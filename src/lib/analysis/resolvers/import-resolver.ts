import ts from "typescript";
import { resolvePackageExports, type WorkspacePackage } from "../monorepo/workspace";

export interface PathAliasConfig {
  baseUrl: string | null;
  paths: Record<string, string[]>;
}

/** Minimal workspace package shape used for cross-package resolution. */
export type WorkspacePackageMapping =
  | string
  | Pick<WorkspacePackage, "root"> & Partial<Pick<WorkspacePackage, "exports" | "main" | "module" | "types">>;

export const EMPTY_ALIAS_CONFIG: PathAliasConfig = { baseUrl: null, paths: {} };

export function normalizeRepoPath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function parseTsConfigAliases(content: string, configPath = "tsconfig.json"): PathAliasConfig {
  let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    const result = ts.parseConfigFileTextToJson(configPath, content);
    parsed = (result.config ?? {}) as typeof parsed;
  } catch {
    return EMPTY_ALIAS_CONFIG;
  }
  const options = parsed.compilerOptions ?? {};
  const rawBaseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
  const baseUrl = rawBaseUrl ? rawBaseUrl : null;
  const paths: Record<string, string[]> = {};
  if (options.paths && typeof options.paths === "object") {
    for (const [key, value] of Object.entries(options.paths)) {
      if (Array.isArray(value)) {
        paths[key] = value.filter((entry): entry is string => typeof entry === "string");
      }
    }
  }
  return { baseUrl, paths };
}

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
const ALL_EXTENSIONS = [...TS_EXTENSIONS, ...JS_EXTENSIONS];

interface ResolverOptions {
  files: Map<string, string>;
  aliases: PathAliasConfig;
  /** Extra direct path mappings, e.g. workspace packages. */
  workspacePackages?: Map<string, WorkspacePackageMapping>;
}

function candidatesForBase(base: string): string[] {
  const candidates: string[] = [];
  candidates.push(base);

  // TypeScript ESM style: "./foo.js" actually points to "./foo.ts".
  const extension = ALL_EXTENSIONS.find((value) => base.endsWith(value));
  if (extension) {
    const stem = base.slice(0, -extension.length);
    for (const replacement of ALL_EXTENSIONS) {
      if (replacement !== extension) candidates.push(stem + replacement);
    }
  } else {
    for (const value of ALL_EXTENSIONS) {
      candidates.push(base + value);
    }
  }

  for (const value of ALL_EXTENSIONS) {
    candidates.push(`${base}/index${value}`);
  }

  return candidates;
}

/**
 * Resolves a module specifier to a repository-relative file path using the
 * analyzed file set only. This intentionally avoids any filesystem or
 * node_modules access: repository code is never installed or executed.
 */
export class ImportResolver {
  private readonly files: Map<string, string>;
  private readonly aliases: PathAliasConfig;
  private readonly workspacePackages: Map<string, WorkspacePackageMapping>;

  constructor(options: ResolverOptions) {
    this.files = options.files;
    this.aliases = options.aliases;
    this.workspacePackages = options.workspacePackages ?? new Map();
  }

  resolve(fromPath: string, specifier: string): string | null {
    if (!specifier) return null;

    // Workspace package mapping (monorepo packages).
    const workspaceTarget = this.resolveWorkspacePackage(specifier);
    if (workspaceTarget) return workspaceTarget;

    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const base = normalizeRepoPath(`${dirname(fromPath)}/${specifier}`);
      return this.findExisting(base);
    }

    // tsconfig path aliases
    const aliased = this.applyAlias(specifier);
    if (aliased) return aliased;

    // Common fallback aliases when tsconfig has no paths at all.
    if (Object.keys(this.aliases.paths).length === 0) {
      if (specifier.startsWith("@/")) {
        const rest = specifier.slice(2);
        return this.findExisting(normalizeRepoPath(`src/${rest}`)) ?? this.findExisting(normalizeRepoPath(rest));
      }
      if (specifier.startsWith("~/")) {
        const rest = specifier.slice(2);
        return this.findExisting(normalizeRepoPath(`src/${rest}`)) ?? this.findExisting(normalizeRepoPath(rest));
      }
    }

    return null;
  }

  private resolveWorkspacePackage(specifier: string): string | null {
    if (this.workspacePackages.size === 0) return null;
    const segments = specifier.split("/");
    const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
    const mapping = this.workspacePackages.get(packageName);
    if (!mapping) return null;
    const pkg = typeof mapping === "string" ? { root: mapping } : mapping;
    const root = pkg.root;
    const rest = specifier.slice(packageName.length).replace(/^\//, "");

    // 1. `exports` map (root import or subpath) — the package's public contract.
    if (pkg.exports && Object.keys(pkg.exports).length > 0) {
      const exportTarget = resolvePackageExports({ exports: pkg.exports }, rest);
      if (exportTarget) {
        const found = this.findExisting(normalizeRepoPath(`${root}/${exportTarget.replace(/^\.\//, "")}`));
        if (found) return found;
      }
    }

    // 2. main/module/types for bare package imports.
    if (!rest) {
      for (const candidate of [pkg.main, pkg.module, pkg.types]) {
        if (!candidate) continue;
        const found = this.findExisting(normalizeRepoPath(`${root}/${candidate.replace(/^\.\//, "")}`));
        if (found) return found;
      }
    }

    // 3. Conventional fallbacks.
    const bases = [normalizeRepoPath(`${root}/${rest}`), normalizeRepoPath(`${root}/src/${rest}`)];
    if (!rest) {
      bases.push(normalizeRepoPath(`${root}/src/index`), normalizeRepoPath(`${root}/index`));
    }
    if (rest === "src" || rest.endsWith("/src")) {
      bases.push(normalizeRepoPath(`${root}/src/index`));
    }
    for (const base of bases) {
      const found = this.findExisting(base);
      if (found) return found;
    }
    return null;
  }

  private applyAlias(specifier: string): string | null {
    const { paths, baseUrl } = this.aliases;

    const patterns = Object.keys(paths).sort((a, b) => b.length - a.length);
    for (const pattern of patterns) {
      const targets = paths[pattern] ?? [];
      if (pattern.includes("*")) {
        const [prefix, suffix] = pattern.split("*");
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
          const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
          for (const target of targets) {
            const substituted = target.replace("*", middle);
            const found = this.findExisting(normalizeRepoPath(substituted));
            if (found) return found;
          }
        }
      } else if (pattern === specifier) {
        for (const target of targets) {
          const found = this.findExisting(normalizeRepoPath(target));
          if (found) return found;
        }
      }
    }

    if (baseUrl) {
      const found = this.findExisting(normalizeRepoPath(`${baseUrl}/${specifier}`));
      if (found) return found;
    }

    return null;
  }

  private findExisting(base: string): string | null {
    const normalized = normalizeRepoPath(base);
    if (!normalized) return null;
    for (const candidate of candidatesForBase(normalized)) {
      if (this.files.has(candidate)) return candidate;
    }
    return null;
  }
}

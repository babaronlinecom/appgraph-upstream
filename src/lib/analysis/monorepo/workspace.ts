/**
 * Monorepo workspace discovery (AG-MONO-001/002).
 * Works solely from repository files: root `package.json` workspaces,
 * `pnpm-workspace.yaml`, `turbo.json`, `nx.json` and per-package manifests.
 */

export interface WorkspacePackage {
  name: string;
  /** Directory relative to the repository root, e.g. "packages/ui". */
  root: string;
  packageJsonPath: string;
  version?: string;
  private: boolean;
  /** Runtime + dev + peer dependencies, as declared. */
  dependencies: Record<string, string>;
  runtimeDependencies: Record<string, string>;
  exports: Record<string, unknown> | string | null;
  main?: string;
  module?: string;
  types?: string;
}

export interface WorkspaceInfo {
  isMonorepo: boolean;
  tool: string | null;
  toolEvidence: string[];
  packages: WorkspacePackage[];
  byName: Map<string, WorkspacePackage>;
}

interface RawPackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
}

const MAX_PACKAGES = 60;

function parseJson(content: string | undefined): RawPackageJson | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as RawPackageJson;
  } catch {
    return null;
  }
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(relativeDir: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegex(glob.trim()).test(relativeDir));
}

/** Minimal `pnpm-workspace.yaml` reader: collects `- "glob"` entries. */
export function parsePnpmWorkspace(content: string | undefined): string[] {
  if (!content) return [];
  const globs: string[] = [];
  let inPackages = false;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^packages\s*:/.test(trimmed)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (!trimmed) continue;
    if (!trimmed.startsWith("-")) {
      if (/^[A-Za-z]/.test(trimmed)) inPackages = false;
      continue;
    }
    const value = trimmed.slice(1).trim().replace(/^["']|["']$/g, "");
    if (value && !value.startsWith("!")) globs.push(value);
  }
  return globs;
}

function rootWorkspaceGlobs(rootPackage: RawPackageJson | null): string[] {
  const workspaces = rootPackage?.workspaces;
  if (Array.isArray(workspaces)) return workspaces;
  if (workspaces && Array.isArray(workspaces.packages)) return workspaces.packages;
  return [];
}

export function detectWorkspaces(input: {
  files: Map<string, string>;
  paths: string[];
}): WorkspaceInfo {
  const { files, paths } = input;
  const rootPackage = parseJson(files.get("package.json"));

  const evidence: string[] = [];
  if (paths.includes("turbo.json")) evidence.push("turbo.json");
  if (paths.includes("nx.json")) evidence.push("nx.json");
  if (paths.includes("pnpm-workspace.yaml")) evidence.push("pnpm-workspace.yaml");
  if (paths.includes("yarn.lock")) evidence.push("yarn.lock");

  const rootGlobs = rootWorkspaceGlobs(rootPackage);
  const pnpmGlobs = parsePnpmWorkspace(files.get("pnpm-workspace.yaml"));
  const globs = [...new Set([...rootGlobs, ...pnpmGlobs])];

  const packageJsonPaths = paths
    .filter((path) => /(^|\/)package\.json$/.test(path))
    .filter((path) => path.split("/").length <= 4)
    .slice(0, 120);

  const includeAllManifests = globs.length === 0 && evidence.includes("nx.json");
  const matchesWorkspace = (dir: string) => matchesAny(dir, globs);

  const packages: WorkspacePackage[] = [];
  for (const packageJsonPath of packageJsonPaths) {
    const root = dirname(packageJsonPath);
    const isRoot = root === "";
    if (isRoot) continue;
    const raw = parseJson(files.get(packageJsonPath));
    if (!raw?.name) continue;
    if (!includeAllManifests && !matchesWorkspace(root)) continue;

    const runtime = raw.dependencies ?? {};
    const dev = raw.devDependencies ?? {};
    const peer = raw.peerDependencies ?? {};
    packages.push({
      name: raw.name,
      root,
      packageJsonPath,
      version: raw.version,
      private: Boolean(raw.private),
      dependencies: { ...peer, ...dev, ...runtime },
      runtimeDependencies: runtime,
      exports: (raw.exports as Record<string, unknown> | string | undefined) ?? null,
      main: raw.main,
      module: raw.module,
      types: raw.types,
    });
    if (packages.length >= MAX_PACKAGES) break;
  }

  const isMonorepo = packages.length > 0 && (globs.length > 0 || includeAllManifests || packages.length > 1);
  if (!isMonorepo) {
    return { isMonorepo: false, tool: null, toolEvidence: evidence, packages: [], byName: new Map() };
  }

  let tool: string | null = null;
  if (evidence.includes("turbo.json")) tool = "turbo";
  else if (evidence.includes("pnpm-workspace.yaml")) tool = "pnpm";
  else if (evidence.includes("nx.json")) tool = "nx";
  else if (evidence.includes("yarn.lock")) tool = "yarn";
  else if (globs.length > 0) tool = "npm";

  packages.sort((a, b) => a.root.localeCompare(b.root));
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

  return { isMonorepo: true, tool, toolEvidence: evidence, packages, byName };
}

/** Returns the deepest workspace package containing a repository path. */
export function packageForPath(
  workspace: WorkspaceInfo,
  path: string,
): WorkspacePackage | undefined {
  let best: WorkspacePackage | undefined;
  for (const pkg of workspace.packages) {
    if (path === pkg.root || path.startsWith(`${pkg.root}/`)) {
      if (!best || pkg.root.length > best.root.length) best = pkg;
    }
  }
  return best;
}

/**
 * Resolves a package-relative subpath through the `exports` map when present.
 * Only concrete string targets are used; wildcard/conditional objects fall
 * through to the default resolution so nothing is guessed.
 */
export function resolvePackageExports(
  pkg: { exports: Record<string, unknown> | string | null },
  subpath: string,
): string | null {
  const exportsField = pkg.exports;
  if (!exportsField) return null;
  const key = subpath ? `./${subpath}` : ".";
  const pick = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const resolved = pick(entry);
        if (resolved) return resolved;
      }
      return null;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const condition of ["import", "default", "require", "module", "node"]) {
        if (condition in record) {
          const resolved = pick(record[condition]);
          if (resolved) return resolved;
        }
      }
    }
    return null;
  };

  if (typeof exportsField === "string") {
    return key === "." ? exportsField : null;
  }
  if (typeof exportsField === "object" && exportsField !== null) {
    const record = exportsField as Record<string, unknown>;
    if (key in record) return pick(record[key]);
    // Wildcard export: "./*": "./src/*.ts"
    for (const [pattern, target] of Object.entries(record)) {
      if (!pattern.includes("*") || typeof target !== "string" || !target.includes("*")) continue;
      const [prefix, suffix] = pattern.split("*");
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const middle = key.slice(prefix.length, key.length - suffix.length);
      return target.replace("*", middle);
    }
  }
  return null;
}

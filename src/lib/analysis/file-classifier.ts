import type { GraphGroupId } from "@/lib/graph/model";
import type { ClassifiedFile, FileCategory, RepositorySignals } from "./types";

const COMPONENT_EXTENSIONS = [".tsx", ".jsx"];

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function withoutExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

function isCapitalized(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

function isComponentLike(path: string): boolean {
  const base = basename(path);
  const lower = base.toLowerCase();
  if (COMPONENT_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return isCapitalized(withoutExtension(base));
  }
  return false;
}

function groupForCategory(category: FileCategory): GraphGroupId {
  switch (category) {
    case "page":
    case "component":
    case "hook":
    case "state":
      return "frontend";
    case "api":
    case "service":
    case "middleware":
      return "backend";
    case "database":
    case "schema":
      return "data";
    case "config":
      return "config";
    default:
      return "frontend";
  }
}

const TEST_PATTERNS: RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)(__tests__|test|tests|e2e|cypress)\//i,
  /(^|\/)\.?storybook\//i,
];

const DATABASE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(lib|src|server)\/(db|database|prisma|drizzle|mongo|mongoose|redis|supabase|knex|sequelize)(\.[cm]?[jt]sx?|\/)/i,
  /(^|\/)prisma\.(client|config)?\.[cm]?[jt]s$/i,
  /(^|\/)(db|database)\.[cm]?[jt]s$/i,
];

const SCHEMA_PATH_PATTERNS: RegExp[] = [
  /(^|\/)schema(\.[cm]?[jt]s|\.prisma)$/i,
  /(^|\/)(db|database|drizzle|prisma)\/(schema|models|entities)(\/|\.)/i,
];

const STATE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(store|stores|state|reducers|slices)(\/|\.)/i,
  /(^|\/)(context|contexts)\//i,
  /\.(store|slice|reducer)\.[cm]?[jt]sx?$/i,
];

const SERVICE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)services?\//i,
  /[.\-/]service\.[cm]?[jt]sx?$/i,
  /[.\-/]services\.[cm]?[jt]sx?$/i,
  /(^|\/)server\/[^/]+\.[cm]?[jt]sx?$/i,
  /(^|\/)lib\/[^/]*(service|repository|repo|client)[^/]*\.[cm]?[jt]sx?$/i,
];

const CONFIG_PATH_PATTERNS: RegExp[] = [
  /(^|\/)[^/]+\.config\.[cm]?[jt]s$/i,
  /(^|\/)config\//i,
];

const UTILITY_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(utils?|helpers?|format|formatters|parsers|constants|types|validation|validators|lib)\//i,
  /(^|\/)(utils?|helpers?|constants|types)\.[cm]?[jt]s$/i,
];

export function createSignals(input: {
  hasNextConfig: boolean;
  hasNextDependency: boolean;
  hasAppDir: boolean;
  hasPagesDir: boolean;
  hasSrcDir: boolean;
  hasTypeScript: boolean;
  hasPrisma: boolean;
  hasDrizzle: boolean;
  hasReactDependency: boolean;
}): RepositorySignals {
  const detectedFrameworks: RepositorySignals["detectedFrameworks"] = [];
  if (input.hasNextConfig || input.hasNextDependency) {
    if (input.hasAppDir) detectedFrameworks.push("nextjs-app");
    if (input.hasPagesDir) detectedFrameworks.push("nextjs-pages");
    if (detectedFrameworks.length === 0) detectedFrameworks.push("nextjs-app");
  }
  if (input.hasReactDependency) detectedFrameworks.push("react");
  detectedFrameworks.push("node");
  if (detectedFrameworks.length === 1) detectedFrameworks.push("generic");

  return {
    ...input,
    detectedFrameworks,
  };
}

function nextRouteFromAppPath(path: string): string | null {
  const normalized = path.replace(/^(\.\/)+/, "");
  const match = normalized.match(/^(?:src\/)?app\/(.*)\/?(page|route|layout|template|error|global-error|loading|not-found|default)\.[cm]?[jt]sx?$/i);
  if (!match) return null;
  let rest = match[1] ?? "";
  rest = rest
    .split("/")
    .filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"))
    .join("/");
  if (!rest) return "/";
  return `/${rest}`;
}

function nextRouteFromPagesPath(path: string): string | null {
  const normalized = path.replace(/^(\.\/)+/, "");
  const match = normalized.match(/^(?:src\/)?pages\/(.*)\.[cm]?[jt]sx?$/i);
  if (!match) return null;
  let rest = match[1] ?? "";
  rest = rest.replace(/(^|\/)index$/i, "");
  rest = rest
    .split("/")
    .filter((segment) => segment && !/^\(.*\)$/.test(segment))
    .join("/");
  return rest ? `/${rest}` : "/";
}

/**
 * Classifies a repository file before expensive parsing. Classification drives
 * which files become semantic entities and how they are grouped.
 */
export function classifyFile(
  path: string,
  signals: RepositorySignals,
  meta: { size?: number } = {},
): ClassifiedFile {
  const normalized = path.replace(/^(\.\/)+/, "");
  const base = basename(normalized);
  const lower = normalized.toLowerCase();

  if (TEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { path: normalized, category: "test", group: "backend", confidence: 0.9, size: meta.size };
  }

  const isAppRouter = signals.hasNextConfig || signals.hasNextDependency || signals.hasAppDir;
  const isPagesRouter = signals.hasNextConfig || signals.hasNextDependency || signals.hasPagesDir;

  // Next.js App Router
  if (isAppRouter && /^(src\/)?app\//i.test(lower)) {
    const route = nextRouteFromAppPath(normalized);
    if (/\/route\.[cm]?[jt]sx?$/i.test(normalized)) {
      return {
        path: normalized,
        category: "api",
        route: route ?? undefined,
        framework: "nextjs-app",
        group: "backend",
        confidence: 0.98,
        size: meta.size,
      };
    }
    if (/\/page\.[cm]?[jt]sx?$/i.test(normalized)) {
      return {
        path: normalized,
        category: "page",
        route: route ?? undefined,
        framework: "nextjs-app",
        group: "frontend",
        confidence: 0.98,
        size: meta.size,
      };
    }
    const special = lower.match(/\/(layout|template|error|global-error|loading|not-found|default)\.[cm]?[jt]sx?$/);
    if (special) {
      return {
        path: normalized,
        category: "component",
        role: special[1].toLowerCase(),
        route: route ?? undefined,
        framework: "nextjs-app",
        group: "frontend",
        confidence: 0.95,
        size: meta.size,
      };
    }
    if (isComponentLike(normalized)) {
      return {
        path: normalized,
        category: "component",
        framework: "nextjs-app",
        group: "frontend",
        confidence: 0.8,
        size: meta.size,
      };
    }
    if (isHookName(withoutExtension(base))) {
      return { path: normalized, category: "hook", framework: "nextjs-app", group: "frontend", confidence: 0.85, size: meta.size };
    }
    return { path: normalized, category: "utility", framework: "nextjs-app", group: "frontend", confidence: 0.6, size: meta.size };
  }

  // Next.js Pages Router
  if (isPagesRouter && /^(src\/)?pages\//i.test(lower)) {
    if (/^(src\/)?pages\/api\//i.test(lower)) {
      const route = nextRouteFromPagesPath(normalized);
      return {
        path: normalized,
        category: "api",
        route: route ?? undefined,
        framework: "nextjs-pages",
        group: "backend",
        confidence: 0.98,
        size: meta.size,
      };
    }
    if (/\/(_app|_document|_error)\.[cm]?[jt]sx?$/i.test(normalized)) {
      return {
        path: normalized,
        category: "component",
        role: "app-shell",
        framework: "nextjs-pages",
        group: "frontend",
        confidence: 0.9,
        size: meta.size,
      };
    }
    const route = nextRouteFromPagesPath(normalized);
    return {
      path: normalized,
      category: "page",
      route: route ?? undefined,
      framework: "nextjs-pages",
      group: "frontend",
      confidence: 0.95,
      size: meta.size,
    };
  }

  // Middleware
  if (/(^|\/)(src\/)?middleware\.[cm]?[jt]s$/i.test(lower)) {
    return { path: normalized, category: "middleware", framework: "nextjs-app", group: "backend", confidence: 0.97, size: meta.size };
  }

  if (DATABASE_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { path: normalized, category: "database", group: "data", confidence: 0.85, size: meta.size };
  }

  if (SCHEMA_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { path: normalized, category: "schema", group: "data", confidence: 0.8, size: meta.size };
  }

  if (STATE_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { path: normalized, category: "state", group: "frontend", confidence: 0.75, size: meta.size };
  }

  if (SERVICE_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    if (isComponentLike(normalized)) {
      return { path: normalized, category: "component", group: "frontend", confidence: 0.6, size: meta.size };
    }
    return { path: normalized, category: "service", group: "backend", confidence: 0.7, size: meta.size };
  }

  if (isHookName(withoutExtension(base))) {
    return { path: normalized, category: "hook", group: "frontend", confidence: 0.8, size: meta.size };
  }

  if (isComponentLike(normalized)) {
    return { path: normalized, category: "component", group: "frontend", confidence: 0.75, size: meta.size };
  }

  if (CONFIG_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { path: normalized, category: "config", group: "config", confidence: 0.8, size: meta.size };
  }

  if (UTILITY_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { path: normalized, category: "utility", group: "frontend", confidence: 0.6, size: meta.size };
  }

  return { path: normalized, category: "unknown", group: "frontend", confidence: 0.4, size: meta.size };
}

export function groupForClassified(file: ClassifiedFile): GraphGroupId {
  return groupForCategory(file.category);
}

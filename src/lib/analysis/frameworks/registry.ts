import type { RepositorySignals } from "../types";
import type { PackageJsonInfo } from "./types";
import { nextjsAnalyzer, nextjsPagesAnalyzer } from "./nextjs";
import { nodeAnalyzer, reactAnalyzer } from "./adapters";

export type { FrameworkAnalyzer, FrameworkAnalysis, FrameworkAnalysisContext, DetectionResult, PackageJsonInfo } from "./types";
export { emptyFrameworkAnalysis, signalsToFrameworkIds } from "./types";
export { nextjsAnalyzer, nextjsPagesAnalyzer, matchRouteTemplate } from "./nextjs";
export { reactAnalyzer, nodeAnalyzer } from "./adapters";

export const FRAMEWORK_ANALYZERS = [nextjsAnalyzer, nextjsPagesAnalyzer, reactAnalyzer, nodeAnalyzer];

export function parsePackageJson(content: string | undefined): PackageJsonInfo | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as PackageJsonInfo & { name?: string };
    return {
      name: parsed.name,
      dependencies: parsed.dependencies ?? {},
      devDependencies: parsed.devDependencies ?? {},
      workspaces: parsed.workspaces,
      scripts: parsed.scripts,
    };
  } catch {
    return null;
  }
}

/** Derives repository-level signals used by classification and framework analysis. */
export function detectRepositorySignals(options: {
  paths: string[];
  packageJson: PackageJsonInfo | null;
}): RepositorySignals {
  const { paths, packageJson } = options;
  const dependencies = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const hasNextConfig = paths.some((path) => /^next\.config\.[cm]?[jt]s$/.test(path));
  const hasNextDependency = Boolean(dependencies.next);
  const hasAppDir = paths.some((path) => /^(src\/)?app\//.test(path));
  const hasPagesDir = paths.some((path) => /^(src\/)?pages\//.test(path));
  const hasSrcDir = paths.some((path) => path.startsWith("src/"));
  const hasTypeScript = paths.some((path) => path.endsWith(".ts") || path.endsWith(".tsx"));

  const detectionContext = { paths, files: new Map<string, string>(), packageJson };
  const detections = FRAMEWORK_ANALYZERS.map((analyzer) => analyzer.detect(detectionContext));
  const detectedFrameworks = detections
    .filter((detection) => detection.detected)
    .map((detection) => detection.id);

  return {
    hasNextConfig,
    hasNextDependency,
    hasAppDir,
    hasPagesDir,
    hasSrcDir,
    hasTypeScript,
    hasPrisma: Boolean(dependencies["@prisma/client"] || dependencies.prisma || paths.some((path) => path === "prisma/schema.prisma")),
    hasDrizzle: Boolean(dependencies["drizzle-orm"] || dependencies["drizzle-kit"]),
    hasReactDependency: Boolean(dependencies.react),
    detectedFrameworks: detectedFrameworks.length > 0 ? detectedFrameworks : ["node"],
  };
}

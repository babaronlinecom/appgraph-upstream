import type { AppGraphEdge } from "@/lib/graph/model";
import type { FrameworkAnalysisContext, FrameworkAnalysis, FrameworkAnalyzer, FrameworkDetectionContext, DetectionResult } from "./types";
import { emptyFrameworkAnalysis } from "./types";

/** Matches concrete request paths to dynamic route templates: /api/x/1 -> /api/x/[id]. */
export function matchRouteTemplate(route: string, template: string): boolean {
  const routeSegments = route.split("/").filter(Boolean);
  const templateSegments = template.split("/").filter(Boolean);
  if (routeSegments.length !== templateSegments.length) {
    for (let index = 0; index < templateSegments.length; index += 1) {
      const segment = templateSegments[index];
      if (segment.startsWith("[...") || segment.startsWith("[[...")) {
        return routeSegments.length >= index;
      }
    }
    return false;
  }
  for (let index = 0; index < templateSegments.length; index += 1) {
    const segment = templateSegments[index];
    if (segment.startsWith("[[...") || segment.startsWith("[...")) return true;
    if (segment.startsWith("[") && segment.endsWith("]")) continue;
    if (segment !== routeSegments[index]) return false;
  }
  return true;
}

function createRouteEdges(context: FrameworkAnalysisContext, analyzerId: string): AppGraphEdge[] {
  const edges: AppGraphEdge[] = [];
  const seen = new Set<string>();

  for (const parsed of context.context.parsed.values()) {
    const sourceNode = context.nodes.get(`file:${parsed.path}`);
    if (!sourceNode || parsed.fetchPaths.length === 0) continue;

    for (const fetchPath of parsed.fetchPaths) {
      const path = fetchPath.path;
      if (!path.startsWith("/api/") && !path.startsWith("/api")) continue;
      const normalized = path.split("?")[0].replace(/\/$/, "") || "/api";
      const candidates = context.nodeIdByRoute.get(normalized) ?? [];

      let targetId: string | undefined = candidates[0];
      let matchedRoute: string | undefined = targetId ? normalized : undefined;
      if (!targetId) {
        for (const [route, ids] of context.nodeIdByRoute) {
          if (route.startsWith("/api") && matchRouteTemplate(normalized, route)) {
            targetId = ids[0];
            matchedRoute = route;
            break;
          }
        }
      }

      if (targetId && targetId !== sourceNode.id) {
        const id = `edge:routes_to:${sourceNode.id}->${targetId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push({
          id,
          source: sourceNode.id,
          target: targetId,
          type: "routes_to",
          confidence: 0.88,
          metadata: {
            label: "routes_to",
            via: normalized,
            evidence: [
              {
                path: fetchPath.range.path,
                startLine: fetchPath.range.startLine,
                endLine: fetchPath.range.endLine,
                analyzerId,
                ruleId: "nextjs.fetch-route-match",
                kind: "inferred",
                reason: `fetch("${path}") matched route ${matchedRoute ?? normalized}`,
              },
            ],
          },
        });
      }
    }
  }

  return edges;
}

export const nextjsAnalyzer: FrameworkAnalyzer = {
  id: "nextjs-app",
  label: "Next.js",
  detect(context: FrameworkDetectionContext): DetectionResult {
    const evidence: string[] = [];
    const hasNextConfig = context.paths.some((path) => /^next\.config\.[cm]?[jt]s$/.test(path));
    const hasNextDependency =
      Boolean(context.packageJson?.dependencies?.next) || Boolean(context.packageJson?.devDependencies?.next);
    const hasAppDir = context.paths.some((path) => /^(src\/)?app\//.test(path));
    const hasPagesDir = context.paths.some((path) => /^(src\/)?pages\//.test(path));
    if (hasNextConfig) evidence.push("next.config found");
    if (hasNextDependency) evidence.push("next dependency found");
    if (hasAppDir) evidence.push("app/ directory found");
    if (hasPagesDir) evidence.push("pages/ directory found");
    const detected = hasNextConfig || hasNextDependency || hasAppDir || hasPagesDir;
    return {
      id: "nextjs-app",
      label: "Next.js",
      detected,
      confidence: hasNextDependency && (hasAppDir || hasPagesDir) ? 1 : detected ? 0.8 : 0,
      evidence,
    };
  },
  analyze(context: FrameworkAnalysisContext): FrameworkAnalysis {
    const result = emptyFrameworkAnalysis();
    result.extraEdges = createRouteEdges(context, this.id);
    return result;
  },
};

/** Pages-router projects use the same route-edge logic; kept as a separate adapter id. */
export const nextjsPagesAnalyzer: FrameworkAnalyzer = {
  ...nextjsAnalyzer,
  id: "nextjs-pages",
  label: "Next.js (Pages Router)",
  detect(context: FrameworkDetectionContext): DetectionResult {
    const result = nextjsAnalyzer.detect(context);
    const hasPagesDir = context.paths.some((path) => /^(src\/)?pages\//.test(path));
    return {
      ...result,
      id: "nextjs-pages",
      detected: result.detected && hasPagesDir,
      evidence: [...result.evidence, hasPagesDir ? "pages/ router detected" : "pages/ router missing"],
    };
  },
};

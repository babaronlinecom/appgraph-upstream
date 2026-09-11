import type { FrameworkAnalysisContext, FrameworkAnalysis, FrameworkAnalyzer, FrameworkDetectionContext, DetectionResult } from "./types";
import { emptyFrameworkAnalysis } from "./types";

export const reactAnalyzer: FrameworkAnalyzer = {
  id: "react",
  label: "React",
  detect(context: FrameworkDetectionContext): DetectionResult {
    const evidence: string[] = [];
    const hasReact =
      Boolean(context.packageJson?.dependencies?.react) ||
      Boolean(context.packageJson?.devDependencies?.react);
    if (hasReact) evidence.push("react dependency found");
    const tsxFiles = context.paths.filter((path) => /\.(tsx|jsx)$/.test(path));
    if (tsxFiles.length > 0) evidence.push(`${tsxFiles.length} JSX files`);
    return {
      id: "react",
      label: "React",
      detected: hasReact || tsxFiles.length > 0,
      confidence: hasReact ? 0.95 : tsxFiles.length > 0 ? 0.6 : 0,
      evidence,
    };
  },
  analyze(context: FrameworkAnalysisContext): FrameworkAnalysis {
    const result = emptyFrameworkAnalysis();
    for (const parsed of context.context.parsed.values()) {
      if (parsed.components.length === 0) continue;
      const nodeId = `file:${parsed.path}`;
      const node = context.nodes.get(nodeId);
      // Pages/components are self-evident; only flag plain modules that export JSX.
      if (node?.type === "module") {
        result.nodeMetadata.set(nodeId, { role: "component" });
      }
    }
    return result;
  },
};

export const nodeAnalyzer: FrameworkAnalyzer = {
  id: "node",
  label: "Node.js",
  detect(context: FrameworkDetectionContext): DetectionResult {
    const evidence: string[] = [];
    const hasNodeTypes = Boolean(context.packageJson?.devDependencies?.["@types/node"]);
    const hasServerEntry = context.paths.some((path) =>
      /^(src\/)?(index|server|main|app|www)\.[cm]?[jt]s$/.test(path),
    );
    if (hasNodeTypes) evidence.push("@types/node found");
    if (hasServerEntry) evidence.push("server entry candidate found");
    return {
      id: "node",
      label: "Node.js",
      detected: hasNodeTypes || hasServerEntry || context.packageJson !== null,
      confidence: hasNodeTypes ? 0.8 : 0.5,
      evidence,
    };
  },
  analyze(context: FrameworkAnalysisContext): FrameworkAnalysis {
    const result = emptyFrameworkAnalysis();
    for (const parsed of context.context.parsed.values()) {
      const isServerEntry = parsed.calls.some((call) =>
        /(^|\.)(listen|createServer)$/.test(call.name) || /\.listen\($/.test(call.name),
      );
      if (isServerEntry) {
        result.nodeMetadata.set(`file:${parsed.path}`, { role: "server-entry" });
      }
    }
    return result;
  },
};

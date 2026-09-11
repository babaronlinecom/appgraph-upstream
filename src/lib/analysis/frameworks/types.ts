import type { AppGraphEdge, AppGraphNode, AppGraphNodeMetadata } from "@/lib/graph/model";
import type { ClassifiedFile, FrameworkId, RepositoryContext, RepositorySignals } from "../types";

export interface FrameworkDetectionContext {
  paths: string[];
  files: Map<string, string>;
  packageJson: PackageJsonInfo | null;
}

export interface PackageJsonInfo {
  name?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

export interface DetectionResult {
  id: FrameworkId;
  label: string;
  detected: boolean;
  confidence: number;
  evidence: string[];
}

export interface FrameworkAnalysisContext {
  context: RepositoryContext;
  nodes: Map<string, AppGraphNode>;
  /** API/page nodes keyed by normalized route path. */
  nodeIdByRoute: Map<string, string[]>;
  classify: (path: string) => ClassifiedFile | undefined;
}

export interface FrameworkAnalysis {
  extraEdges: AppGraphEdge[];
  nodeMetadata: Map<string, Partial<AppGraphNodeMetadata>>;
  warnings: Array<{ code: string; severity: "info" | "warning" | "error"; message: string; detail?: string }>;
}

export interface FrameworkAnalyzer {
  id: FrameworkId;
  label: string;
  detect(context: FrameworkDetectionContext): DetectionResult;
  analyze(context: FrameworkAnalysisContext): FrameworkAnalysis | Promise<FrameworkAnalysis>;
}

export function emptyFrameworkAnalysis(): FrameworkAnalysis {
  return { extraEdges: [], nodeMetadata: new Map(), warnings: [] };
}

export function signalsToFrameworkIds(signals: RepositorySignals): FrameworkId[] {
  return signals.detectedFrameworks;
}

import type { GraphGroupId, RepositoryMetadata, RepositoryTree } from "@/lib/graph/model";
import type { FileIR, IrExport, IrImport, IrSourceRange } from "./ir/model";
import type { WorkspaceInfo } from "./monorepo/workspace";

export type FileCategory =
  | "page"
  | "api"
  | "component"
  | "hook"
  | "service"
  | "database"
  | "schema"
  | "middleware"
  | "config"
  | "utility"
  | "state"
  | "test"
  | "style"
  | "asset"
  | "unknown";

export type FrameworkId = "nextjs-app" | "nextjs-pages" | "react" | "node" | "generic";

export interface RepositorySignals {
  hasNextConfig: boolean;
  hasNextDependency: boolean;
  hasAppDir: boolean;
  hasPagesDir: boolean;
  hasSrcDir: boolean;
  hasTypeScript: boolean;
  hasPrisma: boolean;
  hasDrizzle: boolean;
  hasReactDependency: boolean;
  detectedFrameworks: FrameworkId[];
}

export interface ClassifiedFile {
  path: string;
  category: FileCategory;
  role?: string;
  route?: string;
  methods?: string[];
  framework?: FrameworkId;
  group: GraphGroupId;
  confidence: number;
  size?: number;
}

/**
 * Parser output = normalized Software IR. The historical names are kept as
 * aliases so existing modules and tests continue to work while the codebase
 * migrates to IR terminology.
 */
export type ParsedImport = IrImport;
export type ParsedExport = IrExport;
export type ParsedFile = FileIR;
export type SourceRange = IrSourceRange;

export interface IntegrationDefinition {
  id: string;
  label: string;
  category: string;
  kind: "external" | "database" | "orm" | "auth" | "storage" | "ai" | "observability" | "payments" | "email";
  packages: string[];
  /** Used when the SDK maps to a concrete data store, e.g. pg -> PostgreSQL. */
  databaseLabel?: string;
}

export interface DetectedIntegration {
  definition: IntegrationDefinition;
  packageName: string;
  files: string[];
  confidence: number;
}

export interface AnalysisWarningDraft {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  detail?: string;
}

export interface RepositoryContext {
  metadata: RepositoryMetadata;
  commitSha: string;
  ref: string;
  tree: RepositoryTree;
  signals: RepositorySignals;
  limits: {
    maxAnalyzedFiles: number;
    maxFileBytes: number;
    maxSnippetLines: number;
    maxGraphNodes: number;
    maxGraphEdges: number;
    maxComponents: number;
    maxExternalNodes: number;
    maxSymbolNodes: number;
    maxSymbolEdges: number;
  };
  files: Map<string, string>;
  classified: Map<string, ClassifiedFile>;
  parsed: Map<string, ParsedFile>;
  resolvedImports: Map<string, Map<string, string | null>>;
  integrations: DetectedIntegration[];
  /** Deterministic data-schema detections (Prisma/Drizzle/SQL adapters). */
  dataSchemas: import("./data/registry").DataSchemaDetection[];
  /** Monorepo workspace discovery (npm/pnpm/yarn/turbo/nx). */
  workspace: WorkspaceInfo;
  envVars: Map<string, string[]>;
  envExampleVars: string[];
  warnings: AnalysisWarningDraft[];
  timings: Record<string, number>;
}

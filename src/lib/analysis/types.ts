import type { GraphGroupId, RepositoryMetadata, RepositoryTree } from "@/lib/graph/model";

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

export interface ParsedImport {
  specifier: string;
  kind: "default" | "named" | "namespace" | "side-effect" | "type";
  importedNames: string[];
  localNames: string[];
  typeOnly: boolean;
  line: number;
}

export interface ParsedExport {
  name: string;
  kind: "function" | "class" | "const" | "component" | "hook" | "default" | "type" | "re-export";
  line: number;
}

export interface ParsedFile {
  path: string;
  imports: ParsedImport[];
  exports: ParsedExport[];
  defaultExport?: ParsedExport;
  components: string[];
  hooks: string[];
  functions: string[];
  classes: string[];
  jsxTags: Array<{ name: string; line: number }>;
  calls: Array<{ name: string; line: number }>;
  routeHandlers: Array<{ method: string; line: number }>;
  envVars: string[];
  fetchPaths: Array<{ path: string; line: number }>;
  directives: { useClient: boolean; useServer: boolean };
  usesJsx: boolean;
  lines: string[];
}

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
  };
  files: Map<string, string>;
  classified: Map<string, ClassifiedFile>;
  parsed: Map<string, ParsedFile>;
  resolvedImports: Map<string, Map<string, string | null>>;
  integrations: DetectedIntegration[];
  envVars: Map<string, string[]>;
  envExampleVars: string[];
  warnings: AnalysisWarningDraft[];
  timings: Record<string, number>;
}

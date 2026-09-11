/**
 * Core graph model for AppGraph.
 *
 * The model is intentionally independent from any canvas/UI library.
 * Everything the analyzer produces is serializable JSON.
 */

export type GraphNodeType =
  | "page"
  | "component"
  | "api"
  | "service"
  | "database"
  | "external"
  | "state"
  | "middleware"
  | "config"
  | "module"
  | "group";

export type GraphEdgeType =
  | "imports"
  | "renders"
  | "calls"
  | "reads"
  | "writes"
  | "depends_on"
  | "routes_to"
  | "uses"
  | "unknown";

export type GraphGranularity = "product" | "architecture" | "modules" | "files";

export const GRANULARITY_ORDER: Record<GraphGranularity, number> = {
  product: 0,
  architecture: 1,
  modules: 2,
  files: 3,
};

export const GRANULARITY_LABELS: Record<GraphGranularity, string> = {
  product: "Product",
  architecture: "Architecture",
  modules: "Modules",
  files: "Files",
};

export type GraphGroupId = "frontend" | "backend" | "data" | "config" | "external";

export interface GraphGroupDefinition {
  id: GraphGroupId;
  title: string;
  description: string;
  /** Left-to-right flow order across the canvas. */
  order: number;
}

export const GRAPH_GROUPS: GraphGroupDefinition[] = [
  { id: "frontend", title: "Frontend", description: "Pages, components, state", order: 0 },
  { id: "backend", title: "Backend", description: "API routes, services, middleware", order: 1 },
  { id: "data", title: "Data", description: "Databases, schemas", order: 2 },
  { id: "config", title: "Configuration", description: "Environment and runtime config", order: 3 },
  { id: "external", title: "External Services", description: "Third-party SDKs and APIs", order: 4 },
];

export interface AppGraphSourceRef {
  path: string;
  startLine?: number;
  endLine?: number;
}

/** How a relationship was established. */
export type EdgeEvidenceKind = "exact" | "resolved" | "inferred";

/**
 * Provenance for a semantic relationship. Every edge should be explainable:
 * which file and line proved it, which analyzer produced it and under which
 * rule. This is the basis for the Inspector "Evidence" section.
 */
export interface EdgeEvidence {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  analyzerId: string;
  ruleId: string;
  kind: EdgeEvidenceKind;
  reason?: string;
}

export interface NodeSymbolInfo {
  name: string;
  kind: string;
  line: number;
  endLine?: number;
  exported?: boolean;
}

export interface AppGraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  subtitle?: string;
  path?: string;
  symbol?: string;
  framework?: string;
  /** Inference confidence for the entity itself (1 = certain). */
  confidence: number;
  /** Minimum granularity at which this node becomes visible. */
  granularity: GraphGranularity;
  metadata: AppGraphNodeMetadata;
  source?: AppGraphSourceRef;
}

export interface AppGraphNodeMetadata {
  group: GraphGroupId;
  role?: string;
  route?: string;
  methods?: string[];
  imports?: string[];
  exports?: string[];
  envVars?: string[];
  symbols?: NodeSymbolInfo[];
  usageCount?: number;
  description?: string;
  snippet?: string;
  snippetLanguage?: string;
  url?: string;
  integrationKind?: string;
  archived?: boolean;
  [key: string]: unknown;
}

export interface AppGraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  confidence: number;
  metadata?: AppGraphEdgeMetadata;
}

export interface AppGraphEdgeMetadata {
  label?: string;
  count?: number;
  via?: string;
  envVars?: string[];
  methods?: string[];
  evidence?: EdgeEvidence[];
  [key: string]: unknown;
}

export interface NodePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: GraphGroupId;
  parentId?: string;
}

export interface LayoutGroup {
  id: string;
  group: GraphGroupId;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
}

export interface GraphLayout {
  granularity: GraphGranularity;
  nodePlacements: Record<string, NodePlacement>;
  groups: LayoutGroup[];
  bounds: { width: number; height: number };
}

export interface GraphWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  detail?: string;
}

export interface GraphStats {
  treeEntries: number;
  sourceFiles: number;
  analyzedFiles: number;
  entities: number;
  relationships: number;
  externalServices: number;
  pages: number;
  apis: number;
  services: number;
  components: number;
  databaseNodes: number;
  truncated: boolean;
  durationMs: number;
  cacheHit: boolean;
}

/**
 * What the analyzer actually understood for this repository. Reported honestly
 * so users can see coverage instead of silently missing data.
 */
export interface GraphCapabilities {
  languages: string[];
  frameworks: string[];
  /** Detected schema formats, e.g. "prisma". */
  databaseSchemas: string[];
  /** Registered schema analyzer ids, e.g. "prisma-schema". */
  dataSchemaAnalyzers: string[];
  apiProtocols: string[];
  asyncSystems: string[];
  infrastructure: string[];
  symbolResolution: "full" | "partial" | "none";
  parsers: string[];
  integrations: number;
}

export interface AppGraphDocument {
  schemaVersion: string;
  analysisVersion: string;
  repository: RepositoryMetadata;
  commitSha: string;
  ref: string;
  nodes: AppGraphNode[];
  edges: AppGraphEdge[];
  warnings: GraphWarning[];
  stats: GraphStats;
  layouts: Record<GraphGranularity, GraphLayout>;
  capabilities: GraphCapabilities;
  generatedAt: string;
}

export interface RepositoryIdentity {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
}

export interface RepositoryMetadata {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  language: string | null;
  topics: string[];
  url: string;
  homepage: string | null;
  license: string | null;
  pushedAt: string | null;
  createdAt: string | null;
  archived: boolean;
  sizeKb: number;
  openIssues: number;
}

export interface RepositoryTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha?: string;
}

export interface RepositoryTree {
  entries: RepositoryTreeEntry[];
  truncated: boolean;
  sha: string;
  ref: string;
}

export interface RepositoryFile {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  sha?: string;
}

/**
 * Schema history:
 * - 1.0.0 — initial public document shape.
 * - 1.1.0 — additive: `capabilities`, edge evidence (`metadata.evidence`),
 *   node symbol info (`metadata.symbols`). Backward compatible: older readers
 *   ignore the new fields. See docs/graph-schema.md.
 */
export const GRAPH_SCHEMA_VERSION = "1.1.0";

/** Fixed canvas node dimensions shared by the layout engine and the UI. */
export const NODE_WIDTH = 252;
export const NODE_HEIGHT = 92;

export function emptyLayout(granularity: GraphGranularity): GraphLayout {
  return {
    granularity,
    nodePlacements: {},
    groups: [],
    bounds: { width: 0, height: 0 },
  };
}

export function createEmptyLayouts(): Record<GraphGranularity, GraphLayout> {
  return {
    product: emptyLayout("product"),
    architecture: emptyLayout("architecture"),
    modules: emptyLayout("modules"),
    files: emptyLayout("files"),
  };
}

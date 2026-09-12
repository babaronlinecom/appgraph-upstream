import {
  GRANULARITY_ORDER,
  type AppGraphDocument,
  type AppGraphEdge,
  type AppGraphNode,
  type GraphEdgeType,
  type GraphGranularity,
  type GraphGroupId,
  type GraphLayout,
} from "@/lib/graph/model";
import { getGraphIndexes } from "@/lib/graph/indexes";
import type { WorkspaceFilters } from "./store";

export const ALL_EDGE_TYPES: GraphEdgeType[] = [
  "imports",
  "renders",
  "calls",
  "reads",
  "writes",
  "routes_to",
  "uses",
  "depends_on",
  "unknown",
];

export const DEFAULT_FILTERS: WorkspaceFilters = {
  minConfidence: 0.5,
  showExternal: true,
  showConfig: true,
  hideLowConfidence: false,
  edgeTypes: Object.fromEntries(ALL_EDGE_TYPES.map((type) => [type, true])) as Record<GraphEdgeType, boolean>,
};

export function isNodeVisible(
  node: AppGraphNode,
  granularity: GraphGranularity,
  filters: WorkspaceFilters,
): boolean {
  if (GRANULARITY_ORDER[node.granularity] > GRANULARITY_ORDER[granularity]) return false;
  if (!filters.showExternal && node.type === "external") return false;
  if (!filters.showConfig && (node.type === "config" || node.metadata.group === "config")) return false;
  return true;
}

export function visibleNodes(
  graph: AppGraphDocument,
  granularity: GraphGranularity,
  filters: WorkspaceFilters,
): AppGraphNode[] {
  return graph.nodes.filter((node) => isNodeVisible(node, granularity, filters));
}

export function visibleEdges(
  graph: AppGraphDocument,
  granularity: GraphGranularity,
  filters: WorkspaceFilters,
  visibleIds: Set<string>,
): AppGraphEdge[] {
  return graph.edges.filter((edge) => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return false;
    if (filters.minConfidence > 0 && edge.confidence < filters.minConfidence) return false;
    if (!filters.edgeTypes[edge.type]) return false;
    return true;
  });
}

export function connectionCounts(graph: AppGraphDocument): Map<string, number> {
  return getGraphIndexes(graph).connectionCounts;
}

export interface NeighborSet {
  nodes: Set<string>;
  edges: Set<string>;
}

export function neighborsOf(
  graph: AppGraphDocument,
  nodeId: string,
  direction: "both" | "in" | "out" = "both",
): NeighborSet {
  const indexes = getGraphIndexes(graph);
  const nodes = new Set<string>([nodeId]);
  const edges = new Set<string>();
  const outgoing = direction !== "in" ? indexes.outgoingByNode.get(nodeId) ?? [] : [];
  const incoming = direction !== "out" ? indexes.incomingByNode.get(nodeId) ?? [] : [];
  for (const edge of outgoing) {
    edges.add(edge.id);
    nodes.add(edge.target);
  }
  for (const edge of incoming) {
    edges.add(edge.id);
    nodes.add(edge.source);
  }
  return { nodes, edges };
}

export function groupCounts(nodes: AppGraphNode[]): Map<GraphGroupId, number> {
  const counts = new Map<GraphGroupId, number>();
  for (const node of nodes) {
    counts.set(node.metadata.group, (counts.get(node.metadata.group) ?? 0) + 1);
  }
  return counts;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function shortRepoName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  return { owner: owner ?? fullName, repo: repo ?? "" };
}

/**
 * Layout lookup with a graceful fallback: documents cached before a
 * granularity existed (e.g. "symbols") must not crash the canvas.
 */
export function layoutFor(
  graph: AppGraphDocument,
  granularity: GraphGranularity,
): GraphLayout | undefined {
  return (
    graph.layouts[granularity] ??
    graph.layouts.files ??
    graph.layouts.modules ??
    graph.layouts.architecture ??
    graph.layouts.product
  );
}

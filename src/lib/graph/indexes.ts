import type {
  AppGraphDocument,
  AppGraphEdge,
  AppGraphNode,
  GraphEdgeType,
  GraphGroupId,
  GraphNodeType,
} from "./model";

/**
 * Precomputed graph indexes (AG-PERF-005). Hot interactions (hover, selection,
 * filters) must not rescan every edge of the document.
 */
export interface GraphIndexes {
  nodeById: Map<string, AppGraphNode>;
  nodesByPath: Map<string, AppGraphNode>;
  outgoingByNode: Map<string, AppGraphEdge[]>;
  incomingByNode: Map<string, AppGraphEdge[]>;
  nodesByType: Map<GraphNodeType, AppGraphNode[]>;
  nodesByGroup: Map<GraphGroupId, AppGraphNode[]>;
  edgesByType: Map<GraphEdgeType, AppGraphEdge[]>;
  connectionCounts: Map<string, number>;
}

export function buildGraphIndexes(graph: AppGraphDocument): GraphIndexes {
  const nodeById = new Map<string, AppGraphNode>();
  const nodesByPath = new Map<string, AppGraphNode>();
  const outgoingByNode = new Map<string, AppGraphEdge[]>();
  const incomingByNode = new Map<string, AppGraphEdge[]>();
  const nodesByType = new Map<GraphNodeType, AppGraphNode[]>();
  const nodesByGroup = new Map<GraphGroupId, AppGraphNode[]>();
  const edgesByType = new Map<GraphEdgeType, AppGraphEdge[]>();
  const connectionCounts = new Map<string, number>();

  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
    if (node.path) nodesByPath.set(node.path, node);
    const byType = nodesByType.get(node.type) ?? [];
    byType.push(node);
    nodesByType.set(node.type, byType);
    const byGroup = nodesByGroup.get(node.metadata.group) ?? [];
    byGroup.push(node);
    nodesByGroup.set(node.metadata.group, byGroup);
  }

  for (const edge of graph.edges) {
    const outgoing = outgoingByNode.get(edge.source) ?? [];
    outgoing.push(edge);
    outgoingByNode.set(edge.source, outgoing);
    const incoming = incomingByNode.get(edge.target) ?? [];
    incoming.push(edge);
    incomingByNode.set(edge.target, incoming);
    const byType = edgesByType.get(edge.type) ?? [];
    byType.push(edge);
    edgesByType.set(edge.type, byType);
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
  }

  return {
    nodeById,
    nodesByPath,
    outgoingByNode,
    incomingByNode,
    nodesByType,
    nodesByGroup,
    edgesByType,
    connectionCounts,
  };
}

const indexCache = new WeakMap<AppGraphDocument, GraphIndexes>();

/** Memoized per graph document; rebuilt automatically for a new document. */
export function getGraphIndexes(graph: AppGraphDocument): GraphIndexes {
  const cached = indexCache.get(graph);
  if (cached) return cached;
  const indexes = buildGraphIndexes(graph);
  indexCache.set(graph, indexes);
  return indexes;
}

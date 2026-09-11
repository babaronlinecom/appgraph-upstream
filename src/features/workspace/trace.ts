import type {
  AppGraphDocument,
  AppGraphEdge,
  AppGraphNode,
  GraphEdgeType,
} from "@/lib/graph/model";

/**
 * Semantic traversal priorities: request/data flow reads naturally from
 * routes to calls to data access, while plain imports stay in the background.
 */
export const EDGE_PRIORITY: Record<GraphEdgeType, number> = {
  routes_to: 0,
  calls: 1,
  renders: 2,
  reads: 3,
  writes: 4,
  uses: 5,
  imports: 6,
  depends_on: 8,
  unknown: 9,
};

export type TraceMode = "downstream" | "impact" | "path" | "flow";

export interface TraceStep {
  nodeIds: string[];
  edgeIds: string[];
  label: string;
}

export interface TraceSetup {
  mode: TraceMode;
  title: string;
  subtitle?: string;
  steps: TraceStep[];
}

export interface DetectedFlow {
  id: string;
  title: string;
  nodeIds: string[];
  edgeIds: string[];
  endpoint?: string;
  score: number;
}

interface Adjacency {
  outgoing: Map<string, AppGraphEdge[]>;
  incoming: Map<string, AppGraphEdge[]>;
}

function sortEdges(edges: AppGraphEdge[]): AppGraphEdge[] {
  return edges.sort((a, b) => {
    const priority = (EDGE_PRIORITY[a.type] ?? 9) - (EDGE_PRIORITY[b.type] ?? 9);
    if (priority !== 0) return priority;
    return b.confidence - a.confidence;
  });
}

export function buildAdjacency(graph: AppGraphDocument): Adjacency {
  const outgoing = new Map<string, AppGraphEdge[]>();
  const incoming = new Map<string, AppGraphEdge[]>();
  for (const edge of graph.edges) {
    const out = outgoing.get(edge.source) ?? [];
    out.push(edge);
    outgoing.set(edge.source, out);
    const inc = incoming.get(edge.target) ?? [];
    inc.push(edge);
    incoming.set(edge.target, inc);
  }
  for (const list of outgoing.values()) sortEdges(list);
  for (const list of incoming.values()) sortEdges(list);
  return { outgoing, incoming };
}

function nodeMap(graph: AppGraphDocument): Map<string, AppGraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function shortLabel(label: string, max = 26): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

interface TraversalOptions {
  maxDepth?: number;
  maxNodes?: number;
  maxBranching?: number;
}

function traverse(
  graph: AppGraphDocument,
  startId: string,
  direction: "out" | "in",
  options: TraversalOptions = {},
): TraceSetup | null {
  const { maxDepth = 6, maxNodes = 260 } = options;
  const start = graph.nodes.find((node) => node.id === startId);
  if (!start) return null;

  const adjacency = buildAdjacency(graph);
  const pick = direction === "out" ? adjacency.outgoing : adjacency.incoming;
  const nextId = (edge: AppGraphEdge) => (direction === "out" ? edge.target : edge.source);

  const visited = new Set<string>([startId]);
  let frontier: string[] = [startId];
  const steps: TraceStep[] = [{ nodeIds: [startId], edgeIds: [], label: start.label }];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const levelNodes = new Set<string>();
    const levelEdges = new Set<string>();
    for (const id of frontier) {
      for (const edge of pick.get(id) ?? []) {
        if (visited.size >= maxNodes) break;
        const target = nextId(edge);
        if (visited.has(target)) continue;
        visited.add(target);
        levelNodes.add(target);
        levelEdges.add(edge.id);
      }
    }
    if (levelNodes.size === 0) break;
    steps.push({
      nodeIds: [...levelNodes],
      edgeIds: [...levelEdges],
      label:
        direction === "out"
          ? `${levelNodes.size} downstream connection${levelNodes.size === 1 ? "" : "s"}`
          : `${levelNodes.size} dependent entit${levelNodes.size === 1 ? "y" : "ies"}`,
    });
    frontier = [...levelNodes];
  }

  if (steps.length === 1) return null;

  return direction === "out"
    ? {
        mode: "downstream",
        title: `Flow from ${start.label}`,
        subtitle: start.path ?? start.subtitle,
        steps,
      }
    : {
        mode: "impact",
        title: `Impact of ${start.label}`,
        subtitle: start.path ?? start.subtitle,
        steps,
      };
}

/** Traces what a node leads to: page → API → service → data → external. */
export function traceDownstream(
  graph: AppGraphDocument,
  startId: string,
  options?: TraversalOptions,
): TraceSetup | null {
  return traverse(graph, startId, "out", options);
}

/** Traces what depends on a node (reverse reachability). */
export function traceImpact(
  graph: AppGraphDocument,
  startId: string,
  options?: TraversalOptions,
): TraceSetup | null {
  return traverse(graph, startId, "in", options);
}

export interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
}

/** Shortest undirected path between two entities. */
export function findPath(
  graph: AppGraphDocument,
  fromId: string,
  toId: string,
): GraphPath | null {
  if (fromId === toId) return null;
  const adjacency = buildAdjacency(graph);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const seen = new Set<string>([fromId]);
  const queue: string[] = [fromId];
  let found = false;

  while (queue.length > 0 && !found) {
    const current = queue.shift() as string;
    const edges = [...(adjacency.outgoing.get(current) ?? []), ...(adjacency.incoming.get(current) ?? [])];
    for (const edge of edges) {
      const next = edge.source === current ? edge.target : edge.source;
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, { nodeId: current, edgeId: edge.id });
      if (next === toId) {
        found = true;
        break;
      }
      queue.push(next);
    }
  }

  if (!previous.has(toId)) return null;
  const nodeIds: string[] = [toId];
  const edgeIds: string[] = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const step = previous.get(cursor);
    if (!step) return null;
    edgeIds.unshift(step.edgeId);
    nodeIds.unshift(step.nodeId);
    cursor = step.nodeId;
  }
  return { nodeIds, edgeIds };
}

/** Converts a concrete path into an ordered, playable trace. */
export function pathToTraceSetup(
  graph: AppGraphDocument,
  path: GraphPath,
  options: { mode?: TraceMode; title?: string } = {},
): TraceSetup {
  const nodes = nodeMap(graph);
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const steps: TraceStep[] = [];

  path.nodeIds.forEach((nodeId, index) => {
    const node = nodes.get(nodeId);
    if (!node) return;
    if (index === 0) {
      steps.push({ nodeIds: [nodeId], edgeIds: [], label: node.label });
      return;
    }
    const edgeId = path.edgeIds[index - 1];
    const edge = edges.get(edgeId);
    steps.push({
      nodeIds: [path.nodeIds[index - 1], nodeId],
      edgeIds: edgeId ? [edgeId] : [],
      label: edge ? `${edge.type.replace("_", " ")} → ${node.label}` : node.label,
    });
  });

  const first = nodes.get(path.nodeIds[0]);
  return {
    mode: options.mode ?? "path",
    title: options.title ?? `Path from ${first?.label ?? "start"}`,
    subtitle: path.nodeIds.length > 1 ? `${path.nodeIds.length} entities · ${path.edgeIds.length} hops` : undefined,
    steps,
  };
}

const TERMINAL_TYPES = new Set(["database", "external"]);

export interface FlowDetectionOptions {
  limit?: number;
  maxDepth?: number;
  maxIterations?: number;
  maxBranching?: number;
}

/**
 * Detects readable end-to-end flows (page → API → service → data/external).
 * Bounded DFS: caps on depth, branching and total iterations keep it instant
 * even for repositories at the node limit.
 */
export function detectFlows(
  graph: AppGraphDocument,
  options: FlowDetectionOptions = {},
): DetectedFlow[] {
  const { limit = 10, maxDepth = 6, maxIterations = 5_000, maxBranching = 3 } = options;
  const nodes = nodeMap(graph);
  const adjacency = buildAdjacency(graph);

  const starts = graph.nodes
    .filter((node) => node.type === "page" || node.type === "api")
    .sort((a, b) => {
      const pageDelta = Number(b.type === "page") - Number(a.type === "page");
      if (pageDelta !== 0) return pageDelta;
      const outDelta = (adjacency.outgoing.get(b.id)?.length ?? 0) - (adjacency.outgoing.get(a.id)?.length ?? 0);
      if (outDelta !== 0) return outDelta;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 60);

  const flows: DetectedFlow[] = [];
  const signatures = new Set<string>();
  let iterations = 0;

  const record = (path: string[], edgeIds: string[], edgeTypes: GraphEdgeType[]) => {
    if (path.length < 3) return;
    const signature = path.join(">");
    if (signatures.has(signature)) return;
    const endpointNode = nodes.get(path[path.length - 1]);
    const hasApi = path.some((id) => nodes.get(id)?.type === "api");
    const endsTerminal = endpointNode ? TERMINAL_TYPES.has(endpointNode.type) : false;
    const hasFlowEdge = edgeTypes.some((type) => type !== "imports" && type !== "depends_on");
    if (!hasApi && !endsTerminal && !hasFlowEdge) return;
    signatures.add(signature);
    const title = path
      .map((id) => shortLabel(nodes.get(id)?.label ?? id))
      .join(" → ");
    const score =
      (endsTerminal ? 12 : 0) +
      path.length * 2 +
      (edgeTypes.includes("routes_to") ? 6 : 0) +
      (hasApi ? 4 : 0) +
      (edgeTypes.includes("reads") || edgeTypes.includes("writes") ? 3 : 0);
    flows.push({
      id: `flow:${signature}`,
      title,
      nodeIds: [...path],
      edgeIds: [...edgeIds],
      endpoint: endpointNode?.label,
      score,
    });
  };

  const dfs = (nodeId: string, path: string[], edgeIds: string[], edgeTypes: GraphEdgeType[]) => {
    if (iterations >= maxIterations || flows.length >= limit * 6) return;
    iterations += 1;
    const node = nodes.get(nodeId);
    if (!node) return;

    const outgoing = (adjacency.outgoing.get(nodeId) ?? [])
      .filter((edge) => edge.type !== "depends_on")
      .slice(0, maxBranching);

    // External services are always leaves; database modules keep flowing into
    // their ORM/provider so flows end at "PostgreSQL" rather than "db.ts".
    if (node.type === "external" || (TERMINAL_TYPES.has(node.type) && outgoing.length === 0)) {
      record(path, edgeIds, edgeTypes);
      return;
    }

    if (path.length > maxDepth) {
      record(path, edgeIds, edgeTypes);
      return;
    }

    if (outgoing.length === 0) {
      record(path, edgeIds, edgeTypes);
      return;
    }

    for (const edge of outgoing) {
      if (path.includes(edge.target)) continue;
      dfs(
        edge.target,
        [...path, edge.target],
        [...edgeIds, edge.id],
        [...edgeTypes, edge.type],
      );
    }
  };

  for (const start of starts) {
    if (iterations >= maxIterations || flows.length >= limit * 6) break;
    dfs(start.id, [start.id], [], []);
  }

  return flows
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

export function flowToTraceSetup(graph: AppGraphDocument, flow: DetectedFlow): TraceSetup {
  return pathToTraceSetup(
    graph,
    { nodeIds: flow.nodeIds, edgeIds: flow.edgeIds },
    { mode: "flow", title: flow.title },
  );
}

export interface TourSetup {
  title: string;
  setups: TraceSetup[];
}

/** Builds a guided tour across the strongest detected flows. */
export function buildTour(graph: AppGraphDocument, limit = 8): TourSetup {
  const flows = detectFlows(graph, { limit });
  return {
    title: "Architecture tour",
    setups: flows.map((flow) => flowToTraceSetup(graph, flow)),
  };
}

export function rankOfGranularity(granularity: AppGraphNode["granularity"]): number {
  return { product: 0, architecture: 1, modules: 2, files: 3 }[granularity];
}

/** Highest granularity rank among the given nodes (used to keep traces visible). */
export function requiredGranularity(
  graph: AppGraphDocument,
  nodeIds: string[],
): AppGraphNode["granularity"] {
  let required: AppGraphNode["granularity"] = "product";
  const wanted = new Set(nodeIds);
  for (const node of graph.nodes) {
    if (!wanted.has(node.id)) continue;
    if (rankOfGranularity(node.granularity) > rankOfGranularity(required)) {
      required = node.granularity;
    }
  }
  return required;
}

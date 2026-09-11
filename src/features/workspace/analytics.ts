import {
  GRAPH_GROUPS,
  GRANULARITY_ORDER,
  type AppGraphDocument,
  type GraphEdgeType,
  type GraphGranularity,
  type GraphGroupId,
  type GraphNodeType,
} from "@/lib/graph/model";
import { buildAdjacency } from "./trace";

/* ------------------------------------------------------------------ */
/* Circular dependencies                                              */
/* ------------------------------------------------------------------ */

export interface GraphCycle {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
}

/**
 * Finds dependency cycles (bounded DFS). Imports are included because circular
 * imports are the classic maintainability smell; `depends_on` noise is excluded.
 */
export function detectCycles(graph: AppGraphDocument, limit = 8, maxIterations = 30_000): GraphCycle[] {
  const adjacency = buildAdjacency(graph);
  const cycles: GraphCycle[] = [];
  const seen = new Set<string>();
  const path: string[] = [];
  const pathEdges: string[] = [];
  const position = new Map<string, number>();
  let iterations = 0;

  const visit = (nodeId: string) => {
    if (iterations > maxIterations || cycles.length >= limit) return;
    iterations += 1;
    position.set(nodeId, path.length);
    path.push(nodeId);

    const outgoing = (adjacency.outgoing.get(nodeId) ?? []).filter(
      (edge) => edge.type !== "depends_on" && edge.type !== "unknown",
    );

    for (const edge of outgoing) {
      const target = edge.target;
      const targetIndex = position.get(target);
      if (targetIndex !== undefined) {
        const nodeIds = path.slice(targetIndex);
        const edgeIds = [...pathEdges.slice(targetIndex), edge.id];
        if (nodeIds.length >= 2) {
          const canonical = [...nodeIds].sort().join(">");
          if (!seen.has(canonical)) {
            seen.add(canonical);
            cycles.push({ id: `cycle:${canonical}`, nodeIds, edgeIds });
          }
        }
        continue;
      }
      pathEdges.push(edge.id);
      visit(target);
      pathEdges.pop();
    }

    path.pop();
    position.delete(nodeId);
  };

  const starts = [...graph.nodes]
    .filter((node) => (adjacency.outgoing.get(node.id)?.length ?? 0) > 0)
    .sort(
      (a, b) =>
        (adjacency.outgoing.get(b.id)?.length ?? 0) - (adjacency.outgoing.get(a.id)?.length ?? 0),
    )
    .slice(0, 150);

  for (const start of starts) {
    if (cycles.length >= limit || iterations > maxIterations) break;
    visit(start.id);
  }

  return cycles;
}

/* ------------------------------------------------------------------ */
/* Health metrics                                                     */
/* ------------------------------------------------------------------ */

export interface LayerStat {
  group: GraphGroupId;
  title: string;
  nodes: number;
  outgoing: number;
  incoming: number;
}

export interface TypeCount<T extends string> {
  type: T;
  count: number;
}

export interface GraphHealth {
  entities: number;
  relationships: number;
  density: number;
  avgOutgoing: number;
  avgIncoming: number;
  orphanCount: number;
  hubCount: number;
  avgConfidence: number;
  lowConfidenceShare: number;
  layers: LayerStat[];
  typeCounts: Array<TypeCount<GraphNodeType>>;
  edgeCounts: Array<TypeCount<GraphEdgeType>>;
}

export function graphHealth(graph: AppGraphDocument): GraphHealth {
  const nodes = graph.nodes.filter((node) => node.type !== "group");
  const edges = graph.edges;
  const entityCount = nodes.length;
  const relationshipCount = edges.length;

  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const density =
    entityCount > 1 ? relationshipCount / (entityCount * (entityCount - 1)) : 0;
  const avgOutgoing = entityCount > 0 ? relationshipCount / entityCount : 0;
  const avgIncoming = avgOutgoing;
  const orphanCount = nodes.filter(
    (node) => (outgoing.get(node.id) ?? 0) + (incoming.get(node.id) ?? 0) === 0,
  ).length;
  const hubCount = nodes.filter(
    (node) => (outgoing.get(node.id) ?? 0) + (incoming.get(node.id) ?? 0) >= 8,
  ).length;
  const avgConfidence =
    relationshipCount > 0
      ? edges.reduce((sum, edge) => sum + edge.confidence, 0) / relationshipCount
      : 1;
  const lowConfidenceShare =
    relationshipCount > 0
      ? edges.filter((edge) => edge.confidence < 0.7).length / relationshipCount
      : 0;

  const nodeTypeCounts = new Map<GraphNodeType, number>();
  for (const node of nodes) {
    nodeTypeCounts.set(node.type, (nodeTypeCounts.get(node.type) ?? 0) + 1);
  }
  const edgeTypeCounts = new Map<GraphEdgeType, number>();
  for (const edge of edges) {
    edgeTypeCounts.set(edge.type, (edgeTypeCounts.get(edge.type) ?? 0) + 1);
  }

  const layers: LayerStat[] = GRAPH_GROUPS.map((group) => {
    const layerNodes = nodes.filter((node) => node.metadata.group === group.id);
    const ids = new Set(layerNodes.map((node) => node.id));
    return {
      group: group.id,
      title: group.title,
      nodes: layerNodes.length,
      outgoing: edges.filter((edge) => ids.has(edge.source)).length,
      incoming: edges.filter((edge) => ids.has(edge.target)).length,
    };
  }).filter((layer) => layer.nodes > 0);

  return {
    entities: entityCount,
    relationships: relationshipCount,
    density,
    avgOutgoing,
    avgIncoming,
    orphanCount,
    hubCount,
    avgConfidence,
    lowConfidenceShare,
    layers,
    typeCounts: [...nodeTypeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    edgeCounts: [...edgeTypeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* ------------------------------------------------------------------ */
/* Mermaid export                                                     */
/* ------------------------------------------------------------------ */

const MERMAID_NODE_COLORS: Record<GraphNodeType, string> = {
  page: "#67c7f0",
  component: "#8ba7f5",
  api: "#e0b05c",
  service: "#57c99b",
  database: "#e08bb0",
  external: "#e29a5c",
  state: "#b490e8",
  middleware: "#9aa6b8",
  config: "#8f98a3",
  module: "#7d8797",
  group: "#8f98a3",
};

function mermaidId(id: string, index: number): string {
  void id;
  return `n${index}`;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/["[\]{}()<>|]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Builds a Mermaid flowchart of the semantic graph — handy for PRs and docs.
 */
export function toMermaid(
  graph: AppGraphDocument,
  granularity: GraphGranularity = "architecture",
): string {
  const visibleNodes = graph.nodes
    .filter((node) => node.type !== "group")
    .filter((node) => GRANULARITY_ORDER[node.granularity] <= GRANULARITY_ORDER[granularity])
    .slice(0, 60);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 120);

  const indexById = new Map(visibleNodes.map((node, index) => [node.id, index]));
  const lines: string[] = [`%% ${graph.repository.fullName} @ ${graph.commitSha.slice(0, 7)}`];
  lines.push("flowchart LR");

  for (const [index, node] of visibleNodes.entries()) {
    const label = `${escapeMermaidLabel(node.label)}${
      node.metadata.route ? `<br/>${escapeMermaidLabel(String(node.metadata.route))}` : ""
    }`;
    lines.push(`  ${mermaidId(node.id, index)}["${label}"]:::${node.type}`);
  }

  for (const edge of visibleEdges) {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const label = edge.type.replace(/_/g, " ");
    lines.push(`  ${mermaidId(edge.source, source)} -->|${label}| ${mermaidId(edge.target, target)}`);
  }

  const usedTypes = new Set(visibleNodes.map((node) => node.type));
  for (const type of usedTypes) {
    const color = MERMAID_NODE_COLORS[type];
    lines.push(
      `  classDef ${type} fill:${color}22,stroke:${color},stroke-width:1px,color:#e8eaee;`,
    );
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Markdown report                                                    */
/* ------------------------------------------------------------------ */

export interface ReportFlow {
  title: string;
  nodeIds: string[];
}

export function toMarkdownReport(
  graph: AppGraphDocument,
  health: GraphHealth,
  cycles: GraphCycle[],
  flows: ReportFlow[],
): string {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const label = (id: string) => byId.get(id)?.label ?? id;
  const lines: string[] = [];

  lines.push(`# Architecture report — ${graph.repository.fullName}`);
  lines.push("");
  lines.push(
    `- Commit: \`${graph.commitSha}\` (${graph.ref})`,
  );
  lines.push(`- Analyzed: ${graph.stats.analyzedFiles} of ${graph.stats.sourceFiles} source files`);
  lines.push(
    `- Graph: ${health.entities} entities · ${health.relationships} relationships · ${graph.stats.externalServices} external service(s)`,
  );
  lines.push("");

  lines.push("## Health");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Average connections per entity | ${health.avgOutgoing.toFixed(1)} |`);
  lines.push(`| Unconnected entities | ${health.orphanCount} |`);
  lines.push(`| High-degree entities (hub) | ${health.hubCount} |`);
  lines.push(`| Circular dependencies | ${cycles.length} |`);
  lines.push(`| Average confidence | ${(health.avgConfidence * 100).toFixed(0)}% |`);
  lines.push("");

  if (flows.length > 0) {
    lines.push("## Key flows");
    lines.push("");
    for (const flow of flows.slice(0, 10)) {
      lines.push(`- ${flow.nodeIds.map((id) => label(id)).join(" → ")}`);
    }
    lines.push("");
  }

  const externals = graph.nodes.filter((node) => node.type === "external");
  if (externals.length > 0) {
    lines.push("## External services");
    lines.push("");
    for (const external of externals) {
      lines.push(`- **${external.label}** — ${external.subtitle ?? "external dependency"}`);
    }
    lines.push("");
  }

  if (cycles.length > 0) {
    lines.push("## Circular dependencies");
    lines.push("");
    for (const cycle of cycles.slice(0, 10)) {
      lines.push(`- ${cycle.nodeIds.map((id) => label(id)).join(" → ")} → (back to start)`);
    }
    lines.push("");
  }

  const config = graph.nodes.find((node) => node.type === "config");
  const envVars = Array.isArray(config?.metadata.envVars) ? (config?.metadata.envVars as string[]) : [];
  if (envVars.length > 0) {
    lines.push("## Environment variables");
    lines.push("");
    lines.push(envVars.map((name) => `\`${name}\``).join(", "));
    lines.push("");
  }

  if (graph.warnings.length > 0) {
    lines.push("## Analysis notes");
    lines.push("");
    for (const warning of graph.warnings) {
      lines.push(`- ${warning.message}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`Generated by AppGraph · static analysis only.`);
  return lines.join("\n");
}

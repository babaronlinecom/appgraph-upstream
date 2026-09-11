import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import {
  GRAPH_GROUPS,
  GRANULARITY_ORDER,
  NODE_HEIGHT,
  NODE_WIDTH,
  createEmptyLayouts,
  type AppGraphEdge,
  type AppGraphNode,
  type GraphGranularity,
  type GraphGroupId,
  type GraphLayout,
  type LayoutGroup,
  type NodePlacement,
} from "@/lib/graph/model";

export { NODE_HEIGHT, NODE_WIDTH };

const GROUP_PADDING = { top: 60, left: 32, right: 32, bottom: 32 };
const GROUP_ORDER = new Map(GRAPH_GROUPS.map((group) => [group.id, group.order]));
const GROUP_TITLES = new Map(GRAPH_GROUPS.map((group) => [group.id, group.title]));

const elk = new ELK();

const LAYOUT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.partitioning.activate": "true",
  "elk.spacing.nodeNode": "46",
  "elk.layered.spacing.nodeNodeBetweenLayers": "94",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.mergeEdges": "false",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
  "elk.separateConnectedComponents": "false",
};

export function visibleAt(node: AppGraphNode, granularity: GraphGranularity): boolean {
  return GRANULARITY_ORDER[node.granularity] <= GRANULARITY_ORDER[granularity];
}

/**
 * Computes a deterministic layered layout for every granularity level.
 * Groups become left-to-right partitions (Frontend -> Backend -> Data ->
 * Configuration -> External), so request flow reads naturally.
 */
export async function computeLayouts(
  nodes: AppGraphNode[],
  edges: AppGraphEdge[],
): Promise<Record<GraphGranularity, GraphLayout>> {
  const layouts = createEmptyLayouts();
  const granularities: GraphGranularity[] = ["product", "architecture", "modules", "files"];

  for (const granularity of granularities) {
    const visibleNodes = nodes.filter((node) => visibleAt(node, granularity));
    if (visibleNodes.length === 0) continue;
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    layouts[granularity] = await layoutSingle(visibleNodes, visibleEdges, granularity);
  }

  return layouts;
}

async function layoutSingle(
  nodes: AppGraphNode[],
  edges: AppGraphEdge[],
  granularity: GraphGranularity,
): Promise<GraphLayout> {
  const groupMembers = new Map<GraphGroupId, AppGraphNode[]>();
  for (const node of nodes) {
    const group = node.metadata.group;
    const list = groupMembers.get(group) ?? [];
    list.push(node);
    groupMembers.set(group, list);
  }

  const orderedGroups = [...groupMembers.entries()]
    .filter(([, members]) => members.length > 0)
    .sort((a, b) => (GROUP_ORDER.get(a[0]) ?? 99) - (GROUP_ORDER.get(b[0]) ?? 99));

  const elkNodes: ElkNode[] = nodes.map((node) => {
    const group = node.metadata.group;
    return {
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      layoutOptions: { "elk.partitioning.partition": String(GROUP_ORDER.get(group) ?? 0) },
    };
  });

  const seenPairs = new Set<string>();
  const elkEdges = [];
  for (const edge of edges) {
    const key = `${edge.source}=>${edge.target}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    elkEdges.push({ id: `le:${key}`, sources: [edge.source], targets: [edge.target] });
  }

  const graph: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: elkNodes,
    edges: elkEdges,
  };

  let positions: Map<string, { x: number; y: number }> = new Map();
  try {
    const result = await Promise.race([
      elk.layout(graph),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("layout timeout")), 20_000)),
    ]);
    for (const child of result.children ?? []) {
      positions.set(child.id, { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) });
    }
  } catch {
    positions = fallbackPositions(nodes);
  }

  // Ensure every node has a position (ELK occasionally omits disconnected nodes).
  let fallbackColumn = 0;
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        x: 40 + fallbackColumn * (NODE_WIDTH + 48),
        y: 800 + (fallbackColumn % 7) * (NODE_HEIGHT + 40),
      });
      fallbackColumn += 1;
    }
  }

  const nodePlacements: Record<string, NodePlacement> = {};
  const groups: LayoutGroup[] = [];
  let maxX = 0;
  let maxY = 0;

  for (const [groupId, members] of orderedGroups) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxGroupX = Number.NEGATIVE_INFINITY;
    let maxGroupY = Number.NEGATIVE_INFINITY;
    for (const member of members) {
      const position = positions.get(member.id);
      if (!position) continue;
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxGroupX = Math.max(maxGroupX, position.x + NODE_WIDTH);
      maxGroupY = Math.max(maxGroupY, position.y + NODE_HEIGHT);
    }
    if (!Number.isFinite(minX)) continue;

    const groupX = minX - GROUP_PADDING.left;
    const groupY = minY - GROUP_PADDING.top;
    const groupWidth = maxGroupX - minX + GROUP_PADDING.left + GROUP_PADDING.right;
    const groupHeight = maxGroupY - minY + GROUP_PADDING.top + GROUP_PADDING.bottom;
    const id = `group:${groupId}:${granularity}`;

    groups.push({
      id,
      group: groupId,
      title: GROUP_TITLES.get(groupId) ?? groupId,
      x: groupX,
      y: groupY,
      width: Math.max(groupWidth, 280),
      height: Math.max(groupHeight, 180),
      nodeIds: members.map((member) => member.id),
    });

    maxX = Math.max(maxX, groupX + Math.max(groupWidth, 280));
    maxY = Math.max(maxY, groupY + Math.max(groupHeight, 180));
  }

  for (const node of nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const placement: NodePlacement = { x: position.x, y: position.y, width: NODE_WIDTH, height: NODE_HEIGHT };
    nodePlacements[node.id] = placement;
    maxX = Math.max(maxX, position.x + NODE_WIDTH);
    maxY = Math.max(maxY, position.y + NODE_HEIGHT);
  }

  return {
    granularity,
    nodePlacements,
    groups,
    bounds: { width: maxX + 80, height: maxY + 80 },
  };
}

/** Grid fallback used when ELK cannot produce a layout. Never fails analysis. */
function fallbackPositions(nodes: AppGraphNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  let index = 0;
  for (const node of nodes) {
    positions.set(node.id, {
      x: 60 + index * (NODE_WIDTH + 48),
      y: 60 + (index % 6) * (NODE_HEIGHT + 48),
    });
    index += 1;
  }
  return positions;
}

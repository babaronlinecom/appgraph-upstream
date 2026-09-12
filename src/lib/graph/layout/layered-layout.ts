import {
  GRAPH_GROUPS,
  NODE_HEIGHT,
  NODE_WIDTH,
  type AppGraphEdge,
  type AppGraphNode,
  type GraphGroupId,
} from "@/lib/graph/model";

/**
 * Deterministic layered layout used for large graphs where ELK's crossing
 * minimization is too slow (or would be killed by the worker timeout).
 *
 * Structure mirrors the ELK partitioning used for small graphs: each group is
 * a vertical lane, nodes inside a lane flow left-to-right by dependency depth
 * and stack vertically ordered by predecessor barycenter. Complexity is
 * O(V + E + V log V), so 500+ entity graphs lay out in milliseconds.
 */

const GAP_X = 108;
const GAP_Y = 46;
const LANE_GAP = 96;
const PADDING = 40;

const LANE_ORDER = new Map(GRAPH_GROUPS.map((group) => [group.id, group.order]));

export interface LayeredPosition {
  x: number;
  y: number;
}

export function layeredPositions(
  nodes: AppGraphNode[],
  edges: AppGraphEdge[],
): Map<string, LayeredPosition> {
  const byLane = new Map<GraphGroupId, AppGraphNode[]>();
  for (const node of nodes) {
    const lane = node.metadata.group;
    const list = byLane.get(lane) ?? [];
    list.push(node);
    byLane.set(lane, list);
  }

  const orderedLanes = [...byLane.keys()].sort(
    (a, b) => (LANE_ORDER.get(a) ?? 99) - (LANE_ORDER.get(b) ?? 99),
  );

  const positions = new Map<string, LayeredPosition>();
  let laneOffsetX = PADDING;

  for (const lane of orderedLanes) {
    const members = byLane.get(lane) ?? [];
    const memberIds = new Set(members.map((node) => node.id));

    // Intra-lane dependency edges only: cross-lane flow is already expressed by
    // lane order, so it must not distort the depth of a node inside its lane.
    const incoming = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.source === edge.target) continue;
      if (!memberIds.has(edge.source) || !memberIds.has(edge.target)) continue;
      const inList = incoming.get(edge.target) ?? [];
      inList.push(edge.source);
      incoming.set(edge.target, inList);
    }

    // Longest-path depth with cycle protection (back edges contribute nothing).
    const rank = new Map<string, number>();
    const visiting = new Set<string>();
    const rankOf = (id: string): number => {
      const memoized = rank.get(id);
      if (memoized !== undefined) return memoized;
      if (visiting.has(id)) return -1;
      visiting.add(id);
      let depth = 0;
      for (const predecessor of incoming.get(id) ?? []) {
        const predecessorRank = rankOf(predecessor);
        if (predecessorRank >= 0) depth = Math.max(depth, predecessorRank + 1);
      }
      visiting.delete(id);
      rank.set(id, depth);
      return depth;
    };
    for (const member of members) rankOf(member.id);

    const columns = new Map<number, AppGraphNode[]>();
    for (const member of members) {
      const depth = rank.get(member.id) ?? 0;
      const column = columns.get(depth) ?? [];
      column.push(member);
      columns.set(depth, column);
    }

    // Order each column by the barycenter of already-placed predecessors to
    // reduce edge crossings; deterministic tie-breaks by id.
    const orderIndex = new Map<string, number>();
    const sortedRanks = [...columns.keys()].sort((a, b) => a - b);
    for (const depth of sortedRanks) {
      const column = columns.get(depth) as AppGraphNode[];
      column.sort((a, b) => {
        const barycenter = (node: AppGraphNode): number => {
          const placed = (incoming.get(node.id) ?? [])
            .map((id) => orderIndex.get(id))
            .filter((value): value is number => value !== undefined);
          if (placed.length === 0) return Number.POSITIVE_INFINITY;
          return placed.reduce((sum, value) => sum + value, 0) / placed.length;
        };
        const delta = barycenter(a) - barycenter(b);
        if (delta !== 0 && Number.isFinite(delta)) return delta;
        return a.id.localeCompare(b.id);
      });
      column.forEach((node, index) => orderIndex.set(node.id, index));
    }

    let columnCount = 0;
    let laneHeight = 0;
    for (const [depth, column] of columns) {
      columnCount = Math.max(columnCount, depth + 1);
      const columnHeight = column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * GAP_Y;
      laneHeight = Math.max(laneHeight, columnHeight);
    }

    for (const [depth, column] of columns) {
      const columnHeight = column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * GAP_Y;
      const top = (laneHeight - columnHeight) / 2;
      column.forEach((node, index) => {
        positions.set(node.id, {
          x: Math.round(laneOffsetX + depth * (NODE_WIDTH + GAP_X)),
          y: Math.round(top + index * (NODE_HEIGHT + GAP_Y)),
        });
      });
    }

    laneOffsetX += Math.max(1, columnCount) * (NODE_WIDTH + GAP_X) - GAP_X + LANE_GAP;
  }

  return positions;
}

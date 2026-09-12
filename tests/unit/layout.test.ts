import { describe, expect, it } from "vitest";
import { computeLayouts } from "@/lib/graph/layout/elk-layout";
import { layoutWithWorker } from "@/lib/graph/layout/elk-worker";
import { layeredPositions } from "@/lib/graph/layout/layered-layout";
import type {
  AppGraphEdge,
  AppGraphNode,
  GraphGranularity,
  GraphGroupId,
  GraphNodeType,
} from "@/lib/graph/model";

function node(
  id: string,
  group: GraphGroupId,
  granularity: GraphGranularity = "symbols",
  type: GraphNodeType = "symbol",
): AppGraphNode {
  return { id, type, label: id, confidence: 1, granularity, metadata: { group } };
}

function edge(source: string, target: string, confidence = 0.9): AppGraphEdge {
  return { id: `${source}->${target}`, source, target, type: "imports", confidence };
}

describe("fast layered layout", () => {
  const nodes = [
    node("f1", "frontend"),
    node("f2", "frontend"),
    node("f3", "frontend"),
    node("b1", "backend"),
    node("b2", "backend"),
    node("d1", "data"),
  ];
  const edges = [
    edge("f1", "f2"),
    edge("f2", "f3"),
    edge("f1", "b1"),
    edge("b1", "b2"),
    edge("b1", "d1"),
  ];
  const cyclicEdges = [...edges, edge("f2", "f1"), edge("d1", "d1")];

  it("is deterministic for identical input", () => {
    const first = layeredPositions(nodes, cyclicEdges);
    const second = layeredPositions(nodes, cyclicEdges);
    expect(Object.fromEntries(first)).toEqual(Object.fromEntries(second));
  });

  it("places dependency depth left-to-right inside a lane", () => {
    const positions = layeredPositions(nodes, edges);
    expect(positions.get("f1")!.x).toBeLessThan(positions.get("f2")!.x);
    expect(positions.get("f2")!.x).toBeLessThan(positions.get("f3")!.x);
  });

  it("keeps group lanes horizontally disjoint and ordered by group order", () => {
    const positions = layeredPositions(nodes, edges);
    const xs = (ids: string[]) => ids.map((id) => positions.get(id)!.x);
    const frontendMax = Math.max(...xs(["f1", "f2", "f3"]));
    const backendMin = Math.min(...xs(["b1", "b2"]));
    const backendMax = Math.max(...xs(["b1", "b2"]));
    const dataMin = Math.min(...xs(["d1"]));
    expect(backendMin).toBeGreaterThan(frontendMax);
    expect(dataMin).toBeGreaterThan(backendMax);
  });

  it("positions every node despite cycles and self loops", () => {
    const positions = layeredPositions(nodes, cyclicEdges);
    for (const item of nodes) {
      expect(positions.has(item.id)).toBe(true);
    }
  });
});

describe("ELK worker isolation", () => {
  it("degrades instead of blocking when the timeout is exceeded", async () => {
    const graph = {
      id: "root",
      children: [
        { id: "a", width: 252, height: 92 },
        { id: "b", width: 252, height: 92 },
      ],
      edges: [{ id: "e", sources: ["a"], targets: ["b"] }],
    };
    const outcome = await layoutWithWorker(graph, 1);
    expect(outcome.degraded).toBe(true);
    expect(outcome.error).toContain("timeout");
    expect(outcome.positions.size).toBe(0);
  }, 30_000);
});

describe("computeLayouts scaling", () => {
  it("lays out a dense 180-entity graph quickly without degrading", async () => {
    const nodes: AppGraphNode[] = [];
    const edges: AppGraphEdge[] = [];
    const groups: GraphGroupId[] = ["frontend", "backend", "data"];
    for (let index = 0; index < 180; index += 1) {
      nodes.push(node(`n${index}`, groups[index % groups.length]));
      if (index > 0) {
        edges.push(edge(`n${index - 1}`, `n${index}`, 0.5 + (index % 5) / 10));
      }
      if (index > 3) {
        edges.push(edge(`n${index - 3}`, `n${index}`, 0.6));
      }
    }

    const startedAt = Date.now();
    const layouts = await computeLayouts(nodes, edges);
    const elapsed = Date.now() - startedAt;

    for (const granularity of ["product", "architecture", "modules", "files", "symbols"] as const) {
      const layout = layouts[granularity];
      expect(layout).toBeTruthy();
      expect(layout.degraded).not.toBe(true);
    }
    expect(Object.keys(layouts.symbols.nodePlacements)).toHaveLength(180);
    expect(elapsed).toBeLessThan(10_000);

    const groupsInLayout = layouts.symbols.groups;
    for (let a = 0; a < groupsInLayout.length; a += 1) {
      for (let b = a + 1; b < groupsInLayout.length; b += 1) {
        const first = groupsInLayout[a];
        const second = groupsInLayout[b];
        const overlaps =
          first.x < second.x + second.width &&
          second.x < first.x + first.width &&
          first.y < second.y + second.height &&
          second.y < first.y + first.height;
        expect(overlaps).toBe(false);
      }
    }
  }, 60_000);
});

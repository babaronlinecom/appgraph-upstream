import { describe, expect, it } from "vitest";
import {
  detectCycles,
  graphHealth,
  toMarkdownReport,
  toMermaid,
} from "@/features/workspace/analytics";
import {
  createEmptyLayouts,
  type AppGraphDocument,
  type AppGraphEdge,
  type AppGraphNode,
  type GraphEdgeType,
  type GraphGranularity,
  type GraphNodeType,
} from "@/lib/graph/model";

function node(
  id: string,
  type: GraphNodeType,
  label: string,
  granularity: GraphGranularity = "architecture",
): AppGraphNode {
  const group =
    type === "database" ? "data" : type === "external" ? "external" : type === "service" || type === "api" ? "backend" : "frontend";
  return { id, type, label, confidence: 1, granularity, metadata: { group } };
}

function edge(source: string, target: string, type: GraphEdgeType): AppGraphEdge {
  return { id: `${source}->${target}:${type}`, source, target, type, confidence: 0.9 };
}

const graph: AppGraphDocument = {
  schemaVersion: "1.0.0",
  analysisVersion: "test",
  repository: {
    owner: "test",
    name: "app",
    fullName: "test/app",
    description: null,
    defaultBranch: "main",
    stars: 0,
    forks: 0,
    watchers: 0,
    language: "TypeScript",
    topics: [],
    url: "https://github.com/test/app",
    homepage: null,
    license: null,
    pushedAt: null,
    createdAt: null,
    archived: false,
    sizeKb: 0,
    openIssues: 0,
  },
  commitSha: "abc1234",
  ref: "main",
  nodes: [
    node("page:home", "page", "Home"),
    node("api:projects", "api", "GET /api/projects"),
    node("service:project", "service", "Project Service"),
    node("db:postgres", "database", "PostgreSQL"),
    node("mod:a", "module", "Alpha"),
    node("mod:b", "module", "Beta"),
    node("mod:orphan", "module", "Orphan"),
  ],
  edges: [
    edge("page:home", "api:projects", "routes_to"),
    edge("api:projects", "service:project", "calls"),
    edge("service:project", "db:postgres", "reads"),
    edge("service:project", "db:postgres", "writes"),
    edge("mod:a", "mod:b", "imports"),
    edge("mod:b", "mod:a", "imports"),
  ],
  warnings: [],
  stats: {
    treeEntries: 0,
    sourceFiles: 0,
    analyzedFiles: 0,
    entities: 7,
    relationships: 6,
    externalServices: 0,
    pages: 1,
    apis: 1,
    services: 1,
    components: 0,
    databaseNodes: 1,
    symbols: 0,
    symbolEdges: 0,
    truncated: false,
    durationMs: 0,
    cacheHit: false,
  },
  layouts: createEmptyLayouts(),
  capabilities: {
    languages: ["typescript"],
    frameworks: ["nextjs-app"],
    databaseSchemas: [],
    dataSchemaAnalyzers: [],
    apiProtocols: ["http"],
    asyncSystems: [],
    infrastructure: [],
    symbolResolution: "partial",
    parsers: ["typescript-ast"],
    integrations: 0,
  },
  generatedAt: new Date(0).toISOString(),
};

describe("detectCycles", () => {
  it("finds circular dependency chains", () => {
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    const cycle = cycles[0];
    expect(cycle.nodeIds).toEqual(expect.arrayContaining(["mod:a", "mod:b"]));
    expect(cycle.edgeIds.length).toBeGreaterThanOrEqual(2);
  });

  it("returns nothing for an acyclic graph", () => {
    const acyclic = {
      ...graph,
      edges: graph.edges.filter((candidate) => !candidate.id.includes("mod:")),
    };
    expect(detectCycles(acyclic)).toEqual([]);
  });
});

describe("graphHealth", () => {
  it("computes metrics, layers and distributions", () => {
    const health = graphHealth(graph);
    expect(health.entities).toBe(7);
    expect(health.relationships).toBe(6);
    expect(health.avgOutgoing).toBeCloseTo(6 / 7, 3);
    expect(health.orphanCount).toBe(1);
    expect(health.density).toBeGreaterThan(0);
    expect(health.avgConfidence).toBeCloseTo(0.9, 3);
    expect(health.typeCounts.find((entry) => entry.type === "module")?.count).toBe(3);
    expect(health.edgeCounts.find((entry) => entry.type === "imports")?.count).toBe(2);
    expect(health.layers.map((layer) => layer.group)).toEqual(
      expect.arrayContaining(["frontend", "backend", "data"]),
    );
  });
});

describe("toMermaid", () => {
  it("renders a flowchart with nodes, edges and class definitions", () => {
    const mermaid = toMermaid(graph);
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain('["Home"]:::page');
    expect(mermaid).toContain("-->|routes to|");
    expect(mermaid).toContain("classDef page");
  });

  it("excludes nodes above the requested granularity", () => {
    const architecture = toMermaid(graph, "product");
    expect(architecture).not.toContain("Alpha");
  });
});

describe("toMarkdownReport", () => {
  it("includes health, flows and cycle sections", () => {
    const health = graphHealth(graph);
    const cycles = detectCycles(graph);
    const report = toMarkdownReport(graph, health, cycles, [
      { title: "Home → GET /api/projects → Project Service → PostgreSQL", nodeIds: ["page:home"] },
    ]);
    expect(report).toContain("# Architecture report — test/app");
    expect(report).toContain("## Health");
    expect(report).toContain("## Key flows");
    expect(report).toContain("## Circular dependencies");
  });
});

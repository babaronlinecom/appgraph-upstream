import { describe, expect, it } from "vitest";
import {
  detectFlows,
  findPath,
  pathToTraceSetup,
  requiredGranularity,
  traceDownstream,
  traceImpact,
} from "@/features/workspace/trace";
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
  return {
    id,
    type,
    label,
    confidence: 1,
    granularity,
    metadata: { group: type === "database" ? "data" : type === "external" ? "external" : "frontend" },
  };
}

function edge(
  source: string,
  target: string,
  type: GraphEdgeType,
  confidence = 0.9,
): AppGraphEdge {
  return { id: `${source}->${target}:${type}`, source, target, type, confidence };
}

const graph: AppGraphDocument = {
  schemaVersion: "1.0.0",
  analysisVersion: "test",
  repository: {
    owner: "test",
    name: "test",
    fullName: "test/test",
    description: null,
    defaultBranch: "main",
    stars: 0,
    forks: 0,
    watchers: 0,
    language: "TypeScript",
    topics: [],
    url: "https://github.com/test/test",
    homepage: null,
    license: null,
    pushedAt: null,
    createdAt: null,
    archived: false,
    sizeKb: 0,
    openIssues: 0,
  },
  commitSha: "sha",
  ref: "main",
  nodes: [
    node("page:home", "page", "Home", "product"),
    node("api:projects", "api", "GET /api/projects"),
    node("service:project", "service", "Project Service"),
    node("db:postgres", "database", "PostgreSQL", "product"),
    node("ext:stripe", "external", "Stripe", "product"),
    node("module:utils", "module", "Utils", "files"),
  ],
  edges: [
    edge("page:home", "api:projects", "routes_to", 0.9),
    edge("api:projects", "service:project", "calls", 0.9),
    edge("service:project", "db:postgres", "reads", 0.8),
    edge("service:project", "db:postgres", "writes", 0.8),
    edge("service:project", "ext:stripe", "uses", 0.95),
    edge("api:projects", "module:utils", "imports", 1),
  ],
  warnings: [],
  stats: {
    treeEntries: 0,
    sourceFiles: 0,
    analyzedFiles: 0,
    entities: 6,
    relationships: 6,
    externalServices: 1,
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
    databaseSchemas: ["prisma"],
    dataSchemaAnalyzers: ["prisma-schema"],
    apiProtocols: ["http"],
    asyncSystems: [],
    infrastructure: [],
    symbolResolution: "partial",
    parsers: ["typescript-ast"],
    integrations: 30,
  },
  generatedAt: new Date(0).toISOString(),
};

describe("findPath", () => {
  it("finds the shortest connection between two entities", () => {
    const path = findPath(graph, "page:home", "db:postgres");
    expect(path).not.toBeNull();
    expect(path!.nodeIds[0]).toBe("page:home");
    expect(path!.nodeIds[path!.nodeIds.length - 1]).toBe("db:postgres");
    expect(path!.nodeIds).toContain("api:projects");
    expect(path!.edgeIds.length).toBe(path!.nodeIds.length - 1);
  });

  it("returns null when there is no connection", () => {
    const isolated = {
      ...graph,
      nodes: [...graph.nodes, node("module:orphan", "module", "Orphan", "files")],
    };
    expect(findPath(isolated, "page:home", "module:orphan")).toBeNull();
  });
});

describe("traceDownstream", () => {
  it("produces ordered levels following semantic edges", () => {
    const trace = traceDownstream(graph, "page:home");
    expect(trace).not.toBeNull();
    expect(trace!.mode).toBe("downstream");
    expect(trace!.steps[0].nodeIds).toEqual(["page:home"]);
    expect(trace!.steps[1].nodeIds).toContain("api:projects");
    expect(trace!.steps[2].nodeIds).toEqual(expect.arrayContaining(["service:project", "module:utils"]));
    expect(trace!.steps[3].nodeIds).toEqual(expect.arrayContaining(["db:postgres", "ext:stripe"]));
  });

  it("returns null when nothing is downstream", () => {
    expect(traceDownstream(graph, "db:postgres")).toBeNull();
  });
});

describe("traceImpact", () => {
  it("walks reverse dependencies", () => {
    const trace = traceImpact(graph, "db:postgres");
    expect(trace).not.toBeNull();
    expect(trace!.mode).toBe("impact");
    expect(trace!.steps[0].nodeIds).toEqual(["db:postgres"]);
    const allNodes = trace!.steps.flatMap((step) => step.nodeIds);
    expect(allNodes).toEqual(expect.arrayContaining(["service:project", "api:projects", "page:home"]));
  });
});

describe("detectFlows", () => {
  it("finds end-to-end flows that end at a database or external service", () => {
    const flows = detectFlows(graph, { limit: 5 });
    expect(flows.length).toBeGreaterThan(0);
    const databaseFlow = flows.find((flow) => flow.endpoint === "PostgreSQL");
    expect(databaseFlow).toBeTruthy();
    expect(databaseFlow!.nodeIds[0]).toBe("page:home");
    expect(databaseFlow!.nodeIds).toContain("api:projects");
    const externalFlow = flows.find((flow) => flow.endpoint === "Stripe");
    expect(externalFlow).toBeTruthy();
  });

  it("respects the limit and deduplicates", () => {
    const flows = detectFlows(graph, { limit: 1 });
    expect(flows.length).toBeLessThanOrEqual(1);
  });
});

describe("pathToTraceSetup", () => {
  it("creates one step per hop with readable labels", () => {
    const path = findPath(graph, "page:home", "db:postgres")!;
    const setup = pathToTraceSetup(graph, path);
    expect(setup.steps.length).toBe(path.nodeIds.length);
    expect(setup.steps[0].edgeIds).toEqual([]);
    expect(setup.steps[1].edgeIds.length).toBe(1);
    expect(setup.steps[1].label).toContain("→");
  });
});

describe("requiredGranularity", () => {
  it("returns the highest rank among the given nodes", () => {
    expect(requiredGranularity(graph, ["page:home", "db:postgres"])).toBe("product");
    expect(requiredGranularity(graph, ["page:home", "module:utils"])).toBe("files");
  });
});

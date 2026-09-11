import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { clearMemoryCache } from "@/lib/cache/cache";
import { FixtureRepositoryProvider } from "@/lib/github/fixture-provider";
import { detectFlows, findPath, traceDownstream, traceImpact } from "@/features/workspace/trace";
import { detectCycles, graphHealth, toMermaid } from "@/features/workspace/analytics";
import { GRANULARITY_ORDER, type AppGraphDocument } from "@/lib/graph/model";

function fixtureRoot(name: string): string {
  return path.join(process.cwd(), "tests", "fixtures", name);
}

let document: AppGraphDocument;

beforeAll(async () => {
  process.env.APPGRAPH_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "appgraph-test-"));
  process.env.APPGRAPH_ANALYSIS_VERSION = `test-${Date.now()}`;
  clearMemoryCache();
  const provider = new FixtureRepositoryProvider(fixtureRoot("sample-nextjs"));
  document = await analyzeRepository({
    provider,
    input: "https://github.com/fixture/sample-nextjs",
  });
});

function nodeByPath(path: string) {
  return document.nodes.find((node) => node.path === path);
}

function edge(sourceId: string, targetId: string, type?: string) {
  return document.edges.find(
    (candidate) =>
      candidate.source === sourceId &&
      candidate.target === targetId &&
      (type ? candidate.type === type : true),
  );
}

describe("fixture repository analysis", () => {
  it("resolves repository metadata and commit", () => {
    expect(document.repository.fullName).toBe("fixture/sample-nextjs");
    expect(document.commitSha).toBe("fixture-commit-0001");
    expect(document.stats.cacheHit).toBe(false);
  });

  it("creates semantic page and API nodes (not just files)", () => {
    const dashboard = nodeByPath("src/app/dashboard/page.tsx");
    expect(dashboard?.type).toBe("page");
    expect(dashboard?.label).toBe("Dashboard");
    expect(dashboard?.metadata.route).toBe("/dashboard");

    const api = nodeByPath("src/app/api/projects/route.ts");
    expect(api?.type).toBe("api");
    expect(api?.metadata.methods).toEqual(["GET", "POST"]);
    expect(api?.metadata.route).toBe("/api/projects");
  });

  it("detects services, database module and middleware", () => {
    expect(nodeByPath("src/services/project-service.ts")?.type).toBe("service");
    expect(nodeByPath("src/lib/db.ts")?.type).toBe("database");
    expect(nodeByPath("src/middleware.ts")?.type).toBe("middleware");
  });

  it("creates external service nodes from SDK imports", () => {
    const stripe = document.nodes.find((node) => node.id === "ext:stripe");
    expect(stripe?.type).toBe("external");
    expect(stripe?.label).toBe("Stripe");
    expect(stripe?.granularity).toBe("product");
  });

  it("creates ORM and database nodes with relations", () => {
    const prisma = document.nodes.find((node) => node.id === "orm:prisma");
    const database = document.nodes.find((node) => node.id === "db:postgresql");
    expect(prisma?.type).toBe("service");
    expect(database?.type).toBe("database");
    expect(database?.metadata.models).toEqual(expect.arrayContaining(["Project", "Task"]));
    expect(edge(prisma!.id, database!.id, "uses")).toBeTruthy();
  });

  it("infers renders, calls and reads/writes relationships", () => {
    const dashboard = nodeByPath("src/app/dashboard/page.tsx")!;
    const projectList = nodeByPath("src/components/ProjectList.tsx")!;
    const api = nodeByPath("src/app/api/projects/route.ts")!;
    const service = nodeByPath("src/services/project-service.ts")!;
    const db = nodeByPath("src/lib/db.ts")!;

    expect(edge(dashboard.id, projectList.id, "renders")).toBeTruthy();
    expect(edge(api.id, service.id, "calls")).toBeTruthy();
    expect(edge(service.id, db.id, "reads")).toBeTruthy();
    expect(edge(service.id, db.id, "writes")).toBeTruthy();
  });

  it("creates routes_to edges for internal fetch calls", () => {
    const dashboard = nodeByPath("src/app/dashboard/page.tsx")!;
    const api = nodeByPath("src/app/api/projects/route.ts")!;
    const routeEdge = edge(dashboard.id, api.id, "routes_to");
    expect(routeEdge).toBeTruthy();
    expect(routeEdge!.confidence).toBeGreaterThan(0.8);
  });

  it("collects environment variables without secret values", () => {
    const config = document.nodes.find((node) => node.id === "config:environment");
    expect(config).toBeTruthy();
    const envVars = config!.metadata.envVars as string[];
    expect(envVars).toContain("DATABASE_URL");
    expect(envVars).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    // Names are collected; secret values are never read.
    expect(envVars).toContain("STRIPE_SECRET_KEY");
    const stripeLib = nodeByPath("src/lib/stripe.ts")!;
    expect(edge(stripeLib.id, config!.id, "uses")).toBeTruthy();
  });

  it("assigns confidence values and granularities", () => {
    for (const node of document.nodes) {
      expect(node.confidence).toBeGreaterThan(0);
      expect(node.confidence).toBeLessThanOrEqual(1);
      expect(GRANULARITY_ORDER[node.granularity]).toBeTypeOf("number");
    }
  });

  it("produces layouts for every granularity with visible nodes placed", () => {
    for (const granularity of ["product", "architecture", "modules", "files"] as const) {
      const layout = document.layouts[granularity];
      expect(layout).toBeTruthy();
      const visible = document.nodes.filter(
        (node) => GRANULARITY_ORDER[node.granularity] <= GRANULARITY_ORDER[granularity],
      );
      for (const node of visible) {
        expect(layout.nodePlacements[node.id]).toBeTruthy();
      }
    }
  });

  it("layers product view before architecture, modules and files", () => {
    const productCount = document.nodes.filter((node) => node.granularity === "product").length;
    const architectureCount = document.nodes.filter(
      (node) => GRANULARITY_ORDER[node.granularity] <= GRANULARITY_ORDER.architecture,
    ).length;
    const filesCount = document.nodes.filter(
      (node) => GRANULARITY_ORDER[node.granularity] <= GRANULARITY_ORDER.files,
    ).length;
    expect(productCount).toBeGreaterThan(0);
    expect(architectureCount).toBeGreaterThanOrEqual(productCount);
    expect(filesCount).toBeGreaterThanOrEqual(architectureCount);
  });

  it("reuses the cached graph for the same commit", async () => {
    clearMemoryCache();
    const provider = new FixtureRepositoryProvider(fixtureRoot("sample-nextjs"));
    const second = await analyzeRepository({
      provider,
      input: "https://github.com/fixture/sample-nextjs",
    });
    expect(second.stats.cacheHit).toBe(true);
    expect(second.nodes.length).toBe(document.nodes.length);
  });

  it("detects end-to-end flows through API and database", () => {
    const flows = detectFlows(document, { limit: 8 });
    expect(flows.length).toBeGreaterThan(0);
    const apiFlow = flows.find((flow) =>
      flow.nodeIds.some((id) => document.nodes.find((node) => node.id === id)?.type === "api"),
    );
    expect(apiFlow).toBeTruthy();
  });

  it("connects the dashboard page to PostgreSQL", () => {
    const dashboard = nodeByPath("src/app/dashboard/page.tsx")!;
    const database = document.nodes.find((node) => node.id === "db:postgresql")!;
    const path = findPath(document, dashboard.id, database.id);
    expect(path).not.toBeNull();
    expect(path!.nodeIds[0]).toBe(dashboard.id);
    expect(path!.nodeIds[path!.nodeIds.length - 1]).toBe(database.id);

    const trace = traceDownstream(document, dashboard.id);
    expect(trace).not.toBeNull();
    const reached = trace!.steps.flatMap((step) => step.nodeIds);
    expect(reached).toEqual(expect.arrayContaining([apiNode()!.id, database.id]));
  });

  it("reports impact for the database module", () => {
    const database = document.nodes.find((node) => node.id === "db:postgresql")!;
    const impact = traceImpact(document, database.id);
    expect(impact).not.toBeNull();
    const affected = impact!.steps.flatMap((step) => step.nodeIds);
    expect(affected.length).toBeGreaterThan(1);
  });

  it("produces analytics: health, layers and mermaid export", () => {
    const health = graphHealth(document);
    expect(health.entities).toBeGreaterThan(5);
    expect(health.layers.map((layer) => layer.title)).toEqual(
      expect.arrayContaining(["Frontend", "Backend", "Data"]),
    );
    expect(health.typeCounts.some((entry) => entry.type === "page")).toBe(true);

    const mermaid = toMermaid(document, "architecture");
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain("Dashboard");

    const cycles = detectCycles(document);
    expect(Array.isArray(cycles)).toBe(true);
  });

  it("carries source evidence on every relationship", () => {
    expect(document.edges.length).toBeGreaterThan(0);
    for (const candidate of document.edges) {
      const evidence = candidate.metadata?.evidence;
      expect(Array.isArray(evidence), `edge ${candidate.id} has evidence`).toBe(true);
      expect(evidence!.length).toBeGreaterThan(0);
      for (const entry of evidence!) {
        expect(entry.path.length).toBeGreaterThan(0);
        expect(entry.analyzerId.length).toBeGreaterThan(0);
        expect(entry.ruleId.length).toBeGreaterThan(0);
        expect(["exact", "resolved", "inferred"]).toContain(entry.kind);
      }
    }
  });

  it("explains renders, reads and route relationships with the right rules and lines", () => {
    const dashboard = nodeByPath("src/app/dashboard/page.tsx")!;
    const projectList = nodeByPath("src/components/ProjectList.tsx")!;
    const renders = edge(dashboard.id, projectList.id, "renders")!;
    const renderEvidence = renders.metadata?.evidence?.[0];
    expect(renderEvidence?.ruleId).toBe("react.jsx-usage");
    expect(renderEvidence?.path).toBe("src/app/dashboard/page.tsx");
    expect(renderEvidence?.startLine).toBeGreaterThan(0);

    const service = nodeByPath("src/services/project-service.ts")!;
    const database = nodeByPath("src/lib/db.ts")!;
    const reads = edge(service.id, database.id, "reads")!;
    const readEvidence = reads.metadata?.evidence?.[0];
    expect(readEvidence?.ruleId).toBe("db.operation.classify");
    expect(readEvidence?.kind).toBe("inferred");
    expect(readEvidence?.reason).toContain("findMany");

    const api = nodeByPath("src/app/api/projects/route.ts")!;
    const routeEdge = edge(dashboard.id, api.id, "routes_to")!;
    const routeEvidence = routeEdge.metadata?.evidence?.[0];
    expect(routeEvidence?.ruleId).toBe("nextjs.fetch-route-match");
    expect(routeEvidence?.kind).toBe("inferred");
    expect(routeEvidence?.path).toBe("src/app/dashboard/page.tsx");
  });

  it("attributes the Prisma datasource provider as evidence for the database link", () => {
    const prisma = document.nodes.find((node) => node.id === "orm:prisma")!;
    const database = document.nodes.find((node) => node.id === "db:postgresql")!;
    const link = edge(prisma.id, database.id, "uses")!;
    const evidence = link.metadata?.evidence?.[0];
    expect(evidence?.path).toBe("prisma/schema.prisma");
    expect(evidence?.ruleId).toBe("prisma.datasource-provider");
    expect(evidence?.kind).toBe("exact");
    expect(database.source?.path).toBe("prisma/schema.prisma");
    expect(database.source?.startLine).toBeGreaterThan(0);
  });

  it("reports analysis capabilities honestly", () => {
    expect(document.schemaVersion).toBe("1.1.0");
    expect(document.capabilities.languages).toContain("typescript");
    expect(document.capabilities.frameworks).toContain("nextjs-app");
    expect(document.capabilities.databaseSchemas).toContain("prisma");
    expect(document.capabilities.dataSchemaAnalyzers).toContain("prisma-schema");
    expect(document.capabilities.parsers).toContain("typescript-ast");
    expect(document.capabilities.apiProtocols).toContain("http");
    expect(document.capabilities.asyncSystems).toEqual([]);
    expect(document.capabilities.infrastructure).toEqual([]);
    expect(document.capabilities.symbolResolution).toBe("partial");
    expect(document.capabilities.integrations).toBeGreaterThan(0);
  });

  it("builds a resolved symbol graph with source evidence", () => {
    const symbolNodes = document.nodes.filter((node) => node.type === "symbol");
    expect(symbolNodes.length).toBeGreaterThan(3);
    expect(document.stats.symbols).toBe(symbolNodes.length);
    expect(document.stats.symbolEdges).toBeGreaterThan(0);

    const dashboardSymbol = document.nodes.find(
      (node) => node.id === "symbol:src/app/dashboard/page.tsx#DashboardPage",
    );
    const projectListSymbol = document.nodes.find(
      (node) => node.id === "symbol:src/components/ProjectList.tsx#ProjectList",
    );
    expect(dashboardSymbol).toBeTruthy();
    expect(projectListSymbol).toBeTruthy();

    const renderFact = edge(dashboardSymbol!.id, projectListSymbol!.id, "renders");
    expect(renderFact).toBeTruthy();
    expect(renderFact!.metadata?.evidence?.[0]?.ruleId).toBe("react.jsx-symbol-render");
    expect(renderFact!.metadata?.evidence?.[0]?.path).toBe("src/app/dashboard/page.tsx");

    const contains = edge("file:src/app/dashboard/page.tsx", dashboardSymbol!.id, "contains");
    expect(contains).toBeTruthy();
    expect(contains!.metadata?.evidence?.[0]?.ruleId).toBe("ir.symbol-declaration");
    expect(contains!.metadata?.evidence?.[0]?.kind).toBe("exact");

    const apiGet = document.nodes.find(
      (node) => node.id === "symbol:src/app/api/projects/route.ts#GET",
    );
    const listProjects = document.nodes.find(
      (node) => node.id === "symbol:src/services/project-service.ts#listProjects",
    );
    expect(apiGet).toBeTruthy();
    expect(listProjects).toBeTruthy();
    const call = edge(apiGet!.id, listProjects!.id, "calls");
    expect(call).toBeTruthy();
    expect(call!.metadata?.evidence?.[0]?.ruleId).toBe("symbol.resolved-call");
    expect(call!.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("never creates symbol nodes for unused declarations", () => {
    const buttonSymbols = document.nodes.filter(
      (node) => node.type === "symbol" && node.path === "src/components/Button.tsx",
    );
    expect(buttonSymbols).toEqual([]);
  });

  it("builds data model and enum entities from the Prisma schema", () => {
    const project = document.nodes.find((node) => node.id === "data:prisma:project")!;
    const task = document.nodes.find((node) => node.id === "data:prisma:task")!;
    expect(project?.type).toBe("data_model");
    expect(task?.type).toBe("data_model");

    const fields = project.metadata.fields as Array<{ name: string; kind: string; primaryKey?: boolean }>;
    expect(fields.find((field) => field.name === "id")?.primaryKey).toBe(true);
    expect(fields.find((field) => field.name === "status")?.kind).toBe("enum");

    const enumNode = document.nodes.find((node) => node.id === "data-enum:prisma:projectstatus")!;
    expect(enumNode?.type).toBe("data_enum");
    expect(enumNode?.metadata.values).toEqual(["ACTIVE", "ARCHIVED"]);

    const enumLink = edge(project.id, enumNode.id, "references")!;
    expect(enumLink.metadata?.evidence?.[0]?.ruleId).toBe("data.enum-reference");

    const relation = edge(task.id, project.id, "references")!;
    expect(relation.metadata?.cardinality).toBe("one");
    expect(relation.metadata?.evidence?.[0]?.ruleId).toBe("data.relation-field");
    expect(relation.metadata?.evidence?.[0]?.path).toBe("prisma/schema.prisma");
  });

  it("connects service code to concrete Prisma models", () => {
    const service = "file:src/services/project-service.ts";
    const reads = edge(service, "data:prisma:project", "reads")!;
    expect(reads).toBeTruthy();
    expect(reads.metadata?.evidence?.[0]?.ruleId).toBe("prisma.model-access");
    expect(reads.metadata?.evidence?.[0]?.reason).toContain("prisma.project.findMany");

    const writes = edge(service, "data:prisma:project", "writes")!;
    expect(writes).toBeTruthy();
    expect(writes.confidence).toBeGreaterThanOrEqual(0.85);
  });

  function apiNode() {
    return document.nodes.find((node) => node.type === "api");
  }
});

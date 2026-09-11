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

  function apiNode() {
    return document.nodes.find((node) => node.type === "api");
  }
});

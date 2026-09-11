import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { clearMemoryCache } from "@/lib/cache/cache";
import { FixtureRepositoryProvider } from "@/lib/github/fixture-provider";
import type { AppGraphDocument } from "@/lib/graph/model";

function fixtureRoot(name: string): string {
  return path.join(process.cwd(), "tests", "fixtures", name);
}

/**
 * False-positive regression suite (AG-TRUST-004). The fixture is intentionally
 * designed to fool heuristics; the analyzer must NOT invent semantic facts.
 */
let document: AppGraphDocument;

beforeAll(async () => {
  process.env.APPGRAPH_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "appgraph-negative-"));
  process.env.APPGRAPH_ANALYSIS_VERSION = `negative-${Date.now()}`;
  clearMemoryCache();
  const provider = new FixtureRepositoryProvider(fixtureRoot("sample-negative"));
  document = await analyzeRepository({
    provider,
    input: "https://github.com/fixture/sample-negative",
  });
});

function nodeByPath(filePath: string) {
  return document.nodes.find((node) => node.path === filePath);
}

function edge(sourceId: string, targetId: string, type: string) {
  return document.edges.find(
    (candidate) =>
      candidate.source === sourceId && candidate.target === targetId && candidate.type === type,
  );
}

describe("false-positive regressions", () => {
  it("detects the import but never invents a render for an unused component", () => {
    const page = nodeByPath("src/app/page.tsx")!;
    const widget = nodeByPath("src/components/Widget.tsx")!;
    expect(widget.type).toBe("component");

    const importEdge = edge(page.id, widget.id, "imports");
    expect(importEdge).toBeTruthy();
    expect(importEdge!.metadata?.evidence?.[0]?.ruleId).toBe("import.resolve");

    expect(edge(page.id, widget.id, "renders")).toBeFalsy();
    expect(edge(page.id, widget.id, "calls")).toBeFalsy();
  });

  it("never creates calls for an imported but unused helper", () => {
    const page = nodeByPath("src/app/page.tsx")!;
    const helpers = nodeByPath("src/lib/helpers.ts")!;
    expect(edge(page.id, helpers.id, "imports")).toBeTruthy();
    expect(edge(page.id, helpers.id, "calls")).toBeFalsy();
  });

  it("does not treat a local object with db-like method names as a database", () => {
    const page = nodeByPath("src/app/page.tsx")!;
    const fakeDb = nodeByPath("src/lib/fake-db.ts")!;
    expect(fakeDb.type).not.toBe("database");
    expect(document.nodes.some((node) => node.type === "database")).toBe(false);

    expect(edge(page.id, fakeDb.id, "reads")).toBeFalsy();
    expect(edge(page.id, fakeDb.id, "writes")).toBeFalsy();
    expect(edge(page.id, fakeDb.id, "calls")).toBeFalsy();
  });

  it("does not turn documentation strings into API routes", () => {
    expect(document.edges.some((candidate) => candidate.type === "routes_to")).toBe(false);
  });

  it("does not read process.env mentions from comments", () => {
    expect(document.nodes.some((node) => node.type === "config")).toBe(false);
    expect(document.edges.some((candidate) => candidate.target === "config:environment")).toBe(false);
  });

  it("reports honest capabilities for a repository without data schemas", () => {
    expect(document.capabilities.languages).toEqual(["typescript"]);
    expect(document.capabilities.frameworks).toContain("nextjs-app");
    expect(document.capabilities.databaseSchemas).toEqual([]);
    expect(document.capabilities.apiProtocols).toEqual([]);
    expect(document.capabilities.symbolResolution).toBe("partial");
  });
});

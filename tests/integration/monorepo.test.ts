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

function lineOf(source: string, needle: string): number {
  return source.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

let document: AppGraphDocument;

beforeAll(async () => {
  process.env.APPGRAPH_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "appgraph-mono-"));
  process.env.APPGRAPH_ANALYSIS_VERSION = `mono-${Date.now()}`;
  clearMemoryCache();
  const provider = new FixtureRepositoryProvider(fixtureRoot("sample-monorepo"));
  document = await analyzeRepository({
    provider,
    input: "https://github.com/fixture/sample-monorepo",
  });
});

function nodeById(id: string) {
  return document.nodes.find((node) => node.id === id);
}

function edge(source: string, target: string, type: string) {
  return document.edges.find(
    (candidate) =>
      candidate.source === source && candidate.target === target && candidate.type === type,
  );
}

describe("monorepo package graph", () => {
  it("creates a package node per workspace package with per-package detection", () => {
    const ui = nodeById("package:acme-ui")!;
    const web = nodeById("package:web")!;
    const api = nodeById("package:api")!;
    const db = nodeById("package:acme-db")!;
    expect(ui?.type).toBe("package");
    expect(ui.metadata.packagePath).toBe("packages/ui");
    expect(ui.metadata.role).toBe("library");
    expect(ui.metadata.frameworks).toContain("react");
    expect(ui.metadata.group).toBe("packages");

    expect(web.metadata.role).toBe("app");
    expect(web.metadata.frameworks).toContain("nextjs-app");
    expect(api.metadata.role).toBe("app");
    expect(db.metadata.packagePath).toBe("packages/db");
  });

  it("links workspace dependencies with manifest evidence", async () => {
    const packageJson = await fs.readFile(
      path.join(fixtureRoot("sample-monorepo"), "apps", "web", "package.json"),
      "utf8",
    );
    const edgeToUi = edge("package:web", "package:acme-ui", "depends_on")!;
    expect(edgeToUi).toBeTruthy();
    expect(edgeToUi.metadata?.dependency).toBe("@acme/ui");
    const evidence = edgeToUi.metadata?.evidence?.[0];
    expect(evidence?.ruleId).toBe("package.dependency");
    expect(evidence?.path).toBe("apps/web/package.json");
    expect(evidence?.startLine).toBe(lineOf(packageJson, '"@acme/ui"'));

    expect(edge("package:web", "package:acme-db", "depends_on")).toBeTruthy();
    expect(edge("package:api", "package:acme-db", "depends_on")).toBeTruthy();
    // External dependencies must not become package edges.
    expect(edge("package:web", "package:next", "depends_on")).toBeUndefined();
  });

  it("contains the analyzed files of each package", () => {
    const contains = edge("package:acme-ui", "file:packages/ui/src/Button.tsx", "contains")!;
    expect(contains).toBeTruthy();
    expect(contains.metadata?.evidence?.[0]?.ruleId).toBe("package.contains-file");
    expect(edge("package:web", "file:apps/web/src/app/page.tsx", "contains")).toBeTruthy();
  });

  it("resolves cross-package imports through exports maps", () => {
    const page = "file:apps/web/src/app/page.tsx";
    const button = "file:packages/ui/src/Button.tsx";
    const renders = edge(page, button, "renders")!;
    expect(renders).toBeTruthy();
    expect(renders.metadata?.evidence?.[0]?.ruleId).toBe("react.jsx-usage");

    const apiImport = edge("file:apps/api/src/server.ts", "file:packages/db/src/index.ts", "imports")!;
    expect(apiImport).toBeTruthy();
    expect(apiImport.metadata?.evidence?.[0]?.ruleId).toBe("import.resolve");
  });

  it("resolves cross-package symbols", () => {
    const home = nodeById("symbol:apps/web/src/app/page.tsx#HomePage")!;
    const button = nodeById("symbol:packages/ui/src/Button.tsx#Button")!;
    expect(home).toBeTruthy();
    expect(button).toBeTruthy();
    const renders = edge(home.id, button.id, "renders")!;
    expect(renders).toBeTruthy();
    expect(renders.metadata?.evidence?.[0]?.ruleId).toBe("react.jsx-symbol-render");
  });

  it("reports monorepo capabilities honestly", () => {
    expect(document.capabilities.monorepoTool).toBe("turbo");
    expect(document.capabilities.monorepoPackages).toBe(4);
  });
});

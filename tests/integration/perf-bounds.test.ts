import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { clearMemoryCache } from "@/lib/cache/cache";
import { FixtureRepositoryProvider } from "@/lib/github/fixture-provider";
import { DEFAULT_LIMITS } from "@/lib/github/limits";
import type { AppGraphDocument } from "@/lib/graph/model";

const FILE_COUNT = 420;

async function generateRepository(root: string): Promise<void> {
  const dir = path.join(root, "src", "lib", "modules");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "perf-repo", dependencies: { next: "15.0.0", react: "19.0.0" } }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }, null, 2),
  );

  const writes: Array<Promise<void>> = [];
  for (let index = 0; index < FILE_COUNT; index += 1) {
    const next = (index + 1) % FILE_COUNT;
    const content = `import { value${next} } from "./util-${next}";

export const value${index} = ${index};

export function helper${index}(input: number): number {
  return value${index} + input + value${next};
}

export function useFeature${index}() {
  return helper${index}(1);
}
`;
    writes.push(fs.writeFile(path.join(dir, `util-${index}.ts`), content));
    if (writes.length >= 80) {
      await Promise.all(writes);
      writes.length = 0;
    }
  }
  await Promise.all(writes);
}

let document: AppGraphDocument;
let repoDir: string;
let cacheDir: string;

beforeAll(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "appgraph-perf-"));
  repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "appgraph-perf-repo-"));
  process.env.APPGRAPH_CACHE_DIR = cacheDir;
  process.env.APPGRAPH_ANALYSIS_VERSION = `perf-${Date.now()}`;
  clearMemoryCache();
  await generateRepository(repoDir);
  document = await analyzeRepository({
    provider: new FixtureRepositoryProvider(repoDir, "perf-commit"),
    input: "https://github.com/fixture/perf-repo",
  });
}, 180_000);

describe("performance bounds and determinism", () => {
  it("keeps analysis within the configured budgets", () => {
    expect(document.stats.sourceFiles).toBeGreaterThan(DEFAULT_LIMITS.maxAnalyzedFiles);
    expect(document.stats.analyzedFiles).toBeLessThanOrEqual(DEFAULT_LIMITS.maxAnalyzedFiles);
    expect(document.stats.analyzedFiles).toBeGreaterThan(100);
    expect(document.nodes.length).toBeLessThanOrEqual(DEFAULT_LIMITS.maxGraphNodes);
    expect(document.edges.length).toBeLessThanOrEqual(DEFAULT_LIMITS.maxGraphEdges);
    expect(document.stats.durationMs).toBeLessThan(120_000);
  });

  it("reports the source budget warning instead of silently truncating", () => {
    expect(document.warnings.some((warning) => warning.code === "SOURCE_BUDGET")).toBe(true);
  });

  it("produces every layout for the bounded graph", () => {
    for (const granularity of ["product", "architecture", "modules", "files", "symbols"] as const) {
      expect(document.layouts[granularity]).toBeTruthy();
    }
  });

  it("is deterministic and reuses the per-file parse cache across analysis versions", async () => {
    const firstNodeIds = document.nodes.map((node) => node.id).sort();
    const firstEdgeIds = document.edges.map((edge) => edge.id).sort();

    // Wait for the fire-and-forget parse cache writes to land on disk.
    let cacheFiles = 0;
    for (let attempt = 0; attempt < 20 && cacheFiles === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        cacheFiles = (await fs.readdir(path.join(cacheDir, "parse-files"))).length;
      } catch {
        cacheFiles = 0;
      }
    }
    expect(cacheFiles).toBeGreaterThan(0);

    process.env.APPGRAPH_ANALYSIS_VERSION = `perf-${Date.now()}-second`;
    clearMemoryCache();
    const second = await analyzeRepository({
      provider: new FixtureRepositoryProvider(repoDir, "perf-commit"),
      input: "https://github.com/fixture/perf-repo",
    });

    expect(second.nodes.map((node) => node.id).sort()).toEqual(firstNodeIds);
    expect(second.edges.map((edge) => edge.id).sort()).toEqual(firstEdgeIds);
    expect(second.stats.cacheHit).toBe(false);
  }, 180_000);
});

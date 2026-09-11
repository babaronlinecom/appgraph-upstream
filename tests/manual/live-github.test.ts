import { beforeAll, describe, expect, it } from "vitest";
import { GitHubPublicRepositoryProvider } from "@/lib/github/github-public-provider";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import type { AppGraphDocument } from "@/lib/graph/model";

/**
 * Opt-in live network check (not part of the default test run):
 *   APPGRAPH_LIVE_TEST=1 npx vitest run tests/manual/live-github.test.ts
 *
 * Uses a small real Next.js repository and relies on the commit-addressed
 * cache after the first run, so repeated runs do not hammer the GitHub API.
 */
const live = process.env.APPGRAPH_LIVE_TEST === "1";

describe.skipIf(!live)("live GitHub ingestion", () => {
  let document: AppGraphDocument;

  beforeAll(async () => {
    const provider = new GitHubPublicRepositoryProvider();
    document = await analyzeRepository({
      provider,
      input: "https://github.com/leerob/next-saas-starter",
    });
  }, 180_000);

  it("extracts semantic entities and relationships", () => {
    const byType: Record<string, number> = {};
    for (const node of document.nodes) {
      byType[node.type] = (byType[node.type] ?? 0) + 1;
    }
    // eslint-disable-next-line no-console
    console.log("STATS", JSON.stringify(document.stats));
    // eslint-disable-next-line no-console
    console.log("NODES", JSON.stringify(byType));
    // eslint-disable-next-line no-console
    console.log(
      "EXTERNALS",
      document.nodes
        .filter((node) => node.type === "external")
        .map((node) => node.label)
        .join(", "),
    );

    expect(document.nodes.length).toBeGreaterThan(5);
    expect(document.edges.length).toBeGreaterThan(3);
    expect(document.nodes.some((node) => node.type === "page")).toBe(true);
    expect(document.nodes.some((node) => node.type === "api")).toBe(true);
  });

  it("produces non-overlapping group lanes for every granularity", () => {
    for (const granularity of ["product", "architecture", "modules", "files"] as const) {
      const layout = document.layouts[granularity];
      expect(layout.nodePlacements).toBeTruthy();
      // eslint-disable-next-line no-console
      console.log(
        `LANES ${granularity}`,
        layout.groups
          .map(
            (group) =>
              `${group.title}[x=${Math.round(group.x)}..${Math.round(group.x + group.width)},y=${Math.round(
                group.y,
              )}..${Math.round(group.y + group.height)}]`,
          )
          .join(" | "),
      );
      for (let i = 0; i < layout.groups.length; i += 1) {
        for (let j = i + 1; j < layout.groups.length; j += 1) {
          const a = layout.groups[i];
          const b = layout.groups[j];
          const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
          const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    }
  });
});

import { describe, it } from "vitest";
import { GitHubPublicRepositoryProvider } from "@/lib/github/github-public-provider";
import { analyzeRepository } from "@/lib/analysis/pipeline";

const live = process.env.APPGRAPH_LIVE_TEST === "1";
const repo = process.env.APPGRAPH_PERF_REPO ?? "lnkiai/m3e-canvas";

describe.skipIf(!live)("perf timing", () => {
  it(
    "times every analysis phase",
    async () => {
      process.env.APPGRAPH_ANALYSIS_VERSION = `perf-${Date.now()}`;
      const start = Date.now();
      const logged = new Set<string>();
      let lastDone = start;

      const doc = await analyzeRepository({
        provider: new GitHubPublicRepositoryProvider(),
        input: `https://github.com/${repo}`,
        onMetadata: (metadata) => {
          console.log(
            `[${((Date.now() - start) / 1000).toFixed(1)}s] metadata ${metadata.fullName} size=${metadata.sizeKb}KB branch=${metadata.defaultBranch}`,
          );
        },
        onProgress: (steps) => {
          for (const step of steps) {
            if (step.status === "done" && !logged.has(step.id)) {
              logged.add(step.id);
              const now = Date.now();
              console.log(
                `[+${((now - lastDone) / 1000).toFixed(1)}s / ${((now - start) / 1000).toFixed(1)}s] ${step.id}: ${step.detail ?? ""}`,
              );
              lastDone = now;
            }
          }
        },
      });

      console.log(`TOTAL ${((Date.now() - start) / 1000).toFixed(1)}s`);
      console.log("STATS", JSON.stringify(doc.stats));
      console.log("nodes", doc.nodes.length, "edges", doc.edges.length);
    },
    900_000,
  );
});

import { describe, expect, it } from "vitest";
import { GitHubPublicRepositoryProvider } from "@/lib/github/github-public-provider";
import { analyzeRepository } from "@/lib/analysis/pipeline";

const live = process.env.APPGRAPH_PRIVATE_LIVE_TEST === "1";
const input = process.env.APPGRAPH_PRIVATE_REPO;
const token = process.env.GITHUB_TOKEN;

describe.skipIf(!live)("live private GitHub ingestion", () => {
  it("analyzes a token-authorized private repository", async () => {
    if (!input) throw new Error("APPGRAPH_PRIVATE_REPO is required when APPGRAPH_PRIVATE_LIVE_TEST=1");
    if (!token) throw new Error("GITHUB_TOKEN is required when APPGRAPH_PRIVATE_LIVE_TEST=1");

    const provider = new GitHubPublicRepositoryProvider({ token });
    const document = await analyzeRepository({ provider, input });

    expect(document.nodes.length).toBeGreaterThan(0);
    expect(document.stats.filesAnalyzed).toBeGreaterThan(0);
    expect(document.repository.fullName.toLowerCase()).toContain(input.toLowerCase());
  }, 180_000);
});

import { describe, expect, it } from "vitest";
import { GitHubPublicRepositoryProvider } from "@/lib/github/github-public-provider";
import { analyzeRepository } from "@/lib/analysis/pipeline";

const live = process.env.APPGRAPH_PRIVATE_LIVE_TEST === "1";
const configuredInput = process.env.APPGRAPH_PRIVATE_REPO;
const token = process.env.GITHUB_TOKEN;

describe.skipIf(!live)("live private GitHub ingestion", () => {
  it("analyzes a token-authorized private repository", async () => {
    if (!configuredInput) {
      throw new Error("APPGRAPH_PRIVATE_REPO is required when APPGRAPH_PRIVATE_LIVE_TEST=1");
    }
    if (!token) throw new Error("GITHUB_TOKEN is required when APPGRAPH_PRIVATE_LIVE_TEST=1");

    const input = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configuredInput)
      ? `https://github.com/${configuredInput}`
      : configuredInput;
    const provider = new GitHubPublicRepositoryProvider({ token });
    const document = await analyzeRepository({ provider, input });

    expect(document.nodes.length).toBeGreaterThan(0);
    expect(document.stats.analyzedFiles).toBeGreaterThan(0);
    expect(document.repository.fullName.toLowerCase()).toBe("babaronlinecom/babar-online-os");
  }, 180_000);
});

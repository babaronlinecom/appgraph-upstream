import { describe, expect, it } from "vitest";
import { GitHubPublicRepositoryProvider } from "@/lib/github/github-public-provider";
import { analyzeRepository } from "@/lib/analysis/pipeline";

const live = process.env.APPGRAPH_PRIVATE_LIVE_TEST === "1";
const configuredInput = process.env.APPGRAPH_PRIVATE_REPO;
const token = process.env.GITHUB_TOKEN;

function expectedFullName(input: string): string {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) {
    return input.toLowerCase();
  }

  const url = new URL(input);
  const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (!owner || !repo) throw new Error(`Invalid GitHub repository input: ${input}`);
  return `${owner}/${repo.replace(/\.git$/, "")}`.toLowerCase();
}

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
    expect(document.repository.fullName.toLowerCase()).toBe(expectedFullName(configuredInput));
  }, 180_000);
});

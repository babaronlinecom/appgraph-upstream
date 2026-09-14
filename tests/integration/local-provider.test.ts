import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { LocalRepositoryProvider } from "@/lib/github/local-repository-provider";

describe("local repository provider", () => {
  const fixture = path.resolve(process.cwd(), "tests/fixtures/sample-nextjs");

  it("indexes and reads an existing checkout without GitHub access", async () => {
    const provider = new LocalRepositoryProvider();
    const identity = await provider.resolveRepository(fixture);
    const metadata = await provider.getMetadata(identity);
    const tree = await provider.getTree(identity);
    const pkg = await provider.getFile(identity, "package.json");

    expect(metadata.fullName).toBe("local/sample-nextjs");
    expect(tree.entries.some((entry) => entry.path === "src" && entry.type === "tree")).toBe(true);
    expect(tree.entries.some((entry) => entry.path === "package.json" && entry.type === "blob")).toBe(true);
    expect(pkg.content).toContain("sample-nextjs-app");
    expect(await provider.getCommitSha(identity, "HEAD")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("runs the full AppGraph pipeline against a local checkout", async () => {
    const provider = new LocalRepositoryProvider();
    const document = await analyzeRepository({ provider, input: fixture });

    expect(document.repository.fullName).toBe("local/sample-nextjs");
    expect(document.stats.analyzedFiles).toBeGreaterThan(0);
    expect(document.nodes.some((node) => node.type === "page")).toBe(true);
    expect(document.nodes.some((node) => node.type === "api")).toBe(true);
  }, 60_000);
});

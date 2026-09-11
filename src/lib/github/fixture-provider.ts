import fs from "node:fs/promises";
import path from "node:path";
import type {
  RepositoryFile,
  RepositoryIdentity,
  RepositoryMetadata,
  RepositoryTree,
  RepositoryTreeEntry,
} from "@/lib/graph/model";
import type { RepositoryProvider } from "./provider";
import { parseGitHubUrl } from "./url";

/**
 * Local-directory provider used for deterministic tests and E2E runs.
 * Enabled only when APPGRAPH_FIXTURE_DIR points at a fixture directory, so the
 * production ingestion path always remains the public GitHub provider.
 */
export class FixtureRepositoryProvider implements RepositoryProvider {
  readonly id = "fixture";
  private readonly rootDir: string;
  private readonly commitSha: string;
  private cache: Map<string, string> | null = null;

  constructor(rootDir: string, commitSha = "fixture-commit-0001") {
    this.rootDir = rootDir;
    this.commitSha = commitSha;
  }

  async resolveRepository(input: string): Promise<RepositoryIdentity> {
    const parsed = parseGitHubUrl(input);
    return { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref };
  }

  async getMetadata(): Promise<RepositoryMetadata> {
    return {
      owner: "fixture",
      name: "sample-nextjs",
      fullName: "fixture/sample-nextjs",
      description: "Fixture Next.js application used by AppGraph tests.",
      defaultBranch: "main",
      stars: 42,
      forks: 7,
      watchers: 3,
      language: "TypeScript",
      topics: ["nextjs", "prisma", "fixture"],
      url: "https://github.com/fixture/sample-nextjs",
      homepage: null,
      license: "MIT",
      pushedAt: "2026-01-01T00:00:00Z",
      createdAt: "2025-01-01T00:00:00Z",
      archived: false,
      sizeKb: 128,
      openIssues: 0,
    };
  }

  async getCommitSha(): Promise<string> {
    return this.commitSha;
  }

  async getTree(_repo: RepositoryIdentity, ref?: string): Promise<RepositoryTree> {
    const files = await this.loadFiles();
    const entries: RepositoryTreeEntry[] = [...files.keys()].map((filePath) => ({
      path: filePath,
      type: "blob" as const,
      size: Buffer.byteLength(files.get(filePath) ?? "", "utf8"),
    }));
    return { entries, truncated: false, sha: this.commitSha, ref: ref ?? "main" };
  }

  async getFile(_repo: RepositoryIdentity, filePath: string): Promise<RepositoryFile> {
    const files = await this.loadFiles();
    const content = files.get(filePath.replace(/\\/g, "/"));
    if (content === undefined) {
      throw new Error(`Fixture file not found: ${filePath}`);
    }
    return { path: filePath, content, size: Buffer.byteLength(content, "utf8"), truncated: false };
  }

  private async loadFiles(): Promise<Map<string, string>> {
    if (this.cache) return this.cache;
    const files = new Map<string, string>();
    const walk = async (dir: string, prefix: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(absolute, relative);
        } else if (entry.isFile()) {
          const content = await fs.readFile(absolute, "utf8");
          files.set(relative.replace(/\\/g, "/"), content);
        }
      }
    };
    await walk(this.rootDir, "");
    this.cache = files;
    return files;
  }
}

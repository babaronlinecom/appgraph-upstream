import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  RepositoryFile,
  RepositoryIdentity,
  RepositoryMetadata,
  RepositoryTree,
  RepositoryTreeEntry,
} from "@/lib/graph/model";
import { AppGraphError } from "./errors";
import type { RepositoryProvider } from "./provider";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "out",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".appgraph-cache",
]);

interface GitRemoteIdentity {
  owner: string;
  repo: string;
  url: string;
}

/**
 * CLI-only provider for an already checked-out repository.
 * It never executes repository code; it only reads files and Git metadata.
 */
export class LocalRepositoryProvider implements RepositoryProvider {
  readonly id = "local";

  async resolveRepository(input: string): Promise<RepositoryIdentity> {
    const root = await fs.realpath(path.resolve(input));
    const info = await fs.stat(root).catch(() => null);
    if (!info?.isDirectory()) {
      throw new AppGraphError("REPO_NOT_FOUND", `Local repository directory not found: ${input}`, {
        status: 404,
      });
    }
    const remote = await readGitRemote(root);
    return {
      owner: remote?.owner ?? "local",
      repo: remote?.repo ?? path.basename(root),
      path: root,
    };
  }

  async getMetadata(repo: RepositoryIdentity): Promise<RepositoryMetadata> {
    const root = repositoryRoot(repo);
    const remote = await readGitRemote(root);
    const pkg = await readJson(path.join(root, "package.json"));
    const branch = (await readGitBranch(root)) ?? process.env.GITHUB_REF_NAME ?? "HEAD";
    return {
      owner: remote?.owner ?? repo.owner,
      name: remote?.repo ?? repo.repo,
      fullName: `${remote?.owner ?? repo.owner}/${remote?.repo ?? repo.repo}`,
      description: typeof pkg?.description === "string" ? pkg.description : null,
      defaultBranch: branch,
      stars: 0,
      forks: 0,
      watchers: 0,
      language: "TypeScript",
      topics: [],
      url: remote?.url ?? `file://${root}`,
      homepage: typeof pkg?.homepage === "string" ? pkg.homepage : null,
      license: typeof pkg?.license === "string" ? pkg.license : null,
      pushedAt: null,
      createdAt: null,
      archived: false,
      sizeKb: 0,
      openIssues: 0,
    };
  }

  async getCommitSha(repo: RepositoryIdentity): Promise<string> {
    const root = repositoryRoot(repo);
    return (await readGitCommit(root)) ?? hashDirectory(root);
  }

  async getTree(repo: RepositoryIdentity, ref?: string): Promise<RepositoryTree> {
    const root = repositoryRoot(repo);
    const entries: RepositoryTreeEntry[] = [];
    await walk(root, root, entries);
    if (!entries.some((entry) => entry.type === "blob")) {
      throw new AppGraphError("REPO_EMPTY", "This local repository does not contain any files.", {
        status: 422,
      });
    }
    const sha = await this.getCommitSha(repo, ref ?? "HEAD");
    return { entries, truncated: false, sha, ref: ref ?? sha };
  }

  async getFile(repo: RepositoryIdentity, filePath: string): Promise<RepositoryFile> {
    const root = repositoryRoot(repo);
    const absolute = path.resolve(root, filePath);
    const prefix = `${root}${path.sep}`;
    if (absolute !== root && !absolute.startsWith(prefix)) {
      throw new AppGraphError("NOT_FOUND", `Path escapes repository root: ${filePath}`, { status: 404 });
    }
    const content = await fs.readFile(absolute, "utf8").catch(() => null);
    if (content === null) {
      throw new AppGraphError("NOT_FOUND", `File not found: ${filePath}`, { status: 404 });
    }
    return {
      path: filePath.replace(/\\/g, "/"),
      content,
      size: Buffer.byteLength(content, "utf8"),
      truncated: false,
    };
  }
}

function repositoryRoot(repo: RepositoryIdentity): string {
  if (!repo.path) throw new AppGraphError("INTERNAL", "Local repository root is missing.");
  return repo.path;
}

async function walk(root: string, dir: string, output: RepositoryTreeEntry[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".next-"))) {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      output.push({ path: relative, type: "tree" });
      await walk(root, absolute, output);
    } else if (entry.isFile()) {
      const stat = await fs.stat(absolute);
      output.push({ path: relative, type: "blob", size: stat.size });
    }
  }
}

async function readGitRemote(root: string): Promise<GitRemoteIdentity | null> {
  const gitDir = await resolveGitDir(root);
  if (!gitDir) return null;
  const config = await fs.readFile(path.join(gitDir, "config"), "utf8").catch(() => "");
  const origin = config.match(/\[remote\s+"origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/)?.[1]?.trim();
  if (!origin) return null;
  const match = origin.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

async function resolveGitDir(root: string): Promise<string | null> {
  const dotGit = path.join(root, ".git");
  const stat = await fs.stat(dotGit).catch(() => null);
  if (!stat) return null;
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;
  const content = await fs.readFile(dotGit, "utf8").catch(() => "");
  const match = content.match(/^gitdir:\s*(.+)$/m);
  return match ? path.resolve(root, match[1].trim()) : null;
}

async function readGitBranch(root: string): Promise<string | null> {
  const gitDir = await resolveGitDir(root);
  if (!gitDir) return null;
  const head = await fs.readFile(path.join(gitDir, "HEAD"), "utf8").catch(() => "");
  const match = head.trim().match(/^ref:\s+refs\/heads\/(.+)$/);
  return match?.[1] ?? null;
}

async function readGitCommit(root: string): Promise<string | null> {
  const gitDir = await resolveGitDir(root);
  if (!gitDir) return null;
  const head = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8").catch(() => "")).trim();
  if (/^[0-9a-f]{40,64}$/i.test(head)) return head;
  const ref = head.match(/^ref:\s+(.+)$/)?.[1];
  if (!ref) return null;
  const loose = (await fs.readFile(path.join(gitDir, ref), "utf8").catch(() => "")).trim();
  if (/^[0-9a-f]{40,64}$/i.test(loose)) return loose;
  const packed = await fs.readFile(path.join(gitDir, "packed-refs"), "utf8").catch(() => "");
  const line = packed.split(/\r?\n/).find((candidate) => candidate.endsWith(` ${ref}`));
  return line?.split(" ")[0] ?? null;
}

async function hashDirectory(root: string): Promise<string> {
  const entries: RepositoryTreeEntry[] = [];
  await walk(root, root, entries);
  const hash = createHash("sha1");
  for (const entry of entries.filter((item) => item.type === "blob").sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(root, entry.path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

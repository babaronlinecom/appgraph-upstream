import { readCache, writeCache } from "@/lib/cache/cache";
import type {
  RepositoryFile,
  RepositoryIdentity,
  RepositoryMetadata,
  RepositoryTree,
  RepositoryTreeEntry,
} from "@/lib/graph/model";
import { AppGraphError, isAbortError } from "./errors";
import type { RepositoryProvider } from "./provider";
import { parseGitHubUrl, repositoryKey } from "./url";

const API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";
const METADATA_TTL_MS = 15 * 60 * 1000;
const ANALYSIS_VERSION = process.env.APPGRAPH_ANALYSIS_VERSION?.trim() || "0.1.0";

interface ProviderOptions {
  token?: string;
  requestTimeoutMs?: number;
  userAgent?: string;
}

interface GitHubRepoResponse {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  watchers_count: number;
  language: string | null;
  topics?: string[];
  html_url: string;
  homepage: string | null;
  license: { spdx_id?: string | null; name?: string | null } | null;
  pushed_at: string | null;
  created_at: string | null;
  archived: boolean;
  disabled?: boolean;
  size: number;
  open_issues_count: number;
  private: boolean;
}

interface GitHubTreeResponse {
  sha: string;
  truncated: boolean;
  tree: Array<{
    path: string;
    mode: string;
    type: "blob" | "tree" | "commit";
    sha: string;
    size?: number;
  }>;
}

interface GitHubCommitResponse {
  sha: string;
}

/**
 * Reads repositories through the official public GitHub REST API.
 * Server-side only: the optional token never reaches the browser.
 */
export class GitHubPublicRepositoryProvider implements RepositoryProvider {
  readonly id = "github-public";
  private readonly token?: string;
  private readonly requestTimeoutMs: number;
  private readonly userAgent: string;

  constructor(options: ProviderOptions = {}) {
    this.token = options.token?.trim() || undefined;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.userAgent = options.userAgent ?? "AppGraph/0.1";
  }

  async resolveRepository(input: string): Promise<RepositoryIdentity> {
    const parsed = parseGitHubUrl(input);
    return { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref, path: parsed.path };
  }

  async getMetadata(repo: RepositoryIdentity): Promise<RepositoryMetadata> {
    const key = `${repositoryKey(repo)}:${ANALYSIS_VERSION}`;
    const cached = await readCache<RepositoryMetadata>("github-metadata", key);
    if (cached) return cached;

    const response = await this.request<GitHubRepoResponse>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
    );

    const metadata: RepositoryMetadata = {
      owner: response.owner?.login ?? repo.owner,
      name: response.name,
      fullName: response.full_name,
      description: response.description,
      defaultBranch: response.default_branch,
      stars: response.stargazers_count ?? 0,
      forks: response.forks_count ?? 0,
      watchers: response.subscribers_count ?? response.watchers_count ?? 0,
      language: response.language,
      topics: response.topics ?? [],
      url: response.html_url,
      homepage: response.homepage,
      license: response.license?.spdx_id ?? response.license?.name ?? null,
      pushedAt: response.pushed_at,
      createdAt: response.created_at,
      archived: Boolean(response.archived),
      sizeKb: response.size ?? 0,
      openIssues: response.open_issues_count ?? 0,
    };

    await writeCache("github-metadata", key, metadata, { ttlMs: METADATA_TTL_MS });
    return metadata;
  }

  async getCommitSha(repo: RepositoryIdentity, ref: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request<GitHubCommitResponse>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${encodeURIComponent(ref)}`,
      { signal },
    );
    if (!response.sha) {
      throw new AppGraphError("GITHUB_UNAVAILABLE", "GitHub did not return a commit SHA for this branch.", {
        retryable: true,
      });
    }
    return response.sha;
  }

  async getTree(repo: RepositoryIdentity, ref?: string, signal?: AbortSignal): Promise<RepositoryTree> {
    const treeRef = ref ?? "HEAD";
    const cacheKey = `${repositoryKey(repo)}:${treeRef}:${ANALYSIS_VERSION}`;
    const cached = await readCache<RepositoryTree>("github-trees", cacheKey);
    if (cached) return cached;

    const response = await this.request<GitHubTreeResponse>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`,
      { signal },
    );

    const entries: RepositoryTreeEntry[] = [];
    let blobCount = 0;
    for (const item of response.tree ?? []) {
      if (item.type === "blob") blobCount += 1;
      entries.push({ path: item.path, type: item.type === "tree" ? "tree" : "blob", size: item.size, sha: item.sha });
    }

    if (blobCount === 0) {
      throw new AppGraphError("REPO_EMPTY", "This repository does not contain any files on the analyzed branch.", {
        status: 422,
      });
    }

    const tree: RepositoryTree = {
      entries,
      truncated: Boolean(response.truncated),
      sha: response.sha,
      ref: treeRef,
    };
    await writeCache("github-trees", cacheKey, tree);
    return tree;
  }

  async getFile(
    repo: RepositoryIdentity,
    path: string,
    ref?: string,
    signal?: AbortSignal,
  ): Promise<RepositoryFile> {
    const fileRef = ref ?? "HEAD";
    const url = `${RAW_BASE}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${encodeURIComponent(
      fileRef,
    )}/${path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;

    const response = await this.fetchWithTimeout(url, { signal }, this.requestTimeoutMs);
    if (!response.ok) {
      if (response.status === 404) {
        throw new AppGraphError("NOT_FOUND", `File "${path}" was not found at the analyzed commit.`, {
          status: 404,
        });
      }
      if (response.status === 403 || response.status === 429) {
        throw this.rateLimitError(response);
      }
      throw new AppGraphError("GITHUB_UNAVAILABLE", `GitHub returned ${response.status} while fetching "${path}".`, {
        status: response.status,
        retryable: true,
      });
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    const declaredSize = Number.isNaN(contentLength) ? undefined : contentLength;
    const content = await response.text();
    return {
      path,
      content,
      size: declaredSize ?? Buffer.byteLength(content, "utf8"),
      truncated: false,
    };
  }

  private async request<T>(apiPath: string, options: { signal?: AbortSignal } = {}): Promise<T> {
    const response = await this.fetchWithTimeout(
      `${API_BASE}${apiPath}`,
      {
        signal: options.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      this.requestTimeoutMs,
    );

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (response.status === 404) {
      throw new AppGraphError(
        "REPO_NOT_FOUND",
        "This repository was not found. It may not exist, or it may be private.",
        { status: 404 },
      );
    }

    if (response.status === 451) {
      throw new AppGraphError("REPO_PRIVATE", "GitHub reports this repository as unavailable.", {
        status: 451,
      });
    }

    if (response.status === 403 || response.status === 429) {
      throw this.rateLimitError(response);
    }

    if (response.status >= 500) {
      throw new AppGraphError("GITHUB_UNAVAILABLE", "GitHub responded with a server error.", {
        status: response.status,
        retryable: true,
      });
    }

    throw new AppGraphError("GITHUB_UNAVAILABLE", `Unexpected GitHub response (${response.status}).`, {
      status: response.status,
      retryable: true,
    });
  }

  private rateLimitError(response: Response): AppGraphError {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number.parseInt(response.headers.get("x-ratelimit-reset") ?? "", 10);
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const resetSeconds = Number.isNaN(reset) ? undefined : Math.max(1, reset - Math.floor(Date.now() / 1000));
    const waitSeconds = Number.isNaN(retryAfter) ? resetSeconds : retryAfter;

    if (remaining === "0" || waitSeconds !== undefined) {
      return new AppGraphError(
        "RATE_LIMIT",
        "GitHub temporarily rate-limited AppGraph for this server. Please retry shortly.",
        { status: 429, retryable: true, retryAfterSeconds: waitSeconds },
      );
    }

    return new AppGraphError("GITHUB_UNAVAILABLE", "GitHub rejected the request.", {
      status: response.status,
      retryable: true,
    });
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = init.signal;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const headers = new Headers(init.headers);
    headers.set("User-Agent", this.userAgent);
    if (this.token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    try {
      return await fetch(url, { ...init, headers, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error)) {
        if (externalSignal?.aborted) {
          throw new AppGraphError("TIMEOUT", "Analysis was cancelled.", { status: 499 });
        }
        throw new AppGraphError("TIMEOUT", `GitHub did not respond within ${timeoutMs / 1000}s.`, {
          retryable: true,
        });
      }
      throw new AppGraphError("GITHUB_UNAVAILABLE", "Could not reach GitHub. Check the network connection.", {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

let providerSingleton: GitHubPublicRepositoryProvider | null = null;

export function getGitHubProvider(): GitHubPublicRepositoryProvider {
  if (!providerSingleton) {
    providerSingleton = new GitHubPublicRepositoryProvider({
      token: process.env.GITHUB_TOKEN,
    });
  }
  return providerSingleton;
}

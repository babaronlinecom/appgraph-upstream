import type {
  RepositoryFile,
  RepositoryIdentity,
  RepositoryMetadata,
  RepositoryTree,
} from "@/lib/graph/model";

/**
 * Abstraction over repository hosting. The MVP ships github.com only, but the
 * analyzer consumes this interface so GitLab/Bitbucket/uploaded archives can be
 * added later without touching graph logic.
 */
export interface RepositoryProvider {
  readonly id: string;
  resolveRepository(input: string): Promise<RepositoryIdentity>;
  getMetadata(repo: RepositoryIdentity, signal?: AbortSignal): Promise<RepositoryMetadata>;
  getTree(repo: RepositoryIdentity, ref?: string, signal?: AbortSignal): Promise<RepositoryTree>;
  getFile(
    repo: RepositoryIdentity,
    path: string,
    ref?: string,
    signal?: AbortSignal,
  ): Promise<RepositoryFile>;
  /** Optional: resolves a branch/tag to a commit SHA for cache keys. */
  getCommitSha?(repo: RepositoryIdentity, ref: string, signal?: AbortSignal): Promise<string>;
}

export interface ProviderRequestOptions {
  signal?: AbortSignal;
}

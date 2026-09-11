export type AppGraphErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "REPO_NOT_FOUND"
  | "REPO_PRIVATE"
  | "RATE_LIMIT"
  | "GITHUB_UNAVAILABLE"
  | "REPO_EMPTY"
  | "REPO_TOO_LARGE"
  | "TIMEOUT"
  | "UNSUPPORTED_REPO"
  | "NOT_FOUND"
  | "INTERNAL";

export interface UserFacingError {
  code: AppGraphErrorCode;
  title: string;
  message: string;
  hint?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export class AppGraphError extends Error {
  readonly code: AppGraphErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly detail?: string;

  constructor(
    code: AppGraphErrorCode,
    message: string,
    options: {
      status?: number;
      retryable?: boolean;
      retryAfterSeconds?: number;
      detail?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "AppGraphError";
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.detail = options.detail;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

const DEFAULT_TITLES: Record<AppGraphErrorCode, string> = {
  INVALID_URL: "That does not look like a GitHub repository URL",
  UNSUPPORTED_HOST: "Only github.com repositories are supported",
  REPO_NOT_FOUND: "Repository not found",
  REPO_PRIVATE: "This repository is private",
  RATE_LIMIT: "GitHub API rate limit reached",
  GITHUB_UNAVAILABLE: "GitHub is unavailable right now",
  REPO_EMPTY: "This repository is empty",
  REPO_TOO_LARGE: "This repository is too large for the MVP",
  TIMEOUT: "Analysis timed out",
  UNSUPPORTED_REPO: "This repository is not supported yet",
  NOT_FOUND: "Not found",
  INTERNAL: "Something went wrong",
};

export function toUserFacingError(error: unknown): UserFacingError {
  if (error instanceof AppGraphError) {
    const base: UserFacingError = {
      code: error.code,
      title: DEFAULT_TITLES[error.code],
      message: error.message,
      retryable: error.retryable,
    };
    if (error.retryAfterSeconds !== undefined) base.retryAfterSeconds = error.retryAfterSeconds;
    const hint = HINTS[error.code];
    if (hint) base.hint = hint;
    return base;
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    code: "INTERNAL",
    title: DEFAULT_TITLES.INTERNAL,
    message,
    hint: "Try again. If the problem persists, the repository may use an unsupported pattern.",
    retryable: true,
  };
}

const HINTS: Partial<Record<AppGraphErrorCode, string>> = {
  INVALID_URL: "Expected format: https://github.com/owner/repository",
  UNSUPPORTED_HOST: "Private hosts, GitLab and Bitbucket are not available in this version.",
  REPO_NOT_FOUND:
    "Public repositories work without authentication. Private repository support is coming later.",
  REPO_PRIVATE:
    "Public repositories work without authentication. Private repository support is coming later.",
  RATE_LIMIT:
    "AppGraph reads public GitHub data. Wait a moment, or configure a server-side GITHUB_TOKEN to raise the limit.",
  GITHUB_UNAVAILABLE: "GitHub did not respond in time. This is usually temporary.",
  REPO_TOO_LARGE: "AppGraph returns a partial graph for large repositories when possible.",
  UNSUPPORTED_REPO: "The MVP supports TypeScript and JavaScript repositories (Next.js, React, Node.js).",
  TIMEOUT: "Try a smaller repository, or retry in a moment.",
};

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}

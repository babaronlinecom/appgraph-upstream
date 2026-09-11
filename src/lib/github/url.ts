import { AppGraphError } from "./errors";
import type { RepositoryIdentity } from "@/lib/graph/model";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const RESERVED_REPO_PATHS = new Set([
  "settings",
  "notifications",
  "explore",
  "marketplace",
  "sponsors",
  "topics",
  "collections",
  "trending",
  "new",
  "login",
  "logout",
  "join",
  "features",
  "pricing",
  "about",
  "apps",
]);

export interface ParsedGitHubUrl extends RepositoryIdentity {
  canonicalUrl: string;
}

/**
 * Parses and strictly validates a public github.com repository URL.
 * Never allow arbitrary hosts: this is the only place URLs are accepted from users.
 */
export function parseGitHubUrl(input: string): ParsedGitHubUrl {
  const raw = (input ?? "").trim();
  if (!raw) {
    throw new AppGraphError("INVALID_URL", "Enter a public GitHub repository URL.", { status: 400 });
  }

  let candidate = raw;
  if (/^(github\.com|www\.github\.com)\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    throw new AppGraphError(
      "INVALID_URL",
      `"${truncate(raw)}" is not a valid repository URL. Expected https://github.com/owner/repository.`,
      { status: 400 },
    );
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new AppGraphError(
      "INVALID_URL",
      `"${truncate(raw)}" is not a valid repository URL. Expected https://github.com/owner/repository.`,
      { status: 400 },
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AppGraphError("INVALID_URL", "Only https:// repository URLs are supported.", {
      status: 400,
    });
  }

  const host = url.hostname.toLowerCase();
  if (!GITHUB_HOSTS.has(host)) {
    throw new AppGraphError(
      "UNSUPPORTED_HOST",
      `"${host}" is not supported yet. Paste a public repository URL from github.com.`,
      { status: 400 },
    );
  }

  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => safeDecode(segment));

  if (segments.length < 2) {
    throw new AppGraphError(
      "INVALID_URL",
      "The URL must include both an owner and a repository, for example https://github.com/vercel/next.js.",
      { status: 400 },
    );
  }

  const owner = segments[0];
  let repo = segments[1];
  if (repo.toLowerCase().endsWith(".git")) {
    repo = repo.slice(0, -4);
  }

  if (!OWNER_PATTERN.test(owner)) {
    throw new AppGraphError("INVALID_URL", `"${truncate(owner)}" is not a valid GitHub owner name.`, {
      status: 400,
    });
  }

  if (!REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    throw new AppGraphError("INVALID_URL", `"${truncate(repo)}" is not a valid repository name.`, {
      status: 400,
    });
  }

  if (RESERVED_REPO_PATHS.has(owner.toLowerCase()) && segments.length < 3) {
    throw new AppGraphError(
      "INVALID_URL",
      `"${truncate(raw)}" points to a GitHub page, not a repository.`,
      { status: 400 },
    );
  }

  const identity: ParsedGitHubUrl = {
    owner,
    repo,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };

  // Support pasted "tree"/"blob" URLs: github.com/owner/repo/tree/main/src/...
  const marker = segments[2]?.toLowerCase();
  if ((marker === "tree" || marker === "blob") && segments[3]) {
    identity.ref = safeDecode(segments[3]);
    if (segments.length > 4) {
      identity.path = segments.slice(4).join("/");
    }
  }

  return identity;
}

export function buildGitHubFileUrl(
  identity: Pick<RepositoryIdentity, "owner" | "repo">,
  ref: string,
  path: string,
  startLine?: number,
): string {
  const base = `https://github.com/${identity.owner}/${identity.repo}/blob/${encodeURIComponent(ref)}/${path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  return startLine ? `${base}#L${startLine}` : base;
}

export function repositoryKey(identity: Pick<RepositoryIdentity, "owner" | "repo">): string {
  return `${identity.owner.toLowerCase()}/${identity.repo.toLowerCase()}`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

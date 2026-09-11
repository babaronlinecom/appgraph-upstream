import { describe, expect, it } from "vitest";
import { buildGitHubFileUrl, parseGitHubUrl, repositoryKey } from "@/lib/github/url";
import { AppGraphError } from "@/lib/github/errors";

describe("parseGitHubUrl", () => {
  it("parses canonical repository URLs", () => {
    const parsed = parseGitHubUrl("https://github.com/vercel/next.js");
    expect(parsed.owner).toBe("vercel");
    expect(parsed.repo).toBe("next.js");
    expect(parsed.canonicalUrl).toBe("https://github.com/vercel/next.js");
  });

  it("tolerates trailing slash and .git suffix", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo/").repo).toBe("repo");
    expect(parseGitHubUrl("https://github.com/owner/repo.git").repo).toBe("repo");
  });

  it("accepts URLs without a scheme", () => {
    expect(parseGitHubUrl("github.com/owner/repo").owner).toBe("owner");
  });

  it("extracts ref and path from tree URLs", () => {
    const parsed = parseGitHubUrl("https://github.com/owner/repo/tree/main/src/app");
    expect(parsed.ref).toBe("main");
    expect(parsed.path).toBe("src/app");
  });

  it("rejects non-github hosts", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/owner/repo")).toThrowError(AppGraphError);
    try {
      parseGitHubUrl("https://gitlab.com/owner/repo");
    } catch (error) {
      expect((error as AppGraphError).code).toBe("UNSUPPORTED_HOST");
    }
  });

  it("rejects malformed input", () => {
    expect(() => parseGitHubUrl("")).toThrowError(AppGraphError);
    expect(() => parseGitHubUrl("not a url")).toThrowError(AppGraphError);
    expect(() => parseGitHubUrl("https://github.com/owner")).toThrowError(AppGraphError);
    expect(() => parseGitHubUrl("https://github.com/owner/..")).toThrowError(AppGraphError);
  });

  it("never treats SSRF targets as repositories", () => {
    expect(() => parseGitHubUrl("http://169.254.169.254/latest/meta-data")).toThrowError(AppGraphError);
    expect(() => parseGitHubUrl("https://localhost:3000/owner/repo")).toThrowError(AppGraphError);
    expect(() => parseGitHubUrl("file:///etc/passwd")).toThrowError(AppGraphError);
  });

  it("builds pinned blob URLs", () => {
    const url = buildGitHubFileUrl({ owner: "o", repo: "r" }, "abc123", "src/app/page.tsx", 12);
    expect(url).toBe("https://github.com/o/r/blob/abc123/src/app/page.tsx#L12");
  });

  it("normalizes repository keys case-insensitively", () => {
    expect(repositoryKey({ owner: "Owner", repo: "Repo" })).toBe("owner/repo");
  });
});

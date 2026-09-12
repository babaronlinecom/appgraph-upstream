import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { clearMemoryCache } from "@/lib/cache/cache";
import { FixtureRepositoryProvider } from "@/lib/github/fixture-provider";
import { toMermaidErd } from "@/features/workspace/analytics";
import type { AppGraphDocument } from "@/lib/graph/model";

function fixtureRoot(name: string): string {
  return path.join(process.cwd(), "tests", "fixtures", name);
}

function lineOf(source: string, needle: string): number {
  return source.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

let document: AppGraphDocument;
let schemaSource: string;

beforeAll(async () => {
  process.env.APPGRAPH_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "appgraph-prisma-rel-"));
  process.env.APPGRAPH_ANALYSIS_VERSION = `prisma-rel-${Date.now()}`;
  clearMemoryCache();
  schemaSource = await fs.readFile(
    path.join(fixtureRoot("sample-prisma-relations"), "prisma", "schema.prisma"),
    "utf8",
  );
  const provider = new FixtureRepositoryProvider(fixtureRoot("sample-prisma-relations"));
  document = await analyzeRepository({
    provider,
    input: "https://github.com/fixture/sample-prisma-relations",
  });
});

function edgeById(id: string) {
  return document.edges.find((edge) => edge.id === id);
}

describe("Prisma relations through the full pipeline", () => {
  it("keeps self-relation edges instead of dropping them", () => {
    const manager = edgeById("data:prisma:user->data:prisma:user:references:manager");
    const reports = edgeById("data:prisma:user->data:prisma:user:references:reports");
    expect(manager).toBeTruthy();
    expect(reports).toBeTruthy();
    expect(manager!.source).toBe(manager!.target);
    expect(manager!.metadata?.self).toBe(true);
    expect(manager!.metadata?.cardinality).toBe("one");
    expect(reports!.metadata?.cardinality).toBe("many");
  });

  it("never collapses multiple relations between the same model pair", () => {
    const postToUser = document.edges.filter(
      (edge) =>
        edge.type === "references" &&
        edge.source === "data:prisma:post" &&
        edge.target === "data:prisma:user",
    );
    expect(postToUser).toHaveLength(2);
    expect(postToUser.map((edge) => edge.metadata?.field).sort()).toEqual(["author", "editor"]);
    expect(postToUser.find((edge) => edge.metadata?.field === "author")?.metadata?.relationName).toBe(
      "AuthorPosts",
    );
    expect(postToUser.find((edge) => edge.metadata?.field === "editor")?.metadata?.optional).toBe(true);

    const userToPost = document.edges.filter(
      (edge) =>
        edge.type === "references" &&
        edge.source === "data:prisma:user" &&
        edge.target === "data:prisma:post",
    );
    expect(userToPost).toHaveLength(2);
  });

  it("attaches evidence with the exact relation attribute line", () => {
    const manager = edgeById("data:prisma:user->data:prisma:user:references:manager")!;
    const editor = edgeById("data:prisma:post->data:prisma:user:references:editor")!;
    expect(manager.metadata?.evidence?.[0]?.path).toBe("prisma/schema.prisma");
    expect(manager.metadata?.evidence?.[0]?.ruleId).toBe("data.relation-field");
    expect(manager.metadata?.evidence?.[0]?.startLine).toBe(
      lineOf(schemaSource, 'manager   User?   @relation("Management"'),
    );
    expect(editor.metadata?.evidence?.[0]?.startLine).toBe(
      lineOf(schemaSource, 'editor   User?  @relation("EditorPosts"'),
    );
    for (const edge of document.edges.filter((candidate) => candidate.type === "references")) {
      expect(edge.metadata?.evidence?.length).toBeGreaterThan(0);
      expect(edge.metadata?.evidence?.[0]?.startLine).toBeGreaterThan(0);
    }
  });

  it("renders self-relations and both named relations in the ER diagram", () => {
    const erd = toMermaidErd(document)!;
    expect(erd).toMatch(/User \|\|--\|?[|o{]{1,2} User : "manager"/);
    expect(erd).toMatch(/User \|\|--o{ User : "reports"/);
    expect(erd).toContain('Post ||--|| User : "author"');
    expect(erd).toContain('Post ||--o| User : "editor"');
  });
});

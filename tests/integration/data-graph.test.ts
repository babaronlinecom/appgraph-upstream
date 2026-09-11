import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { clearMemoryCache } from "@/lib/cache/cache";
import { FixtureRepositoryProvider } from "@/lib/github/fixture-provider";
import type { AppGraphDocument, AppGraphNodeMetadata } from "@/lib/graph/model";

function fixtureRoot(name: string): string {
  return path.join(process.cwd(), "tests", "fixtures", name);
}

interface FieldFact {
  name: string;
  type: string;
  kind: string;
  optional?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  relation?: { target: string; cardinality: string };
}

let document: AppGraphDocument;

beforeAll(async () => {
  process.env.APPGRAPH_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "appgraph-data-"));
  process.env.APPGRAPH_ANALYSIS_VERSION = `data-${Date.now()}`;
  clearMemoryCache();
  const provider = new FixtureRepositoryProvider(fixtureRoot("sample-data"));
  document = await analyzeRepository({
    provider,
    input: "https://github.com/fixture/sample-data",
  });
});

function node(id: string) {
  return document.nodes.find((candidate) => candidate.id === id);
}

function edge(source: string, target: string, type: string) {
  return document.edges.find(
    (candidate) =>
      candidate.source === source && candidate.target === target && candidate.type === type,
  );
}

function fieldsOf(id: string): FieldFact[] {
  const metadata = node(id)?.metadata as AppGraphNodeMetadata;
  return Array.isArray(metadata?.fields) ? (metadata.fields as FieldFact[]) : [];
}

describe("data graph from a Drizzle + SQL repository", () => {
  it("creates data model nodes with parsed columns", () => {
    const users = node("data:drizzle:users");
    expect(users?.type).toBe("data_model");
    expect(users?.metadata.format).toBe("drizzle");

    const fields = fieldsOf("data:drizzle:users");
    expect(fields.find((field) => field.name === "id")?.primaryKey).toBe(true);
    expect(fields.find((field) => field.name === "email")?.unique).toBe(true);
    expect(fields.find((field) => field.name === "email")?.optional).toBe(false);
    expect(fields.find((field) => field.name === "role")?.kind).toBe("enum");
  });

  it("links models with relation edges carrying cardinality and evidence", () => {
    const one = edge("data:drizzle:posts", "data:drizzle:users", "references")!;
    expect(one).toBeTruthy();
    expect(one.metadata?.cardinality).toBe("one");
    const evidence = one.metadata?.evidence?.[0];
    expect(evidence?.ruleId).toBe("data.relation-field");
    expect(evidence?.path).toBe("src/db/schema.ts");
    expect(evidence?.kind).toBe("exact");

    const many = edge("data:drizzle:users", "data:drizzle:posts", "references")!;
    expect(many).toBeTruthy();
    expect(many.metadata?.cardinality).toBe("many");
  });

  it("creates enum nodes and links model enum fields", () => {
    const role = node("data-enum:drizzle:role");
    expect(role?.type).toBe("data_enum");
    expect(role?.metadata.values).toEqual(["admin", "member"]);
    const link = edge("data:drizzle:users", "data-enum:drizzle:role", "references")!;
    expect(link).toBeTruthy();
    expect(link.metadata?.evidence?.[0]?.ruleId).toBe("data.enum-reference");
  });

  it("connects the provider to its models", () => {
    const database = document.nodes.find((candidate) => candidate.type === "database" && !candidate.path);
    expect(database).toBeTruthy();
    expect(edge(database!.id, "data:drizzle:users", "contains")).toBeTruthy();
    expect(edge(database!.id, "data:drizzle:posts", "contains")).toBeTruthy();
  });

  it("connects code to concrete tables through real schema facts", () => {
    const source = "file:src/app/api/users/route.ts";
    const readEdge = edge(source, "data:drizzle:users", "reads")!;
    expect(readEdge).toBeTruthy();
    const evidence = readEdge.metadata?.evidence?.[0];
    expect(evidence?.ruleId).toBe("drizzle.table-read");
    expect(evidence?.reason).toContain("users");
  });

  it("parses SQL DDL tables, composite keys and ALTER constraints", () => {
    const teams = node("data:sql:teams")!;
    expect(teams).toBeTruthy();
    expect(fieldsOf("data:sql:teams").find((field) => field.name === "id")?.primaryKey).toBe(true);

    const members = fieldsOf("data:sql:members");
    expect(members.find((field) => field.name === "team_id")?.primaryKey).toBe(true);
    expect(members.find((field) => field.name === "user_id")?.primaryKey).toBe(true);

    const fk = edge("data:sql:members", "data:sql:teams", "references")!;
    expect(fk).toBeTruthy();
    const evidence = fk.metadata?.evidence?.[0];
    expect(evidence?.ruleId).toBe("data.relation-field");
    expect(evidence?.path).toBe("migrations/002_members.sql");
  });

  it("reports every schema format it actually parsed", () => {
    expect(document.capabilities.databaseSchemas).toEqual(
      expect.arrayContaining(["drizzle", "sql"]),
    );
    expect(document.capabilities.dataSchemaAnalyzers).toEqual(
      expect.arrayContaining(["prisma-schema", "drizzle-schema", "sql-ddl"]),
    );
  });

  it("exports the ER diagram from real schema facts only", async () => {
    const { toMermaidErd } = await import("@/features/workspace/analytics");
    const erd = toMermaidErd(document)!;
    expect(erd).toContain("erDiagram");
    expect(erd).toContain("users {");
    expect(erd).toContain("posts {");
    // The posts→users relation must be rendered from the parsed schema fact.
    expect(erd).toMatch(/posts \|\|--[|o{]{1,2} users : "author(Id)?"/);
    expect(erd).toContain("teams {");
    expect(erd).toContain("members {");
  });
});

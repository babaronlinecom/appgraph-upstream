import { describe, expect, it } from "vitest";
import { drizzleSchemaAnalyzer, parseDrizzleModule } from "@/lib/analysis/data/drizzle";

function detect(path: string, content: string): boolean {
  return drizzleSchemaAnalyzer.detect({ files: new Map([[path, content]]), paths: [path] });
}

function analyze(path: string, content: string) {
  return drizzleSchemaAnalyzer.analyze({ files: new Map([[path, content]]), paths: [path] });
}

describe("Drizzle detection proof (AST, not substring)", () => {
  it("rejects a locally defined pgTable without a drizzle-orm import", () => {
    const fake = `
      function pgTable(name: string, columns: Record<string, unknown>) {
        return { name, columns };
      }
      export const users = pgTable("users", { id: 1 });
    `;
    expect(detect("src/fake.ts", fake)).toBe(false);
    expect(analyze("src/fake.ts", fake)).toEqual([]);
  });

  it("rejects a file that only mentions drizzle-orm in a comment or string", () => {
    const fake = `
      // import { pgTable } from "drizzle-orm/pg-core";
      const note = "drizzle-orm pgTable";
      function pgTable() { return null; }
      pgTable();
    `;
    expect(detect("src/fake.ts", fake)).toBe(false);
  });

  it("rejects an import that is never called", () => {
    const unused = `
      import { pgTable } from "drizzle-orm/pg-core";
      export const label = "users";
    `;
    expect(detect("src/unused.ts", unused)).toBe(false);
  });

  it("accepts aliased imports from drizzle-orm modules", () => {
    const aliased = `
      import { pgTable as table, pgEnum as enumType } from "drizzle-orm/pg-core";
      import { relations as rel } from "drizzle-orm";
      import { integer, serial, text } from "drizzle-orm/pg-core";

      export const roleEnum = enumType("role", ["admin", "member"]);
      export const users = table("users", {
        id: serial("id").primaryKey(),
        role: roleEnum("role").notNull(),
      });
      export const posts = table("posts", {
        id: serial("id").primaryKey(),
        authorId: integer("author_id").notNull(),
      });
      export const userRelations = rel(users, ({ many }) => ({ posts: many(posts) }));
    `;
    const detections = analyze("src/db/schema.ts", aliased);
    expect(detections).toHaveLength(1);
    const models = detections[0].models;
    expect(models.map((model) => model.name).sort()).toEqual(["posts", "users"]);
    expect(detections[0].enums[0]).toMatchObject({ name: "role", values: ["admin", "member"] });
    // relations() was resolved through the alias as well.
    const users = models.find((model) => model.name === "users")!;
    expect(users.fields.find((field) => field.name === "posts")?.relation?.target).toBe("posts");
  });

  it("does not treat a local name that shadows another symbol as a factory", () => {
    const shadowed = `
      import { pgEnum } from "drizzle-orm/pg-core";
      function pgTable() { return null; }
      export const roleEnum = pgEnum("role", ["admin"]);
      pgTable();
    `;
    expect(detect("src/shadow.ts", shadowed)).toBe(false);
  });
});

const COMPOSITE = `
import { foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  id: integer("id").primaryKey(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: integer("user_id").notNull(),
    teamId: integer("team_id").notNull(),
    role: text("role").default("member").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.teamId] }),
    uniqueIndex("memberships_pair_idx").on(table.userId, table.teamId),
    index("memberships_role_idx").on(table.role),
    foreignKey({ columns: [table.teamId], foreignColumns: [teams.id] }),
  ],
);
`;

describe("Drizzle table config: composite keys and indexes", () => {
  it("parses composite primary keys, unique indexes and indexes", () => {
    const models = parseDrizzleModule("src/db/schema.ts", COMPOSITE).tables;
    const memberships = models.find((model) => model.name === "memberships")!;

    expect(memberships.primaryKey.sort()).toEqual(["teamId", "userId"]);
    expect(memberships.fields.find((field) => field.name === "userId")?.primaryKey).toBe(true);
    expect(memberships.fields.find((field) => field.name === "teamId")?.primaryKey).toBe(true);

    expect(memberships.uniqueConstraints).toEqual([["userId", "teamId"]]);
    expect(memberships.indexes).toEqual([["role"]]);
    expect(memberships.indexDetails).toEqual(
      expect.arrayContaining([
        { name: "memberships_pair_idx", columns: ["userId", "teamId"], unique: true },
        { name: "memberships_role_idx", columns: ["role"], unique: false },
      ]),
    );
  });

  it("resolves foreignKey() config to the referenced table", () => {
    const models = parseDrizzleModule("src/db/schema.ts", COMPOSITE).tables;
    const memberships = models.find((model) => model.name === "memberships")!;
    const teamId = memberships.fields.find((field) => field.name === "teamId")!;
    expect(teamId.kind).toBe("relation");
    expect(teamId.relation?.target).toBe("teams");
    expect(teamId.relation?.ownerField).toBe("id");
  });
});

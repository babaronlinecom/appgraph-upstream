import { describe, expect, it } from "vitest";

const PRISMA_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  MEMBER
}

model User {
  id      String   @id @default(cuid())
  email   String   @unique
  role    Role     @default(MEMBER)
  posts   Post[]
  profile Profile?

  @@map("users")
}

model Profile {
  id     String @id
  userId String @unique
  user   User   @relation(fields: [userId], references: [id])
}

model Post {
  id       String  @id
  title    String
  authorId String
  author   User    @relation(fields: [authorId], references: [id])
  tags     String?

  @@index([authorId])
}
`;

describe("Prisma schema parser", () => {
  it("parses provider, models, fields, enums and attributes", async () => {
    const { parsePrismaSchema } = await import("@/lib/analysis/data/prisma");
    const schema = parsePrismaSchema("prisma/schema.prisma", PRISMA_SCHEMA);

    expect(schema.provider).toBe("postgresql");
    expect(schema.providerLine).toBeGreaterThan(0);
    expect(schema.enums[0].name).toBe("Role");
    expect(schema.enums[0].values).toEqual(["ADMIN", "MEMBER"]);

    const user = schema.models.find((model) => model.name === "User")!;
    expect(user.mappedName).toBe("users");
    const email = user.fields.find((field) => field.name === "email")!;
    expect(email.unique).toBe(true);
    expect(email.optional).toBe(false);
    const role = user.fields.find((field) => field.name === "role")!;
    expect(role.kind).toBe("enum");
    const posts = user.fields.find((field) => field.name === "posts")!;
    expect(posts.kind).toBe("relation");
    expect(posts.list).toBe(true);
    expect(posts.relation?.target).toBe("Post");
    expect(posts.relation?.cardinality).toBe("many");
    const profile = user.fields.find((field) => field.name === "profile")!;
    expect(profile.relation?.cardinality).toBe("one");
    expect(profile.optional).toBe(true);

    const post = schema.models.find((model) => model.name === "Post")!;
    expect(post.indexes).toEqual([["authorId"]]);
    const author = post.fields.find((field) => field.name === "author")!;
    expect(author.relation?.ownerField).toBe("authorId");
  });
});

const DRIZZLE_SCHEMA = `
import { relations } from "drizzle-orm";
import { integer, pgEnum, pgTable, serial, text } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "member"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").default("member").notNull(),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id").notNull().references(() => users.id),
});

export const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }));
export const postsRelations = relations(posts, ({ one }) => ({ author: one(users) }));
`;

describe("Drizzle schema parser", () => {
  it("parses tables, columns, references, relations and enums", async () => {
    const { parseDrizzleModule } = await import("@/lib/analysis/data/drizzle");
    const result = parseDrizzleModule("src/db/schema.ts", DRIZZLE_SCHEMA);

    expect(result.provider).toBe("postgresql");
    expect(result.tables.map((table) => table.name).sort()).toEqual(["posts", "users"]);

    const users = result.tables.find((table) => table.name === "users")!;
    const id = users.fields.find((field) => field.name === "id")!;
    expect(id.primaryKey).toBe(true);
    const email = users.fields.find((field) => field.name === "email")!;
    expect(email.unique).toBe(true);
    expect(email.optional).toBe(false);

    const posts = result.tables.find((table) => table.name === "posts")!;
    const authorId = posts.fields.find((field) => field.name === "authorId")!;
    expect(authorId.kind).toBe("relation");
    expect(authorId.relation?.target).toBe("users");
    expect(authorId.relation?.cardinality).toBe("one");

    const usersPosts = users.fields.find((field) => field.name === "posts");
    expect(usersPosts?.kind).toBe("relation");
    expect(usersPosts?.relation?.target).toBe("posts");
    expect(usersPosts?.relation?.cardinality).toBe("many");

    expect(result.enums[0]).toMatchObject({ name: "role", values: ["admin", "member"] });
  });
});

const SQL_A = `
CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id)
);
`;

const SQL_B = `
CREATE TABLE members (
  team_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE members
  ADD CONSTRAINT members_team_fk FOREIGN KEY (team_id) REFERENCES teams(id);
`;

describe("SQL DDL parser", () => {
  it("parses tables, primary keys, foreign keys and ALTER constraints", async () => {
    const { parseSqlDdl } = await import("@/lib/analysis/data/sql-ddl");
    const teams = parseSqlDdl("migrations/001_init.sql", SQL_A);
    expect(teams[0].name).toBe("teams");
    const ownerId = teams[0].fields.find((field) => field.name === "owner_id")!;
    expect(ownerId.kind).toBe("relation");
    expect(ownerId.relation?.target).toBe("users");

    const members = parseSqlDdl("migrations/002_members.sql", SQL_B);
    expect(members[0].primaryKey.sort()).toEqual(["team_id", "user_id"]);
    const teamId = members[0].fields.find((field) => field.name === "team_id")!;
    expect(teamId.kind).toBe("relation");
    expect(teamId.relation?.target).toBe("teams");
    expect(teamId.relation?.ownerField).toBe("id");
  });

  it("never guesses schema formats for unrelated sql files", async () => {
    const { sqlDdlAnalyzer } = await import("@/lib/analysis/data/sql-ddl");
    const detected = sqlDdlAnalyzer.detect({
      files: new Map([["scripts/seed_data.sql", "INSERT INTO audit_log VALUES (1);"]]),
      paths: ["scripts/seed_data.sql"],
    });
    expect(detected).toBe(false);
  });
});

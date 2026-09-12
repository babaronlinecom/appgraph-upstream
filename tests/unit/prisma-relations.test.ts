import { describe, expect, it } from "vitest";
import { parsePrismaSchema } from "@/lib/analysis/data/prisma";

const SELF_AND_MULTI_RELATIONS = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String  @id
  name      String
  managerId String?
  manager   User?   @relation("Management", fields: [managerId], references: [id])
  reports   User[]  @relation("Management")
  authored  Post[]  @relation("AuthorPosts")
  edited    Post[]  @relation("EditorPosts")
}

model Post {
  id       String @id
  title    String
  authorId String
  editorId String?
  author   User   @relation("AuthorPosts", fields: [authorId], references: [id])
  editor   User?  @relation("EditorPosts", fields: [editorId], references: [id])
}
`;

describe("Prisma relation hardening", () => {
  const schema = parsePrismaSchema("prisma/schema.prisma", SELF_AND_MULTI_RELATIONS);
  const user = schema.models.find((model) => model.name === "User")!;
  const post = schema.models.find((model) => model.name === "Post")!;

  it("supports self-relations without dropping them", () => {
    const manager = user.fields.find((field) => field.name === "manager")!;
    expect(manager.kind).toBe("relation");
    expect(manager.relation?.target).toBe("User");
    expect(manager.relation?.self).toBe(true);
    expect(manager.relation?.cardinality).toBe("one");
    expect(manager.relation?.ownerField).toBe("managerId");

    const reports = user.fields.find((field) => field.name === "reports")!;
    expect(reports.relation?.target).toBe("User");
    expect(reports.relation?.self).toBe(true);
    expect(reports.relation?.cardinality).toBe("many");
  });

  it("keeps named relations distinguishable", () => {
    const manager = user.fields.find((field) => field.name === "manager")!;
    const userPosts = user.fields.find((field) => field.name === "authored")!;
    expect(manager.relation?.name).toBe("Management");
    expect(userPosts.relation?.name).toBe("AuthorPosts");
  });

  it("keeps multiple relations between the same pair of models", () => {
    const author = post.fields.find((field) => field.name === "author")!;
    const editor = post.fields.find((field) => field.name === "editor")!;
    expect(author.relation?.name).toBe("AuthorPosts");
    expect(author.relation?.ownerField).toBe("authorId");
    expect(author.relation?.optional).toBe(false);
    expect(editor.relation?.name).toBe("EditorPosts");
    expect(editor.relation?.ownerField).toBe("editorId");
    expect(editor.relation?.optional).toBe(true);

    // Two distinct relation fields on the same pair must both exist.
    const postToUser = post.fields.filter(
      (field) => field.kind === "relation" && field.relation?.target === "User",
    );
    expect(postToUser.map((field) => field.name).sort()).toEqual(["author", "editor"]);
  });

  it("records an exact source line for each relation attribute", () => {
    const lines = SELF_AND_MULTI_RELATIONS.split("\n");
    const managerLine = lines.findIndex((line) => /^\s*manager\s+User\?/.test(line)) + 1;
    const editorLine = lines.findIndex((line) => /^\s*editor\s+User\?/.test(line)) + 1;
    const manager = user.fields.find((field) => field.name === "manager")!;
    const editor = post.fields.find((field) => field.name === "editor")!;
    expect(manager.relation?.range?.startLine).toBe(managerLine);
    expect(editor.relation?.range?.startLine).toBe(editorLine);
  });
});

import { describe, expect, it } from "vitest";
import { parseSqlDdl, parseSqlDdlFiles } from "@/lib/analysis/data/sql-ddl";

function lineOf(source: string, needle: string): number {
  return source.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

describe("SQL DDL hardening: comments and string literals", () => {
  const sql = [
    "-- CREATE TABLE commented_out (id INT);",
    "/* CREATE TABLE block_commented (id INT); */",
    "CREATE TABLE real_table (",
    "  id INT PRIMARY KEY,",
    "  note TEXT DEFAULT 'CREATE TABLE string_trap (x INT); -- not a comment',",
    "  label TEXT DEFAULT 'a -- b'",
    ");",
    "-- ALTER TABLE real_table ADD COLUMN ghost TEXT;",
  ].join("\n");

  it("never creates schema facts from commented-out DDL or string contents", () => {
    const models = parseSqlDdl("migrations/001.sql", sql);
    expect(models.map((model) => model.name)).toEqual(["real_table"]);
    const fields = models[0].fields.map((field) => field.name);
    expect(fields).toEqual(["id", "note", "label"]);
    expect(fields).not.toContain("ghost");
  });

  it("keeps lines accurate after masking comments and strings", () => {
    const models = parseSqlDdl("migrations/001.sql", sql);
    const note = models[0].fields.find((field) => field.name === "note")!;
    const label = models[0].fields.find((field) => field.name === "label")!;
    expect(note.range.startLine).toBe(lineOf(sql, "note TEXT"));
    expect(label.range.startLine).toBe(lineOf(sql, "label TEXT"));
  });
});

describe("SQL DDL hardening: multi-word types", () => {
  const sql = [
    "CREATE TABLE measurements (",
    "  id BIGSERIAL PRIMARY KEY,",
    "  ratio DOUBLE PRECISION NOT NULL,",
    "  recorded TIMESTAMP WITH TIME ZONE DEFAULT now(),",
    "  label CHARACTER VARYING(120),",
    "  amount NUMERIC(10, 2) NOT NULL",
    ");",
  ].join("\n");

  it("parses multi-word and parameterized types", () => {
    const model = parseSqlDdl("migrations/measure.sql", sql)[0];
    const types = Object.fromEntries(model.fields.map((field) => [field.name, field.type]));
    expect(types.ratio).toBe("DOUBLE PRECISION");
    expect(types.recorded).toBe("TIMESTAMP WITH TIME ZONE");
    expect(types.label).toBe("CHARACTER VARYING(120)");
    expect(types.amount).toBe("NUMERIC(10, 2)");
    expect(types.id).toBe("BIGSERIAL");
  });

  it("reports the exact line of every column", () => {
    const model = parseSqlDdl("migrations/measure.sql", sql)[0];
    for (const field of model.fields) {
      expect(field.range.startLine).toBe(lineOf(sql, `${field.name} `));
    }
  });
});

describe("SQL DDL hardening: migration replay", () => {
  const first = [
    "CREATE TABLE users (",
    "  id SERIAL PRIMARY KEY,",
    "  name TEXT NOT NULL",
    ");",
    "CREATE TABLE legacy (",
    "  id INT PRIMARY KEY",
    ");",
  ].join("\n");

  const second = [
    "ALTER TABLE users ADD COLUMN email TEXT;",
    "ALTER TABLE users RENAME COLUMN name TO full_name;",
    "CREATE UNIQUE INDEX users_email_idx ON users (email);",
    "CREATE INDEX users_name_idx ON users (full_name);",
    "ALTER TABLE users DROP COLUMN email;",
    "DROP TABLE legacy;",
  ].join("\n");

  it("applies ALTER/CREATE INDEX/DROP in file order", () => {
    const { models } = parseSqlDdlFiles([
      { path: "migrations/001_init.sql", content: first },
      { path: "migrations/002_changes.sql", content: second },
    ]);
    expect(models.map((model) => model.name)).toEqual(["users"]);

    const users = models[0];
    const names = users.fields.map((field) => field.name);
    expect(names).toContain("full_name");
    expect(names).not.toContain("name");
    expect(names).not.toContain("email");

    // The unique index on the dropped column must not survive.
    expect(users.uniqueConstraints).toEqual([]);
    expect(users.indexes).toEqual([["full_name"]]);
    expect(users.indexDetails).toEqual([
      { columns: ["full_name"], unique: false },
    ]);
  });

  it("records exact lines for ADD COLUMN and renamed fields", () => {
    const { models } = parseSqlDdlFiles([
      { path: "migrations/001_init.sql", content: first },
      { path: "migrations/002_changes.sql", content: second },
    ]);
    const fullName = models[0].fields.find((field) => field.name === "full_name")!;
    expect(fullName.range.startLine).toBe(lineOf(first, "name TEXT"));

    const addSql = ["CREATE TABLE t (", "  id INT PRIMARY KEY", ");", "ALTER TABLE t", "  ADD COLUMN label TEXT;"].join("\n");
    const t = parseSqlDdl("migrations/003.sql", addSql)[0];
    expect(t.fields.find((field) => field.name === "label")?.range.startLine).toBe(
      lineOf(addSql, "ADD COLUMN label"),
    );
  });

  it("records the constraint line for table-level foreign keys", () => {
    const sql = [
      "CREATE TABLE orders (",
      "  id INT PRIMARY KEY,",
      "  user_id INT NOT NULL,",
      "  CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id)",
      ");",
    ].join("\n");
    const model = parseSqlDdl("migrations/orders.sql", sql)[0];
    const userId = model.fields.find((field) => field.name === "user_id")!;
    expect(userId.kind).toBe("relation");
    expect(userId.relation?.target).toBe("users");
    expect(userId.relation?.range?.startLine).toBe(lineOf(sql, "CONSTRAINT orders_user_fk"));
  });

  it("notes incomplete replay instead of claiming a full schema", () => {
    const sql = [
      "CREATE TABLE t (id INT PRIMARY KEY);",
      "CREATE TRIGGER trg AFTER INSERT ON t EXECUTE FUNCTION f();",
    ].join("\n");
    const { notes } = parseSqlDdlFiles([{ path: "migrations/004.sql", content: sql }]);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/not replayed|incomplete/i);
  });
});

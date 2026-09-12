import type {
  DataFieldFact,
  DataModelFact,
  DataRelationFact,
  DataSchemaAnalyzer,
  DataSchemaContext,
  DataSchemaDetection,
} from "./registry";

const MAX_TABLES = 120;
const MAX_COLUMNS = 80;

const CONSTRAINT_KEYWORDS = new Set([
  "NOT",
  "NULL",
  "DEFAULT",
  "PRIMARY",
  "UNIQUE",
  "REFERENCES",
  "CHECK",
  "CONSTRAINT",
  "GENERATED",
  "COLLATE",
  "DEFERRABLE",
  "INITIALLY",
  "AUTO_INCREMENT",
  "AUTOINCREMENT",
  "COMMENT",
]);

interface TableDraft {
  name: string;
  file: string;
  line: number;
  endLine: number;
  fields: DataFieldFact[];
  indexes: string[][];
  uniques: string[][];
}

interface SqlStatement {
  text: string;
  /** Offset of the statement inside the (masked, same-length) source. */
  offset: number;
  line: number;
}

/**
 * Replaces SQL comments and string-literal contents with spaces while keeping
 * the exact length and newlines. This guarantees that commented-out DDL and
 * keywords inside strings can never create schema facts, and that every
 * reported line still matches the original file.
 */
export function maskSql(content: string): string {
  const chars = content.split("");
  const length = chars.length;
  const blank = (from: number, to: number) => {
    for (let index = from; index < to && index < length; index += 1) {
      if (chars[index] !== "\n") chars[index] = " ";
    }
  };

  let index = 0;
  while (index < length) {
    const character = chars[index];

    if (character === "'") {
      index += 1;
      while (index < length) {
        if (chars[index] === "'") {
          if (chars[index + 1] === "'") {
            blank(index, index + 2);
            index += 2;
            continue;
          }
          break;
        }
        blank(index, index + 1);
        index += 1;
      }
      index += 1;
      continue;
    }

    if (character === "-" && chars[index + 1] === "-") {
      while (index < length && chars[index] !== "\n") {
        chars[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && chars[index + 1] === "*") {
      let depth = 1;
      blank(index, index + 2);
      index += 2;
      while (index < length && depth > 0) {
        if (chars[index] === "/" && chars[index + 1] === "*") {
          depth += 1;
          blank(index, index + 2);
          index += 2;
          continue;
        }
        if (chars[index] === "*" && chars[index + 1] === "/") {
          depth -= 1;
          blank(index, index + 2);
          index += 2;
          continue;
        }
        blank(index, index + 1);
        index += 1;
      }
      continue;
    }

    if (character === "$") {
      const tagMatch = content.slice(index).match(/^\$([A-Za-z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = content.indexOf(tag, index + tag.length);
        if (end > 0) {
          blank(index, end + tag.length);
          index = end + tag.length;
          continue;
        }
      }
    }

    index += 1;
  }

  return chars.join("");
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function splitStatements(masked: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === ";" && depth === 0) {
      const text = masked.slice(start, index);
      if (text.trim()) statements.push({ text, offset: start, line: lineAt(masked, start) });
      start = index + 1;
    }
  }
  const tail = masked.slice(start);
  if (tail.trim()) statements.push({ text: tail, offset: start, line: lineAt(masked, start) });
  return statements;
}

interface BodyItem {
  text: string;
  /** Offset of the item relative to the statement body start. */
  offset: number;
}

function splitTopLevel(body: string): BodyItem[] {
  const items: BodyItem[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= body.length; index += 1) {
    const character = index < body.length ? body[index] : ",";
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      const text = body.slice(start, index);
      if (text.trim()) {
        // Offset must point at the first non-whitespace character so line
        // numbers are exact for the column/constraint itself.
        const leading = text.length - text.trimStart().length;
        items.push({ text: text.trim(), offset: start + leading });
      }
      start = index + 1;
    }
  }
  return items;
}

function unquote(name: string): string {
  return name.replace(/^["`[]|["`\]]$/g, "").replace(/["`]/g, "");
}

interface ParsedColumn {
  name: string;
  type: string;
  constraints: string;
}

/**
 * Splits a column definition into name / type / constraints. The type scanner
 * understands multi-word types (`DOUBLE PRECISION`, `TIMESTAMP WITH TIME ZONE`,
 * `CHARACTER VARYING(36)`, `NUMERIC(10, 2)`).
 */
export function splitColumnDefinition(item: string): ParsedColumn | null {
  const tokens = item.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const name = unquote(tokens[0]);
  if (/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK|KEY|EXCLUDE)$/i.test(name)) return null;

  const typeParts: string[] = [];
  let depth = 0;
  let index = 1;
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (depth === 0 && CONSTRAINT_KEYWORDS.has(token.toUpperCase())) break;
    typeParts.push(token);
    depth += (token.match(/\(/g)?.length ?? 0) - (token.match(/\)/g)?.length ?? 0);
  }
  if (typeParts.length === 0) return null;
  return {
    name,
    type: typeParts.join(" ").replace(/\s+/g, " "),
    constraints: tokens.slice(index).join(" "),
  };
}

function fieldFromColumn(column: ParsedColumn, range: { path: string; startLine: number }): DataFieldFact {
  const constraints = column.constraints.toUpperCase();
  const referenceMatch = column.constraints.match(
    /REFERENCES\s+["`[]?([\w.]+)["`\]]?\s*\(([^)]+)\)/i,
  );
  const relation: DataRelationFact | undefined = referenceMatch
    ? {
        target: unquote(referenceMatch[1]),
        cardinality: "one",
        optional: !/NOT\s+NULL/.test(constraints),
        ownerField: referenceMatch[2].trim(),
        range,
      }
    : undefined;
  return {
    name: column.name,
    type: column.type,
    kind: relation ? "relation" : "scalar",
    optional: !/NOT\s+NULL/.test(constraints),
    list: false,
    primaryKey: /PRIMARY\s+KEY/.test(constraints),
    unique: /\bUNIQUE\b/.test(constraints),
    ...(column.constraints.match(/DEFAULT\s+([^ ]+)/i)?.[1]
      ? { default: column.constraints.match(/DEFAULT\s+([^ ]+)/i)![1] }
      : {}),
    ...(relation ? { relation } : {}),
    range,
  };
}

function columnsFromList(list: string): string[] {
  return list
    .split(",")
    .map((column) => unquote(column.trim().replace(/\(.*\)$/, "")))
    .filter(Boolean);
}

/**
 * Static SQL DDL parser with ordered statement replay (CREATE/ALTER/DROP/RENAME
 * across migration files). Never executes SQL. The result is a best-effort
 * snapshot of the parsed statements, not a guarantee of the full live schema.
 */
export function parseSqlDdlFiles(
  files: Array<{ path: string; content: string }>,
): { models: DataModelFact[]; notes: string[] } {
  const tables = new Map<string, TableDraft>();
  const notes = new Set<string>();

  const ensureTable = (name: string, file: string, line: number): TableDraft => {
    const key = name.toLowerCase();
    const existing = tables.get(key);
    if (existing) return existing;
    const draft: TableDraft = {
      name,
      file,
      line,
      endLine: line,
      fields: [],
      indexes: [],
      uniques: [],
    };
    tables.set(key, draft);
    return draft;
  };

  for (const { path, content } of files) {
    const masked = maskSql(content);
    const statements = splitStatements(masked);

    for (const statement of statements) {
      const text = statement.text;
      const trimmed = text.trim();
      if (!trimmed) continue;
      const range = { path, startLine: statement.line };

      // CREATE TABLE ... ( ... )
      const createMatch = trimmed.match(
        /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w.]+)["`\]]?\s*\(/i,
      );
      if (createMatch) {
        const tableName = unquote(createMatch[1]);
        const bodyStart = trimmed.indexOf("(") + 1;
        let depth = 1;
        let cursor = bodyStart;
        while (cursor < trimmed.length && depth > 0) {
          if (trimmed[cursor] === "(") depth += 1;
          if (trimmed[cursor] === ")") depth -= 1;
          cursor += 1;
        }
        const body = trimmed.slice(bodyStart, cursor - 1);
        // Offset of `trimmed` inside the statement text (leading whitespace).
        const statementStartInText = text.indexOf(trimmed);
        const bodyAbsolute = statement.offset + statementStartInText + bodyStart;
        const draft = ensureTable(tableName, path, statement.line);
        draft.file = path;
        draft.line = statement.line;
        draft.endLine = lineAt(masked, statement.offset + cursor);
        draft.fields = [];

        for (const item of splitTopLevel(body)) {
          if (draft.fields.length >= MAX_COLUMNS) break;
          const itemRange = {
            path,
            startLine: lineAt(masked, bodyAbsolute + item.offset),
          };
          const tableConstraint = item.text.match(
            /^(?:CONSTRAINT\s+["`[]?[\w]+["`\]]?\s+)?(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)\s*\(([^)]+)\)/i,
          );
          if (tableConstraint) {
            const columns = columnsFromList(tableConstraint[2]);
            if (/PRIMARY/i.test(tableConstraint[1])) {
              for (const column of columns) {
                const field = draft.fields.find((candidate) => candidate.name === column);
                if (field) field.primaryKey = true;
              }
            } else if (/UNIQUE/i.test(tableConstraint[1])) {
              for (const column of columns) {
                const field = draft.fields.find((candidate) => candidate.name === column);
                if (field) field.unique = true;
              }
            } else {
              const references = item.text.match(
                /REFERENCES\s+["`[]?([\w.]+)["`\]]?\s*\(([^)]+)\)/i,
              );
              const field = draft.fields.find((candidate) => candidate.name === columns[0]);
              if (field && references) {
                field.kind = "relation";
                field.relation = {
                  target: unquote(references[1]),
                  cardinality: "one",
                  optional: field.optional,
                  ownerField: references[2].trim(),
                  range: itemRange,
                };
              }
            }
            continue;
          }
          const column = splitColumnDefinition(item.text);
          if (column) draft.fields.push(fieldFromColumn(column, itemRange));
        }
        continue;
      }

      // DROP TABLE [IF EXISTS] name
      const dropMatch = trimmed.match(
        /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`[]?([\w.]+)["`\]]?/i,
      );
      if (dropMatch) {
        tables.delete(unquote(dropMatch[1]).toLowerCase());
        continue;
      }

      // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table (columns)
      const indexMatch = trimmed.match(
        /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w.]+)["`\]]?\s+ON\s+["`[]?([\w.]+)["`\]]?\s*\(([^)]+)\)/i,
      );
      if (indexMatch) {
        const table = tables.get(unquote(indexMatch[3]).toLowerCase());
        if (table) {
          const unique = Boolean(indexMatch[1]);
          const columns = columnsFromList(indexMatch[4]);
          if (unique) table.uniques.push(columns);
          else table.indexes.push(columns);
        }
        continue;
      }

      // ALTER TABLE name <action>
      const alterMatch = trimmed.match(
        /^ALTER\s+TABLE\s+(?:ONLY\s+)?["`[]?([\w.]+)["`\]]?\s+([\s\S]+)$/i,
      );
      if (alterMatch) {
        const table = tables.get(unquote(alterMatch[1]).toLowerCase());
        if (!table) continue;
        const action = alterMatch[2].trim();
        const actionOffsetInStatement = text.indexOf(action);
        const actionAbsolute = statement.offset + actionOffsetInStatement;

        const foreignKey = action.match(
          /^ADD\s+(?:CONSTRAINT\s+["`[]?[\w]+["`\]]?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+["`[]?([\w.]+)["`\]]?\s*\(([^)]+)\)/i,
        );
        if (foreignKey) {
          const column = unquote(foreignKey[1].trim());
          const relationRange = { path, startLine: lineAt(masked, actionAbsolute) };
          const field = table.fields.find((candidate) => candidate.name === column);
          const relation: DataRelationFact = {
            target: unquote(foreignKey[2]),
            cardinality: "one",
            optional: field?.optional ?? true,
            ownerField: foreignKey[3].trim(),
            range: relationRange,
          };
          if (field) {
            field.kind = "relation";
            field.relation = relation;
            field.range = relationRange;
          } else {
            table.fields.push({
              name: column,
              type: "foreign_key",
              kind: "relation",
              optional: true,
              list: false,
              primaryKey: false,
              unique: false,
              relation,
              range: relationRange,
            });
          }
          continue;
        }

        const addColumn = action.match(/^ADD\s+(?:COLUMN\s+)?([\s\S]+)$/i);
        if (addColumn && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK)\b/i.test(addColumn[1].trim())) {
          const definition = addColumn[1].trim();
          const definitionOffset = action.indexOf(definition);
          const column = splitColumnDefinition(definition);
          if (column) {
            const columnRange = {
              path,
              startLine: lineAt(masked, actionAbsolute + definitionOffset),
            };
            const existing = table.fields.find((candidate) => candidate.name === column.name);
            if (existing) {
              existing.range = columnRange;
            } else if (table.fields.length < MAX_COLUMNS) {
              table.fields.push(fieldFromColumn(column, columnRange));
            }
          }
          continue;
        }

        const dropColumn = action.match(/^DROP\s+(?:COLUMN\s+)?["`[]?([\w.]+)["`\]]?/i);
        if (dropColumn) {
          const name = unquote(dropColumn[1]);
          table.fields = table.fields.filter((candidate) => candidate.name !== name);
          // Indexes/uniques referencing a dropped column must not survive.
          table.indexes = table.indexes.filter((columns) => !columns.includes(name));
          table.uniques = table.uniques.filter((columns) => !columns.includes(name));
          continue;
        }

        const renameColumn = action.match(
          /^RENAME\s+(?:COLUMN\s+)?["`[]?([\w.]+)["`\]]?\s+TO\s+["`[]?([\w.]+)["`\]]?/i,
        );
        if (renameColumn) {
          const from = unquote(renameColumn[1]);
          const to = unquote(renameColumn[2]);
          const field = table.fields.find((candidate) => candidate.name === from);
          if (field) field.name = to;
          continue;
        }

        notes.add(
          "Some ALTER TABLE statements are not replayed yet; the schema snapshot may be incomplete.",
        );
        continue;
      }

      if (/^(CREATE|ALTER|DROP|TRUNCATE|COMMENT)\b/i.test(trimmed)) {
        notes.add(
          "Some DDL statements are not replayed yet; the schema snapshot may be incomplete.",
        );
      }
    }
  }

  const models: DataModelFact[] = [...tables.values()].map((draft) => ({
    name: draft.name,
    kind: "table" as const,
    range: { path: draft.file, startLine: draft.line, endLine: draft.endLine },
    fieldCount: draft.fields.length,
    fields: draft.fields,
    primaryKey: draft.fields.filter((field) => field.primaryKey).map((field) => field.name),
    uniqueConstraints:
      draft.uniques.length > 0
        ? draft.uniques
        : draft.fields.filter((field) => field.unique).map((field) => [field.name]),
    indexes: draft.indexes,
    indexDetails: [
      ...draft.uniques.map((columns) => ({ columns, unique: true })),
      ...draft.indexes.map((columns) => ({ columns, unique: false })),
    ],
  }));

  return { models, notes: [...notes] };
}

export function parseSqlDdl(path: string, content: string): DataModelFact[] {
  return parseSqlDdlFiles([{ path, content }]).models;
}

export const sqlDdlAnalyzer: DataSchemaAnalyzer = {
  id: "sql-ddl",
  version: "2.0.0",
  label: "SQL DDL",
  capabilities: {
    formats: ["sql"],
    providers: ["postgresql", "mysql", "sqlite"],
    concepts: [
      "table",
      "column",
      "primary key",
      "foreign key",
      "unique",
      "index",
      "alter table",
      "drop table",
      "rename column",
    ],
  },

  detect(context: DataSchemaContext): boolean {
    return [...context.files.entries()].some(
      ([path, content]) => /\.sql$/i.test(path) && /CREATE\s+TABLE|ALTER\s+TABLE/i.test(content),
    );
  },

  analyze(context: DataSchemaContext): DataSchemaDetection[] {
    const files = [...context.files.entries()]
      .filter(([path, content]) => /\.sql$/i.test(path) && /CREATE\s+TABLE|ALTER\s+TABLE/i.test(content))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => ({ path, content }));
    if (files.length === 0) return [];

    const { models, notes } = parseSqlDdlFiles(files);
    if (models.length === 0) return [];

    return [
      {
        analyzerId: this.id,
        format: "sql",
        files: files.map((file) => file.path),
        provider: null,
        models,
        enums: [],
        notes,
      },
    ];
  },
};

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

interface TableDraft {
  name: string;
  file: string;
  line: number;
  endLine: number;
  fields: DataFieldFact[];
  relationIndex: Map<string, DataRelationFact>;
}

function splitTopLevel(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

function unquote(name: string): string {
  return name.replace(/^["`[]|["`\]]$/g, "").replace(/["`]/g, "");
}

function typeAndConstraints(item: string): DataFieldFact | null {
  const tokens = item.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const name = unquote(tokens[0]);
  if (/^(primary|unique|foreign|constraint|check|key)$/i.test(name)) return null;

  const type = tokens[1].replace(/,$/, "");
  const restRaw = tokens.slice(2).join(" ");
  const rest = restRaw.toUpperCase();
  const referenceMatch = restRaw.match(/REFERENCES\s+["`[]?([\w.]+)["`\]]?\s*\(([^)]+)\)/i);
  const relation: DataRelationFact | undefined = referenceMatch
    ? {
        target: referenceMatch[1].replace(/["`]/g, ""),
        cardinality: "one",
        optional: !/NOT\s+NULL/.test(rest),
        ownerField: referenceMatch[2].trim(),
      }
    : undefined;

  return {
    name,
    type,
    kind: relation ? "relation" : "scalar",
    optional: !/NOT\s+NULL/.test(rest),
    list: false,
    primaryKey: /PRIMARY\s+KEY/.test(rest),
    unique: /\bUNIQUE\b/.test(rest),
    ...(restRaw.match(/DEFAULT\s+([^ ]+)/i)?.[1]
      ? { default: restRaw.match(/DEFAULT\s+([^ ]+)/i)![1] }
      : {}),
    ...(relation ? { relation } : {}),
    range: { path: "", startLine: 0 },
  };
}

/**
 * Static SQL DDL parser (PostgreSQL-first, tolerant of MySQL/SQLite shape).
 * Never executes SQL; multiple migration files are merged into one current
 * best-effort model so cross-file foreign keys resolve.
 */
export function parseSqlDdlFiles(files: Array<{ path: string; content: string }>): DataModelFact[] {
  const tables = new Map<string, TableDraft>();

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
      relationIndex: new Map(),
    };
    tables.set(key, draft);
    return draft;
  };

  // Pass 1: CREATE TABLE across all files (path order is the merge order).
  for (const { path, content } of files) {
    const createPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w.]+)["`\]]?\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = createPattern.exec(content)) !== null) {
      const tableName = unquote(match[1]);
      const lineNumber = content.slice(0, match.index).split(/\r?\n/).length;
      const bodyStart = match.index + match[0].length;
      let depth = 1;
      let cursor = bodyStart;
      while (cursor < content.length && depth > 0) {
        const character = content[cursor];
        if (character === "(") depth += 1;
        if (character === ")") depth -= 1;
        cursor += 1;
      }
      const body = content.slice(bodyStart, cursor - 1);
      const endLine = content.slice(0, cursor).split(/\r?\n/).length;
      const draft = ensureTable(tableName, path, lineNumber);
      draft.file = path;
      draft.line = lineNumber;
      draft.endLine = Math.max(draft.endLine, endLine);
      draft.fields = [];
      draft.relationIndex.clear();

      for (const item of splitTopLevel(body)) {
        if (draft.fields.length >= MAX_COLUMNS) break;
        const tableConstraint = item.match(
          /^(?:CONSTRAINT\s+["`[]?[\w]+["`\]]?\s+)?(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)\s*\(([^)]+)\)/i,
        );
        if (tableConstraint) {
          const columns = tableConstraint[2].split(",").map((column) => unquote(column.trim()));
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
            const references = item.match(
              /REFERENCES\s+["`[]?([\w.]+)["`\]]?\s*\(([^)]+)\)/i,
            );
            const column = columns[0];
            const field = draft.fields.find((candidate) => candidate.name === column);
            if (field && references) {
              field.kind = "relation";
              field.relation = {
                target: unquote(references[1]),
                cardinality: "one",
                optional: field.optional,
                ownerField: references[2].trim(),
              };
            }
          }
          continue;
        }
        const field = typeAndConstraints(item);
        if (field) {
          field.range = { path, startLine: lineNumber };
          draft.fields.push(field);
        }
      }
    }
  }

  // Pass 2: ALTER TABLE ... ADD FOREIGN KEY across all files — targets may live
  // in a different migration file, which is why this runs after pass 1.
  for (const { path, content } of files) {
    const alterPattern =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?["`[]?([\w.]+)["`\]]?[\s\S]*?ADD\s+(?:CONSTRAINT\s+["`[]?[\w]+["`\]]?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+["`[]?([\w.]+)["`\]]?\s*\(([^)]+)\)/gi;
    let match: RegExpExecArray | null;
    while ((match = alterPattern.exec(content)) !== null) {
      const tableName = unquote(match[1]);
      const table = tables.get(tableName.toLowerCase());
      if (!table) continue;
      const column = unquote(match[2].trim());
      const target = unquote(match[3]);
      const targetColumn = match[4].trim();
      const lineNumber = content.slice(0, match.index).split(/\r?\n/).length;
      const field = table.fields.find((candidate) => candidate.name === column);
      const relation: DataRelationFact = {
        target,
        cardinality: "one",
        optional: field?.optional ?? true,
        ownerField: targetColumn,
      };
      if (field) {
        field.kind = "relation";
        field.relation = relation;
        field.range = { path, startLine: lineNumber };
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
          range: { path, startLine: lineNumber },
        });
      }
    }
  }

  return [...tables.values()].map((draft) => ({
    name: draft.name,
    kind: "table",
    range: { path: draft.file, startLine: draft.line, endLine: draft.endLine },
    fieldCount: draft.fields.length,
    fields: draft.fields,
    primaryKey: draft.fields.filter((field) => field.primaryKey).map((field) => field.name),
    uniqueConstraints: draft.fields.filter((field) => field.unique).map((field) => [field.name]),
    indexes: [],
  }));
}

export function parseSqlDdl(path: string, content: string): DataModelFact[] {
  return parseSqlDdlFiles([{ path, content }]);
}

export const sqlDdlAnalyzer: DataSchemaAnalyzer = {
  id: "sql-ddl",
  version: "1.0.0",
  label: "SQL DDL",
  capabilities: {
    formats: ["sql"],
    providers: ["postgresql", "mysql", "sqlite"],
    concepts: ["table", "column", "primary key", "foreign key", "unique"],
  },

  detect(context: DataSchemaContext): boolean {
    return context.paths.some((path) => /\.sql$/i.test(path)) &&
      [...context.files.entries()].some(
        ([path, content]) => /\.sql$/i.test(path) && /CREATE\s+TABLE|ALTER\s+TABLE/i.test(content),
      );
  },

  analyze(context: DataSchemaContext): DataSchemaDetection[] {
    const files = [...context.files.entries()]
      .filter(([path, content]) => /\.sql$/i.test(path) && /CREATE\s+TABLE|ALTER\s+TABLE/i.test(content))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => ({ path, content }));
    if (files.length === 0) return [];

    const models = parseSqlDdlFiles(files);
    if (models.length === 0) return [];

    return [
      {
        analyzerId: this.id,
        format: "sql",
        files: files.map((file) => file.path),
        provider: null,
        models,
        enums: [],
      },
    ];
  },
};

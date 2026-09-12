import type {
  DataEnumFact,
  DataFieldFact,
  DataModelFact,
  DataRelationFact,
  DataSchemaAnalyzer,
  DataSchemaContext,
  DataSchemaDetection,
} from "./registry";

const MAX_MODELS = 120;
const MAX_FIELDS_PER_MODEL = 80;
const MAX_ENUMS = 60;

const PRISMA_SCALARS = new Set([
  "String",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
  "Unsupported",
]);

interface RawBlock {
  kind: "model" | "enum";
  name: string;
  line: number;
  lines: Array<{ text: string; line: number }>;
}

/**
 * Deterministic, line-based Prisma schema parser. Static only: the schema is
 * never executed. Two passes: blocks first, then fields with knowledge of all
 * model/enum names so relation fields can be classified correctly.
 */
export function parsePrismaSchema(path: string, content: string): {
  provider: string | null;
  providerLine: number | null;
  models: DataModelFact[];
  enums: DataEnumFact[];
} {
  const lines = content.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let provider: string | null = null;
  let providerLine: number | null = null;
  let inDatasource = false;
  let current: RawBlock | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (/^\s*datasource\b.*\{/.test(line)) {
      inDatasource = true;
      continue;
    }
    if (inDatasource) {
      const providerMatch = line.match(/provider\s*=\s*"([^"]+)"/);
      if (providerMatch) {
        provider = providerMatch[1];
        providerLine = lineNumber;
      }
      if (/^\s*\}/.test(line)) inDatasource = false;
      continue;
    }

    if (current) {
      if (/^\s*\}/.test(line)) {
        blocks.push(current);
        current = null;
        continue;
      }
      current.lines.push({ text: line, line: lineNumber });
      continue;
    }

    const modelStart = line.match(/^\s*model\s+([A-Za-z0-9_]+)\s*\{/);
    if (modelStart) {
      current = { kind: "model", name: modelStart[1], line: lineNumber, lines: [] };
      continue;
    }
    const enumStart = line.match(/^\s*enum\s+([A-Za-z0-9_]+)\s*\{/);
    if (enumStart) {
      current = { kind: "enum", name: enumStart[1], line: lineNumber, lines: [] };
    }
  }
  if (current) blocks.push(current);

  const modelNames = new Set(blocks.filter((block) => block.kind === "model").map((block) => block.name));
  const enumNames = new Set(blocks.filter((block) => block.kind === "enum").map((block) => block.name));

  const enums: DataEnumFact[] = [];
  for (const block of blocks) {
    if (block.kind !== "enum" || enums.length >= MAX_ENUMS) continue;
    const values: string[] = [];
    for (const entry of block.lines) {
      const match = entry.text.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (match) values.push(match[1]);
    }
    enums.push({
      name: block.name,
      values,
      range: { path, startLine: block.line, endLine: block.lines[block.lines.length - 1]?.line ?? block.line },
    });
  }

  const models: DataModelFact[] = [];
  for (const block of blocks) {
    if (block.kind !== "model" || models.length >= MAX_MODELS) continue;
    const fields: DataFieldFact[] = [];
    const primaryKey: string[] = [];
    const uniqueConstraints: string[][] = [];
    const indexes: string[][] = [];
    let mappedName: string | undefined;

    for (const entry of block.lines) {
      const trimmed = entry.text.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;

      if (trimmed.startsWith("@@")) {
        const mapMatch = trimmed.match(/@@map\("([^"]+)"\)/);
        if (mapMatch) mappedName = mapMatch[1];
        const attribute = trimmed.match(/@@(id|unique|index)\(\[([^\]]*)\]\)/);
        if (attribute) {
          const columns = attribute[2]
            .split(",")
            .map((column) => column.trim().replace(/\(.*\)$/, ""))
            .filter(Boolean);
          if (attribute[1] === "id") primaryKey.push(...columns);
          else if (attribute[1] === "unique") uniqueConstraints.push(columns);
          else indexes.push(columns);
        }
        continue;
      }

      if (fields.length >= MAX_FIELDS_PER_MODEL) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const name = parts[0];
      const typeRaw = parts[1];
      const attributes = parts.slice(2).join(" ");

      const list = typeRaw.endsWith("[]");
      const optional = typeRaw.endsWith("?");
      const baseType = typeRaw.replace(/[?[\]]/g, "");
      const isEnum = enumNames.has(baseType);
      // Self-relations (User.manager / User.reports) are valid: the target may
      // be the model itself.
      const isRelation = modelNames.has(baseType);
      const kind: DataFieldFact["kind"] = isRelation
        ? "relation"
        : isEnum
          ? "enum"
          : PRISMA_SCALARS.has(baseType)
            ? "scalar"
            : "unknown";

      const relationMatch = attributes.match(/@relation\(([^)]*)\)/);
      let relation: DataRelationFact | undefined;
      if (isRelation) {
        const args = relationMatch?.[1] ?? "";
        const fieldsMatch = args.match(/fields:\s*\[([^\]]*)\]/);
        const ownerField = fieldsMatch?.[1].split(",")[0]?.trim();
        const nameMatch = args.match(/^\s*"([^"]+)"/) ?? args.match(/\bname:\s*"([^"]+)"/);
        relation = {
          target: baseType,
          cardinality: list ? "many" : "one",
          optional,
          ...(ownerField ? { ownerField } : {}),
          ...(nameMatch ? { name: nameMatch[1] } : {}),
          ...(baseType === block.name ? { self: true } : {}),
          range: { path, startLine: entry.line },
        };
      }

      const isPrimaryKey = /@id\b|@id\(/.test(attributes);
      const isUnique = /@unique\b|@unique\(/.test(attributes);
      if (isPrimaryKey) primaryKey.push(name);

      fields.push({
        name,
        type: baseType + (list ? "[]" : "") + (optional ? "?" : ""),
        kind,
        optional,
        list,
        primaryKey: isPrimaryKey,
        unique: isUnique,
        ...(attributes.match(/@default\((.*)\)/)?.[1]
          ? { default: attributes.match(/@default\((.*)\)/)![1] }
          : {}),
        ...(attributes.match(/@map\("([^"]+)"\)/)?.[1]
          ? { map: attributes.match(/@map\("([^"]+)"\)/)![1] }
          : {}),
        ...(relation ? { relation } : {}),
        range: { path, startLine: entry.line },
      });
    }

    models.push({
      name: block.name,
      kind: "collection",
      range: {
        path,
        startLine: block.line,
        endLine: block.lines[block.lines.length - 1]?.line ?? block.line,
      },
      fieldCount: fields.length,
      fields,
      ...(mappedName ? { mappedName } : {}),
      primaryKey,
      uniqueConstraints,
      indexes,
    });
  }

  return { provider, providerLine, models, enums };
}

/** Maps a provider value to a display label, e.g. postgresql -> PostgreSQL. */
export function providerLabel(provider: string): string {
  const map: Record<string, string> = {
    postgresql: "PostgreSQL",
    postgres: "PostgreSQL",
    mysql: "MySQL",
    mongodb: "MongoDB",
    sqlite: "SQLite",
    sqlserver: "SQL Server",
    cockroachdb: "CockroachDB",
  };
  return map[provider.toLowerCase()] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

export const prismaSchemaAnalyzer: DataSchemaAnalyzer = {
  id: "prisma-schema",
  version: "1.1.0",
  label: "Prisma schema",
  capabilities: {
    formats: ["prisma"],
    providers: ["postgresql", "mysql", "sqlite", "mongodb", "sqlserver", "cockroachdb"],
    concepts: ["model", "field", "relation", "enum", "index", "datasource", "provider"],
  },

  detect(context: DataSchemaContext): boolean {
    return context.paths.some((path) => /(^|\/)schema\.prisma$/i.test(path));
  },

  analyze(context: DataSchemaContext): DataSchemaDetection[] {
    const detections: DataSchemaDetection[] = [];
    for (const [path, content] of context.files) {
      if (!/(^|\/)schema\.prisma$/i.test(path)) continue;
      const schema = parsePrismaSchema(path, content);
      detections.push({
        analyzerId: this.id,
        format: "prisma",
        files: [path],
        provider: schema.provider
          ? { raw: schema.provider, range: { path, startLine: schema.providerLine ?? 1 } }
          : null,
        models: schema.models,
        enums: schema.enums,
      });
    }
    return detections;
  },
};

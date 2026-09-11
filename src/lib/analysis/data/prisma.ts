import type { DataSchemaContext, DataSchemaDetection, DataSchemaAnalyzer } from "./registry";

export interface PrismaModel {
  name: string;
  line: number;
  endLine: number;
  fieldCount: number;
}

export interface PrismaSchema {
  path: string;
  provider: string | null;
  providerLine: number | null;
  models: PrismaModel[];
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

/**
 * Deterministic, line-based Prisma schema parser. Static only: the schema is
 * never executed. Field/relation extraction is intentionally minimal in this
 * batch; the ERD batch extends it.
 */
export function parsePrismaSchema(path: string, content: string): PrismaSchema {
  const lines = content.split(/\r?\n/);
  const models: PrismaModel[] = [];
  let provider: string | null = null;
  let providerLine: number | null = null;
  let inDatasource = false;
  let current: PrismaModel | null = null;

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

    const modelStart = line.match(/^\s*model\s+([A-Za-z0-9_]+)\s*\{/);
    if (modelStart && !current) {
      current = { name: modelStart[1], line: lineNumber, endLine: lineNumber, fieldCount: 0 };
      continue;
    }
    if (current) {
      if (/^\s*\}/.test(line)) {
        current.endLine = lineNumber;
        models.push(current);
        current = null;
        continue;
      }
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("@@")) {
        current.fieldCount += 1;
      }
    }
  }

  return { path, provider, providerLine, models };
}

export const prismaSchemaAnalyzer: DataSchemaAnalyzer = {
  id: "prisma-schema",
  version: "1.0.0",
  label: "Prisma schema",
  capabilities: {
    formats: ["prisma"],
    providers: ["postgresql", "mysql", "sqlite", "mongodb", "sqlserver", "cockroachdb"],
    concepts: ["model", "datasource", "provider"],
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
          ? {
              raw: schema.provider,
              range: { path, startLine: schema.providerLine ?? 1 },
            }
          : null,
        models: schema.models.map((model) => ({
          name: model.name,
          range: { path, startLine: model.line, endLine: model.endLine },
          fieldCount: model.fieldCount,
        })),
      });
    }
    return detections;
  },
};

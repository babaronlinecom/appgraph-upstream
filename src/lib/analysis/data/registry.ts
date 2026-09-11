import type { IrSourceRange } from "../ir/model";

/**
 * Data-schema analyzer contract (Prisma/Drizzle/SQL/ORM adapters).
 * Detections carry source ranges so code↔model edges can point at the schema
 * fact that proves them.
 */

export type DataFieldKind = "scalar" | "relation" | "enum" | "unknown";

export interface DataRelationFact {
  /** Target model/table name as written in the schema. */
  target: string;
  cardinality: "one" | "many";
  optional: boolean;
  /** Owning field on the other side, when declared (`@relation(...)`). */
  ownerField?: string;
  mappedBy?: string;
}

export interface DataFieldFact {
  name: string;
  /** Raw type as written, e.g. `String`, `User[]`, `timestamp`. */
  type: string;
  kind: DataFieldKind;
  optional: boolean;
  list: boolean;
  primaryKey: boolean;
  unique: boolean;
  default?: string;
  map?: string;
  relation?: DataRelationFact;
  range: IrSourceRange;
}

export interface DataModelFact {
  name: string;
  /** "model" (Prisma), "table" (SQL/Drizzle), "collection". */
  kind: "model" | "table" | "collection";
  range: IrSourceRange;
  fieldCount: number;
  fields: DataFieldFact[];
  mappedName?: string;
  primaryKey: string[];
  uniqueConstraints: string[][];
  indexes: string[][];
}

export interface DataEnumFact {
  name: string;
  values: string[];
  range: IrSourceRange;
}

export interface DataProviderFact {
  /** Raw provider value, e.g. "postgresql". */
  raw: string;
  range: IrSourceRange;
}

export interface DataSchemaDetection {
  analyzerId: string;
  /** Schema format family, e.g. "prisma", "drizzle", "sql". */
  format: string;
  files: string[];
  provider: DataProviderFact | null;
  models: DataModelFact[];
  enums: DataEnumFact[];
}

export interface DataSchemaContext {
  files: Map<string, string>;
  paths: string[];
}

export interface DataSchemaAnalyzer {
  id: string;
  version: string;
  label: string;
  capabilities: {
    formats: string[];
    providers: string[];
    concepts: string[];
  };
  detect(context: DataSchemaContext): boolean;
  analyze(context: DataSchemaContext): DataSchemaDetection[];
}

export class DataSchemaRegistry {
  private readonly analyzers: DataSchemaAnalyzer[] = [];

  register(analyzer: DataSchemaAnalyzer): void {
    if (this.analyzers.some((existing) => existing.id === analyzer.id)) {
      throw new Error(`Data schema analyzer "${analyzer.id}" is already registered`);
    }
    this.analyzers.push(analyzer);
  }

  list(): DataSchemaAnalyzer[] {
    return [...this.analyzers];
  }

  get(id: string): DataSchemaAnalyzer | undefined {
    return this.analyzers.find((analyzer) => analyzer.id === id);
  }

  /** Runs every analyzer whose detection matches the repository. */
  analyze(context: DataSchemaContext): DataSchemaDetection[] {
    const detections: DataSchemaDetection[] = [];
    for (const analyzer of this.analyzers) {
      try {
        if (!analyzer.detect(context)) continue;
        detections.push(...analyzer.analyze(context));
      } catch {
        // A failing schema analyzer must never fail the whole analysis.
      }
    }
    return detections;
  }
}

export const dataSchemaRegistry = new DataSchemaRegistry();

// Built-in schema analyzers.
import { prismaSchemaAnalyzer } from "./prisma";
import { drizzleSchemaAnalyzer } from "./drizzle";
import { sqlDdlAnalyzer } from "./sql-ddl";

dataSchemaRegistry.register(prismaSchemaAnalyzer);
dataSchemaRegistry.register(drizzleSchemaAnalyzer);
dataSchemaRegistry.register(sqlDdlAnalyzer);

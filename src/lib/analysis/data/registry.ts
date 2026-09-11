import type { IrSourceRange } from "../ir/model";

/**
 * Data-schema analyzer contract (Prisma/Drizzle/SQL/ORM adapters).
 * Detections carry source ranges so code↔model edges can point at the schema
 * fact that proves them.
 */
export interface DataModelFact {
  name: string;
  range: IrSourceRange;
  fieldCount: number;
}

export interface DataProviderFact {
  /** Raw provider value, e.g. "postgresql". */
  raw: string;
  range: IrSourceRange;
}

export interface DataSchemaDetection {
  analyzerId: string;
  /** Schema format family, e.g. "prisma". */
  format: string;
  files: string[];
  provider: DataProviderFact | null;
  models: DataModelFact[];
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

dataSchemaRegistry.register(prismaSchemaAnalyzer);

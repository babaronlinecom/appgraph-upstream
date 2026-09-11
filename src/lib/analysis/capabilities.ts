import type { GraphCapabilities } from "@/lib/graph/model";
import type { DataSchemaDetection } from "./data/registry";
import { analyzerRegistries } from "./registries";
import type { RepositorySignals } from "./types";

/**
 * Builds the honest capability report for a finished analysis: what languages,
 * frameworks and schema formats were actually understood, and which analyzers
 * are registered but produced no result for this repository.
 */
export function buildCapabilities(input: {
  languages: Set<string>;
  parserIds: Set<string>;
  signals: RepositorySignals;
  dataSchemas: DataSchemaDetection[];
  hasHttpSurface: boolean;
}): GraphCapabilities {
  const formats = [...new Set(input.dataSchemas.map((detection) => detection.format))].sort();
  const dataSchemaAnalyzers = analyzerRegistries.dataSchemas
    .list()
    .map((analyzer) => analyzer.id)
    .sort();

  return {
    languages: [...input.languages].sort(),
    frameworks: [...input.signals.detectedFrameworks].sort(),
    databaseSchemas: formats,
    dataSchemaAnalyzers,
    apiProtocols: input.hasHttpSurface ? ["http"] : [],
    asyncSystems: [],
    infrastructure: [],
    symbolResolution: "partial",
    parsers: [...input.parserIds].sort(),
    integrations: analyzerRegistries.integrations.size,
  };
}

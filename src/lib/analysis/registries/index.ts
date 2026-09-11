import { INTEGRATIONS } from "../integrations";
import { FRAMEWORK_ANALYZERS, type FrameworkAnalyzer } from "../frameworks/registry";
import { dataSchemaRegistry } from "../data/registry";
import { parserRegistry } from "../parsers/registry";
import { AnalyzerRegistry } from "./registry";

export { AnalyzerRegistry } from "./registry";
export type { RegisteredAnalyzer } from "./registry";

/**
 * Central analyzer registries (AG-CODE-003). Every ecosystem analyzer is
 * discoverable here; the capabilities builder reports exactly what is
 * registered so users know what is trustworthy.
 */

export interface FrameworkRegistryEntry {
  id: string;
  version: string;
  label: string;
  capabilities: Record<string, unknown>;
  analyzer: FrameworkAnalyzer;
}

export const frameworkRegistry = new AnalyzerRegistry<FrameworkRegistryEntry>("framework");

for (const analyzer of FRAMEWORK_ANALYZERS) {
  frameworkRegistry.register({
    id: analyzer.id,
    version: "1.0.0",
    label: analyzer.label,
    capabilities: { languages: ["typescript", "javascript"] },
    analyzer,
  });
}

export interface IntegrationRegistryEntry {
  id: string;
  version: string;
  label: string;
  capabilities: Record<string, unknown>;
}

export const integrationRegistry = new AnalyzerRegistry<IntegrationRegistryEntry>("integration");

for (const definition of INTEGRATIONS) {
  integrationRegistry.register({
    id: definition.id,
    version: "1.0.0",
    label: definition.label,
    capabilities: {
      kind: definition.kind,
      category: definition.category,
      packages: definition.packages,
    },
  });
}

export const analyzerRegistries = {
  parsers: parserRegistry,
  frameworks: frameworkRegistry,
  integrations: integrationRegistry,
  dataSchemas: dataSchemaRegistry,
};

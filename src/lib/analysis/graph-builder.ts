import type {
  AppGraphEdge,
  AppGraphNode,
  AppGraphNodeMetadata,
  GraphGranularity,
  GraphGroupId,
} from "@/lib/graph/model";
import { GRANULARITY_ORDER } from "@/lib/graph/model";
import { matchRouteTemplate } from "./frameworks/registry";
import { analyzerRegistries } from "./registries";
import { createEdgeAccumulator } from "./builders/edge-accumulator";
import { addDataEdges, projectDataGraph } from "./builders/data-graph";
import { addImportGraphEdges } from "./builders/import-graph";
import {
  addOrmDatabaseEdges,
  createSchemaDatabaseNode,
  projectIntegrations,
} from "./builders/integration-graph";
import { addSymbolEdges, projectSymbols } from "./builders/symbol-graph";
import { fileNodeId, FILE_NODE_PREFIX } from "./builders/ids";
import type {
  AnalysisWarningDraft,
  ClassifiedFile,
  ParsedFile,
  RepositoryContext,
} from "./types";

export interface GraphBuildResult {
  nodes: AppGraphNode[];
  edges: AppGraphEdge[];
  warnings: AnalysisWarningDraft[];
  stats: {
    entities: number;
    relationships: number;
    externalServices: number;
    pages: number;
    apis: number;
    services: number;
    components: number;
    databaseNodes: number;
    symbols: number;
    symbolEdges: number;
  };
}

export const CONFIG_NODE_ID = "config:environment";

export { fileNodeId, FILE_NODE_PREFIX };

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeSegment(segment: string): string {
  if (/^\[\[?\.\.\..+\]\]?$/.test(segment)) return `all ${segment.replace(/[[\].]/g, "")}`;
  if (/^\[.+\]$/.test(segment)) return segment.replace(/[[\]]/g, "");
  return titleCase(segment.replace(/[-_]/g, " "));
}

function labelForRoute(
  route: string | undefined,
  fallbackPath: string,
): { label: string; subtitle?: string } {
  if (!route) return { label: titleCase(baseName(fallbackPath)) };
  if (route === "/") return { label: "Home", subtitle: "/" };
  const segments = route.split("/").filter(Boolean);
  const meaningful = segments[segments.length - 1] ?? "";
  return { label: humanizeSegment(meaningful), subtitle: route };
}

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function withoutExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

function nodeTypeFor(file: ClassifiedFile): AppGraphNode["type"] {
  switch (file.category) {
    case "page":
      return "page";
    case "api":
      return "api";
    case "component":
    case "hook":
      return "component";
    case "service":
      return "service";
    case "database":
    case "schema":
      return "database";
    case "state":
      return "state";
    case "middleware":
      return "middleware";
    case "config":
      return "config";
    default:
      return "module";
  }
}

function baseGranularityFor(file: ClassifiedFile, usageCount: number): GraphGranularity {
  switch (file.category) {
    case "page":
    case "service":
    case "database":
      return "product";
    case "api":
    case "middleware":
    case "config":
    case "schema":
      return "architecture";
    case "component":
      return usageCount > 0 ? "modules" : "files";
    case "hook":
    case "state":
      return usageCount > 0 || file.category === "state" ? "modules" : "files";
    default:
      return "files";
  }
}

function snippetFor(lines: string[], maxLines: number): string {
  const snippet = lines.slice(0, maxLines).join("\n");
  return snippet.length > 2400 ? `${snippet.slice(0, 2400)}…` : snippet;
}

function languageFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "tsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  return "javascript";
}

function descriptionFor(
  type: AppGraphNode["type"],
  file: ClassifiedFile,
  parsed: ParsedFile,
  usageCount: number,
): string {
  const exportCount = parsed.exports.length;
  switch (type) {
    case "page": {
      const parts = [`Route ${file.route ?? "/"}.`];
      if (parsed.components.length > 0) parts.push(`${parsed.components.length} exported component(s).`);
      if (usageCount > 0) parts.push(`Referenced ${usageCount} time(s) in the analyzed source.`);
      return parts.join(" ");
    }
    case "api": {
      const methods = file.methods?.length ? file.methods.join(", ") : "route";
      return `${methods} handler for ${file.route ?? file.path}. ${exportCount} export(s).`;
    }
    case "component":
      if (file.role === "layout") return `Layout component for ${file.route ?? "the application shell"}.`;
      return `React component module with ${parsed.components.length || exportCount} export(s).`;
    case "service":
      return `Service module exposing ${exportCount} export(s). Used by ${usageCount} analyzed module(s).`;
    case "database":
      return file.category === "schema"
        ? "Database schema definitions (static analysis only, no data accessed)."
        : "Database access module. Relationships show which modules read or write data.";
    case "state":
      return "Application state module (stores, reducers or contexts).";
    case "middleware":
      return "Request middleware. Runs before routes match.";
    case "config":
      return "Runtime configuration.";
    case "external":
      return "External service detected from SDK imports.";
    default:
      return `Source module with ${exportCount} export(s).`;
  }
}

function rankOrder(granularity: GraphGranularity): number {
  return GRANULARITY_ORDER[granularity];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * Turns a parsed repository context into the semantic AppGraph document.
 * This function orchestrates projections only; each ecosystem lives in its own
 * builder under `builders/` (files, integrations, symbols, data, imports).
 */
export async function buildGraph(context: RepositoryContext): Promise<GraphBuildResult> {
  const warnings: AnalysisWarningDraft[] = [...context.warnings];
  const nodes = new Map<string, AppGraphNode>();
  const nodeRank = new Map<string, number>();
  const usageCounts = new Map<string, number>();

  // --- Usage counting (imports pointing at a file) ---
  for (const [fromPath, resolved] of context.resolvedImports) {
    for (const target of resolved.values()) {
      if (!target || target === fromPath) continue;
      usageCounts.set(target, (usageCounts.get(target) ?? 0) + 1);
    }
  }

  // --- File-backed semantic nodes ---
  for (const file of context.classified.values()) {
    const parsed = context.parsed.get(file.path);
    if (!parsed) continue;
    const usageCount = usageCounts.get(file.path) ?? 0;
    if (file.category === "page" || file.category === "api") {
      if (parsed.routeHandlers.length > 0 && file.category === "api") {
        file.methods = [...new Set(parsed.routeHandlers.map((handler) => handler.method))].sort();
      }
    }

    const type = nodeTypeFor(file);
    const rank = baseGranularityFor(file, usageCount);
    const { label: routeLabel, subtitle: routeSubtitle } = labelForRoute(file.route, file.path);
    let label: string;
    let subtitle: string | undefined;

    if (file.category === "page") {
      label = routeLabel;
      subtitle = routeSubtitle;
    } else if (file.category === "api") {
      const methods = file.methods ?? [];
      const route = file.route ?? file.path;
      label = methods.length > 0 ? `${methods[0]} ${route}` : route;
      subtitle = methods.length > 1 ? methods.join(" · ") : baseName(file.path);
    } else if (file.category === "component" || file.category === "hook") {
      label = parsed.components[0] ?? titleCase(withoutExtension(baseName(file.path)));
      subtitle = file.path;
    } else if (file.category === "database" || file.category === "schema") {
      label = titleCase(withoutExtension(baseName(file.path)));
      subtitle = file.category === "schema" ? "Schema" : "Data access";
    } else if (file.category === "middleware") {
      label = "Middleware";
      subtitle = file.path;
    } else {
      label = titleCase(withoutExtension(baseName(file.path)));
      subtitle = file.path;
    }

    const primarySymbol =
      parsed.symbols.find(
        (symbol) =>
          symbol.exported &&
          (symbol.kind === "component" || symbol.kind === "function" || symbol.kind === "class"),
      ) ??
      parsed.symbols.find((symbol) => symbol.kind === "component") ??
      parsed.symbols[0];
    const symbolMetadata = parsed.symbols
      .filter((symbol) => symbol.exported)
      .slice(0, 16)
      .map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.range.startLine,
        endLine: symbol.range.endLine,
        exported: symbol.exported,
      }));

    const metadata: AppGraphNodeMetadata = {
      group: file.group,
      usageCount,
      role: file.role,
      route: file.route,
      methods: file.methods,
      imports: parsed.imports
        .map((entry) => entry.specifier)
        .filter((value, index, list) => list.indexOf(value) === index)
        .slice(0, 24),
      exports: parsed.exports.map((entry) => entry.name).slice(0, 24),
      symbols: symbolMetadata,
      envVars: parsed.envVars.slice(0, 24),
      description: descriptionFor(type, file, parsed, usageCount),
      snippet: snippetFor(parsed.lines, context.limits.maxSnippetLines),
      snippetLanguage: languageFor(file.path),
    };
    if (file.category === "hook") metadata.role = "hook";
    if (parsed.directives.useClient) metadata.role = metadata.role ?? "client";
    if (parsed.directives.useServer) metadata.role = "server-action";

    const node: AppGraphNode = {
      id: fileNodeId(file.path),
      type,
      label,
      subtitle,
      path: file.path,
      symbol: primarySymbol?.name ?? parsed.components[0] ?? parsed.functions[0],
      framework: file.framework,
      confidence: file.confidence,
      granularity: rank,
      metadata,
      source: {
        path: file.path,
        startLine: primarySymbol?.range.startLine,
        endLine: primarySymbol?.range.endLine,
      },
    };
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder(rank));
  }

  // --- Integration projection (external services, databases, ORMs) ---
  const integrationProjection = projectIntegrations(context);
  for (const node of integrationProjection.nodes) {
    if (nodes.has(node.id)) continue;
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder(node.granularity));
  }
  const databaseNodes: AppGraphNode[] = [...integrationProjection.databaseNodes];
  const ormNodes: AppGraphNode[] = [...integrationProjection.ormNodes];

  // Schema-backed database node (when integrations did not already create one).
  if (databaseNodes.length === 0 && context.dataSchemas.length > 0) {
    const schemaNode = createSchemaDatabaseNode(context);
    if (schemaNode && !nodes.has(schemaNode.id)) {
      nodes.set(schemaNode.id, schemaNode);
      nodeRank.set(schemaNode.id, rankOrder(schemaNode.granularity));
      databaseNodes.push(schemaNode);
    }
  }

  // --- Symbol projection (Batch 2) ---
  const symbolProjection = projectSymbols(context);
  for (const node of symbolProjection.nodes) {
    if (nodes.has(node.id)) continue;
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder(node.granularity));
  }

  // --- Data projection (Batch 3) ---
  const dataProjection = projectDataGraph(context);
  for (const node of dataProjection.nodes) {
    if (nodes.has(node.id)) continue;
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder(node.granularity));
  }
  for (const note of dataProjection.notes) {
    warnings.push({ code: "SCHEMA_PARTIAL_REPLAY", severity: "info", message: note });
  }

  // --- Environment configuration node ---
  const envVarsByFile = new Map<string, string[]>();
  const allEnvVars = new Set<string>(context.envExampleVars ?? []);
  for (const parsed of context.parsed.values()) {
    if (parsed.envVars.length === 0) continue;
    envVarsByFile.set(parsed.path, parsed.envVars);
    for (const name of parsed.envVars) allEnvVars.add(name);
  }
  if (allEnvVars.size > 0) {
    const sortedVars = [...allEnvVars].sort();
    const node: AppGraphNode = {
      id: CONFIG_NODE_ID,
      type: "config",
      label: "Environment Variables",
      subtitle: `process.env · ${sortedVars.length} key(s)`,
      confidence: 0.92,
      granularity: "architecture",
      metadata: {
        group: "config",
        envVars: sortedVars.slice(0, 40),
        description: `Runtime configuration read through process.env. ${sortedVars.length} variable name(s) detected. Values are never read or stored.`,
        imports: [],
        exports: [],
      },
    };
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder(node.granularity));
  }

  // --- Product layer cap: keep the overview readable ---
  const productNodes = [...nodes.values()].filter((node) => node.granularity === "product");
  const MAX_PRODUCT_PAGES = 60;
  const productPages = productNodes.filter((node) => node.type === "page");
  if (productPages.length > MAX_PRODUCT_PAGES) {
    const keep = new Set(
      productPages
        .sort((a, b) => (usageCounts.get(b.path ?? "") ?? 0) - (usageCounts.get(a.path ?? "") ?? 0))
        .slice(0, MAX_PRODUCT_PAGES)
        .map((node) => node.id),
    );
    for (const page of productPages) {
      if (!keep.has(page.id)) {
        page.granularity = "architecture";
        nodeRank.set(page.id, rankOrder("architecture"));
      }
    }
    warnings.push({
      code: "PRODUCT_LAYER_TRUNCATED",
      severity: "info",
      message: `The Product view shows the ${MAX_PRODUCT_PAGES} most connected pages. Switch to Architecture or Files for the full list.`,
    });
  }

  // --- Component cap at Modules layer ---
  const moduleComponents = [...nodes.values()].filter(
    (node) => node.granularity === "modules" && node.type === "component",
  );
  if (moduleComponents.length > context.limits.maxComponents) {
    const keep = new Set(
      moduleComponents
        .sort((a, b) => (usageCounts.get(b.path ?? "") ?? 0) - (usageCounts.get(a.path ?? "") ?? 0))
        .slice(0, context.limits.maxComponents)
        .map((node) => node.id),
    );
    for (const component of moduleComponents) {
      if (!keep.has(component.id)) {
        component.granularity = "files";
        nodeRank.set(component.id, rankOrder("files"));
      }
    }
    warnings.push({
      code: "MODULES_LAYER_TRUNCATED",
      severity: "info",
      message: `The Modules view shows the ${context.limits.maxComponents} most referenced components. Switch to Files for everything.`,
    });
  }

  // --- Edges: one accumulator shared by all projections ---
  const accumulator = createEdgeAccumulator((id) => nodes.has(id));
  addImportGraphEdges(accumulator, context, {
    configNodeId: nodes.has(CONFIG_NODE_ID) ? CONFIG_NODE_ID : null,
    envVarsByFile,
  });
  addSymbolEdges(accumulator, context, symbolProjection);
  addDataEdges(accumulator, context, dataProjection, databaseNodes[0]?.id);
  addOrmDatabaseEdges(accumulator, context, ormNodes, databaseNodes);

  // Framework analyzers contribute framework-specific edges (e.g. Next.js routes).
  const nodeIdByRoute = new Map<string, string[]>();
  for (const node of nodes.values()) {
    const route = node.metadata.route;
    if (!route) continue;
    const list = nodeIdByRoute.get(route) ?? [];
    list.push(node.id);
    nodeIdByRoute.set(route, list);
  }

  const analysisContext = {
    context,
    nodes,
    nodeIdByRoute,
    classify: (path: string) => context.classified.get(path),
  };

  const detectedFrameworkIds = new Set(context.signals.detectedFrameworks);
  for (const entry of analyzerRegistries.frameworks.list()) {
    const analyzer = entry.analyzer;
    if (!detectedFrameworkIds.has(analyzer.id)) continue;
    try {
      const analysis = await analyzer.analyze(analysisContext);
      for (const edge of analysis.extraEdges) {
        accumulator.addEdge(edge.source, edge.target, edge.type, edge.confidence, edge.metadata);
      }
      for (const [nodeId, metadata] of analysis.nodeMetadata) {
        const node = nodes.get(nodeId);
        if (node) node.metadata = { ...node.metadata, ...stripUndefined(metadata) };
      }
      warnings.push(...analysis.warnings);
    } catch (error) {
      warnings.push({
        code: "FRAMEWORK_ANALYZER_FAILED",
        severity: "warning",
        message: `The ${analyzer.label} adapter could not complete. Results may be partial.`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- Node cap (defensive, for extremely large repositories) ---
  let nodeList = [...nodes.values()];
  if (nodeList.length > context.limits.maxGraphNodes) {
    nodeList = nodeList
      .sort((a, b) => {
        const rankDelta = rankOrder(a.granularity) - rankOrder(b.granularity);
        if (rankDelta !== 0) return rankDelta;
        const usageDelta = (usageCounts.get(b.path ?? "") ?? 0) - (usageCounts.get(a.path ?? "") ?? 0);
        if (usageDelta !== 0) return usageDelta;
        return a.id.localeCompare(b.id);
      })
      .slice(0, context.limits.maxGraphNodes);
    warnings.push({
      code: "GRAPH_TRUNCATED",
      severity: "warning",
      message: `This repository is very large. The graph was bounded to ${context.limits.maxGraphNodes} entities.`,
    });
  }

  const allowedNodes = new Set(nodeList.map((node) => node.id));
  let edgeList = accumulator.edges().filter(
    (edge) => allowedNodes.has(edge.source) && allowedNodes.has(edge.target),
  );

  if (edgeList.length > context.limits.maxGraphEdges) {
    edgeList = edgeList
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, context.limits.maxGraphEdges);
    warnings.push({
      code: "EDGES_TRUNCATED",
      severity: "info",
      message: `The relationship list was bounded to ${context.limits.maxGraphEdges} highest-confidence edges.`,
    });
  }

  const external = nodeList.filter((node) => node.type === "external");
  const database = nodeList.filter((node) => node.type === "database");

  return {
    nodes: nodeList,
    edges: edgeList,
    warnings,
    stats: {
      entities: nodeList.length,
      relationships: edgeList.length,
      externalServices: external.length,
      pages: nodeList.filter((node) => node.type === "page").length,
      apis: nodeList.filter((node) => node.type === "api").length,
      services: nodeList.filter((node) => node.type === "service").length,
      components: nodeList.filter((node) => node.type === "component").length,
      databaseNodes: database.length,
      symbols: symbolProjection.allowedKeys.size,
      symbolEdges: symbolProjection.facts.length,
    },
  };
}

export function routeMatches(candidate: string, template: string): boolean {
  return matchRouteTemplate(candidate, template);
}

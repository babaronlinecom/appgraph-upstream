import type {
  AppGraphEdge,
  AppGraphEdgeMetadata,
  AppGraphNode,
  AppGraphNodeMetadata,
  GraphEdgeType,
  GraphGranularity,
  GraphGroupId,
} from "@/lib/graph/model";
import { GRAPH_GROUPS } from "@/lib/graph/model";
import { classifyDatabaseOperation, findIntegrationForSpecifier, type DatabaseOperation } from "./integrations";
import { matchRouteTemplate } from "./frameworks/registry";
import type {
  AnalysisWarningDraft,
  ClassifiedFile,
  DetectedIntegration,
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
  };
}

export const CONFIG_NODE_ID = "config:environment";
export const FILE_NODE_PREFIX = "file:";

export function fileNodeId(path: string): string {
  return `${FILE_NODE_PREFIX}${path}`;
}

const GROUP_ORDER = new Map(GRAPH_GROUPS.map((group) => [group.id, group.order]));

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

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

function labelForRoute(route: string | undefined, fallbackPath: string): { label: string; subtitle?: string } {
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

function localUsage(
  parsed: { jsxTags: Array<{ name: string }>; calls: Array<{ name: string }> },
  localNames: string[],
): { usedInJsx: boolean; callNames: string[] } {
  const usedInJsx = parsed.jsxTags.some((tag) =>
    localNames.some((name) => tag.name === name || tag.name.startsWith(`${name}.`)),
  );
  const callNames = parsed.calls
    .filter((call) => localNames.some((name) => call.name === name || call.name.startsWith(`${name}.`)))
    .map((call) => call.name);
  return { usedInJsx, callNames };
}

interface DatabaseAggregate {
  hasRead: boolean;
  hasWrite: boolean;
  unknown: boolean;
  count: number;
}

function aggregateOperations(callNames: string[]): DatabaseAggregate {
  const aggregate: DatabaseAggregate = { hasRead: false, hasWrite: false, unknown: false, count: callNames.length };
  for (const callName of callNames) {
    const operation: DatabaseOperation = classifyDatabaseOperation(callName);
    if (operation === "read") aggregate.hasRead = true;
    else if (operation === "write") aggregate.hasWrite = true;
    else aggregate.unknown = true;
  }
  return aggregate;
}

function integrationGroup(integration: DetectedIntegration): GraphGroupId {
  return integration.definition.kind === "database" ? "data" : "external";
}

function integrationNodeId(integration: DetectedIntegration): string {
  if (integration.definition.kind === "database" || integration.definition.databaseLabel) {
    return `db:${slug(integration.definition.databaseLabel ?? integration.definition.label)}`;
  }
  if (integration.definition.kind === "orm") {
    return `orm:${slug(integration.definition.label)}`;
  }
  return `ext:${slug(integration.definition.id)}`;
}

function integrationNodeType(integration: DetectedIntegration): AppGraphNode["type"] {
  if (integration.definition.kind === "database") return "database";
  if (integration.definition.kind === "orm") return "service";
  return "external";
}

function integrationGranularity(integration: DetectedIntegration): GraphGranularity {
  return integration.definition.kind === "orm" ? "architecture" : "product";
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

/**
 * Turns a parsed repository context into the semantic AppGraph document.
 * Files are evidence; nodes are semantic entities.
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
      symbol: parsed.components[0] ?? parsed.functions[0],
      framework: file.framework,
      confidence: file.confidence,
      granularity: rank,
      metadata,
      source: { path: file.path },
    };
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder(rank));
  }

  // --- External service & database nodes ---
  const externalNodes = new Set<string>();
  const integrationByNodeId = new Map<string, DetectedIntegration>();
  for (const integration of context.integrations) {
    const id = integrationNodeId(integration);
    integrationByNodeId.set(id, integration);
    if (nodes.has(id)) continue;
    const definition = integration.definition;
    const node: AppGraphNode = {
      id,
      type: integrationNodeType(integration),
      label: definition.databaseLabel ?? definition.label,
      subtitle: definition.kind === "database" ? "Database" : definition.category,
      confidence: integration.confidence,
      granularity: integrationGranularity(integration),
      metadata: {
        group: integrationGroup(integration),
        integrationKind: definition.kind,
        description:
          definition.kind === "database"
            ? "Data store inferred from SDK usage. Operations show reads and writes."
            : definition.kind === "orm"
              ? "ORM layer detected. Connects application code to the database."
              : `External service detected from ${definition.packages.join(", ")} imports.`,
        packages: definition.packages,
        imports: integration.files.slice(0, 24),
        url: definitionUrl(definition.id),
      },
    };
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder(node.granularity));
    if (node.type === "external") externalNodes.add(node.id);
  }

  // --- ORM -> database link ---
  const ormNodes = [...nodes.values()].filter((node) => node.id.startsWith("orm:"));
  const databaseNodes = [...nodes.values()].filter((node) => node.type === "database" && !node.path);
  const isPrisma = ormNodes.some((orm) => orm.id === "orm:prisma");
  if (isPrisma && databaseNodes.length === 0) {
    const schemaProvider = context.files.get("prisma/schema.prisma")
      ? parsePrismaProvider(context.files.get("prisma/schema.prisma") as string)
      : null;
    const label = schemaProvider ? providerLabel(schemaProvider) : "Database";
    const id = `db:${slug(label)}`;
    const node: AppGraphNode = {
      id,
      type: "database",
      label,
      subtitle: "Database",
      confidence: schemaProvider ? 0.9 : 0.6,
      granularity: "product",
      metadata: {
        group: "data",
        integrationKind: "database",
        description: schemaProvider
          ? `Database provider "${schemaProvider}" detected in prisma/schema.prisma.`
          : "Database inferred from Prisma usage. Provider could not be determined statically.",
        models: schemaProvider ? parsePrismaModels(context.files.get("prisma/schema.prisma") as string) : [],
      },
    };
    nodes.set(id, node);
    nodeRank.set(id, rankOrder("product"));
    databaseNodes.push(node);
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

  // --- Edges ---
  const edgeMap = new Map<string, AppGraphEdge>();
  const addEdge = (
    source: string,
    target: string,
    type: GraphEdgeType,
    confidence: number,
    metadata?: AppGraphEdgeMetadata,
  ) => {
    if (source === target) return;
    if (!nodes.has(source) || !nodes.has(target)) return;
    const id = `${source}->${target}:${type}`;
    const existing = edgeMap.get(id);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      if (metadata) {
        existing.metadata = mergeEdgeMetadata(existing.metadata, metadata);
      }
      return;
    }
    edgeMap.set(id, { id, source, target, type, confidence, metadata });
  };

  for (const [fromPath, parsed] of context.parsed) {
    const sourceId = fileNodeId(fromPath);
    if (!nodes.has(sourceId)) continue;
    const resolved = context.resolvedImports.get(fromPath) ?? new Map();

    const handledSpecifiers = new Set<string>();

    for (const entry of parsed.imports) {
      if (handledSpecifiers.has(entry.specifier)) continue;
      handledSpecifiers.add(entry.specifier);
      const targetPath = resolved.get(entry.specifier);
      const { usedInJsx, callNames } = localUsage(parsed, entry.localNames);

      if (targetPath && targetPath !== fromPath) {
        const targetId = fileNodeId(targetPath);
        const targetFile = context.classified.get(targetPath);
        const targetNode = nodes.get(targetId);
        if (!targetFile || !targetNode) continue;

        if (entry.typeOnly) {
          addEdge(sourceId, targetId, "depends_on", 0.55, { label: "type import" });
          continue;
        }

        if (targetFile.category === "database" || targetFile.category === "schema") {
          const aggregate = aggregateOperations(callNames);
          if (aggregate.hasRead) addEdge(sourceId, targetId, "reads", 0.82, { count: aggregate.count });
          if (aggregate.hasWrite) addEdge(sourceId, targetId, "writes", 0.85, { count: aggregate.count });
          if (!aggregate.hasRead && !aggregate.hasWrite) {
            addEdge(sourceId, targetId, "uses", 0.7, { label: "database module" });
          }
          continue;
        }

        if (targetFile.category === "component" || targetFile.category === "hook") {
          if (usedInJsx) {
            addEdge(sourceId, targetId, "renders", 0.92);
          } else if (callNames.length > 0 || targetFile.category === "hook") {
            addEdge(sourceId, targetId, "calls", 0.86, { via: callNames[0] });
          } else {
            addEdge(sourceId, targetId, "imports", 0.9);
          }
          continue;
        }

        if (targetFile.category === "service" || targetFile.category === "state") {
          if (callNames.length > 0) {
            addEdge(sourceId, targetId, "calls", 0.85, { via: callNames[0] });
          } else {
            addEdge(sourceId, targetId, "imports", 0.9);
          }
          continue;
        }

        addEdge(sourceId, targetId, "imports", 1, undefined);
        continue;
      }

      // External package: known integrations become explicit nodes.
      const integration = findIntegrationForSpecifier(entry.specifier);
      if (integration) {
        const targetIdMatches = integrationNodeId({
          definition: integration.definition,
          packageName: integration.packageName,
          files: [],
          confidence: 1,
        });
        if (nodes.has(targetIdMatches)) {
          const aggregate = aggregateOperations(callNames);
          const kind = integration.definition.kind;
          if (kind === "database") {
            if (aggregate.hasRead) addEdge(sourceId, targetIdMatches, "reads", 0.8, { count: aggregate.count });
            if (aggregate.hasWrite) addEdge(sourceId, targetIdMatches, "writes", 0.82, { count: aggregate.count });
            if (!aggregate.hasRead && !aggregate.hasWrite) {
              addEdge(sourceId, targetIdMatches, "uses", 0.75, { label: integration.definition.label });
            }
          } else if (kind === "orm") {
            addEdge(sourceId, targetIdMatches, "uses", 0.9, { label: integration.definition.label });
          } else {
            addEdge(sourceId, targetIdMatches, "uses", 0.95, { label: integration.definition.label });
          }
        }
      }
    }

    // Environment variable usage
    const envVars = envVarsByFile.get(fromPath);
    if (envVars && nodes.has(CONFIG_NODE_ID)) {
      addEdge(sourceId, CONFIG_NODE_ID, "uses", 0.9, { envVars: envVars.slice(0, 12) });
    }
  }

  // ORM -> database edges
  for (const orm of ormNodes) {
    for (const database of databaseNodes) {
      addEdge(orm.id, database.id, "uses", 0.85, { label: orm.label });
    }
  }

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
  const { FRAMEWORK_ANALYZERS } = await import("./frameworks/registry");
  for (const analyzer of FRAMEWORK_ANALYZERS) {
    if (!detectedFrameworkIds.has(analyzer.id)) continue;
    try {
      const analysis = await analyzer.analyze(analysisContext);
      for (const edge of analysis.extraEdges) {
        addEdge(edge.source, edge.target, edge.type, edge.confidence, edge.metadata);
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
  let edgeList = [...edgeMap.values()].filter(
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

  // Clean dangling references to removed edges from node metadata view.
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
    },
  };
}

function rankOrder(granularity: GraphGranularity): number {
  return { product: 0, architecture: 1, modules: 2, files: 3 }[granularity];
}

function mergeEdgeMetadata(
  current: AppGraphEdgeMetadata | undefined,
  next: AppGraphEdgeMetadata,
): AppGraphEdgeMetadata {
  const merged: AppGraphEdgeMetadata = { ...current, ...next };
  const envVars = [...new Set([...(current?.envVars ?? []), ...(next.envVars ?? [])])].slice(0, 12);
  if (envVars.length > 0) merged.envVars = envVars;
  return merged;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function parsePrismaProvider(schema: string): string | null {
  const match = schema.match(/datasource\s+\w+\s*{[^}]*provider\s*=\s*"([^"]+)"/s);
  return match?.[1] ?? null;
}

export function parsePrismaModels(schema: string): string[] {
  const models: string[] = [];
  const pattern = /^\s*model\s+([A-Za-z0-9_]+)\s*{/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(schema)) !== null) {
    models.push(match[1]);
  }
  return models.slice(0, 40);
}

function providerLabel(provider: string): string {
  const map: Record<string, string> = {
    postgresql: "PostgreSQL",
    postgres: "PostgreSQL",
    mysql: "MySQL",
    mongodb: "MongoDB",
    sqlite: "SQLite",
    sqlserver: "SQL Server",
    cockroachdb: "CockroachDB",
  };
  return map[provider.toLowerCase()] ?? titleCase(provider);
}

function definitionUrl(id: string): string | undefined {
  const map: Record<string, string> = {
    stripe: "https://stripe.com",
    supabase: "https://supabase.com",
    firebase: "https://firebase.google.com",
    clerk: "https://clerk.com",
    openai: "https://openai.com",
    anthropic: "https://anthropic.com",
    resend: "https://resend.com",
    posthog: "https://posthog.com",
    sentry: "https://sentry.io",
    prisma: "https://www.prisma.io",
    drizzle: "https://orm.drizzle.team",
  };
  return map[id];
}

export function routeMatches(candidate: string, template: string): boolean {
  return matchRouteTemplate(candidate, template);
}

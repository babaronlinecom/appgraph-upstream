import type {
  AppGraphEdge,
  AppGraphEdgeMetadata,
  AppGraphNode,
  AppGraphNodeMetadata,
  EdgeEvidence,
  EdgeEvidenceKind,
  GraphEdgeType,
  GraphGranularity,
  GraphGroupId,
} from "@/lib/graph/model";
import { GRAPH_GROUPS, GRANULARITY_ORDER } from "@/lib/graph/model";
import { classifyDatabaseOperation, findIntegrationForSpecifier, type DatabaseOperation } from "./integrations";
import { matchRouteTemplate } from "./frameworks/registry";
import { providerLabel } from "./data/prisma";
import { analyzerRegistries } from "./registries";
import { buildSymbolGraph, type SymbolFact } from "./resolvers/symbol-resolver";
import type { IrSourceRange } from "./ir/model";
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
    symbols: number;
    symbolEdges: number;
  };
}

export const CONFIG_NODE_ID = "config:environment";
export const FILE_NODE_PREFIX = "file:";
export const SYMBOL_NODE_PREFIX = "symbol:";

export function fileNodeId(path: string): string {
  return `${FILE_NODE_PREFIX}${path}`;
}

export function symbolNodeId(path: string, name: string): string {
  return `${SYMBOL_NODE_PREFIX}${path}#${name}`;
}

function splitSymbolKey(key: string): { path: string; name: string } {
  const index = key.lastIndexOf("#");
  return { path: key.slice(0, index), name: key.slice(index + 1) };
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
  parsed: ParsedFile,
  localNames: string[],
): { usedInJsx: boolean; jsxTag?: ParsedFile["jsxTags"][number]; calls: ParsedFile["calls"] } {
  const jsxTag = parsed.jsxTags.find((tag) =>
    localNames.some((name) => tag.name === name || tag.name.startsWith(`${name}.`)),
  );
  const calls = parsed.calls.filter((call) =>
    localNames.some((name) => call.name === name || call.name.startsWith(`${name}.`)),
  );
  return { usedInJsx: Boolean(jsxTag), jsxTag, calls };
}

interface DatabaseAggregate {
  hasRead: boolean;
  hasWrite: boolean;
  unknown: boolean;
  count: number;
  readCall?: ParsedFile["calls"][number];
  writeCall?: ParsedFile["calls"][number];
}

function aggregateOperations(calls: ParsedFile["calls"]): DatabaseAggregate {
  const aggregate: DatabaseAggregate = { hasRead: false, hasWrite: false, unknown: false, count: calls.length };
  for (const call of calls) {
    const operation: DatabaseOperation = classifyDatabaseOperation(call.name);
    if (operation === "read") {
      aggregate.hasRead = true;
      aggregate.readCall ??= call;
    } else if (operation === "write") {
      aggregate.hasWrite = true;
      aggregate.writeCall ??= call;
    } else {
      aggregate.unknown = true;
    }
  }
  return aggregate;
}

const MAX_EVIDENCE_PER_EDGE = 6;

function evidenceFrom(
  range: IrSourceRange | undefined,
  analyzerId: string,
  ruleId: string,
  kind: EdgeEvidenceKind,
  reason?: string,
): EdgeEvidence[] | undefined {
  if (!range) return undefined;
  return [
    {
      path: range.path,
      startLine: range.startLine,
      endLine: range.endLine,
      analyzerId,
      ruleId,
      kind,
      ...(reason ? { reason } : {}),
    },
  ];
}

function evidenceMetadata(
  base: AppGraphEdgeMetadata | undefined,
  range: IrSourceRange | undefined,
  analyzerId: string,
  ruleId: string,
  kind: EdgeEvidenceKind,
  reason?: string,
): AppGraphEdgeMetadata | undefined {
  const evidence = evidenceFrom(range, analyzerId, ruleId, kind, reason);
  if (!evidence) return base;
  return {
    ...(base ?? {}),
    evidence: [...(base?.evidence ?? []), ...evidence].slice(0, MAX_EVIDENCE_PER_EDGE),
  };
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
  if (databaseNodes.length === 0 && context.dataSchemas.length > 0) {
    const detection = context.dataSchemas[0];
    const label = detection.provider ? providerLabel(detection.provider.raw) : "Database";
    const id = `db:${slug(label)}`;
    const node: AppGraphNode = {
      id,
      type: "database",
      label,
      subtitle: "Database",
      confidence: detection.provider ? 0.95 : 0.6,
      granularity: "product",
      metadata: {
        group: "data",
        integrationKind: "database",
        description: detection.provider
          ? `Database provider "${detection.provider.raw}" parsed from ${detection.files.join(", ")}.`
          : `Database inferred from ${detection.format} schema. Provider could not be determined statically.`,
        models: detection.models.map((model) => model.name).slice(0, 40),
        modelCount: detection.models.length,
        schemaAnalyzer: detection.analyzerId,
        schemaFiles: detection.files,
      },
      source: detection.provider
        ? { path: detection.provider.range.path, startLine: detection.provider.range.startLine }
        : { path: detection.files[0], startLine: 1 },
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

  // --- Symbol-level entities (Batch 2) ---
  // Facts are only produced by the resolver when a call/JSX name actually
  // matches a resolved import binding or a declaration in the same file.
  const symbolGraph = buildSymbolGraph({
    parsed: context.parsed,
    resolvedImports: context.resolvedImports,
  });
  const symbolDegree = new Map<string, number>();
  const symbolKeys = new Set<string>();
  for (const fact of symbolGraph.facts) {
    if (fact.target.name === "*") continue;
    const sourceKey = `${fact.sourcePath}#${fact.sourceSymbol}`;
    const targetKey = `${fact.target.path}#${fact.target.name}`;
    symbolKeys.add(sourceKey);
    symbolKeys.add(targetKey);
    symbolDegree.set(sourceKey, (symbolDegree.get(sourceKey) ?? 0) + 1);
    symbolDegree.set(targetKey, (symbolDegree.get(targetKey) ?? 0) + 1);
  }

  const allowedSymbolKeys = new Set(
    [...symbolKeys]
      .filter((key) => {
        const { path, name } = splitSymbolKey(key);
        return name !== "*" && context.parsed.has(path);
      })
      .sort((a, b) => (symbolDegree.get(b) ?? 0) - (symbolDegree.get(a) ?? 0))
      .slice(0, context.limits.maxSymbolNodes),
  );

  for (const key of allowedSymbolKeys) {
    const { path, name } = splitSymbolKey(key);
    const file = context.parsed.get(path);
    if (!file) continue;
    const symbol = file.symbols.find((candidate) => candidate.name === name);
    const classified = context.classified.get(path);
    const node: AppGraphNode = {
      id: symbolNodeId(path, name),
      type: "symbol",
      label: name,
      subtitle: `${symbol?.kind ?? "symbol"} · ${path}`,
      path,
      symbol: name,
      framework: classified?.framework,
      confidence: 0.95,
      granularity: "symbols",
      metadata: {
        group: classified?.group ?? "frontend",
        role: "symbol",
        symbolKind: symbol?.kind ?? "unknown",
        description: `Symbol ${name} declared in ${path}${
          symbol ? ` at line ${symbol.range.startLine}` : ""
        }. Relationships come from resolved imports, calls and JSX usage.`,
        imports: [],
        exports: [],
      },
      source: symbol?.range ?? { path },
    };
    nodes.set(node.id, node);
    nodeRank.set(node.id, rankOrder("symbols"));
  }

  const symbolFacts = symbolGraph.facts
    .filter(
      (fact) =>
        fact.target.name !== "*" &&
        allowedSymbolKeys.has(`${fact.sourcePath}#${fact.sourceSymbol}`) &&
        allowedSymbolKeys.has(`${fact.target.path}#${fact.target.name}`),
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, context.limits.maxSymbolEdges);

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
      const usage = localUsage(parsed, entry.localNames);

      if (targetPath && targetPath !== fromPath) {
        const targetId = fileNodeId(targetPath);
        const targetFile = context.classified.get(targetPath);
        const targetNode = nodes.get(targetId);
        if (!targetFile || !targetNode) continue;

        if (entry.typeOnly) {
          addEdge(
            sourceId,
            targetId,
            "depends_on",
            0.55,
            evidenceMetadata(
              { label: "type import" },
              entry.range,
              parsed.parserId,
              "import.type-only",
              "exact",
              `import type from "${entry.specifier}"`,
            ),
          );
          continue;
        }

        if (targetFile.category === "database" || targetFile.category === "schema") {
          const aggregate = aggregateOperations(usage.calls);
          if (aggregate.hasRead && aggregate.readCall) {
            addEdge(
              sourceId,
              targetId,
              "reads",
              0.82,
              evidenceMetadata(
                { count: aggregate.count },
                aggregate.readCall.range,
                parsed.parserId,
                "db.operation.classify",
                "inferred",
                `call ${aggregate.readCall.name} classified as a read`,
              ),
            );
          }
          if (aggregate.hasWrite && aggregate.writeCall) {
            addEdge(
              sourceId,
              targetId,
              "writes",
              0.85,
              evidenceMetadata(
                { count: aggregate.count },
                aggregate.writeCall.range,
                parsed.parserId,
                "db.operation.classify",
                "inferred",
                `call ${aggregate.writeCall.name} classified as a write`,
              ),
            );
          }
          if (!aggregate.hasRead && !aggregate.hasWrite) {
            addEdge(
              sourceId,
              targetId,
              "uses",
              0.7,
              evidenceMetadata(
                { label: "database module" },
                entry.range,
                parsed.parserId,
                "import.database-module",
                "resolved",
                `import from "${entry.specifier}"`,
              ),
            );
          }
          continue;
        }

        if (targetFile.category === "component" || targetFile.category === "hook") {
          if (usage.usedInJsx && usage.jsxTag) {
            addEdge(
              sourceId,
              targetId,
              "renders",
              0.92,
              evidenceMetadata(
                undefined,
                usage.jsxTag.range,
                parsed.parserId,
                "react.jsx-usage",
                "resolved",
                `JSX <${usage.jsxTag.name}> bound to import "${entry.specifier}"`,
              ),
            );
          } else if (usage.calls.length > 0 || targetFile.category === "hook") {
            const call = usage.calls[0];
            addEdge(
              sourceId,
              targetId,
              "calls",
              0.86,
              evidenceMetadata(
                call ? { via: call.name } : undefined,
                call?.range ?? entry.range,
                parsed.parserId,
                call ? "symbol.imported-call" : "symbol.imported-reference",
                "resolved",
                call ? `call ${call.name}` : `import from "${entry.specifier}"`,
              ),
            );
          } else {
            addEdge(
              sourceId,
              targetId,
              "imports",
              0.9,
              evidenceMetadata(
                undefined,
                entry.range,
                parsed.parserId,
                "import.resolve",
                "exact",
                `import from "${entry.specifier}"`,
              ),
            );
          }
          continue;
        }

        if (targetFile.category === "service" || targetFile.category === "state") {
          if (usage.calls.length > 0) {
            const call = usage.calls[0];
            addEdge(
              sourceId,
              targetId,
              "calls",
              0.85,
              evidenceMetadata(
                { via: call.name },
                call.range,
                parsed.parserId,
                "symbol.imported-call",
                "resolved",
                `call ${call.name}`,
              ),
            );
          } else {
            addEdge(
              sourceId,
              targetId,
              "imports",
              0.9,
              evidenceMetadata(
                undefined,
                entry.range,
                parsed.parserId,
                "import.resolve",
                "exact",
                `import from "${entry.specifier}"`,
              ),
            );
          }
          continue;
        }

        addEdge(
          sourceId,
          targetId,
          "imports",
          1,
          evidenceMetadata(
            undefined,
            entry.range,
            parsed.parserId,
            "import.resolve",
            "exact",
            `import from "${entry.specifier}"`,
          ),
        );
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
          const aggregate = aggregateOperations(usage.calls);
          const kind = integration.definition.kind;
          if (kind === "database") {
            if (aggregate.hasRead && aggregate.readCall) {
              addEdge(
                sourceId,
                targetIdMatches,
                "reads",
                0.8,
                evidenceMetadata(
                  { count: aggregate.count },
                  aggregate.readCall.range,
                  parsed.parserId,
                  "integration.db-call",
                  "inferred",
                  `${integration.packageName}: ${aggregate.readCall.name} classified as a read`,
                ),
              );
            }
            if (aggregate.hasWrite && aggregate.writeCall) {
              addEdge(
                sourceId,
                targetIdMatches,
                "writes",
                0.82,
                evidenceMetadata(
                  { count: aggregate.count },
                  aggregate.writeCall.range,
                  parsed.parserId,
                  "integration.db-call",
                  "inferred",
                  `${integration.packageName}: ${aggregate.writeCall.name} classified as a write`,
                ),
              );
            }
            if (!aggregate.hasRead && !aggregate.hasWrite) {
              addEdge(
                sourceId,
                targetIdMatches,
                "uses",
                0.75,
                evidenceMetadata(
                  { label: integration.definition.label },
                  entry.range,
                  parsed.parserId,
                  "integration.package-import",
                  "exact",
                  `package "${integration.packageName}" imported`,
                ),
              );
            }
          } else {
            addEdge(
              sourceId,
              targetIdMatches,
              "uses",
              kind === "orm" ? 0.9 : 0.95,
              evidenceMetadata(
                { label: integration.definition.label },
                entry.range,
                parsed.parserId,
                "integration.package-import",
                "exact",
                `package "${integration.packageName}" imported`,
              ),
            );
          }
        }
      }
    }

    // Environment variable usage
    const envVars = envVarsByFile.get(fromPath);
    if (envVars && nodes.has(CONFIG_NODE_ID)) {
      const reads = (parsed.envReads ?? []).slice(0, MAX_EVIDENCE_PER_EDGE);
      const metadata: AppGraphEdgeMetadata = { envVars: envVars.slice(0, 12) };
      if (reads.length > 0) {
        metadata.evidence = reads.map((read) => ({
          path: read.range.path,
          startLine: read.range.startLine,
          endLine: read.range.endLine,
          symbol: read.name,
          analyzerId: parsed.parserId,
          ruleId: "env.process-read",
          kind: "exact" as const,
          reason: `process.env.${read.name}`,
        }));
      }
      addEdge(sourceId, CONFIG_NODE_ID, "uses", 0.9, metadata);
    }
  }

  // Symbol edges: file -> symbol ownership and symbol -> symbol calls/renders.
  for (const key of allowedSymbolKeys) {
    const { path, name } = splitSymbolKey(key);
    const file = context.parsed.get(path);
    const symbol = file?.symbols.find((candidate) => candidate.name === name);
    addEdge(
      fileNodeId(path),
      symbolNodeId(path, name),
      "contains",
      1,
      evidenceMetadata(
        undefined,
        symbol?.range ?? { path, startLine: 1 },
        file?.parserId ?? "typescript-ast",
        "ir.symbol-declaration",
        "exact",
        `symbol ${name} declared in ${path}`,
      ),
    );
  }

  for (const fact of symbolFacts) {
    addEdge(
      symbolNodeId(fact.sourcePath, fact.sourceSymbol),
      symbolNodeId(fact.target.path, fact.target.name),
      fact.type,
      fact.confidence,
      evidenceMetadata(
        { via: fact.target.name },
        fact.range,
        context.parsed.get(fact.sourcePath)?.parserId ?? "typescript-ast",
        fact.ruleId,
        fact.evidenceKind,
        fact.reason,
      ),
    );
  }

  // ORM -> database edges. The link is only drawn when a schema analyzer
  // actually detected a provider; otherwise it stays a low-confidence inference.
  for (const orm of ormNodes) {
    for (const database of databaseNodes) {
      const detection = context.dataSchemas.find((candidate) => candidate.provider);
      const range = detection?.provider?.range;
      addEdge(
        orm.id,
        database.id,
        "uses",
        detection?.provider ? 0.9 : 0.6,
        evidenceMetadata(
          { label: orm.label },
          range,
          detection?.analyzerId ?? "orm-mapping",
          detection?.provider ? "prisma.datasource-provider" : "orm.default-database",
          detection?.provider ? "exact" : "inferred",
          detection?.provider
            ? `provider "${detection.provider.raw}" declared in ${detection.provider.range.path}`
            : "no schema provider found; database inferred from ORM usage",
        ),
      );
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
  for (const entry of analyzerRegistries.frameworks.list()) {
    const analyzer = entry.analyzer;
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
      symbols: allowedSymbolKeys.size,
      symbolEdges: symbolFacts.length,
    },
  };
}

function rankOrder(granularity: GraphGranularity): number {
  return GRANULARITY_ORDER[granularity];
}

function mergeEdgeMetadata(
  current: AppGraphEdgeMetadata | undefined,
  next: AppGraphEdgeMetadata,
): AppGraphEdgeMetadata {
  const merged: AppGraphEdgeMetadata = { ...current, ...next };
  const envVars = [...new Set([...(current?.envVars ?? []), ...(next.envVars ?? [])])].slice(0, 12);
  if (envVars.length > 0) merged.envVars = envVars;

  const evidence = [...(current?.evidence ?? []), ...(next.evidence ?? [])];
  if (evidence.length > 0) {
    const seen = new Set<string>();
    merged.evidence = evidence
      .filter((entry) => {
        const key = `${entry.path}:${entry.startLine ?? 0}:${entry.ruleId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_EVIDENCE_PER_EDGE);
  }
  return merged;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
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

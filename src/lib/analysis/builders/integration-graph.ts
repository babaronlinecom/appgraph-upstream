import type { AppGraphNode, GraphGranularity, GraphGroupId } from "@/lib/graph/model";
import type { DetectedIntegration, RepositoryContext } from "../types";
import { providerLabel } from "../data/prisma";
import { evidenceMetadata } from "./evidence";
import type { EdgeAccumulator } from "./edge-accumulator";
import { slug } from "./ids";

/** Integration projection: external services, databases and ORMs as nodes. */

function integrationGroup(integration: DetectedIntegration): GraphGroupId {
  return integration.definition.kind === "database" ? "data" : "external";
}

export function integrationNodeId(integration: DetectedIntegration): string {
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

export interface IntegrationProjection {
  nodes: AppGraphNode[];
  externalNodeIds: Set<string>;
  databaseNodes: AppGraphNode[];
  ormNodes: AppGraphNode[];
}

export function projectIntegrations(context: RepositoryContext): IntegrationProjection {
  const nodes: AppGraphNode[] = [];
  const externalNodeIds = new Set<string>();
  const databaseNodes: AppGraphNode[] = [];
  const ormNodes: AppGraphNode[] = [];
  const seen = new Set<string>();

  for (const integration of context.integrations) {
    const id = integrationNodeId(integration);
    if (seen.has(id)) continue;
    seen.add(id);
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
    nodes.push(node);
    if (node.type === "external") externalNodeIds.add(id);
    if (node.type === "database") databaseNodes.push(node);
    if (node.type === "service") ormNodes.push(node);
  }

  return { nodes, externalNodeIds, databaseNodes, ormNodes };
}

/** Creates the schema-backed database node when no integration already did. */
export function createSchemaDatabaseNode(context: RepositoryContext): AppGraphNode | null {
  const detection = context.dataSchemas[0];
  if (!detection) return null;
  const label = detection.provider ? providerLabel(detection.provider.raw) : "Database";
  const id = `db:${slug(label)}`;
  return {
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
}

/**
 * ORM → database link. Drawn only from a parsed schema provider; otherwise it
 * stays a low-confidence inference with no fabricated source line.
 */
export function addOrmDatabaseEdges(
  accumulator: EdgeAccumulator,
  context: RepositoryContext,
  ormNodes: AppGraphNode[],
  databaseNodes: AppGraphNode[],
): void {
  for (const orm of ormNodes) {
    for (const database of databaseNodes) {
      const detection = context.dataSchemas.find((candidate) => candidate.provider);
      addOrmEdge(accumulator, orm, database, detection?.provider?.range, detection?.analyzerId, detection?.provider?.raw);
    }
  }
}

function addOrmEdge(
  accumulator: EdgeAccumulator,
  orm: AppGraphNode,
  database: AppGraphNode,
  range: { path: string; startLine: number } | undefined,
  analyzerId: string | undefined,
  provider: string | undefined,
): void {
  accumulator.addEdge(
    orm.id,
    database.id,
    "uses",
    provider ? 0.9 : 0.6,
    evidenceMetadata(
      { label: orm.label },
      range,
      analyzerId ?? "orm-mapping",
      provider ? "prisma.datasource-provider" : "orm.default-database",
      provider ? "exact" : "inferred",
      provider
        ? `provider "${provider}" declared in ${range?.path ?? "schema"}`
        : "no schema provider found; database inferred from ORM usage",
    ),
  );
}

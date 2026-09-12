import type { AppGraphNode } from "@/lib/graph/model";
import { classifyDatabaseOperation } from "../integrations";
import type { DataModelFact, DataSchemaDetection } from "../data/registry";
import type { RepositoryContext } from "../types";
import { evidenceMetadata } from "./evidence";
import type { EdgeAccumulator } from "./edge-accumulator";
import { fileNodeId, slug } from "./ids";

/** Data graph projection (Batch 3): models, enums, relations, code→model. */

export function dataModelId(format: string, name: string): string {
  return `data:${format}:${slug(name)}`;
}

export function dataEnumId(format: string, name: string): string {
  return `data-enum:${format}:${slug(name)}`;
}

export interface DataProjection {
  nodes: AppGraphNode[];
  detectionModels: Array<{ detection: DataSchemaDetection; model: DataModelFact }>;
  notes: string[];
}

const FORMAT_RULE: Record<string, string> = {
  prisma: "data.model-declaration",
  drizzle: "drizzle.table-declaration",
  sql: "sql.create-table",
};

export function projectDataGraph(context: RepositoryContext): DataProjection {
  const nodes: AppGraphNode[] = [];
  const detectionModels: DataProjection["detectionModels"] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const detection of context.dataSchemas) {
    for (const note of detection.notes ?? []) notes.push(note);

    for (const model of detection.models) {
      const id = dataModelId(detection.format, model.name);
      if (seen.has(id)) continue;
      seen.add(id);
      const relationCount = model.fields.filter((field) => field.kind === "relation").length;
      nodes.push({
        id,
        type: "data_model",
        label: model.name,
        subtitle: `${model.kind === "table" ? "Table" : "Model"} · ${model.fields.length} field(s)`,
        confidence: 0.95,
        granularity: "architecture",
        metadata: {
          group: "data",
          role: model.kind,
          format: detection.format,
          provider: detection.provider?.raw ?? null,
          schemaFile: model.range.path,
          mappedName: model.mappedName,
          primaryKey: model.primaryKey,
          uniqueConstraints: model.uniqueConstraints,
          indexes: model.indexes,
          indexDetails: model.indexDetails ?? [],
          fields: model.fields.slice(0, 60).map((field) => ({
            name: field.name,
            type: field.type,
            kind: field.kind,
            optional: field.optional,
            list: field.list,
            primaryKey: field.primaryKey,
            unique: field.unique,
            default: field.default,
            map: field.map,
            relation: field.relation
              ? {
                  target: field.relation.target,
                  cardinality: field.relation.cardinality,
                  optional: field.relation.optional,
                  ownerField: field.relation.ownerField,
                  name: field.relation.name,
                  self: field.relation.self ?? false,
                }
              : undefined,
            line: field.range.startLine,
          })),
          description: `${model.kind === "table" ? "Table" : "Model"} ${model.name} parsed from ${detection.format} schema (${model.fields.length} fields, ${relationCount} relation(s)).${
            detection.format === "sql"
              ? " SQL migrations are replayed best-effort; unsupported statements may be missing."
              : ""
          }`,
          imports: [],
          exports: [],
        },
        source: model.range,
      });
      detectionModels.push({ detection, model });
    }

    for (const enumFact of detection.enums) {
      const id = dataEnumId(detection.format, enumFact.name);
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push({
        id,
        type: "data_enum",
        label: enumFact.name,
        subtitle: `Enum · ${enumFact.values.length} value(s)`,
        confidence: 0.95,
        granularity: "architecture",
        metadata: {
          group: "data",
          role: "enum",
          format: detection.format,
          values: enumFact.values,
          schemaFile: enumFact.range.path,
          description: `Enum ${enumFact.name} (${enumFact.values.join(", ") || "no values"}) parsed from ${detection.format} schema.`,
          imports: [],
          exports: [],
        },
        source: enumFact.range,
      });
    }
  }

  return { nodes, detectionModels, notes };
}

export function addDataEdges(
  accumulator: EdgeAccumulator,
  context: RepositoryContext,
  projection: DataProjection,
  providerDatabaseId?: string,
): void {
  for (const { detection, model } of projection.detectionModels) {
    const modelId = dataModelId(detection.format, model.name);

    if (providerDatabaseId) {
      accumulator.addEdge(
        providerDatabaseId,
        modelId,
        "contains",
        0.95,
        evidenceMetadata(
          undefined,
          model.range,
          detection.analyzerId,
          FORMAT_RULE[detection.format] ?? "data.model-declaration",
          "exact",
          `${model.name} declared in ${model.range.path}`,
        ),
      );
    }

    for (const field of model.fields) {
      if (field.kind === "relation" && field.relation) {
        const target = detection.models.find(
          (candidate) => candidate.name.toLowerCase() === field.relation!.target.toLowerCase(),
        );
        if (!target) continue;
        accumulator.addEdge(
          modelId,
          dataModelId(detection.format, target.name),
          "references",
          0.95,
          evidenceMetadata(
            {
              cardinality: field.relation.cardinality,
              field: field.name,
              optional: field.relation.optional,
              ownerField: field.relation.ownerField,
              relationName: field.relation.name,
              self: field.relation.self ?? false,
            },
            field.relation.range ?? field.range,
            detection.analyzerId,
            "data.relation-field",
            "exact",
            `${model.name}.${field.name} -> ${target.name} (${field.relation.cardinality}${
              field.relation.name ? `, "${field.relation.name}"` : ""
            })`,
          ),
          // Distinct relations between the same pair must never collapse.
          field.name,
        );
      } else if (field.kind === "enum") {
        const enumName = field.type.replace(/[?[\]]/g, "");
        const enumNodeId = dataEnumId(detection.format, enumName);
        accumulator.addEdge(
          modelId,
          enumNodeId,
          "references",
          0.9,
          evidenceMetadata(
            { field: field.name, kind: "enum" },
            field.range,
            detection.analyzerId,
            "data.enum-reference",
            "exact",
            `${model.name}.${field.name}: ${enumName}`,
          ),
          `enum:${field.name}`,
        );
      }
    }
  }

  // Code → data model usage: Prisma model calls and Drizzle `.from(table)`.
  // Only model/method names that match parsed schema facts produce edges.
  for (const [fromPath, file] of context.parsed) {
    const sourceId = fileNodeId(fromPath);
    for (const call of file.calls) {
      const prismaMatch = call.name.match(/^(?:prisma|db|tx)\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
      if (prismaMatch) {
        const modelKey = prismaMatch[1].toLowerCase();
        const entry = projection.detectionModels.find(
          ({ detection, model }) =>
            detection.format === "prisma" && model.name.toLowerCase() === modelKey,
        );
        if (entry) {
          const operation = classifyDatabaseOperation(prismaMatch[2]);
          if (operation === "read" || operation === "write") {
            accumulator.addEdge(
              sourceId,
              dataModelId("prisma", entry.model.name),
              operation === "read" ? "reads" : "writes",
              0.85,
              evidenceMetadata(
                { via: call.name },
                call.range,
                file.parserId,
                "prisma.model-access",
                "resolved",
                `call ${call.name} targets model ${entry.model.name}`,
              ),
            );
          }
        }
        continue;
      }

      if (call.name.endsWith(".from") && call.argumentIdentifiers?.length) {
        for (const identifier of call.argumentIdentifiers) {
          const entry = projection.detectionModels.find(
            ({ detection, model }) =>
              detection.format === "drizzle" &&
              (model.mappedName ?? model.name).toLowerCase() === identifier.toLowerCase(),
          );
          if (entry) {
            accumulator.addEdge(
              sourceId,
              dataModelId("drizzle", entry.model.name),
              "reads",
              0.8,
              evidenceMetadata(
                { via: call.name },
                call.range,
                file.parserId,
                "drizzle.table-read",
                "resolved",
                `${call.name}(${identifier}) matches table ${entry.model.name}`,
              ),
            );
          }
        }
      }
    }
  }
}

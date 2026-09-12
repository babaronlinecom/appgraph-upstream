import type { AppGraphEdgeMetadata } from "@/lib/graph/model";
import { findIntegrationForSpecifier } from "../integrations";
import type { RepositoryContext } from "../types";
import { evidenceMetadata, MAX_EVIDENCE_PER_EDGE } from "./evidence";
import type { EdgeAccumulator } from "./edge-accumulator";
import { integrationNodeId } from "./integration-graph";
import { aggregateOperations, localUsage } from "./usage";
import { fileNodeId } from "./ids";

/**
 * Generic file-level edge projection: imports, renders, calls, reads/writes,
 * external integration usage and environment reads. Every edge here is backed
 * by a parsed import/call/JSX fact with an exact source line.
 */
export function addImportGraphEdges(
  accumulator: EdgeAccumulator,
  context: RepositoryContext,
  options: { configNodeId: string | null; envVarsByFile: Map<string, string[]> },
): void {
  for (const [fromPath, parsed] of context.parsed) {
    const sourceId = fileNodeId(fromPath);
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
        if (!targetFile) continue;

        if (entry.typeOnly) {
          accumulator.addEdge(
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
            accumulator.addEdge(
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
            accumulator.addEdge(
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
            accumulator.addEdge(
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
            accumulator.addEdge(
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
            accumulator.addEdge(
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
            accumulator.addEdge(
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
            accumulator.addEdge(
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
            accumulator.addEdge(
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

        accumulator.addEdge(
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
      if (!integration) continue;
      const targetId = integrationNodeId({
        definition: integration.definition,
        packageName: integration.packageName,
        files: [],
        confidence: 1,
      });
      const aggregate = aggregateOperations(usage.calls);
      const kind = integration.definition.kind;

      if (kind === "database") {
        if (aggregate.hasRead && aggregate.readCall) {
          accumulator.addEdge(
            sourceId,
            targetId,
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
          accumulator.addEdge(
            sourceId,
            targetId,
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
          accumulator.addEdge(
            sourceId,
            targetId,
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
        continue;
      }

      accumulator.addEdge(
        sourceId,
        targetId,
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

    // Environment variable usage
    const envVars = options.envVarsByFile.get(fromPath);
    if (envVars && options.configNodeId) {
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
      accumulator.addEdge(sourceId, options.configNodeId, "uses", 0.9, metadata);
    }
  }
}

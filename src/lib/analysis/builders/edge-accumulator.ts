import type { AppGraphEdge, AppGraphEdgeMetadata, GraphEdgeType } from "@/lib/graph/model";
import { mergeEdgeMetadata } from "./evidence";

/**
 * Edge sink used by all graph projections. It enforces the same invariants as
 * before: endpoints must exist, self-loops are only allowed for relation types
 * that legitimately reference themselves (e.g. Prisma self-relations), and
 * duplicate edges merge metadata/evidence instead of duplicating.
 */
export interface EdgeAccumulator {
  addEdge(
    source: string,
    target: string,
    type: GraphEdgeType,
    confidence: number,
    metadata?: AppGraphEdgeMetadata,
    identitySuffix?: string,
  ): void;
  edges(): AppGraphEdge[];
}

export function createEdgeAccumulator(
  hasNode: (id: string) => boolean,
  selfLoopTypes: Set<GraphEdgeType> = new Set<GraphEdgeType>(["references"]),
): EdgeAccumulator {
  const edgeMap = new Map<string, AppGraphEdge>();

  return {
    addEdge(source, target, type, confidence, metadata, identitySuffix) {
      if (!hasNode(source) || !hasNode(target)) return;
      if (source === target && !selfLoopTypes.has(type)) return;
      const id = `${source}->${target}:${type}${identitySuffix ? `:${identitySuffix}` : ""}`;
      const existing = edgeMap.get(id);
      if (existing) {
        existing.confidence = Math.max(existing.confidence, confidence);
        if (metadata) existing.metadata = mergeEdgeMetadata(existing.metadata, metadata);
        return;
      }
      edgeMap.set(id, { id, source, target, type, confidence, metadata });
    },
    edges() {
      return [...edgeMap.values()];
    },
  };
}

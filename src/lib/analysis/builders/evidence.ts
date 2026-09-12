import type { AppGraphEdgeMetadata, EdgeEvidence, EdgeEvidenceKind } from "@/lib/graph/model";
import type { IrSourceRange } from "../ir/model";

export const MAX_EVIDENCE_PER_EDGE = 6;

export function evidenceFrom(
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

export function evidenceMetadata(
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

export function mergeEdgeMetadata(
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

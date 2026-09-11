import { classifyFile } from "./file-classifier";
import type { RepositorySignals } from "./types";
import {
  hasSourceExtension,
  isIgnoredDirectory,
  isIgnoredFile,
  isMetadataFile,
  type AnalysisLimits,
} from "@/lib/github/limits";

export interface SourceCandidate {
  path: string;
  size: number;
}

export interface FileSelection {
  metadataFiles: string[];
  sourceFiles: SourceCandidate[];
  skipped: Array<{ path: string; reason: string }>;
  totalSourceCount: number;
  totalSourceBytes: number;
}

const ENTRY_FILE_PATTERN = /^(src\/)?(index|main|server|app|www)\.[cm]?[jt]s$/i;

export function collectSourceCandidates(paths: Array<{ path: string; size?: number }>): SourceCandidate[] {
  const candidates: SourceCandidate[] = [];
  for (const entry of paths) {
    if (!hasSourceExtension(entry.path)) continue;
    if (isIgnoredFile(entry.path)) continue;
    const segments = entry.path.split("/");
    if (segments.some((segment) => isIgnoredDirectory(segment))) continue;
    // Ignore files inside ignored directories except the root-level check above.
    candidates.push({ path: entry.path, size: entry.size ?? 0 });
  }
  return candidates;
}

export function collectMetadataCandidates(paths: string[]): string[] {
  const candidates: string[] = [];
  for (const path of paths) {
    if (isMetadataFile(path)) {
      candidates.push(path);
      continue;
    }
    if (/^(apps|packages)\/[^/]+\/package\.json$/i.test(path)) {
      candidates.push(path);
      continue;
    }
    // SQL schema/migration files feed the deterministic DDL analyzer.
    if (/\.sql$/i.test(path) && !/\.generated\.sql$/i.test(path)) {
      candidates.push(path);
    }
  }
  return [...new Set(candidates)].slice(0, 40);
}

export function priorityScore(path: string, signals: RepositorySignals): number {
  const classified = classifyFile(path, signals);
  const depth = path.split("/").length;
  let score: number;
  switch (classified.category) {
    case "page":
      score = 120;
      break;
    case "api":
      score = 115;
      break;
    case "middleware":
      score = 110;
      break;
    case "database":
    case "schema":
      score = 105;
      break;
    case "service":
      score = 100;
      break;
    case "state":
      score = 80;
      break;
    case "hook":
      score = 70;
      break;
    case "component":
      score = 65;
      break;
    case "config":
      score = 50;
      break;
    case "utility":
      score = 35;
      break;
    default:
      score = 20;
  }
  if (ENTRY_FILE_PATTERN.test(path)) score += 15;
  // Prefer shallower files: they are usually more architectural.
  score -= Math.min(depth, 10) * 1.5;
  return score;
}

/**
 * Chooses which files to download within strict byte/count budgets.
 * Larger repositories degrade to a partial graph rather than failing.
 */
export function selectFiles(
  allPaths: Array<{ path: string; size?: number }>,
  signals: RepositorySignals,
  limits: AnalysisLimits,
): FileSelection {
  const metadataFiles = collectMetadataCandidates(allPaths.map((entry) => entry.path));
  const sourceCandidates = collectSourceCandidates(allPaths);
  const totalSourceCount = sourceCandidates.length;

  const skipped: FileSelection["skipped"] = [];
  const eligible: SourceCandidate[] = [];
  for (const candidate of sourceCandidates) {
    if (candidate.size > limits.maxFileBytes) {
      skipped.push({ path: candidate.path, reason: "file exceeds size limit" });
      continue;
    }
    eligible.push(candidate);
  }

  eligible.sort((a, b) => {
    const scoreDelta = priorityScore(b.path, signals) - priorityScore(a.path, signals);
    if (scoreDelta !== 0) return scoreDelta;
    return a.path.localeCompare(b.path);
  });

  const selected: SourceCandidate[] = [];
  let totalBytes = 0;
  for (const candidate of eligible) {
    if (selected.length >= limits.maxAnalyzedFiles) {
      skipped.push({ path: candidate.path, reason: "file budget reached" });
      continue;
    }
    if (candidate.size > 0 && totalBytes + candidate.size > limits.maxTotalSourceBytes) {
      skipped.push({ path: candidate.path, reason: "source byte budget reached" });
      continue;
    }
    selected.push(candidate);
    totalBytes += candidate.size;
  }

  return {
    metadataFiles,
    sourceFiles: selected,
    skipped,
    totalSourceCount,
    totalSourceBytes: totalBytes,
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  options: { signal?: AbortSignal } = {},
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      // Stop pulling new work as soon as the analysis is aborted (timeout/cancel).
      if (options.signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

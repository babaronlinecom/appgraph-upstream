import { readCache, writeCache } from "@/lib/cache/cache";
import type { RepositoryProvider } from "@/lib/github/provider";
import { AppGraphError, isAbortError } from "@/lib/github/errors";
import { loadLimits, type AnalysisLimits } from "@/lib/github/limits";
import { repositoryKey } from "@/lib/github/url";
import {
  GRAPH_SCHEMA_VERSION,
  type AppGraphDocument,
  type RepositoryMetadata,
} from "@/lib/graph/model";
import { computeLayouts } from "@/lib/graph/layout/elk-layout";
import { buildCapabilities } from "./capabilities";
import { classifyFile } from "./file-classifier";
import { detectRepositorySignals, parsePackageJson } from "./frameworks/registry";
import { buildGraph } from "./graph-builder";
import { findIntegrationForSpecifier } from "./integrations";
import { detectLanguage } from "./languages";
import { parserRegistry } from "./parsers/registry";
import { analyzerRegistries } from "./registries";
import { ImportResolver, parseTsConfigAliases, type PathAliasConfig } from "./resolvers/import-resolver";
import { collectMetadataCandidates, mapWithConcurrency, selectFiles } from "./selection";
import type {
  AnalysisWarningDraft,
  ClassifiedFile,
  DetectedIntegration,
  ParsedFile,
  RepositoryContext,
} from "./types";

export type AnalysisStepStatus = "pending" | "active" | "done" | "error";

export interface AnalysisStep {
  id: string;
  label: string;
  status: AnalysisStepStatus;
  detail?: string;
}

export interface AnalyzeOptions {
  provider: RepositoryProvider;
  input: string;
  limits?: Partial<AnalysisLimits>;
  signal?: AbortSignal;
  expectedSha?: string;
  onProgress?: (steps: AnalysisStep[]) => void;
  onMetadata?: (metadata: RepositoryMetadata) => void;
}

export const ANALYSIS_STEP_DEFINITIONS: Array<{ id: string; label: string }> = [
  { id: "resolve", label: "Repository resolved" },
  { id: "index", label: "Files indexed" },
  { id: "select", label: "Source files selected" },
  { id: "fetch", label: "Source files downloaded" },
  { id: "parse", label: "Source parsed" },
  { id: "resolve-imports", label: "Import graph resolved" },
  { id: "graph", label: "Architecture graph built" },
  { id: "layout", label: "Layout computed" },
];

function createStepTracker(onProgress?: (steps: AnalysisStep[]) => void) {
  const steps: AnalysisStep[] = ANALYSIS_STEP_DEFINITIONS.map((definition) => ({
    ...definition,
    status: "pending",
  }));

  const emit = () => onProgress?.(steps.map((step) => ({ ...step })));

  return {
    steps,
    start(id: string) {
      const step = steps.find((candidate) => candidate.id === id);
      if (step) {
        step.status = "active";
        emit();
      }
    },
    done(id: string, detail?: string) {
      const step = steps.find((candidate) => candidate.id === id);
      if (step) {
        step.status = "done";
        if (detail) step.detail = detail;
        emit();
      }
    },
    fail(id: string, detail?: string) {
      const step = steps.find((candidate) => candidate.id === id);
      if (step) {
        step.status = "error";
        if (detail) step.detail = detail;
        emit();
      }
    },
  };
}

function analysisVersion(): string {
  return process.env.APPGRAPH_ANALYSIS_VERSION?.trim() || "0.2.0";
}

export function graphCacheKey(ownerRepo: string, commitSha: string): string {
  return `github:${ownerRepo}:${commitSha}:${analysisVersion()}`;
}

function parseDotEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

function workspaceAliases(files: Map<string, string>): Map<string, string> {
  const packages = new Map<string, string>();
  for (const [path, content] of files) {
    const match = path.match(/^(packages|apps)\/([^/]+)\/package\.json$/);
    if (!match) continue;
    try {
      const parsed = JSON.parse(content) as { name?: string };
      if (parsed.name) {
        packages.set(parsed.name, `${match[1]}/${match[2]}`);
      }
    } catch {
      // ignore malformed workspace package.json
    }
  }
  return packages;
}

function combineSignals(signal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!signal) return timeoutSignal;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted || timeoutSignal.aborted) controller.abort();
  else {
    signal.addEventListener("abort", abort, { once: true });
    timeoutSignal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

/**
 * Full deterministic analysis pipeline:
 * resolve -> tree -> select -> fetch -> parse -> resolve -> graph -> layout.
 * No repository code is ever executed, installed or written to disk.
 */
export async function analyzeRepository(options: AnalyzeOptions): Promise<AppGraphDocument> {
  const provider = options.provider;
  const limits = loadLimits(options.limits);
  const tracker = createStepTracker(options.onProgress);
  const startedAt = Date.now();

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), limits.analysisTimeoutMs);
  const signal = combineSignals(options.signal, timeoutController.signal);

  const ensureNotAborted = () => {
    if (signal.aborted) {
      throw new AppGraphError("TIMEOUT", "Analysis exceeded the time limit or was cancelled.", {
        retryable: true,
      });
    }
  };

  try {
    tracker.start("resolve");
    const identity = await provider.resolveRepository(options.input);
    const metadata = await provider.getMetadata(identity);
    options.onMetadata?.(metadata);
    ensureNotAborted();

    const commitSha = provider.getCommitSha
      ? await provider.getCommitSha(identity, metadata.defaultBranch)
      : "";
    const cacheRef = commitSha || `branch:${metadata.defaultBranch}`;
    const ownerRepo = repositoryKey(identity);
    const cacheKey = graphCacheKey(ownerRepo, cacheRef);

    const cached = await readCache<AppGraphDocument>("graphs", cacheKey);
    if (cached) {
      for (const definition of ANALYSIS_STEP_DEFINITIONS) tracker.done(definition.id);
      cached.stats = { ...cached.stats, cacheHit: true };
      tracker.done("resolve", `${ownerRepo}@${cacheRef.slice(0, 7)} · cached`);
      return cached;
    }

    tracker.done("resolve", `${ownerRepo}@${(commitSha || metadata.defaultBranch).slice(0, 7)}`);

    tracker.start("index");
    const tree = await provider.getTree(identity, cacheRef, signal);
    ensureNotAborted();
    const warnings: AnalysisWarningDraft[] = [];
    if (tree.truncated) {
      warnings.push({
        code: "TREE_TRUNCATED",
        severity: "warning",
        message: "GitHub truncated this repository tree. The graph is based on the first portion of the file list.",
      });
    }
    if (metadata.archived) {
      warnings.push({
        code: "REPO_ARCHIVED",
        severity: "info",
        message: "This repository is archived. Analysis still reflects its latest commit.",
      });
    }
    if (metadata.sizeKb > 1_500_000) {
      warnings.push({
        code: "REPO_LARGE",
        severity: "warning",
        message: "This is a large repository. AppGraph analyzed a bounded subset of source files.",
      });
    }
    tracker.done("index", `${tree.entries.length} files indexed`);

    // --- Metadata files first (package.json, tsconfig, ...) ---
    const allPaths = tree.entries.map((entry) => ({
      path: entry.path,
      size: entry.size ?? 0,
    }));
    const metadataPaths = collectMetadataCandidates(allPaths.map((entry) => entry.path));
    const fetched = new Map<string, string>();
    const metadataResults = await mapWithConcurrency(
      metadataPaths,
      4,
      async (path) => {
        const file = await provider.getFile(identity, path, tree.ref, signal);
        return { path, content: file.content, size: file.size };
      },
      { signal },
    );
    let metadataFailures = 0;
    metadataResults.forEach((result, index) => {
      if (result.ok) {
        if (result.value.size <= limits.maxFileBytes) {
          fetched.set(result.value.path, result.value.content);
        }
      } else if (!isAbortError(result.error)) {
        metadataFailures += 1;
      }
    });
    if (metadataFailures > 0) {
      warnings.push({
        code: "METADATA_FETCH_FAILED",
        severity: "warning",
        message: `${metadataFailures} configuration file(s) could not be downloaded. Framework detection may be less precise.`,
      });
    }
    ensureNotAborted();

    const packageJson = parsePackageJson(fetched.get("package.json"));
    const signals = detectRepositorySignals({
      paths: allPaths.map((entry) => entry.path),
      packageJson,
    });

    // --- Source selection ---
    tracker.start("select");
    const selection = selectFiles(allPaths, signals, limits);
    if (selection.skipped.length > 0) {
      const budgetSkips = selection.skipped.filter((entry) => entry.reason.includes("budget")).length;
      if (budgetSkips > 0) {
        warnings.push({
          code: "SOURCE_BUDGET",
          severity: "warning",
          message: `${budgetSkips} source file(s) were skipped to stay within analysis limits. The graph shows the most architectural files first.`,
        });
      }
      const sizeSkips = selection.skipped.length - budgetSkips;
      if (sizeSkips > 0) {
        warnings.push({
          code: "SOURCE_SIZE_SKIPPED",
          severity: "info",
          message: `${sizeSkips} large or generated file(s) were not analyzed.`,
        });
      }
    }
    if (selection.totalSourceCount === 0) {
      throw new AppGraphError(
        "UNSUPPORTED_REPO",
        "No TypeScript or JavaScript source files were found. AppGraph currently supports TS/JS repositories.",
        { status: 422 },
      );
    }
    tracker.done("select", `${selection.sourceFiles.length} of ${selection.totalSourceCount} source files`);

    // --- Fetch source files ---
    tracker.start("fetch");
    const sourceResults = await mapWithConcurrency(
      selection.sourceFiles,
      limits.fetchConcurrency,
      async (candidate) => {
        const file = await provider.getFile(identity, candidate.path, tree.ref, signal);
        return { path: candidate.path, content: file.content, size: file.size };
      },
      { signal },
    );
    let fetchFailures = 0;
    sourceResults.forEach((result) => {
      if (result.ok) {
        if (Buffer.byteLength(result.value.content, "utf8") <= limits.maxFileBytes) {
          fetched.set(result.value.path, result.value.content);
        }
      } else if (!isAbortError(result.error)) {
        fetchFailures += 1;
      }
    });
    if (fetchFailures > 0) {
      warnings.push({
        code: "SOURCE_FETCH_PARTIAL",
        severity: "warning",
        message: `${fetchFailures} source file(s) could not be downloaded. The graph is based on the remaining files.`,
      });
    }
    ensureNotAborted();
    tracker.done("fetch", `${fetched.size} files downloaded`);

    // --- Classify + parse ---
    tracker.start("parse");
    const classified = new Map<string, ClassifiedFile>();
    const parsed = new Map<string, ParsedFile>();
    const parsedLanguages = new Set<string>();
    const parserIds = new Set<string>();
    let unsupportedFiles = 0;
    const parserFailures: Array<{ path: string; message: string }> = [];

    for (const [path, content] of fetched) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(path)) continue;
      const meta = tree.entries.find((entry) => entry.path === path);
      classified.set(path, classifyFile(path, signals, { size: meta?.size }));
    }

    for (const path of classified.keys()) {
      ensureNotAborted();
      const content = fetched.get(path);
      if (content === undefined) continue;
      if (Buffer.byteLength(content, "utf8") > limits.maxFileBytes) continue;
      // Parser resolution is language-agnostic: the pipeline only knows the
      // registry contract, never a specific parser.
      const parser = parserRegistry.getForPath(path);
      if (!parser) {
        unsupportedFiles += 1;
        continue;
      }
      const language = detectLanguage(path) ?? parser.capabilities.languages[0];
      if (!language) {
        unsupportedFiles += 1;
        continue;
      }
      const extension = `.${path.split(".").pop()?.toLowerCase() ?? ""}`;
      try {
        const result = parser.parse({ path, content, language, extension });
        parsed.set(path, result.file);
        parserIds.add(parser.id);
        parsedLanguages.add(language);
        for (const diagnostic of result.diagnostics) {
          warnings.push({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
            detail: diagnostic.path,
          });
        }
      } catch (error) {
        parserFailures.push({
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (unsupportedFiles > 0) {
      warnings.push({
        code: "LANGUAGE_UNSUPPORTED",
        severity: "info",
        message: `${unsupportedFiles} source file(s) use a language without a registered parser and were skipped.`,
      });
    }
    if (parserFailures.length > 0) {
      warnings.push({
        code: "PARSER_FAILED",
        severity: "warning",
        message: `${parserFailures.length} file(s) could not be parsed and are excluded from the graph.`,
        detail: parserFailures
          .slice(0, 3)
          .map((failure) => `${failure.path}: ${failure.message}`)
          .join("; "),
      });
    }
    tracker.done("parse", `${parsed.size} files parsed`);

    // --- Import resolution ---
    tracker.start("resolve-imports");
    const tsconfigContent = fetched.get("tsconfig.json") ?? fetched.get("jsconfig.json");
    let aliases: PathAliasConfig = { baseUrl: null, paths: {} };
    if (tsconfigContent) {
      aliases = parseTsConfigAliases(tsconfigContent, fetched.has("jsconfig.json") ? "jsconfig.json" : "tsconfig.json");
    }
    const resolver = new ImportResolver({ files: fetched, aliases, workspacePackages: workspaceAliases(fetched) });
    const resolvedImports = new Map<string, Map<string, string | null>>();
    for (const [path, file] of parsed) {
      const perFile = new Map<string, string | null>();
      for (const entry of file.imports) {
        if (perFile.has(entry.specifier)) continue;
        perFile.set(entry.specifier, resolver.resolve(path, entry.specifier));
      }
      resolvedImports.set(path, perFile);
    }

    // --- Integrations ---
    const integrationMap = new Map<string, DetectedIntegration>();
    for (const [path, file] of parsed) {
      const seenInFile = new Set<string>();
      for (const entry of file.imports) {
        const match = findIntegrationForSpecifier(entry.specifier);
        if (!match || seenInFile.has(match.definition.id)) continue;
        seenInFile.add(match.definition.id);
        const existing = integrationMap.get(match.definition.id);
        if (existing) {
          if (!existing.files.includes(path)) existing.files.push(path);
        } else {
          integrationMap.set(match.definition.id, {
            definition: match.definition,
            packageName: match.packageName,
            files: [path],
            confidence: 0.95,
          });
        }
      }
    }
    const integrations = [...integrationMap.values()];

    // --- Environment variable names from .env examples ---
    const envExampleVars = [
      ...new Set([
        ...parseDotEnvKeys(fetched.get(".env.example") ?? ""),
        ...parseDotEnvKeys(fetched.get(".env.sample") ?? ""),
        ...parseDotEnvKeys(fetched.get(".env.template") ?? ""),
      ]),
    ];
    tracker.done("resolve-imports", `${resolvedImports.size} modules · ${integrations.length} integrations`);

    // --- Data schema detection (Prisma/… adapters) ---
    const dataSchemas = analyzerRegistries.dataSchemas.analyze({
      files: fetched,
      paths: [...fetched.keys()],
    });

    // --- Graph ---
    tracker.start("graph");
    const hasHttpSurface =
      [...classified.values()].some((file) => file.category === "api") ||
      [...parsed.values()].some((file) => file.fetchPaths.length > 0);

    const context: RepositoryContext = {
      metadata,
      commitSha: commitSha || tree.sha,
      ref: tree.ref,
      tree,
      signals,
      limits: {
        maxAnalyzedFiles: limits.maxAnalyzedFiles,
        maxFileBytes: limits.maxFileBytes,
        maxSnippetLines: limits.maxSnippetLines,
        maxGraphNodes: limits.maxGraphNodes,
        maxGraphEdges: limits.maxGraphEdges,
        maxComponents: limits.maxComponents,
        maxExternalNodes: limits.maxExternalNodes,
      },
      files: fetched,
      classified,
      parsed,
      resolvedImports,
      integrations,
      dataSchemas,
      envVars: new Map(),
      envExampleVars,
      warnings,
      timings: {},
    };

    const built = await buildGraph(context);
    ensureNotAborted();
    tracker.done(
      "graph",
      `${built.stats.entities} entities · ${built.stats.relationships} relationships`,
    );

    // --- Layout ---
    tracker.start("layout");
    const layouts = await computeLayouts(built.nodes, built.edges);
    tracker.done("layout");

    if (options.expectedSha && commitSha && options.expectedSha !== commitSha) {
      warnings.push({
        code: "SHARED_SHA_MISMATCH",
        severity: "info",
        message: "The shared link pointed to an older commit. Showing the latest analyzed commit instead.",
      });
    }

    const document: AppGraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      analysisVersion: analysisVersion(),
      repository: metadata,
      commitSha: commitSha || tree.sha,
      ref: tree.ref,
      nodes: built.nodes,
      edges: built.edges,
      warnings: built.warnings,
      capabilities: buildCapabilities({
        languages: parsedLanguages,
        parserIds,
        signals,
        dataSchemas,
        hasHttpSurface,
      }),
      stats: {
        treeEntries: tree.entries.length,
        sourceFiles: selection.totalSourceCount,
        analyzedFiles: parsed.size,
        truncated: tree.truncated,
        durationMs: Date.now() - startedAt,
        cacheHit: false,
        ...built.stats,
      },
      layouts,
      generatedAt: new Date().toISOString(),
    };

    await writeCache("graphs", cacheKey, document);
    return document;
  } catch (error) {
    const activeStep = tracker.steps.find((step) => step.status === "active");
    if (activeStep) tracker.fail(activeStep.id);
    if (error instanceof AppGraphError) throw error;
    if (isAbortError(error)) {
      throw new AppGraphError("TIMEOUT", "Analysis was cancelled.", { retryable: true });
    }
    throw new AppGraphError("INTERNAL", error instanceof Error ? error.message : "Analysis failed.", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

import { randomUUID } from "node:crypto";
import { FixtureRepositoryProvider } from "@/lib/github/fixture-provider";
import { getGitHubProvider } from "@/lib/github/github-public-provider";
import type { RepositoryProvider } from "@/lib/github/provider";
import { AppGraphError, toUserFacingError, type UserFacingError } from "@/lib/github/errors";
import { loadLimits } from "@/lib/github/limits";
import { parseGitHubUrl } from "@/lib/github/url";
import type { AppGraphDocument, RepositoryMetadata } from "@/lib/graph/model";
import { ANALYSIS_STEP_DEFINITIONS, analyzeRepository, type AnalysisStep } from "./pipeline";

export type JobStatus = "queued" | "running" | "complete" | "error";

export interface AnalysisJobSnapshot {
  id: string;
  status: JobStatus;
  input: string;
  owner: string;
  repo: string;
  metadata?: RepositoryMetadata;
  steps: AnalysisStep[];
  graph?: AppGraphDocument;
  error?: UserFacingError;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  cacheHit: boolean;
}

interface AnalysisJob extends Omit<AnalysisJobSnapshot, "graph"> {
  graph?: AppGraphDocument;
  dedupeKey: string;
}

const jobs = new Map<string, AnalysisJob>();
const activeByKey = new Map<string, string>();
const MAX_JOBS = 120;

let runningCount = 0;
const pendingQueue: Array<() => void> = [];

function maxConcurrent(): number {
  const parsed = Number.parseInt(process.env.APPGRAPH_MAX_CONCURRENT_ANALYSES ?? "", 10);
  if (Number.isNaN(parsed)) return 3;
  return Math.min(Math.max(parsed, 1), 8);
}

function initialSteps(): AnalysisStep[] {
  return ANALYSIS_STEP_DEFINITIONS.map((definition) => ({ ...definition, status: "pending" }));
}

function pruneJobs(): void {
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((job) => job.status === "complete" || job.status === "error")
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt));
  while (jobs.size > MAX_JOBS && finished.length > 0) {
    const oldest = finished.shift();
    if (oldest) jobs.delete(oldest.id);
  }
}

async function acquireSlot(): Promise<void> {
  if (runningCount < maxConcurrent()) {
    runningCount += 1;
    return;
  }
  await new Promise<void>((resolve) => pendingQueue.push(resolve));
  runningCount += 1;
}

function releaseSlot(): void {
  runningCount = Math.max(0, runningCount - 1);
  const next = pendingQueue.shift();
  if (next) next();
}

function runJob(job: AnalysisJob, provider: RepositoryProvider, expectedSha?: string): void {
  queueMicrotask(async () => {
    await acquireSlot();
    const limits = loadLimits();
    const abortController = new AbortController();
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      if (job.status !== "running" && job.status !== "queued") return;
      watchdogFired = true;
      abortController.abort();
      job.error = toUserFacingError(
        new AppGraphError("TIMEOUT", "Analysis exceeded the time limit and was stopped.", {
          retryable: true,
        }),
      );
      job.status = "error";
      job.finishedAt = Date.now();
      activeByKey.delete(job.dedupeKey);
    }, limits.analysisTimeoutMs + 20_000);

    try {
      job.status = "running";
      job.startedAt = Date.now();
      const graph = await analyzeRepository({
        provider,
        input: job.input,
        expectedSha,
        signal: abortController.signal,
        onMetadata: (metadata) => {
          job.metadata = metadata;
        },
        onProgress: (steps) => {
          job.steps = steps;
        },
      });
      if (watchdogFired) return;
      job.graph = graph;
      job.metadata = graph.repository;
      job.status = "complete";
      job.cacheHit = graph.stats.cacheHit;
      job.finishedAt = Date.now();
    } catch (error) {
      if (!watchdogFired) {
        job.error = toUserFacingError(error);
        job.status = "error";
        job.finishedAt = Date.now();
      }
    } finally {
      clearTimeout(watchdog);
      activeByKey.delete(job.dedupeKey);
      releaseSlot();
      pruneJobs();
    }
  });
}

export interface CreateJobOptions {
  expectedSha?: string;
  provider?: RepositoryProvider;
}

/** Local fixtures are opt-in (tests/E2E); production always reads github.com. */
function defaultProvider(): RepositoryProvider {
  const fixtureDir = process.env.APPGRAPH_FIXTURE_DIR?.trim();
  if (fixtureDir) return new FixtureRepositoryProvider(fixtureDir);
  return getGitHubProvider();
}

export function createAnalysisJob(input: string, options: CreateJobOptions = {}): AnalysisJobSnapshot {
  const identity = parseGitHubUrl(input);
  const dedupeKey = `${identity.owner.toLowerCase()}/${identity.repo.toLowerCase()}`;
  const provider = options.provider ?? defaultProvider();

  const existingId = activeByKey.get(dedupeKey);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return toSnapshot(existing);
    }
    activeByKey.delete(dedupeKey);
  }

  const job: AnalysisJob = {
    id: randomUUID(),
    status: "queued",
    input,
    owner: identity.owner,
    repo: identity.repo,
    steps: initialSteps(),
    createdAt: Date.now(),
    cacheHit: false,
    dedupeKey,
  };

  jobs.set(job.id, job);
  activeByKey.set(dedupeKey, job.id);
  runJob(job, provider, options.expectedSha ?? identity.ref);
  pruneJobs();
  return toSnapshot(job);
}

export function getAnalysisJob(id: string): AnalysisJobSnapshot | undefined {
  const job = jobs.get(id);
  return job ? toSnapshot(job) : undefined;
}

export function getActiveJobsForRepository(owner: string, repo: string): AnalysisJobSnapshot[] {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  return [...jobs.values()].filter((job) => job.dedupeKey === key).map(toSnapshot);
}

function toSnapshot(job: AnalysisJob): AnalysisJobSnapshot {
  const snapshot: AnalysisJobSnapshot = {
    id: job.id,
    status: job.status,
    input: job.input,
    owner: job.owner,
    repo: job.repo,
    steps: job.steps.map((step) => ({ ...step })),
    metadata: job.metadata,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cacheHit: job.cacheHit,
  };
  if (job.status === "complete") snapshot.graph = job.graph;
  return snapshot;
}

export function assertJobId(id: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new AppGraphError("NOT_FOUND", "Analysis job not found.", { status: 404 });
  }
}

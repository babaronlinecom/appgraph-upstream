import { NextResponse } from "next/server";
import { assertJobId, getAnalysisJob } from "@/lib/analysis/jobs";
import { AppGraphError, toUserFacingError } from "@/lib/github/errors";
import { ANALYSIS_STEP_DEFINITIONS } from "@/lib/analysis/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertJobId(id);
    const job = getAnalysisJob(id);
    if (!job) {
      throw new AppGraphError("NOT_FOUND", "Analysis job not found. It may have expired.", { status: 404 });
    }

    const total = ANALYSIS_STEP_DEFINITIONS.length;
    const done = job.steps.filter((step) => step.status === "done").length;
    const percent = job.status === "complete" ? 100 : Math.round((done / total) * 100);

    return NextResponse.json(
      {
        id: job.id,
        status: job.status,
        owner: job.owner,
        repo: job.repo,
        metadata: job.metadata,
        steps: job.steps,
        progress: { done, total, percent },
        error: job.error,
        cacheHit: job.cacheHit,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        graph: job.status === "complete" ? job.graph : undefined,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const userError = toUserFacingError(error);
    const status = error instanceof AppGraphError ? error.status : 500;
    return NextResponse.json(
      { error: userError },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

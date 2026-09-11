import { NextResponse } from "next/server";
import { createAnalysisJob } from "@/lib/analysis/jobs";
import { AppGraphError, toUserFacingError } from "@/lib/github/errors";
import { checkRateLimit, clientIdentity } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;

function rateLimitPerWindow(): number {
  const parsed = Number.parseInt(process.env.APPGRAPH_ANALYZE_RATE_LIMIT ?? "", 10);
  return Number.isNaN(parsed) ? 12 : Math.min(Math.max(parsed, 1), 100);
}

export async function POST(request: Request) {
  try {
    const identity = clientIdentity(request);
    const limit = checkRateLimit(`analyze:${identity}`, rateLimitPerWindow(), 5 * 60 * 1000);
    if (!limit.allowed) {
      throw new AppGraphError(
        "RATE_LIMIT",
        "Too many analyses from this client. Please wait before starting another one.",
        { status: 429, retryable: true, retryAfterSeconds: limit.retryAfterSeconds },
      );
    }

    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      throw new AppGraphError("INVALID_URL", "Request body is too large.", { status: 413 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppGraphError("INVALID_URL", "Send a JSON body: { \"url\": \"https://github.com/owner/repo\" }.", {
        status: 400,
      });
    }

    const url =
      typeof body === "object" && body !== null && typeof (body as { url?: unknown }).url === "string"
        ? (body as { url: string }).url
        : "";
    if (!url) {
      throw new AppGraphError("INVALID_URL", "A repository URL is required.", { status: 400 });
    }

    const snapshot = createAnalysisJob(url);

    return NextResponse.json(
      {
        jobId: snapshot.id,
        status: snapshot.status,
        owner: snapshot.owner,
        repo: snapshot.repo,
        createdAt: snapshot.createdAt,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
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

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "appgraph",
    version: process.env.APPGRAPH_ANALYSIS_VERSION ?? "0.1.0",
    githubToken: Boolean(process.env.GITHUB_TOKEN),
    time: new Date().toISOString(),
  });
}

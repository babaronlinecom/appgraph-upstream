import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/services/project-service";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string };
  const project = await createProject(body.name ?? "Untitled");
  return NextResponse.json(project, { status: 201 });
}

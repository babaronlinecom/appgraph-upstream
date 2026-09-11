import { describe, expect, it } from "vitest";
import { parseSource } from "@/lib/analysis/parsers/ts-parser";

describe("parseSource (TypeScript AST)", () => {
  it("extracts imports, exports and route handlers", () => {
    const parsed = parseSource(
      "src/app/api/projects/route.ts",
      `
      import { NextResponse } from "next/server";
      import { prisma } from "@/lib/db";

      export async function GET() {
        return NextResponse.json(await prisma.project.findMany());
      }

      export async function POST(request: Request) {
        const body = await request.json();
        return NextResponse.json(await prisma.project.create({ data: body }));
      }
      `,
    );
    expect(parsed.imports.map((entry) => entry.specifier)).toEqual(["next/server", "@/lib/db"]);
    expect(parsed.routeHandlers.map((handler) => handler.method).sort()).toEqual(["GET", "POST"]);
    expect(parsed.calls.some((call) => call.name === "prisma.project.findMany")).toBe(true);
    expect(parsed.calls.some((call) => call.name === "prisma.project.create")).toBe(true);
  });

  it("detects React components and JSX usage", () => {
    const parsed = parseSource(
      "src/components/ProjectList.tsx",
      `
      import { useProjects } from "@/hooks/useProjects";
      import Badge from "./Badge";

      export default function ProjectList({ projects }: { projects: string[] }) {
        const { selected } = useProjects();
        return <ul>{projects.map((p) => <li key={p}><Badge label={p} /></li>)}</ul>;
      }
      `,
    );
    expect(parsed.components).toContain("ProjectList");
    expect(parsed.usesJsx).toBe(true);
    expect(parsed.jsxTags.map((tag) => tag.name)).toEqual(expect.arrayContaining(["Badge"]));
  });

  it("detects hooks and client directives", () => {
    const parsed = parseSource(
      "src/hooks/useProjects.ts",
      `
      "use client";
      import { useState } from "react";
      export function useProjects() {
        const [selected, setSelected] = useState(null);
        return { selected, setSelected };
      }
      `,
    );
    expect(parsed.hooks).toContain("useProjects");
    expect(parsed.directives.useClient).toBe(true);
  });

  it("collects environment variables and fetch paths without values", () => {
    const parsed = parseSource(
      "src/lib/stripe.ts",
      `
      import Stripe from "stripe";
      const client = new Stripe(process.env.STRIPE_SECRET_KEY);
      const { STRIPE_WEBHOOK_SECRET, DATABASE_URL } = process.env;
      export async function load() {
        return fetch("/api/projects");
      }
      `,
    );
    expect(parsed.envVars).toContain("STRIPE_WEBHOOK_SECRET");
    expect(parsed.envVars).toContain("DATABASE_URL");
    // Only names are collected — never values.
    expect(parsed.envVars).toContain("STRIPE_SECRET_KEY");
    expect(parsed.fetchPaths.map((entry) => entry.path)).toContain("/api/projects");
  });

  it("does not execute code and tolerates syntax errors", () => {
    const parsed = parseSource("src/broken.ts", "import { from \"broken\" ");
    expect(parsed.path).toBe("src/broken.ts");
  });
});

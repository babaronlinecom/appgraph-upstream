import { describe, expect, it } from "vitest";
import { parseSource } from "@/lib/analysis/parsers/ts-parser";
import { buildSymbolGraph } from "@/lib/analysis/resolvers/symbol-resolver";
import type { ParsedFile } from "@/lib/analysis/types";

function normalize(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function buildSymbols(files: Record<string, string>) {
  const parsed = new Map<string, ParsedFile>();
  for (const [path, content] of Object.entries(files)) {
    parsed.set(path, parseSource(path, content));
  }

  const resolvedImports = new Map<string, Map<string, string | null>>();
  for (const [path, file] of parsed) {
    const base = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const perFile = new Map<string, string | null>();
    for (const entry of file.imports) {
      let resolved: string | null = null;
      if (entry.specifier.startsWith(".")) {
        const target = normalize(`${base}/${entry.specifier}`);
        resolved =
          [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`].find((candidate) =>
            parsed.has(candidate),
          ) ?? null;
      }
      perFile.set(entry.specifier, resolved);
    }
    resolvedImports.set(path, perFile);
  }

  return buildSymbolGraph({ parsed, resolvedImports });
}

describe("buildSymbolGraph", () => {
  it("resolves a named import call to the exported function", () => {
    const { facts } = buildSymbols({
      "src/lib/projects.ts": `export function listProjects() { return []; }`,
      "src/app/api/route.ts": `
        import { listProjects } from "../../lib/projects";
        export function GET() { return listProjects(); }
      `,
    });

    const fact = facts.find((candidate) => candidate.target.name === "listProjects");
    expect(fact).toBeTruthy();
    expect(fact!.sourceSymbol).toBe("GET");
    expect(fact!.target.path).toBe("src/lib/projects.ts");
    expect(fact!.type).toBe("calls");
    expect(fact!.ruleId).toBe("symbol.resolved-call");
    expect(fact!.evidenceKind).toBe("exact");
    expect(fact!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(fact!.range.startLine).toBeGreaterThan(0);
  });

  it("resolves a default import rendered as JSX", () => {
    const { facts } = buildSymbols({
      "src/components/ProjectList.tsx": `export default function ProjectList() { return <ul />; }`,
      "src/app/page.tsx": `
        import ProjectList from "../components/ProjectList";
        export default function DashboardPage() { return <main><ProjectList /></main>; }
      `,
    });

    const fact = facts.find((candidate) => candidate.type === "renders");
    expect(fact).toBeTruthy();
    expect(fact!.sourceSymbol).toBe("DashboardPage");
    expect(fact!.target.path).toBe("src/components/ProjectList.tsx");
    expect(fact!.target.name).toBe("ProjectList");
    expect(fact!.ruleId).toBe("react.jsx-symbol-render");
  });

  it("resolves namespace member calls", () => {
    const { facts } = buildSymbols({
      "src/lib/service.ts": `export function createProject() {}`,
      "src/app/handler.ts": `
        import * as service from "../lib/service";
        export function handler() { service.createProject(); }
      `,
    });

    const fact = facts.find((candidate) => candidate.target.name === "createProject");
    expect(fact).toBeTruthy();
    expect(fact!.ruleId).toBe("symbol.namespace-member-call");
    expect(fact!.evidenceKind).toBe("resolved");
    expect(fact!.confidence).toBeLessThan(0.95);
  });

  it("follows barrel re-exports, including aliases", () => {
    const { facts } = buildSymbols({
      "src/lib/projects.ts": `export function listProjects() { return []; }`,
      "src/lib/index.ts": `export { listProjects as list } from "./projects";`,
      "src/app/use.ts": `
        import { list } from "../lib/index";
        export function useIt() { list(); }
      `,
    });

    const fact = facts.find((candidate) => candidate.sourceSymbol === "useIt");
    expect(fact).toBeTruthy();
    expect(fact!.target.path).toBe("src/lib/projects.ts");
    expect(fact!.target.name).toBe("listProjects");
  });

  it("follows export * chains", () => {
    const { facts } = buildSymbols({
      "src/lib/projects.ts": `export function listProjects() {}`,
      "src/lib/barrel.ts": `export * from "./projects";`,
      "src/app/use.ts": `
        import { listProjects } from "../lib/barrel";
        export function useIt() { listProjects(); }
      `,
    });

    const fact = facts.find((candidate) => candidate.sourceSymbol === "useIt");
    expect(fact?.target.path).toBe("src/lib/projects.ts");
  });

  it("resolves same-file calls to declared symbols", () => {
    const { facts } = buildSymbols({
      "src/lib/local.ts": `
        function helper() { return 1; }
        export function main() { return helper(); }
      `,
    });

    const fact = facts.find((candidate) => candidate.sourceSymbol === "main");
    expect(fact).toBeTruthy();
    expect(fact!.target.name).toBe("helper");
    expect(fact!.target.path).toBe("src/lib/local.ts");
    expect(fact!.ruleId).toBe("symbol.local-call");
    expect(fact!.evidenceKind).toBe("resolved");
  });

  it("never invents facts for unused imports or member calls on non-callable imports", () => {
    const { facts } = buildSymbols({
      "src/lib/projects.ts": `export function listProjects() {}`,
      "src/lib/unused.ts": `export function neverCalled() {}`,
      "src/lib/db.ts": `
        export const prisma = { project: { findMany: () => [] } };
      `,
      "src/app/page.tsx": `
        import { neverCalled } from "../lib/unused";
        import { prisma } from "../lib/db";
        export function Page() {
          prisma.project.findMany();
          return null;
        }
      `,
    });

    expect(facts.some((candidate) => candidate.target.name === "neverCalled")).toBe(false);
    // `prisma.project.findMany()` is a member call on an imported object, not a
    // call of an exported function — no symbol fact may be invented.
    expect(facts.some((candidate) => candidate.target.name === "findMany")).toBe(false);
    expect(facts.some((candidate) => candidate.target.name === "prisma")).toBe(false);
  });

  it("terminates on circular barrel re-exports without inventing a target", () => {
    const { facts, resolveExport } = buildSymbols({
      "src/a.ts": `export * from "./b";`,
      "src/b.ts": `export * from "./a";`,
      "src/use.ts": `
        import { ghost } from "./a";
        export function useIt() { void ghost; }
      `,
    });

    expect(facts).toEqual([]);
    expect(resolveExport("src/a.ts", "ghost")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { parseSource } from "@/lib/analysis/parsers/ts-parser";

const SOURCE = `
import { prisma } from "@/lib/db";
import type { User } from "./types";

export interface Props {
  title: string;
}

export type Status = "open" | "closed";

export enum Kind {
  A = "a",
  B = "b",
}

export const LIMIT = 10;

export class ProjectService {
  list() {
    return prisma.project.findMany();
  }
}

export function plainHelper(value: number) {
  return value * 2;
}

export function useProjects() {
  const [items] = useMemoLocal();
  return items;
}

export default function DashboardPage() {
  const key = process.env.API_URL;
  const { FLAG } = process.env;
  void key;
  void FLAG;
  return <Widget title="x" />;
}
`;

describe("normalized IR produced by the TypeScript parser", () => {
  const file = parseSource("src/app/dashboard/page.tsx", SOURCE);

  it("tags the file with language and parser id", () => {
    expect(file.parserId).toBe("typescript-ast");
    expect(file.language).toBe("typescript");
  });

  it("declares symbols with kinds and source ranges", () => {
    const byName = new Map(file.symbols.map((symbol) => [symbol.name, symbol]));

    const page = byName.get("DashboardPage");
    expect(page?.kind).toBe("component");
    expect(page?.exported).toBe(true);
    expect(page?.defaultExport).toBe(true);
    expect(page?.range.startLine).toBeGreaterThan(0);
    expect(page?.range.endLine ?? 0).toBeGreaterThanOrEqual(page?.range.startLine ?? 0);

    expect(byName.get("useProjects")?.kind).toBe("hook");
    expect(byName.get("plainHelper")?.kind).toBe("function");
    expect(byName.get("ProjectService")?.kind).toBe("class");
    expect(byName.get("list")?.kind).toBe("method");
    expect(byName.get("Props")?.kind).toBe("interface");
    expect(byName.get("Status")?.kind).toBe("type");
    expect(byName.get("Kind")?.kind).toBe("enum");
    expect(byName.get("LIMIT")?.kind).toBe("const");
  });

  it("records located environment reads and derives envVars", () => {
    expect(file.envReads.map((read) => read.name)).toEqual(expect.arrayContaining(["API_URL", "FLAG"]));
    for (const read of file.envReads) {
      expect(read.range.path).toBe("src/app/dashboard/page.tsx");
      expect(read.range.startLine).toBeGreaterThan(0);
    }
    expect(file.envVars).toEqual(["API_URL", "FLAG"]);
  });

  it("carries ranges on imports, calls, jsx tags and handlers", () => {
    const prismaImport = file.imports.find((entry) => entry.specifier === "@/lib/db");
    expect(prismaImport?.range.startLine).toBeGreaterThan(0);

    const call = file.calls.find((entry) => entry.name === "prisma.project.findMany");
    expect(call?.range.startLine).toBeGreaterThan(0);

    const jsx = file.jsxTags.find((tag) => tag.name === "Widget");
    expect(jsx?.range.startLine).toBeGreaterThan(0);

    expect(file.symbols.every((symbol) => symbol.range.path === "src/app/dashboard/page.tsx")).toBe(true);
  });

  it("marks type-only imports explicitly", () => {
    const typeImport = file.imports.find((entry) => entry.specifier === "./types");
    expect(typeImport?.typeOnly).toBe(true);
  });
});

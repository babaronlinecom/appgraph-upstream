import { describe, expect, it } from "vitest";
import { ParserRegistry, parserRegistry } from "@/lib/analysis/parsers/registry";
import type { LanguageParser } from "@/lib/analysis/parsers/contract";
import type { FileIR } from "@/lib/analysis/ir/model";

function emptyFile(path: string, language: string, parserId: string): FileIR {
  return {
    path,
    language,
    parserId,
    imports: [],
    reExports: [],
    exports: [],
    symbols: [],
    components: [],
    hooks: [],
    functions: [],
    classes: [],
    jsxTags: [],
    calls: [],
    routeHandlers: [],
    envReads: [],
    envVars: [],
    fetchPaths: [],
    directives: { useClient: false, useServer: false },
    usesJsx: false,
    lines: [],
  };
}

function fakeParser(id: string, extension: string, language: string): LanguageParser {
  return {
    id,
    version: "0.0.1",
    label: `${language} parser`,
    capabilities: {
      languages: [language],
      extensions: [extension],
      symbolKinds: ["function"],
      supportsCallGraph: true,
      supportsJsx: false,
      supportsTypeOnlyImports: false,
    },
    canParse: (input) => input.extension === extension,
    parse: (input) => ({ file: emptyFile(input.path, language, id), diagnostics: [] }),
  };
}

describe("ParserRegistry", () => {
  it("resolves a parser purely by file extension, independent of the pipeline", () => {
    const registry = new ParserRegistry();
    registry.register(fakeParser("python-ast", ".py", "python"));
    registry.register(fakeParser("go-ast", ".go", "go"));

    expect(registry.getForPath("services/api/main.py")?.id).toBe("python-ast");
    expect(registry.getForPath("cmd/server/main.go")?.id).toBe("go-ast");
    expect(registry.getForPath("README.md")).toBeNull();
    expect(registry.languages().sort()).toEqual(["go", "python"]);
  });

  it("exposes parser capability metadata", () => {
    const registry = new ParserRegistry();
    const parser = fakeParser("rust-ast", ".rs", "rust");
    registry.register(parser);

    const resolved = registry.getForPath("src/main.rs");
    expect(resolved?.capabilities.supportsCallGraph).toBe(true);
    expect(resolved?.capabilities.symbolKinds).toContain("function");
    expect(resolved?.version).toBe("0.0.1");
  });

  it("rejects duplicate parser ids", () => {
    const registry = new ParserRegistry();
    registry.register(fakeParser("dup", ".py", "python"));
    expect(() => registry.register(fakeParser("dup", ".py2", "python"))).toThrow(/already registered/);
  });

  it("registers the built-in TypeScript parser and reports unsupported languages as null", () => {
    expect(parserRegistry.getForPath("src/app/page.tsx")?.id).toBe("typescript-ast");
    expect(parserRegistry.getForPath("src/index.js")?.id).toBe("typescript-ast");
    expect(parserRegistry.getForPath("app/main.py")).toBeNull();
    expect(parserRegistry.languages()).toEqual(expect.arrayContaining(["typescript", "javascript"]));
  });

  it("supports lookup by parser id", () => {
    expect(parserRegistry.get("typescript-ast")?.label).toContain("TypeScript");
    expect(parserRegistry.get("missing-parser")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  ImportResolver,
  parseTsConfigAliases,
  type PathAliasConfig,
} from "@/lib/analysis/resolvers/import-resolver";

function resolverWith(
  entries: Record<string, string>,
  aliases: PathAliasConfig = { baseUrl: null, paths: {} },
) {
  return new ImportResolver({ files: new Map(Object.entries(entries)), aliases });
}

describe("ImportResolver", () => {
  it("resolves relative imports with extension inference", () => {
    const resolver = resolverWith({
      "src/app/page.tsx": "",
      "src/components/Button.tsx": "",
      "src/lib/utils.ts": "",
    });
    expect(resolver.resolve("src/app/page.tsx", "../components/Button")).toBe("src/components/Button.tsx");
    expect(resolver.resolve("src/app/page.tsx", "../lib/utils")).toBe("src/lib/utils.ts");
  });

  it("resolves index files", () => {
    const resolver = resolverWith({
      "src/app/page.tsx": "",
      "src/components/index.tsx": "",
    });
    expect(resolver.resolve("src/app/page.tsx", "../components")).toBe("src/components/index.tsx");
  });

  it("resolves ESM-style .js specifiers to TypeScript files", () => {
    const resolver = resolverWith({
      "src/app/page.tsx": "",
      "src/lib/helper.ts": "",
    });
    expect(resolver.resolve("src/app/page.tsx", "../lib/helper.js")).toBe("src/lib/helper.ts");
  });

  it("resolves tsconfig path aliases", () => {
    const aliases = parseTsConfigAliases(
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    const resolver = resolverWith(
      {
        "src/app/page.tsx": "",
        "src/components/ProjectList.tsx": "",
        "src/lib/db.ts": "",
      },
      aliases,
    );
    expect(resolver.resolve("src/app/page.tsx", "@/components/ProjectList")).toBe("src/components/ProjectList.tsx");
    expect(resolver.resolve("src/app/page.tsx", "@/lib/db")).toBe("src/lib/db.ts");
  });

  it("applies fallback @/ alias when tsconfig has no paths", () => {
    const resolver = resolverWith({
      "src/app/page.tsx": "",
      "src/lib/db.ts": "",
    });
    expect(resolver.resolve("src/app/page.tsx", "@/lib/db")).toBe("src/lib/db.ts");
  });

  it("resolves workspace packages", () => {
    const resolver = new ImportResolver({
      files: new Map([
        ["packages/ui/package.json", ""],
        ["packages/ui/src/index.ts", ""],
        ["packages/ui/src/Button.tsx", ""],
        ["apps/web/src/app/page.tsx", ""],
      ]),
      aliases: { baseUrl: null, paths: {} },
      workspacePackages: new Map([["@acme/ui", "packages/ui"]]),
    });
    expect(resolver.resolve("apps/web/src/app/page.tsx", "@acme/ui")).toBe("packages/ui/src/index.ts");
    expect(resolver.resolve("apps/web/src/app/page.tsx", "@acme/ui/src/Button")).toBe("packages/ui/src/Button.tsx");
  });

  it("returns null for unresolved external packages", () => {
    const resolver = resolverWith({ "src/app/page.tsx": "" });
    expect(resolver.resolve("src/app/page.tsx", "react")).toBeNull();
    expect(resolver.resolve("src/app/page.tsx", "./missing")).toBeNull();
  });
});

describe("parseTsConfigAliases", () => {
  it("tolerates comments in tsconfig", () => {
    const aliases = parseTsConfigAliases(`{
      // comment
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }
    }`);
    expect(aliases.paths["@/*"]).toEqual(["./src/*"]);
    expect(aliases.baseUrl).toBe(".");
  });

  it("returns empty config on malformed input", () => {
    const aliases = parseTsConfigAliases("not json");
    expect(aliases.paths).toEqual({});
  });
});

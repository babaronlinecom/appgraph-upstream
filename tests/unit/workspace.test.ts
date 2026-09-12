import { describe, expect, it } from "vitest";
import {
  detectWorkspaces,
  globToRegex,
  packageForPath,
  parsePnpmWorkspace,
  resolvePackageExports,
} from "@/lib/analysis/monorepo/workspace";

function files(entries: Record<string, unknown>): Map<string, string> {
  return new Map(
    Object.entries(entries).map(([path, content]) => [
      path,
      typeof content === "string" ? content : JSON.stringify(content),
    ]),
  );
}

describe("workspace discovery", () => {
  it("parses npm workspaces (array and object form)", () => {
    const base = {
      "packages/ui/package.json": { name: "@acme/ui", version: "1.0.0" },
      "apps/web/package.json": { name: "web", private: true },
      "src/index.ts": "export {};",
    };
    const arrayForm = detectWorkspaces({
      files: files({ "package.json": { name: "root", private: true, workspaces: ["apps/*", "packages/*"] }, ...base }),
      paths: Object.keys({ "package.json": 1, ...base }),
    });
    expect(arrayForm.isMonorepo).toBe(true);
    expect(arrayForm.tool).toBe("npm");
    expect(arrayForm.packages.map((pkg) => pkg.name).sort()).toEqual(["@acme/ui", "web"]);

    const objectForm = detectWorkspaces({
      files: files({
        "package.json": { name: "root", private: true, workspaces: { packages: ["packages/*"] } },
        ...base,
      }),
      paths: ["package.json", "packages/ui/package.json", "apps/web/package.json"],
    });
    expect(objectForm.packages.map((pkg) => pkg.name)).toEqual(["@acme/ui"]);
  });

  it("detects pnpm and turbo tooling with evidence", () => {
    const pnpm = detectWorkspaces({
      files: files({
        "package.json": { name: "root", private: true },
        "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
        "packages/ui/package.json": { name: "@acme/ui" },
      }),
      paths: ["package.json", "pnpm-workspace.yaml", "packages/ui/package.json"],
    });
    expect(pnpm.isMonorepo).toBe(true);
    expect(pnpm.tool).toBe("pnpm");
    expect(pnpm.packages[0]).toMatchObject({ name: "@acme/ui", root: "packages/ui" });

    const turbo = detectWorkspaces({
      files: files({
        "package.json": { name: "root", private: true, workspaces: ["apps/*"] },
        "turbo.json": "{}",
        "apps/web/package.json": { name: "web" },
      }),
      paths: ["package.json", "turbo.json", "apps/web/package.json"],
    });
    expect(turbo.tool).toBe("turbo");
    expect(turbo.toolEvidence).toContain("turbo.json");
  });

  it("keeps single-package repositories unchanged", () => {
    const info = detectWorkspaces({
      files: files({ "package.json": { name: "app", private: true } }),
      paths: ["package.json", "src/index.ts"],
    });
    expect(info.isMonorepo).toBe(false);
    expect(info.packages).toEqual([]);
  });

  it("parses pnpm-workspace yaml entries", () => {
    const globs = parsePnpmWorkspace(
      ["# comment", "packages:", "  - 'packages/*'", '  - "apps/*"', "  - '!packages/excluded'", "other: true"].join("\n"),
    );
    expect(globs).toEqual(["packages/*", "apps/*"]);
  });

  it("matches globs deterministically", () => {
    expect(globToRegex("packages/*").test("packages/ui")).toBe(true);
    expect(globToRegex("packages/*").test("packages/ui/src")).toBe(false);
    expect(globToRegex("packages/**").test("packages/ui/src")).toBe(true);
  });

  it("finds the deepest package containing a path", () => {
    const info = detectWorkspaces({
      files: files({
        "package.json": { name: "root", private: true, workspaces: ["packages/*"] },
        "packages/ui/package.json": { name: "@acme/ui" },
        "packages/ui/src/Button.tsx": "export {};",
      }),
      paths: ["package.json", "packages/ui/package.json", "packages/ui/src/Button.tsx"],
    });
    expect(packageForPath(info, "packages/ui/src/Button.tsx")?.name).toBe("@acme/ui");
    expect(packageForPath(info, "apps/web/src/page.tsx")).toBeUndefined();
  });
});

describe("package exports resolution", () => {
  it("resolves root, subpath and conditional targets", () => {
    const pkg = {
      exports: {
        ".": "./src/index.ts",
        "./button": { types: "./src/Button.tsx", default: "./src/Button.tsx" },
      },
    } as { exports: Record<string, unknown> };
    expect(resolvePackageExports(pkg, "")).toBe("./src/index.ts");
    expect(resolvePackageExports(pkg, "button")).toBe("./src/Button.tsx");
    expect(resolvePackageExports(pkg, "missing")).toBeNull();
  });

  it("resolves wildcard export patterns", () => {
    const pkg = { exports: { "./*": "./src/*.ts" } } as { exports: Record<string, unknown> };
    expect(resolvePackageExports(pkg, "utils")).toBe("./src/utils.ts");
  });

  it("returns null when there is no exports map", () => {
    expect(resolvePackageExports({ exports: null }, "button")).toBeNull();
    expect(resolvePackageExports({ exports: "./index.ts" }, "button")).toBeNull();
  });
});

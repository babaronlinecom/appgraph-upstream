import { describe, expect, it } from "vitest";
import { classifyFile, createSignals } from "@/lib/analysis/file-classifier";

const signals = createSignals({
  hasNextConfig: true,
  hasNextDependency: true,
  hasAppDir: true,
  hasPagesDir: false,
  hasSrcDir: true,
  hasTypeScript: true,
  hasPrisma: true,
  hasDrizzle: false,
  hasReactDependency: true,
});

describe("classifyFile (Next.js App Router)", () => {
  it("detects pages and derives routes", () => {
    expect(classifyFile("src/app/page.tsx", signals).route).toBe("/");
    expect(classifyFile("src/app/dashboard/page.tsx", signals).route).toBe("/dashboard");
    expect(classifyFile("src/app/blog/[slug]/page.tsx", signals).route).toBe("/blog/[slug]");
    expect(classifyFile("app/(marketing)/about/page.tsx", signals).route).toBe("/about");
  });

  it("detects route handlers", () => {
    const classified = classifyFile("src/app/api/projects/route.ts", signals);
    expect(classified.category).toBe("api");
    expect(classified.route).toBe("/api/projects");
    expect(classified.framework).toBe("nextjs-app");
  });

  it("detects layouts and special files", () => {
    expect(classifyFile("src/app/layout.tsx", signals).role).toBe("layout");
    expect(classifyFile("src/app/dashboard/loading.tsx", signals).role).toBe("loading");
  });

  it("detects components and hooks", () => {
    expect(classifyFile("src/components/ProjectList.tsx", signals).category).toBe("component");
    expect(classifyFile("src/components/Button.tsx", signals).category).toBe("component");
    expect(classifyFile("src/hooks/useProjects.ts", signals).category).toBe("hook");
  });

  it("detects services, databases and middleware", () => {
    expect(classifyFile("src/services/project-service.ts", signals).category).toBe("service");
    expect(classifyFile("src/lib/db.ts", signals).category).toBe("database");
    expect(classifyFile("src/server/user.ts", signals).category).toBe("service");
    expect(classifyFile("src/middleware.ts", signals).category).toBe("middleware");
  });

  it("marks tests even inside component paths", () => {
    expect(classifyFile("src/components/Button.test.tsx", signals).category).toBe("test");
    expect(classifyFile("src/app/dashboard/__tests__/page.test.tsx", signals).category).toBe("test");
  });
});

describe("classifyFile (Pages Router)", () => {
  const pagesSignals = createSignals({
    hasNextConfig: true,
    hasNextDependency: true,
    hasAppDir: false,
    hasPagesDir: true,
    hasSrcDir: false,
    hasTypeScript: true,
    hasPrisma: false,
    hasDrizzle: false,
    hasReactDependency: true,
  });

  it("detects pages and index routes", () => {
    expect(classifyFile("pages/index.tsx", pagesSignals).route).toBe("/");
    expect(classifyFile("pages/dashboard.tsx", pagesSignals).route).toBe("/dashboard");
    expect(classifyFile("pages/blog/[slug].tsx", pagesSignals).route).toBe("/blog/[slug]");
  });

  it("detects API routes", () => {
    const classified = classifyFile("pages/api/users.ts", pagesSignals);
    expect(classified.category).toBe("api");
    expect(classified.route).toBe("/api/users");
  });

  it("treats _app and _document as app shell", () => {
    expect(classifyFile("pages/_app.tsx", pagesSignals).role).toBe("app-shell");
    expect(classifyFile("pages/_document.tsx", pagesSignals).role).toBe("app-shell");
  });
});

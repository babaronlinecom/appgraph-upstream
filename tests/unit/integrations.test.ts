import { describe, expect, it } from "vitest";
import {
  classifyDatabaseOperation,
  findIntegrationForSpecifier,
} from "@/lib/analysis/integrations";
import { matchRouteTemplate } from "@/lib/analysis/frameworks/nextjs";

describe("integration detection", () => {
  it("recognizes common SDKs", () => {
    expect(findIntegrationForSpecifier("stripe")?.definition.id).toBe("stripe");
    expect(findIntegrationForSpecifier("@prisma/client")?.definition.id).toBe("prisma");
    expect(findIntegrationForSpecifier("@clerk/nextjs")?.definition.id).toBe("clerk");
    expect(findIntegrationForSpecifier("@supabase/supabase-js")?.definition.id).toBe("supabase");
    expect(findIntegrationForSpecifier("pg")?.definition.databaseLabel).toBe("PostgreSQL");
    expect(findIntegrationForSpecifier("ioredis")?.definition.databaseLabel).toBe("Redis");
  });

  it("handles submodule and scoped imports", () => {
    expect(findIntegrationForSpecifier("firebase/auth")?.definition.id).toBe("firebaseauth");
    expect(findIntegrationForSpecifier("@aws-sdk/client-s3")?.definition.id).toBe("s3");
    expect(findIntegrationForSpecifier("@sentry/nextjs")?.definition.id).toBe("sentry");
  });

  it("does not flag local or unknown imports", () => {
    expect(findIntegrationForSpecifier("./stripe")).toBeNull();
    expect(findIntegrationForSpecifier("@/lib/db")).toBeNull();
    expect(findIntegrationForSpecifier("lodash")).toBeNull();
  });
});

describe("database operation classification", () => {
  it("classifies reads", () => {
    expect(classifyDatabaseOperation("prisma.project.findMany")).toBe("read");
    expect(classifyDatabaseOperation("db.user.findUnique")).toBe("read");
    expect(classifyDatabaseOperation("redis.get")).toBe("read");
  });

  it("classifies writes", () => {
    expect(classifyDatabaseOperation("prisma.project.create")).toBe("write");
    expect(classifyDatabaseOperation("db.user.updateMany")).toBe("write");
    expect(classifyDatabaseOperation("redis.del")).toBe("write");
  });

  it("returns unknown for unrelated calls", () => {
    expect(classifyDatabaseOperation("console.log")).toBe("unknown");
  });
});

describe("Next.js route matching", () => {
  it("matches static routes exactly", () => {
    expect(matchRouteTemplate("/api/projects", "/api/projects")).toBe(true);
    expect(matchRouteTemplate("/api/projects/1", "/api/projects")).toBe(false);
  });

  it("matches dynamic and catch-all segments", () => {
    expect(matchRouteTemplate("/api/projects/42", "/api/projects/[id]")).toBe(true);
    expect(matchRouteTemplate("/api/files/a/b/c", "/api/files/[...path]")).toBe(true);
    expect(matchRouteTemplate("/api/projects", "/api/projects/[id]")).toBe(false);
  });
});

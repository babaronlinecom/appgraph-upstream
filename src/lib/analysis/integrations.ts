import type { IntegrationDefinition } from "./types";

/**
 * External service / infrastructure detection table.
 * Recognized SDKs become explicit graph nodes with high confidence.
 */
export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "stripe",
    label: "Stripe",
    category: "Payments",
    kind: "payments",
    packages: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
  },
  {
    id: "paddle",
    label: "Paddle",
    category: "Payments",
    kind: "payments",
    packages: ["@paddle/paddle-js", "@paddle/paddle-node-sdk"],
  },
  {
    id: "prisma",
    label: "Prisma",
    category: "ORM",
    kind: "orm",
    packages: ["@prisma/client", "prisma"],
  },
  {
    id: "drizzle",
    label: "Drizzle ORM",
    category: "ORM",
    kind: "orm",
    packages: ["drizzle-orm", "drizzle-kit"],
  },
  {
    id: "supabase",
    label: "Supabase",
    category: "Database & Auth",
    kind: "database",
    packages: ["@supabase/supabase-js", "@supabase/ssr", "@supabase/auth-helpers-nextjs"],
    databaseLabel: "Supabase",
  },
  {
    id: "firebase",
    label: "Firebase",
    category: "Database & Auth",
    kind: "database",
    packages: ["firebase", "firebase-admin", "@firebase/app"],
    databaseLabel: "Firestore",
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    category: "Database",
    kind: "database",
    packages: ["pg", "postgres", "@vercel/postgres", "@neondatabase/serverless"],
    databaseLabel: "PostgreSQL",
  },
  {
    id: "mysql",
    label: "MySQL",
    category: "Database",
    kind: "database",
    packages: ["mysql2", "mysql"],
    databaseLabel: "MySQL",
  },
  {
    id: "mongodb",
    label: "MongoDB",
    category: "Database",
    kind: "database",
    packages: ["mongodb", "mongoose"],
    databaseLabel: "MongoDB",
  },
  {
    id: "redis",
    label: "Redis",
    category: "Cache",
    kind: "database",
    packages: ["redis", "ioredis", "@upstash/redis"],
    databaseLabel: "Redis",
  },
  {
    id: "sqlite",
    label: "SQLite",
    category: "Database",
    kind: "database",
    packages: ["better-sqlite3", "libsql", "@libsql/client"],
    databaseLabel: "SQLite",
  },
  {
    id: "clerk",
    label: "Clerk",
    category: "Authentication",
    kind: "auth",
    packages: ["@clerk/nextjs", "@clerk/clerk-sdk-node", "@clerk/backend", "@clerk/remix"],
  },
  {
    id: "authjs",
    label: "Auth.js",
    category: "Authentication",
    kind: "auth",
    packages: ["next-auth", "@auth/core", "@auth/prisma-adapter", "@auth/drizzle-adapter"],
  },
  {
    id: "firebaseauth",
    label: "Firebase Auth",
    category: "Authentication",
    kind: "auth",
    packages: ["firebase/auth", "firebase-admin/auth"],
  },
  {
    id: "s3",
    label: "AWS S3",
    category: "Storage",
    kind: "storage",
    packages: ["@aws-sdk/client-s3", "@aws-sdk/lib-storage", "aws-sdk"],
  },
  {
    id: "cloudinary",
    label: "Cloudinary",
    category: "Storage",
    kind: "storage",
    packages: ["cloudinary", "next-cloudinary"],
  },
  {
    id: "uploadthing",
    label: "UploadThing",
    category: "Storage",
    kind: "storage",
    packages: ["uploadthing", "@uploadthing/react"],
  },
  {
    id: "openai",
    label: "OpenAI",
    category: "AI",
    kind: "ai",
    packages: ["openai", "@ai-sdk/openai", "@langchain/openai"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    category: "AI",
    kind: "ai",
    packages: ["@anthropic-ai/sdk", "@ai-sdk/anthropic", "@langchain/anthropic"],
  },
  {
    id: "vercel-ai",
    label: "Vercel AI SDK",
    category: "AI",
    kind: "ai",
    packages: ["ai", "@ai-sdk/react"],
  },
  {
    id: "resend",
    label: "Resend",
    category: "Email",
    kind: "email",
    packages: ["resend"],
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    category: "Email",
    kind: "email",
    packages: ["@sendgrid/mail"],
  },
  {
    id: "nodemailer",
    label: "SMTP",
    category: "Email",
    kind: "email",
    packages: ["nodemailer"],
  },
  {
    id: "posthog",
    label: "PostHog",
    category: "Analytics",
    kind: "observability",
    packages: ["posthog-js", "posthog-node"],
  },
  {
    id: "sentry",
    label: "Sentry",
    category: "Monitoring",
    kind: "observability",
    packages: ["@sentry/nextjs", "@sentry/react", "@sentry/node"],
  },
  {
    id: "vercel-analytics",
    label: "Vercel Analytics",
    category: "Analytics",
    kind: "observability",
    packages: ["@vercel/analytics", "@vercel/speed-insights"],
  },
  {
    id: "segment",
    label: "Segment",
    category: "Analytics",
    kind: "observability",
    packages: ["@segment/analytics-next", "analytics-node"],
  },
  {
    id: "mixpanel",
    label: "Mixpanel",
    category: "Analytics",
    kind: "observability",
    packages: ["mixpanel", "mixpanel-browser"],
  },
  {
    id: "algolia",
    label: "Algolia",
    category: "Search",
    kind: "external",
    packages: ["algoliasearch", "@algolia/client-search"],
  },
  {
    id: "meilisearch",
    label: "Meilisearch",
    category: "Search",
    kind: "external",
    packages: ["meilisearch", "@meilisearch/instant-meilisearch"],
  },
  {
    id: "pusher",
    label: "Pusher",
    category: "Realtime",
    kind: "external",
    packages: ["pusher", "pusher-js"],
  },
  {
    id: "ably",
    label: "Ably",
    category: "Realtime",
    kind: "external",
    packages: ["ably"],
  },
  {
    id: "socketio",
    label: "Socket.IO",
    category: "Realtime",
    kind: "external",
    packages: ["socket.io", "socket.io-client"],
  },
  {
    id: "twilio",
    label: "Twilio",
    category: "Communications",
    kind: "external",
    packages: ["twilio"],
  },
];

const INTEGRATION_BY_PACKAGE = new Map<string, IntegrationDefinition>();
for (const definition of INTEGRATIONS) {
  for (const packageName of definition.packages) {
    INTEGRATION_BY_PACKAGE.set(packageName, definition);
  }
}

/**
 * Maps an import specifier to a known integration. Handles scoped submodule
 * imports (e.g. "firebase/auth", "@supabase/supabase-js/dist/...").
 */
export function findIntegrationForSpecifier(
  specifier: string,
): { definition: IntegrationDefinition; packageName: string } | null {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/")) {
    return null;
  }
  const direct = INTEGRATION_BY_PACKAGE.get(specifier);
  if (direct) return { definition: direct, packageName: specifier };

  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    if (segments.length >= 2) {
      const scoped = `${segments[0]}/${segments[1]}`;
      const definition = INTEGRATION_BY_PACKAGE.get(scoped);
      if (definition) return { definition, packageName: scoped };
      // Try deeper prefixes like @auth/prisma-adapter from @auth/core.
      for (let index = segments.length - 1; index >= 2; index -= 1) {
        const prefix = segments.slice(0, index).join("/");
        const nested = INTEGRATION_BY_PACKAGE.get(prefix);
        if (nested) return { definition: nested, packageName: prefix };
      }
    }
    return null;
  }

  for (let index = segments.length - 1; index >= 1; index -= 1) {
    const prefix = segments.slice(0, index).join("/");
    const definition = INTEGRATION_BY_PACKAGE.get(prefix);
    if (definition) return { definition, packageName: prefix };
  }
  return null;
}

export function isKnownIntegrationSpecifier(specifier: string): boolean {
  return findIntegrationForSpecifier(specifier) !== null;
}

const DB_READ_METHODS = new Set([
  "findmany",
  "findfirst",
  "findunique",
  "finduniqueorthrow",
  "findfirstorthrow",
  "count",
  "aggregate",
  "groupby",
  "select",
  "query",
  "get",
  "getall",
  "mget",
  "scan",
  "keys",
  "exists",
]);

const DB_WRITE_METHODS = new Set([
  "create",
  "createmany",
  "update",
  "updatemany",
  "upsert",
  "delete",
  "deletemany",
  "set",
  "setex",
  "del",
  "incr",
  "decr",
  "hset",
  "hdel",
  "lpush",
  "rpush",
  "sadd",
  "srem",
  "insert",
  "insertmany",
  "replace",
  "executeraw",
  "queryraw",
  "queryrawunsafe",
  "executerawunsafe",
]);

export type DatabaseOperation = "read" | "write" | "unknown";

/**
 * Classifies a call expression as a likely database read or write.
 * Used to give edges meaningful types (reads/writes) instead of generic "uses".
 */
export function classifyDatabaseOperation(calleeName: string): DatabaseOperation {
  const parts = calleeName.split(".");
  const method = parts[parts.length - 1]?.toLowerCase() ?? "";
  if (!method) return "unknown";
  if (DB_READ_METHODS.has(method)) return "read";
  if (DB_WRITE_METHODS.has(method)) return "write";
  if (method.startsWith("find")) return "read";
  if (method.startsWith("get")) return "read";
  if (method.startsWith("select")) return "read";
  if (method.startsWith("insert") || method.startsWith("update") || method.startsWith("delete")) return "write";
  return "unknown";
}

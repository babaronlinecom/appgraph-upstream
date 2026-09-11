/**
 * Protection limits for untrusted public repositories.
 * Every limit is configurable through the environment via loadLimits().
 */
export interface AnalysisLimits {
  maxTreeEntries: number;
  maxAnalyzedFiles: number;
  maxFileBytes: number;
  maxTotalSourceBytes: number;
  analysisTimeoutMs: number;
  githubRequestTimeoutMs: number;
  fetchConcurrency: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
  maxComponents: number;
  maxExternalNodes: number;
  maxSnippetLines: number;
  maxFetchAttempts: number;
}

export const DEFAULT_LIMITS: AnalysisLimits = {
  maxTreeEntries: 40_000,
  maxAnalyzedFiles: 320,
  maxFileBytes: 300_000,
  maxTotalSourceBytes: 14_000_000,
  analysisTimeoutMs: 100_000,
  githubRequestTimeoutMs: 20_000,
  fetchConcurrency: 10,
  maxGraphNodes: 520,
  maxGraphEdges: 1_600,
  maxComponents: 170,
  maxExternalNodes: 40,
  maxSnippetLines: 48,
  maxFetchAttempts: 360,
};

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
] as const;

export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".github",
  ".gitlab",
  ".vscode",
  ".idea",
  ".husky",
  ".turbo",
  ".next",
  ".nuxt",
  ".output",
  ".vercel",
  ".netlify",
  ".cache",
  ".parcel-cache",
  "node_modules",
  "bower_components",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "tmp",
  "temp",
  "__snapshots__",
  "__mocks__",
  "__fixtures__",
  "fixtures",
  "test",
  "tests",
  "__tests__",
  "e2e",
  "cypress",
  "playwright",
  "stories",
  ".storybook",
  "public",
  "static",
  "assets",
  "images",
  "img",
  "fonts",
  "locales",
  "i18n",
  "migrations",
  "seeds",
]);

export const IGNORED_FILE_PATTERNS: RegExp[] = [
  /\.min\.(js|css)$/i,
  /\.bundle\.js$/i,
  /\.map$/i,
  /\.d\.ts$/i,
  /\.d\.mts$/i,
  /\.d\.cts$/i,
  /\.test\.(ts|tsx|js|jsx|mts|cts)$/i,
  /\.spec\.(ts|tsx|js|jsx|mts|cts)$/i,
  /(^|\/)[^/]*\.config\.(test|spec)\./i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /bun\.lockb$/i,
  /npm-shrinkwrap\.json$/i,
  /composer\.lock$/i,
  /Cargo\.lock$/i,
  /(^|\/)\.env(\.|$)/i,
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff)$/i,
  /\.(woff2?|ttf|otf|eot)$/i,
  /\.(mp4|webm|mov|mp3|wav|ogg)$/i,
  /\.(pdf|zip|gz|tar|tgz|7z|rar)$/i,
  /\.(wasm|node|exe|dll|so|dylib)$/i,
  /\.(sqlite|db|sqlite3)$/i,
  /\.(csv|parquet|avro|xlsx?)$/i,
  /\.(glb|gltf|fbx|obj|stl)$/i,
];

/**
 * Config and metadata files that are fetched even though they are not
 * source modules. They power framework detection and alias resolution.
 */
export const METADATA_FILE_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
  "prisma/schema.prisma",
  "drizzle.config.ts",
  "drizzle.config.js",
  ".env.example",
  ".env.sample",
  ".env.template",
  "middleware.ts",
  "middleware.js",
  "src/middleware.ts",
  "src/middleware.js",
]);

export const METADATA_FILE_PATTERNS: RegExp[] = [
  /^tailwind\.config\.(js|cjs|mjs|ts)$/i,
  /(^|\/)\.env\.example$/i,
  /(^|\/)\.env\.sample$/i,
  /(^|\/)\.env\.template$/i,
];

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function loadLimits(overrides: Partial<AnalysisLimits> = {}): AnalysisLimits {
  return {
    ...DEFAULT_LIMITS,
    ...overrides,
    maxAnalyzedFiles: readInt("APPGRAPH_MAX_ANALYZED_FILES", overrides.maxAnalyzedFiles ?? DEFAULT_LIMITS.maxAnalyzedFiles, 10, 2_000),
    maxFileBytes: readInt("APPGRAPH_MAX_FILE_BYTES", overrides.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes, 1_000, 5_000_000),
    analysisTimeoutMs: readInt(
      "APPGRAPH_ANALYSIS_TIMEOUT_MS",
      overrides.analysisTimeoutMs ?? DEFAULT_LIMITS.analysisTimeoutMs,
      5_000,
      600_000,
    ),
  } as AnalysisLimits;
}

export function hasSourceExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return SOURCE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isIgnoredDirectory(segment: string): boolean {
  return IGNORED_DIRECTORIES.has(segment.toLowerCase());
}

export function isIgnoredFile(path: string): boolean {
  if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(path))) return true;
  const lower = path.toLowerCase();
  if (lower.endsWith(".json") && lower.includes("lock")) return true;
  return false;
}

export function isMetadataFile(path: string): boolean {
  const lower = path.toLowerCase().replace(/^\.\//, "");
  if (METADATA_FILE_NAMES.has(lower)) return true;
  const basename = lower.split("/").pop() ?? lower;
  if (METADATA_FILE_NAMES.has(basename) && lower.split("/").length <= 2) {
    // Allow nested app dirs for next.config only at repo root; app sources are handled elsewhere.
    return lower.split("/").length === 1;
  }
  return METADATA_FILE_PATTERNS.some((pattern) => pattern.test(lower));
}

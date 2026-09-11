import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3224;
const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "sample-nextjs");

/**
 * Dev-mode reproduction config (React StrictMode is active in next dev).
 * Used to verify that the workspace survives StrictMode double-mounting.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
  },
  projects: [
    {
      name: "msedge",
      use: { channel: "msedge", viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      APPGRAPH_FIXTURE_DIR: fixtureDir,
      APPGRAPH_ANALYSIS_VERSION: "e2e-dev",
      APPGRAPH_CACHE_DIR: path.join(process.cwd(), ".appgraph-cache-e2e-dev"),
      APPGRAPH_ANALYZE_RATE_LIMIT: "200",
      APPGRAPH_MAX_CONCURRENT_ANALYSES: "2",
      NEXT_DIST_DIR: ".next-e2e-dev",
    },
  },
});

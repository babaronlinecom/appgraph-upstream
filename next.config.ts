import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is enabled only for container builds (see Dockerfile),
  // so local `next start` and Playwright keep working with the standard server.
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // Optional isolated build directory (used by parallel dev/E2E runs).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  serverExternalPackages: ["elkjs"],
  webpack: (config, { dev }) => {
    if (dev) {
      // Runtime caches and test artifacts must not trigger dev-server reloads,
      // otherwise in-memory analysis jobs would disappear mid-poll.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next*/**",
          "**/.appgraph-cache*/**",
          "**/test-results/**",
          "**/playwright-report/**",
        ],
      };
    }
    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;

/**
 * AppGraph CLI — analyze a GitHub repository or an already checked-out local repository.
 *
 * Usage:
 *   npm run analyze -- https://github.com/owner/repo
 *   npm run analyze -- owner/repo --json
 *   npm run analyze -- --local ../checked-out-repo --out graph.json
 *
 * Flags:
 *   --local         read an existing checkout instead of GitHub
 *   --json          print a machine-readable summary to stdout
 *   --out <file>    write the full AppGraph document JSON to a file
 *   --mermaid       print a Mermaid diagram to stdout
 *   --report <file> write a Markdown architecture report
 */
import { writeFile } from "node:fs/promises";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { GitHubPublicRepositoryProvider } from "@/lib/github/github-public-provider";
import { LocalRepositoryProvider } from "@/lib/github/local-repository-provider";
import {
  detectCycles,
  graphHealth,
  toMarkdownReport,
  toMermaid,
} from "@/features/workspace/analytics";
import { detectFlows } from "@/features/workspace/trace";

function usage(): never {
  console.error(
    [
      "AppGraph CLI — deterministic static architecture analysis.",
      "",
      "Usage:",
      "  npm run analyze -- <github-url-or-owner/repo> [flags]",
      "  npm run analyze -- --local <checkout-path> [flags]",
      "",
      "Flags: --local --json --out <file.json> --mermaid --report <file.md>",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const hasFlag = (flag: string) => args.includes(flag);
  const flagValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const valueFlags = new Set(["--out", "--report"]);
  const rawInput = args.find((argument, index) => {
    if (argument.startsWith("--")) return false;
    return index === 0 || !valueFlags.has(args[index - 1]);
  });
  if (!rawInput) usage();

  const local = hasFlag("--local");
  const input = local
    ? rawInput
    : /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(rawInput)
      ? `https://github.com/${rawInput}`
      : rawInput;
  const provider = local ? new LocalRepositoryProvider() : new GitHubPublicRepositoryProvider();
  const startedAt = Date.now();
  const logged = new Set<string>();

  const document = await analyzeRepository({
    provider,
    input,
    onMetadata: (metadata) => {
      console.error(
        `▸ ${metadata.fullName} · ${metadata.defaultBranch} · ${metadata.sizeKb} KB · ★ ${metadata.stars}`,
      );
    },
    onProgress: (steps) => {
      for (const step of steps) {
        if (step.status === "done" && !logged.has(step.id)) {
          logged.add(step.id);
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.error(`  ✓ ${step.label}${step.detail ? ` — ${step.detail}` : ""} (${elapsed}s)`);
        }
      }
    },
  });

  const health = graphHealth(document);
  const cycles = detectCycles(document);
  const flows = detectFlows(document, { limit: 8 });

  console.error("");
  console.error(
    `▸ ${health.entities} entities · ${health.relationships} relationships · ${document.stats.analyzedFiles}/${document.stats.sourceFiles} files · ${(document.stats.durationMs / 1000).toFixed(1)}s${document.stats.cacheHit ? " (cached)" : ""}`,
  );
  console.error(
    `▸ health: avg links ${health.avgOutgoing.toFixed(1)} · orphans ${health.orphanCount} · cycles ${cycles.length} · confidence ${Math.round(health.avgConfidence * 100)}%`,
  );
  console.error(
    `▸ coverage: languages ${document.capabilities.languages.join(", ")} · frameworks ${
      document.capabilities.frameworks.join(", ") || "none"
    } · schemas ${document.capabilities.databaseSchemas.join(", ") || "none"} · symbol resolution ${document.capabilities.symbolResolution}`,
  );
  if (flows.length > 0) {
    console.error("▸ key flows:");
    for (const flow of flows.slice(0, 5)) console.error(`   ${flow.title}`);
  }
  if (cycles.length > 0) {
    console.error(`▸ circular dependencies: ${cycles.length} (use --json for details)`);
  }

  const outPath = flagValue("--out");
  if (outPath) {
    await writeFile(outPath, JSON.stringify(document, null, 2), "utf8");
    console.error(`▸ graph written to ${outPath}`);
  }

  const reportPath = flagValue("--report");
  if (reportPath) {
    await writeFile(reportPath, toMarkdownReport(document, health, cycles, flows), "utf8");
    console.error(`▸ report written to ${reportPath}`);
  }

  if (hasFlag("--mermaid")) console.log(toMermaid(document, "architecture"));

  if (hasFlag("--json")) {
    console.log(
      JSON.stringify(
        {
          repository: document.repository.fullName,
          commitSha: document.commitSha,
          stats: document.stats,
          capabilities: document.capabilities,
          health,
          cycles: cycles.map((cycle) => cycle.nodeIds),
          flows: flows.map((flow) => ({ title: flow.title, nodeIds: flow.nodeIds })),
          warnings: document.warnings,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

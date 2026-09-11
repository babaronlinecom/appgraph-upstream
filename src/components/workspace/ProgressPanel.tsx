"use client";

import { AlertTriangle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { AnalysisStep } from "@/lib/analysis/pipeline";
import type { RepositoryMetadata } from "@/lib/graph/model";
import { cn } from "@/lib/utils/cn";

export function StepIcon({ status }: { status: AnalysisStep["status"] }) {
  if (status === "done") return <CheckCircle2 size={14} className="text-success" aria-hidden />;
  if (status === "active") return <Loader2 size={14} className="animate-spin text-accent" aria-hidden />;
  if (status === "error") return <AlertTriangle size={14} className="text-danger" aria-hidden />;
  return <Circle size={14} className="text-ink-muted/50" aria-hidden />;
}

export function ProgressPanel({
  owner,
  repo,
  steps,
  metadata,
  elapsedMs,
}: {
  owner: string;
  repo: string;
  steps: AnalysisStep[];
  metadata?: RepositoryMetadata;
  elapsedMs: number;
}) {
  const visibleSteps: AnalysisStep[] =
    steps.length > 0
      ? steps
      : [
          { id: "resolve", label: "Repository resolved", status: "pending" },
          { id: "index", label: "Files indexed", status: "pending" },
          { id: "select", label: "Source files selected", status: "pending" },
          { id: "fetch", label: "Source files downloaded", status: "pending" },
          { id: "parse", label: "Source parsed", status: "pending" },
          { id: "resolve-imports", label: "Import graph resolved", status: "pending" },
          { id: "graph", label: "Architecture graph built", status: "pending" },
          { id: "layout", label: "Layout computed", status: "pending" },
        ];

  const done = visibleSteps.filter((step) => step.status === "done").length;
  const percent = Math.round((done / visibleSteps.length) * 100);

  return (
    <section
      className="w-full max-w-[480px] animate-slide-up rounded-xl border border-line bg-panel p-5 shadow-panel"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-ink">
            Analyzing{" "}
            <span className="font-mono text-[13px] text-ink-secondary">
              {owner}/{repo}
            </span>
          </h1>
          <p className="mt-1 truncate text-xs text-ink-muted">
            {metadata?.description ?? "Reading repository metadata from the public GitHub API."}
          </p>
        </div>
        <span className="shrink-0 font-mono text-2xs text-ink-muted">{(elapsedMs / 1000).toFixed(1)}s</span>
      </div>

      {metadata ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-muted">
          {metadata.language ? <span>{metadata.language}</span> : null}
          <span>★ {metadata.stars.toLocaleString()}</span>
          <span>{metadata.sizeKb >= 1024 ? `${(metadata.sizeKb / 1024).toFixed(1)} MB` : `${metadata.sizeKb} KB`}</span>
          <span>default: {metadata.defaultBranch}</span>
        </div>
      ) : null}

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(percent, 4)}%` }}
        />
      </div>

      <ol className="mt-4 space-y-2">
        {visibleSteps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-xs">
            <StepIcon status={step.status} />
            <span className={cn(step.status === "pending" ? "text-ink-muted" : "text-ink-secondary")}>
              {step.label}
            </span>
            {step.detail ? <span className="ml-auto font-mono text-2xs text-ink-muted">{step.detail}</span> : null}
          </li>
        ))}
      </ol>

      <p className="mt-4 text-2xs leading-4 text-ink-muted">
        Static analysis only. AppGraph never runs, installs or writes repository code.
      </p>
    </section>
  );
}

"use client";

import { AlertTriangle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { formatDuration } from "@/features/workspace/selectors";
import { cn } from "@/lib/utils/cn";

export function StatusBar() {
  const { state, dispatch } = useWorkspace();
  const graph = state.graph;
  if (!graph) return null;
  const stats = graph.stats;
  const warnings = graph.warnings;
  const errorCount = warnings.filter((warning) => warning.severity === "error").length;
  const warningCount = warnings.filter((warning) => warning.severity === "warning").length;

  return (
    <footer className="relative z-30 flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-2xs text-ink-muted">
      <span className="hidden sm:inline">{stats.analyzedFiles} files analyzed</span>
      <span className="hidden sm:inline text-ink-muted/60">·</span>
      <span>{stats.entities} entities</span>
      <span className="text-ink-muted/60">·</span>
      <span>{stats.relationships} relationships</span>
      <span className="hidden text-ink-muted/60 md:inline">·</span>
      <span className="hidden md:inline">
        {stats.externalServices} external service{stats.externalServices === 1 ? "" : "s"}
      </span>
      <span className="ml-auto hidden font-mono lg:inline">{formatDuration(stats.durationMs)}</span>
      {stats.truncated ? <span className="hidden lg:inline text-warning">bounded</span> : null}

      <button
        type="button"
        onClick={() => dispatch({ type: "ui/warnings", open: !state.warningsOpen })}
        className={cn(
          "ml-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors duration-180",
          warnings.length === 0
            ? "border-transparent text-success"
            : errorCount > 0
              ? "border-[rgba(229,100,95,0.4)] text-danger hover:bg-[rgba(229,100,95,0.08)]"
              : "border-[rgba(217,164,65,0.4)] text-warning hover:bg-[rgba(217,164,65,0.08)]",
        )}
        aria-expanded={state.warningsOpen}
      >
        {warnings.length === 0 ? (
          <>
            <CheckCircle2 size={11} aria-hidden /> clean
          </>
        ) : (
          <>
            <TriangleAlert size={11} aria-hidden /> {warningCount + errorCount} warning
            {warningCount + errorCount === 1 ? "" : "s"}
          </>
        )}
      </button>

      {state.warningsOpen ? (
        <div className="absolute bottom-8 right-2 z-50 w-[360px] max-w-[90vw] animate-slide-up rounded-lg border border-line bg-panel p-3 shadow-float">
          <div className="mb-2 flex items-center justify-between">
            <span className="ag-section-label">Analysis notes</span>
            <button
              type="button"
              className="text-2xs text-ink-muted hover:text-ink"
              onClick={() => dispatch({ type: "ui/warnings", open: false })}
            >
              Close
            </button>
          </div>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex items-start gap-2 text-xs">
                {warning.severity === "error" ? (
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                ) : warning.severity === "warning" ? (
                  <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                ) : (
                  <Info size={13} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="leading-5 text-ink-secondary">{warning.message}</p>
                  {warning.detail ? (
                    <p className="mt-0.5 break-words font-mono text-2xs text-ink-muted">{warning.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
            {warnings.length === 0 ? (
              <li className="text-xs text-ink-muted">No warnings. This analysis completed cleanly.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

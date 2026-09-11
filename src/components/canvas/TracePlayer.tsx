"use client";

import { useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Pause,
  Play,
  Radar,
  Route,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { cn } from "@/lib/utils/cn";
import type { TraceMode } from "@/features/workspace/trace";

const MODE_META: Record<TraceMode, { icon: LucideIcon; label: string; color: string }> = {
  downstream: { icon: Route, label: "Downstream flow", color: "#67c7f0" },
  impact: { icon: Radar, label: "Impact analysis", color: "#e0b05c" },
  path: { icon: GitBranch, label: "Relationship path", color: "#b490e8" },
  flow: { icon: Workflow, label: "Detected flow", color: "#57c99b" },
};

export function TracePlayer() {
  const { state, advanceTrace, prevTrace, stopTrace, setTracePlaying } = useWorkspace();
  const trace = state.trace;

  useEffect(() => {
    if (!trace?.playing) return;
    const isLast = trace.index >= trace.steps.length - 1;
    const delay = isLast ? (trace.tour ? 1700 : 2_100) : 1_500;
    const timeout = setTimeout(() => advanceTrace(), delay);
    return () => clearTimeout(timeout);
  }, [trace?.playing, trace?.index, trace?.title, trace?.tour?.index, advanceTrace]);

  if (!trace) return null;
  const mode = MODE_META[trace.mode];
  const Icon = mode.icon;
  const step = trace.steps[trace.index];
  const total = trace.steps.length;
  const atStart = trace.index === 0;
  const atEnd = trace.index >= total - 1 && !trace.tour;

  return (
    <div
      className="ag-trace-player absolute bottom-4 left-1/2 z-20 flex w-[min(720px,calc(100%-32px))] -translate-x-1/2 animate-slide-up items-center gap-2.5 rounded-lg border border-line-strong bg-panel/95 px-2.5 py-2 shadow-float"
      role="status"
      aria-live="polite"
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
        style={{ borderColor: `${mode.color}44`, background: `${mode.color}14` }}
        title={mode.label}
      >
        <Icon size={13} style={{ color: mode.color }} aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-ink">{trace.title}</span>
          {trace.tour ? (
            <span className="shrink-0 rounded border border-line bg-elevated px-1 font-mono text-2xs text-ink-muted">
              tour {trace.tour.index + 1}/{trace.tour.setups.length}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 font-mono text-2xs text-ink-muted">
            {trace.index + 1}/{total}
          </span>
        </div>
        <div className="mt-0.5 truncate font-mono text-2xs text-ink-secondary">{step?.label}</div>
        <div className="mt-1.5 flex items-center gap-0.5">
          {total <= 24 ? (
            trace.steps.map((_, index) => (
              <span
                key={index}
                className={cn(
                  "h-1 rounded-full transition-all duration-200",
                  index < trace.index
                    ? "w-3 bg-[#3d4452]"
                    : index === trace.index
                      ? "w-4"
                      : "w-1.5 bg-[#23272f]",
                )}
                style={index === trace.index ? { background: mode.color } : undefined}
              />
            ))
          ) : (
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
              <span
                className="block h-full rounded-full transition-all duration-300"
                style={{
                  width: `${((trace.index + 1) / total) * 100}%`,
                  background: mode.color,
                }}
              />
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="ag-icon-button"
          onClick={prevTrace}
          disabled={atStart}
          aria-label="Previous trace step"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="ag-icon-button"
          onClick={() => setTracePlaying(!trace.playing)}
          aria-label={trace.playing ? "Pause trace" : "Play trace"}
        >
          {trace.playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button
          type="button"
          className="ag-icon-button"
          onClick={advanceTrace}
          disabled={atEnd}
          aria-label="Next trace step"
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          className="ag-icon-button"
          onClick={stopTrace}
          aria-label="Exit trace"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

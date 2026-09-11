"use client";

import { GitBranch, Github, PanelLeft, Play, Search, Share2 } from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils/cn";

export function TopBar() {
  const { state, dispatch, copyShareLink, startTour, openPalette } = useWorkspace();
  const graph = state.graph;
  const statusLabel =
    state.status === "complete"
      ? "Ready"
      : state.status === "error"
        ? "Error"
        : state.status === "idle"
          ? "Preparing"
          : "Analyzing";

  const statusColor =
    state.status === "complete"
      ? "var(--ag-success)"
      : state.status === "error"
        ? "var(--ag-danger)"
        : "var(--ag-warning)";

  return (
    <header className="relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 sm:px-3">
      <button
        type="button"
        className="ag-icon-button lg:hidden"
        onClick={() => dispatch({ type: "ui/explorer", open: !state.explorerOpen })}
        aria-label="Toggle explorer"
      >
        <PanelLeft size={15} />
      </button>

      <Logo compact={false} />

      {graph ? (
        <div className="hidden min-w-0 items-center gap-2 rounded-md border border-line bg-elevated px-2 py-1 md:flex">
          <Github size={12} className="shrink-0 text-ink-muted" aria-hidden />
          <span className="max-w-[240px] truncate text-xs text-ink">
            {graph.repository.owner}/{graph.repository.name}
          </span>
          <span className="text-ink-muted">·</span>
          <GitBranch size={11} className="shrink-0 text-ink-muted" aria-hidden />
          <span className="max-w-[120px] truncate font-mono text-2xs text-ink-secondary">{graph.ref}</span>
          <span className="font-mono text-2xs text-ink-muted">@{graph.commitSha.slice(0, 7)}</span>
          {graph.stats.cacheHit ? (
            <span className="rounded border border-line px-1 text-2xs uppercase tracking-wide text-ink-muted">
              cached
            </span>
          ) : null}
        </div>
      ) : (
        <div className="hidden items-center gap-2 rounded-md border border-line bg-elevated px-2 py-1 md:flex">
          <span className="max-w-[280px] truncate text-xs text-ink-secondary">
            {state.owner ? `${state.owner}/${state.repo}` : state.url}
          </span>
        </div>
      )}

      <div className="flex flex-1 justify-center px-1">
        {graph ? (
          <button
            type="button"
            onClick={openPalette}
            className="group flex h-7 w-full max-w-[440px] items-center gap-2 rounded-md border border-line bg-elevated px-2.5 text-left text-xs text-ink-muted transition-colors duration-180 hover:border-line-strong hover:text-ink-secondary"
          >
            <Search size={13} aria-hidden />
            <span className="flex-1 truncate">Search nodes, routes, symbols…</span>
            <span className="ag-kbd hidden sm:inline-flex">⌘K</span>
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="hidden items-center gap-1.5 rounded-md border border-line bg-elevated px-2 py-1 text-2xs text-ink-secondary sm:flex">
          <span
            className={cn("h-1.5 w-1.5 rounded-full", state.status !== "complete" && state.status !== "error" && "animate-pulse-soft")}
            style={{ background: statusColor }}
            aria-hidden
          />
          {statusLabel}
        </span>

        {graph ? (
          <>
            <button
              type="button"
              className="ag-button hidden md:inline-flex"
              onClick={startTour}
              title="Play a guided tour across detected architecture flows"
            >
              <Play size={12} aria-hidden />
              Tour
            </button>
            <button type="button" className="ag-button hidden sm:inline-flex" onClick={copyShareLink}>
              <Share2 size={12} aria-hidden />
              Share
            </button>
            <a
              className="ag-icon-button"
              href={graph.repository.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open repository on GitHub"
            >
              <Github size={15} />
            </a>
          </>
        ) : null}
      </div>
    </header>
  );
}

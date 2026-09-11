"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Braces,
  Command,
  Eye,
  EyeOff,
  FileText,
  FolderTree,
  GitBranch,
  Layers,
  Link2,
  Locate,
  Radar,
  RotateCcw,
  Route,
  Search,
  Gauge,
} from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { ALL_EDGE_TYPES } from "@/features/workspace/selectors";
import { toMermaid } from "@/features/workspace/analytics";
import { copyText, downloadText } from "@/lib/utils/download";
import { NODE_TYPE_META } from "@/components/canvas/node-meta";
import { cn } from "@/lib/utils/cn";
import { GRANULARITY_ORDER, type AppGraphNode, type GraphGranularity } from "@/lib/graph/model";

interface PaletteItem {
  id: string;
  kind: "node" | "command";
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  run: () => void;
}

const GRANULARITY_ITEMS: Array<{ id: GraphGranularity; label: string }> = [
  { id: "product", label: "Product view" },
  { id: "architecture", label: "Architecture view" },
  { id: "modules", label: "Modules view" },
  { id: "files", label: "Files view" },
  { id: "symbols", label: "Symbols view" },
];

export function CommandPalette() {
  const {
    state,
    dispatch,
    copyShareLink,
    resetPositions,
    selectNode,
    startTour,
    startDownstream,
    startImpact,
    startPathPick,
    setExplorerTab,
    toast,
  } = useWorkspace();
  const open = state.paletteOpen;
  const graph = state.graph;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const timeout = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timeout);
  }, [open]);

  const close = useCallback(() => dispatch({ type: "ui/palette", open: false }), [dispatch]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!graph) return [];
    const normalized = query.trim().toLowerCase();
    const selected = state.selectedNodeId
      ? graph.nodes.find((node) => node.id === state.selectedNodeId)
      : undefined;

    const commands: PaletteItem[] = [
      {
        id: "cmd:tour",
        kind: "command",
        title: "Play architecture tour",
        subtitle: "Guided walkthrough of detected flows",
        icon: <Route size={13} />,
        run: () => startTour(),
      },
      ...(selected
        ? [
            {
              id: "cmd:trace",
              kind: "command" as const,
              title: `Trace flow from ${selected.label}`,
              subtitle: "shortcut: T",
              icon: <Route size={13} />,
              run: () => startDownstream(selected.id),
            },
            {
              id: "cmd:impact",
              kind: "command" as const,
              title: `Impact of ${selected.label}`,
              subtitle: "what depends on this · shortcut: I",
              icon: <Radar size={13} />,
              run: () => startImpact(selected.id),
            },
            {
              id: "cmd:path",
              kind: "command" as const,
              title: `Find path from ${selected.label}`,
              subtitle: "shortcut: P",
              icon: <GitBranch size={13} />,
              run: () => startPathPick(selected.id),
            },
          ]
        : []),
      {
        id: "cmd:analytics",
        kind: "command",
        title: "Open analytics",
        subtitle: "Charts, health metrics and cycles",
        icon: <BarChart3 size={13} />,
        run: () => {
          setExplorerTab("analytics");
          dispatch({ type: "ui/explorer", open: true });
        },
      },
      {
        id: "cmd:mermaid",
        kind: "command",
        title: "Copy Mermaid diagram",
        subtitle: "Paste into docs or a pull request",
        icon: <FileText size={13} />,
        run: () => {
          void copyText(toMermaid(graph, state.granularity)).then((ok) =>
            toast(ok ? "Mermaid diagram copied to clipboard" : "Could not access the clipboard"),
          );
        },
      },
      {
        id: "cmd:json",
        kind: "command",
        title: "Download graph JSON",
        subtitle: "Full graph model",
        icon: <Braces size={13} />,
        run: () => {
          downloadText(
            `${graph.repository.owner}-${graph.repository.name}-${graph.commitSha.slice(0, 7)}.appgraph.json`,
            JSON.stringify(graph, null, 2),
            "application/json",
          );
          toast("Graph JSON downloaded");
        },
      },
      {
        id: "cmd:fit",
        kind: "command",
        title: "Fit graph to view",
        subtitle: "shortcut: F",
        icon: <Locate size={13} />,
        run: () => {
          window.dispatchEvent(new CustomEvent("appgraph:fit"));
        },
      },
      {
        id: "cmd:reset",
        kind: "command",
        title: "Reset layout positions",
        subtitle: "shortcut: R",
        icon: <RotateCcw size={13} />,
        run: () => {
          resetPositions();
          window.dispatchEvent(new CustomEvent("appgraph:fit"));
        },
      },
      ...GRANULARITY_ITEMS.map((item) => ({
        id: `cmd:view:${item.id}`,
        kind: "command" as const,
        title: item.label,
        subtitle: "Granularity",
        icon: <Layers size={13} />,
        run: () => dispatch({ type: "ui/granularity", granularity: item.id }),
      })),
      {
        id: "cmd:external",
        kind: "command",
        title: state.filters.showExternal ? "Hide external services" : "Show external services",
        subtitle: "Filter",
        icon: state.filters.showExternal ? <EyeOff size={13} /> : <Eye size={13} />,
        run: () =>
          dispatch({ type: "ui/filter", patch: { showExternal: !state.filters.showExternal } }),
      },
      {
        id: "cmd:lowconf",
        kind: "command",
        title: state.filters.minConfidence >= 0.7 ? "Show lower-confidence edges" : "Hide low-confidence edges",
        subtitle: "Filter",
        icon: <Gauge size={13} />,
        run: () =>
          dispatch({
            type: "ui/filter",
            patch: { minConfidence: state.filters.minConfidence >= 0.7 ? 0.5 : 0.7 },
          }),
      },
      {
        id: "cmd:alledges",
        kind: "command",
        title:
          ALL_EDGE_TYPES.every((type) => state.filters.edgeTypes[type])
            ? "Hide import-only edges"
            : "Show all edge types",
        subtitle: "Filter",
        icon: <FolderTree size={13} />,
        run: () => {
          const allOn = ALL_EDGE_TYPES.every((type) => state.filters.edgeTypes[type]);
          const edgeTypes = Object.fromEntries(
            ALL_EDGE_TYPES.map((type) => [type, allOn ? type !== "imports" : true]),
          ) as Record<(typeof ALL_EDGE_TYPES)[number], boolean>;
          dispatch({ type: "ui/filter", patch: { edgeTypes } });
        },
      },
      {
        id: "cmd:share",
        kind: "command",
        title: "Copy graph share link",
        icon: <Link2 size={13} />,
        run: () => copyShareLink(),
      },
    ];

    const nodeItems: PaletteItem[] = graph.nodes
      .filter((node) => {
        if (node.type === "group") return false;
        if (!normalized) return false;
        return matchesNode(node, normalized);
      })
      .sort(
        (a, b) =>
          nodeScore(b, normalized, state.granularity) - nodeScore(a, normalized, state.granularity),
      )
      .slice(0, 14)
      .map((node) => {
        const meta = NODE_TYPE_META[node.type] ?? NODE_TYPE_META.module;
        const Icon = meta.icon;
        return {
          id: `node:${node.id}`,
          kind: "node" as const,
          title: node.label,
          subtitle: `${meta.label} · ${node.metadata.route ?? node.path ?? node.subtitle ?? ""}`,
          icon: <Icon size={13} style={{ color: meta.color }} />,
          run: () => {
            selectNode(node.id);
          },
        };
      });

    const filteredCommands = normalized
      ? commands.filter((command) => command.title.toLowerCase().includes(normalized))
      : commands;

    return [...nodeItems, ...filteredCommands].slice(0, 22);
  }, [
    graph,
    query,
    state.filters,
    state.selectedNodeId,
    state.granularity,
    dispatch,
    resetPositions,
    copyShareLink,
    selectNode,
    startTour,
    startDownstream,
    startImpact,
    startPathPick,
    setExplorerTab,
    toast,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open || !graph) return null;

  const runItem = (item: PaletteItem) => {
    item.run();
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal>
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-overlay backdrop-blur-[2px]"
        aria-label="Close command palette"
        onClick={close}
      />
      <div className="relative w-full max-w-[560px] animate-slide-up overflow-hidden rounded-xl border border-line-strong bg-panel shadow-float">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search size={14} className="text-ink-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, items.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = items[activeIndex];
                if (item) runItem(item);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            placeholder="Search nodes, routes, symbols, or run a command…"
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            aria-label="Command palette search"
          />
          <span className="ag-kbd">esc</span>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5">
          {state.pendingPathFrom ? (
            <div className="mx-2 mb-1.5 flex items-center gap-1.5 rounded-md border border-[rgba(124,140,248,0.35)] bg-[rgba(124,140,248,0.08)] px-2 py-1.5 text-2xs text-ink-secondary">
              <GitBranch size={11} className="text-accent" aria-hidden />
              Pick the destination entity for the path. Press Esc to cancel.
            </div>
          ) : null}
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-muted">
              No matches for “{query}”. Try a route, component or service name.
            </p>
          ) : (
            items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runItem(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  index === activeIndex ? "bg-elevated" : "bg-transparent",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-secondary">
                  {item.icon ?? <Command size={13} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink">{item.title}</span>
                  {item.subtitle ? (
                    <span className="block truncate font-mono text-2xs text-ink-muted">{item.subtitle}</span>
                  ) : null}
                </span>
                {item.kind === "command" ? (
                  <span className="shrink-0 rounded border border-line px-1 text-2xs uppercase tracking-wide text-ink-muted">
                    command
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function matchesNode(node: AppGraphNode, query: string): boolean {
  return (
    node.label.toLowerCase().includes(query) ||
    (node.path?.toLowerCase().includes(query) ?? false) ||
    (node.metadata.route?.toLowerCase().includes(query) ?? false) ||
    (node.symbol?.toLowerCase().includes(query) ?? false) ||
    node.type.includes(query)
  );
}

function nodeScore(node: AppGraphNode, query: string, granularity: GraphGranularity): number {
  let score = 0;
  const label = node.label.toLowerCase();
  if (label === query) score = 100;
  else if (label.startsWith(query)) score = 80;
  else if (label.includes(query)) score = 60;
  else if (node.metadata.route?.toLowerCase().includes(query)) score = 50;
  else if (node.path?.toLowerCase().includes(query)) score = 40;
  else score = 10;

  // Prefer entities that are visible in the current view, then lower granularity ranks.
  if (GRANULARITY_ORDER[node.granularity] <= GRANULARITY_ORDER[granularity]) score += 30;
  score += (3 - GRANULARITY_ORDER[node.granularity]) * 6;
  return score;
}

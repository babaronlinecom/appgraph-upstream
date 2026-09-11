"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Globe,
  LayoutTemplate,
  RotateCcw,
  ServerCog,
  Settings2,
  X,
} from "lucide-react";
import {
  GRAPH_GROUPS,
  GRANULARITY_LABELS,
  type AppGraphNode,
  type GraphGranularity,
  type GraphGroupId,
} from "@/lib/graph/model";
import { useWorkspace } from "@/features/workspace/store";
import { ALL_EDGE_TYPES, connectionCounts, visibleNodes } from "@/features/workspace/selectors";
import { EDGE_TYPE_META, NODE_TYPE_META } from "@/components/canvas/node-meta";
import { InsightsPanel } from "./InsightsPanel";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { DataPanel } from "./DataPanel";
import { cn } from "@/lib/utils/cn";

const GROUP_ICONS: Record<GraphGroupId, typeof LayoutTemplate> = {
  frontend: LayoutTemplate,
  backend: ServerCog,
  data: Database,
  config: Settings2,
  external: Globe,
};

const GRANULARITIES: GraphGranularity[] = ["product", "architecture", "modules", "files", "symbols"];

export function Explorer() {
  const { state, dispatch, resetPositions, toast, selectNode, setExplorerTab } = useWorkspace();
  const graph = state.graph;
  const [collapsed, setCollapsed] = useState<Set<GraphGroupId>>(new Set());
  const [filter, setFilter] = useState("");

  const counts = useMemo(() => (graph ? connectionCounts(graph) : new Map<string, number>()), [graph]);

  const nodesAtLevel = useMemo(() => {
    if (!graph) return [];
    return visibleNodes(graph, state.granularity, state.filters);
  }, [graph, state.granularity, state.filters]);

  const grouped = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    const map = new Map<GraphGroupId, AppGraphNode[]>();
    for (const node of nodesAtLevel) {
      if (normalized && !matches(node, normalized)) continue;
      const list = map.get(node.metadata.group) ?? [];
      list.push(node);
      map.set(node.metadata.group, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.label.localeCompare(b.label));
    }
    return map;
  }, [nodesAtLevel, filter, counts]);

  if (!graph) return null;

  const toggleGroup = (groupId: GraphGroupId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const tab = state.explorerTab;

  return (
    <aside
      className={cn(
        "z-30 flex w-[280px] shrink-0 flex-col border-r border-line bg-panel",
        "max-lg:fixed max-lg:bottom-7 max-lg:left-0 max-lg:top-12 max-lg:w-[300px] max-lg:shadow-float max-lg:transition-transform max-lg:duration-200",
        state.explorerOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
      )}
      aria-label="Explorer"
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="ag-section-label">Explorer</span>
        <button
          type="button"
          className="ag-icon-button lg:hidden"
          onClick={() => dispatch({ type: "ui/explorer", open: false })}
          aria-label="Close explorer"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        {(["nodes", "insights", "analytics", "data"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setExplorerTab(item)}
            className={cn(
              "flex-1 rounded-md px-1 py-1 text-2xs font-medium capitalize transition-colors duration-180",
              tab === item ? "bg-[#1f242c] text-ink" : "text-ink-muted hover:text-ink-secondary",
            )}
            aria-pressed={tab === item}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "insights" ? (
        <InsightsPanel />
      ) : tab === "analytics" ? (
        <AnalyticsPanel />
      ) : tab === "data" ? (
        <DataPanel />
      ) : (
        <>
          <div className="space-y-3 border-b border-line p-3">
            <div>
              <span className="ag-section-label mb-1.5 block">Granularity</span>
              <div className="grid grid-cols-5 gap-1 rounded-md border border-line bg-elevated p-1">
                {GRANULARITIES.map((granularity) => (
                  <button
                    key={granularity}
                    type="button"
                    onClick={() => dispatch({ type: "ui/granularity", granularity })}
                    className={cn(
                      "rounded px-1 py-1 text-2xs font-medium transition-colors duration-180",
                      state.granularity === granularity
                        ? "bg-[#1f242c] text-ink"
                        : "text-ink-muted hover:text-ink-secondary",
                    )}
                    aria-pressed={state.granularity === granularity}
                    title={GRANULARITY_LABELS[granularity]}
                  >
                    {GRANULARITY_LABELS[granularity].slice(0, 4)}
                  </button>
                ))}
              </div>
            </div>

            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter entities…"
              className="ag-input h-8 py-1 text-xs"
              aria-label="Filter entities"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {nodesAtLevel.length === 0 ? (
              <p className="px-2 py-4 text-xs text-ink-muted">No entities match the current filters.</p>
            ) : null}
            {GRAPH_GROUPS.map((group) => {
              const nodes = grouped.get(group.id) ?? [];
              // Groups without entities at the current granularity are hidden
              // entirely instead of rendering an empty placeholder.
              if (nodes.length === 0) return null;
              const isCollapsed = collapsed.has(group.id);
              const Icon = GROUP_ICONS[group.id];
              return (
                <section key={group.id} className="mb-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-elevated"
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={12} className="text-ink-muted" aria-hidden />
                    ) : (
                      <ChevronDown size={12} className="text-ink-muted" aria-hidden />
                    )}
                    <Icon size={12} className="text-ink-muted" aria-hidden />
                    <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-secondary">
                      {group.title}
                    </span>
                    <span className="ml-auto font-mono text-2xs text-ink-muted">{nodes.length}</span>
                  </button>

                  {!isCollapsed ? (
                    <ul className="mt-0.5 space-y-px">
                      {nodes.slice(0, 100).map((node) => {
                        const meta = NODE_TYPE_META[node.type] ?? NODE_TYPE_META.module;
                        const NodeIcon = meta.icon;
                        const selected = state.selectedNodeId === node.id;
                        return (
                          <li key={node.id}>
                            <button
                              type="button"
                              onClick={() => selectNode(node.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-180",
                                selected ? "bg-[#1c2027]" : "hover:bg-elevated",
                              )}
                              title={node.path ?? node.label}
                            >
                              <NodeIcon size={12} className="shrink-0" style={{ color: meta.color }} aria-hidden />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs text-ink">{node.label}</span>
                                <span className="block truncate font-mono text-2xs text-ink-muted">
                                  {node.metadata.route ?? node.path ?? meta.label}
                                </span>
                              </span>
                              <span className="shrink-0 font-mono text-2xs text-ink-muted">
                                {counts.get(node.id) ?? 0}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>

          <div className="space-y-3 border-t border-line p-3">
            <label className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
              <span>External services</span>
              <input
                type="checkbox"
                checked={state.filters.showExternal}
                onChange={(event) => dispatch({ type: "ui/filter", patch: { showExternal: event.target.checked } })}
                className="h-3.5 w-3.5 accent-[#7c8cf8]"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
              <span>Environment & config</span>
              <input
                type="checkbox"
                checked={state.filters.showConfig}
                onChange={(event) => dispatch({ type: "ui/filter", patch: { showConfig: event.target.checked } })}
                className="h-3.5 w-3.5 accent-[#7c8cf8]"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
              <span>Min confidence</span>
              <select
                value={String(state.filters.minConfidence)}
                onChange={(event) =>
                  dispatch({ type: "ui/filter", patch: { minConfidence: Number(event.target.value) } })
                }
                className="rounded border border-line bg-elevated px-1.5 py-0.5 text-2xs text-ink"
              >
                <option value="0.5">50%</option>
                <option value="0.6">60%</option>
                <option value="0.7">70%</option>
                <option value="0.9">90%</option>
              </select>
            </label>

            <div>
              <span className="ag-section-label mb-1.5 block">Edge types</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {ALL_EDGE_TYPES.map((edgeType) => (
                  <label key={edgeType} className="flex items-center gap-1.5 text-2xs text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={state.filters.edgeTypes[edgeType]}
                      onChange={(event) =>
                        dispatch({
                          type: "ui/filter",
                          patch: {
                            edgeTypes: { ...state.filters.edgeTypes, [edgeType]: event.target.checked },
                          },
                        })
                      }
                      className="h-3 w-3 accent-[#7c8cf8]"
                    />
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: EDGE_TYPE_META[edgeType].color }} />
                    {EDGE_TYPE_META[edgeType].label}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="ag-button w-full"
              onClick={() => {
                resetPositions();
                window.dispatchEvent(new CustomEvent("appgraph:fit"));
                toast("Layout reset");
              }}
            >
              <RotateCcw size={12} aria-hidden />
              Reset layout
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function matches(node: AppGraphNode, query: string): boolean {
  return (
    node.label.toLowerCase().includes(query) ||
    (node.path?.toLowerCase().includes(query) ?? false) ||
    (node.metadata.route?.toLowerCase().includes(query) ?? false) ||
    node.type.includes(query) ||
    (node.symbol?.toLowerCase().includes(query) ?? false)
  );
}

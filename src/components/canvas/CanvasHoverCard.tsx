"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { AppGraphEdge, AppGraphNode } from "@/lib/graph/model";
import { EDGE_TYPE_META, NODE_TYPE_META, roleLabel } from "./node-meta";

export interface HoverConnection {
  edge: AppGraphEdge;
  other: AppGraphNode;
  direction: "in" | "out";
}

export function CanvasHoverCard({
  node,
  connections,
  style,
}: {
  node: AppGraphNode;
  connections: HoverConnection[];
  style: React.CSSProperties;
}) {
  const meta = NODE_TYPE_META[node.type] ?? NODE_TYPE_META.module;
  const Icon = meta.icon;
  const role = roleLabel(node);
  const outgoing = connections.filter((connection) => connection.direction === "out").slice(0, 3);
  const incoming = connections.filter((connection) => connection.direction === "in").slice(0, 2);
  const description =
    typeof node.metadata.description === "string" ? node.metadata.description : undefined;

  return (
    <div
      style={style}
      className="pointer-events-none absolute z-30 w-[300px] animate-fade-in rounded-lg border border-line-strong bg-panel/95 p-3 shadow-float"
      role="tooltip"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
          style={{ borderColor: `${meta.color}44`, background: `${meta.color}14` }}
        >
          <Icon size={12} style={{ color: meta.color }} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="text-2xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: meta.color }}
            >
              {meta.label}
            </span>
            {role ? (
              <span className="rounded border border-line bg-elevated px-1 text-2xs uppercase tracking-wide text-ink-muted">
                {role}
              </span>
            ) : null}
          </div>
          <div className="truncate text-xs font-medium text-ink">{node.label}</div>
        </div>
      </div>

      {description ? (
        <p className="mt-2 line-clamp-2 text-2xs leading-4 text-ink-secondary">{description}</p>
      ) : null}
      {node.path ? (
        <p className="mt-1.5 truncate font-mono text-2xs text-ink-muted">{node.path}</p>
      ) : null}

      {outgoing.length > 0 ? (
        <div className="mt-2.5">
          <div className="ag-section-label mb-1 flex items-center gap-1">
            <ArrowUpRight size={10} aria-hidden />
            Leads to
          </div>
          <div className="space-y-0.5">
            {outgoing.map(({ edge, other }) => (
              <div key={edge.id} className="flex items-center gap-1.5 text-2xs">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: EDGE_TYPE_META[edge.type].color }}
                  aria-hidden
                />
                <span className="shrink-0 font-mono" style={{ color: EDGE_TYPE_META[edge.type].color }}>
                  {EDGE_TYPE_META[edge.type].label}
                </span>
                <span className="truncate text-ink-secondary">{other.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {incoming.length > 0 ? (
        <div className="mt-2.5">
          <div className="ag-section-label mb-1 flex items-center gap-1">
            <ArrowDownLeft size={10} aria-hidden />
            Depends on it
          </div>
          <div className="space-y-0.5">
            {incoming.map(({ edge, other }) => (
              <div key={edge.id} className="flex items-center gap-1.5 text-2xs">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: EDGE_TYPE_META[edge.type].color }}
                  aria-hidden
                />
                <span className="truncate text-ink-secondary">{other.label}</span>
                <span className="ml-auto shrink-0 font-mono" style={{ color: EDGE_TYPE_META[edge.type].color }}>
                  {EDGE_TYPE_META[edge.type].label}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2 text-2xs text-ink-muted">
        <span className="ag-kbd">T</span> trace
        <span className="ag-kbd">I</span> impact
        <span className="ag-kbd">P</span> path
        <span className="ml-auto">right-click for more</span>
      </div>
    </div>
  );
}

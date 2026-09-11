"use client";

import { BookOpen, X } from "lucide-react";
import type { GraphEdgeType, GraphNodeType } from "@/lib/graph/model";
import { EDGE_TYPE_META, NODE_TYPE_META } from "./node-meta";

const LEGEND_NODE_TYPES: GraphNodeType[] = [
  "page",
  "component",
  "api",
  "service",
  "database",
  "external",
  "state",
  "middleware",
  "config",
  "module",
];

const LEGEND_EDGE_TYPES: GraphEdgeType[] = [
  "renders",
  "routes_to",
  "calls",
  "reads",
  "writes",
  "uses",
  "imports",
  "depends_on",
];

export function LegendButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-md border border-line bg-panel/95 px-2 py-1 text-2xs text-ink-secondary shadow-panel transition-colors duration-180 hover:border-line-strong hover:text-ink"
      aria-expanded={open}
      aria-label={open ? "Hide legend" : "Show legend"}
    >
      <BookOpen size={11} aria-hidden />
      Legend
    </button>
  );
}

export function CanvasLegend({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute right-4 top-4 z-30 w-[252px] animate-slide-up rounded-lg border border-line bg-panel/95 p-3 shadow-float">
      <div className="mb-2 flex items-center justify-between">
        <span className="ag-section-label">Map legend</span>
        <button type="button" className="ag-icon-button -mr-1 -mt-1 h-6 w-6" onClick={onClose} aria-label="Hide legend">
          <X size={12} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {LEGEND_NODE_TYPES.map((type) => {
          const meta = NODE_TYPE_META[type];
          const Icon = meta.icon;
          return (
            <div key={type} className="flex items-center gap-1.5 text-2xs text-ink-secondary">
              <Icon size={11} style={{ color: meta.color }} aria-hidden />
              {meta.label}
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-1 border-t border-line pt-2">
        {LEGEND_EDGE_TYPES.map((type) => {
          const meta = EDGE_TYPE_META[type];
          return (
            <div key={type} className="flex items-center gap-2 text-2xs text-ink-secondary">
              <svg width="26" height="8" aria-hidden>
                <line
                  x1="0"
                  y1="4"
                  x2="26"
                  y2="4"
                  stroke={meta.color}
                  strokeWidth="1.6"
                  strokeDasharray={meta.dashed ? "4 3" : undefined}
                />
              </svg>
              {meta.label}
              <span className="ml-auto truncate text-2xs text-ink-muted">{meta.description}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 border-t border-line pt-2 text-2xs leading-5 text-ink-muted">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ag-kbd">T</span> trace
          <span className="ag-kbd">I</span> impact
          <span className="ag-kbd">P</span> path
          <span className="ag-kbd">F</span> fit
          <span className="ag-kbd">⌘K</span> commands
        </div>
      </div>
    </div>
  );
}

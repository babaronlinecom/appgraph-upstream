"use client";

import {
  Copy,
  Crosshair,
  ExternalLink,
  GitBranch,
  Github,
  Radar,
  Route,
} from "lucide-react";
import type { AppGraphNode } from "@/lib/graph/model";
import { NODE_TYPE_META } from "./node-meta";

export interface NodeContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

export function NodeContextMenu({
  menu,
  node,
  githubUrl,
  onTrace,
  onImpact,
  onPath,
  onFocus,
  onCopyPath,
  onClose,
}: {
  menu: NodeContextMenuState;
  node: AppGraphNode;
  githubUrl?: string;
  onTrace: () => void;
  onImpact: () => void;
  onPath: () => void;
  onFocus: () => void;
  onCopyPath: () => void;
  onClose: () => void;
}) {
  const meta = NODE_TYPE_META[node.type] ?? NODE_TYPE_META.module;
  const Icon = meta.icon;

  const itemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ink-secondary hover:bg-elevated hover:text-ink";

  return (
    <>
      <button
        type="button"
        aria-label="Close context menu"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 w-[224px] animate-fade-in rounded-lg border border-line-strong bg-panel/98 p-1.5 shadow-float"
        style={{ left: menu.x, top: menu.y }}
        role="menu"
      >
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Icon size={12} style={{ color: meta.color }} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{node.label}</span>
          <span className="shrink-0 font-mono text-2xs uppercase tracking-wide" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
        <div className="my-1 h-px bg-line" />
        <button type="button" role="menuitem" className={itemClass} onClick={onTrace}>
          <Route size={13} aria-hidden />
          Trace flow
          <span className="ag-kbd ml-auto">T</span>
        </button>
        <button type="button" role="menuitem" className={itemClass} onClick={onImpact}>
          <Radar size={13} aria-hidden />
          Impact analysis
          <span className="ag-kbd ml-auto">I</span>
        </button>
        <button type="button" role="menuitem" className={itemClass} onClick={onPath}>
          <GitBranch size={13} aria-hidden />
          Find path from here
          <span className="ag-kbd ml-auto">P</span>
        </button>
        <button type="button" role="menuitem" className={itemClass} onClick={onFocus}>
          <Crosshair size={13} aria-hidden />
          Focus neighborhood
        </button>
        <div className="my-1 h-px bg-line" />
        {node.path ? (
          <button type="button" role="menuitem" className={itemClass} onClick={onCopyPath}>
            <Copy size={13} aria-hidden />
            Copy source path
          </button>
        ) : null}
        {githubUrl ? (
          <a
            role="menuitem"
            className={itemClass}
            href={githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={onClose}
          >
            <Github size={13} aria-hidden />
            Open on GitHub
            <ExternalLink size={10} className="ml-auto" aria-hidden />
          </a>
        ) : null}
      </div>
    </>
  );
}

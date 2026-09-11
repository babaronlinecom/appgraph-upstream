"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_TYPE_META, roleLabel } from "./node-meta";
import type { GraphFlowNode } from "./flow-types";

export const GraphNodeView = memo(function GraphNodeView({ data, selected }: NodeProps<GraphFlowNode>) {
  const { node, connectionCount } = data;
  const meta = NODE_TYPE_META[node.type] ?? NODE_TYPE_META.module;
  const Icon = meta.icon;
  const role = roleLabel(node);

  return (
    <div
      className="ag-node-card relative flex h-[92px] w-[252px] flex-col justify-between overflow-hidden rounded-lg border border-line bg-[#101318] px-3 py-2.5 transition-[transform,border-color,box-shadow] duration-180 hover:-translate-y-px"
      style={
        selected
          ? {
              borderColor: `${meta.color}cc`,
              boxShadow: `0 0 0 1px ${meta.color}55, 0 16px 36px -18px ${meta.color}99`,
            }
          : undefined
      }
      aria-label={`${meta.label}: ${node.label}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2.5px]"
        style={{ background: meta.color, opacity: selected ? 1 : 0.55 }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(180deg, ${meta.color}12, transparent 62%)` }}
      />

      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="relative flex items-center gap-1.5">
        <Icon size={11} strokeWidth={2.2} style={{ color: meta.color }} aria-hidden />
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
        <span className="ml-auto flex items-center gap-1 font-mono text-2xs text-ink-muted">
          <span className="h-1 w-1 rounded-full" style={{ background: `${meta.color}aa` }} aria-hidden />
          {connectionCount}
        </span>
      </div>

      <div className="relative min-w-0">
        <div className="truncate text-[13px] font-medium leading-5 text-ink" title={node.label}>
          {node.label}
        </div>
        <div
          className="truncate font-mono text-[10.5px] leading-4 text-ink-muted"
          title={node.subtitle ?? node.path}
        >
          {node.subtitle ?? node.path ?? ""}
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

"use client";

import { memo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import type { GraphGroupId } from "@/lib/graph/model";
import { cn } from "@/lib/utils/cn";
import type { GroupFlowNode } from "./flow-types";

export const GROUP_COLORS: Record<GraphGroupId, string> = {
  frontend: "#8ba7f5",
  backend: "#e0b05c",
  data: "#e08bb0",
  config: "#9aa6b8",
  external: "#e29a5c",
};

export const GroupNodeView = memo(function GroupNodeView({ data }: NodeProps<GroupFlowNode>) {
  const { groupId, title, count, collapsed, onToggle } = data;
  const color = GROUP_COLORS[groupId] ?? "#8f98a3";

  return (
    <div
      className={cn(
        "h-full w-full rounded-xl border border-dashed transition-colors duration-180",
        collapsed ? "bg-[#0d0f13]" : "bg-[rgba(19,22,27,0.28)]",
      )}
      style={{ borderColor: `${color}3d` }}
      data-group={groupId}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(groupId);
        }}
        className="flex h-11 w-full items-center gap-1.5 rounded-t-xl px-3 text-left hover:bg-[rgba(255,255,255,0.02)]"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${title} group`}
      >
        {collapsed ? (
          <ChevronRight size={12} className="text-ink-muted" aria-hidden />
        ) : (
          <ChevronDown size={12} className="text-ink-muted" aria-hidden />
        )}
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
        <span
          className="text-2xs font-semibold uppercase tracking-[0.16em]"
          style={{ color: `${color}e6` }}
        >
          {title}
        </span>
        <span className="ml-auto rounded border border-line bg-elevated px-1.5 font-mono text-2xs text-ink-muted">
          {count}
        </span>
      </button>
    </div>
  );
});

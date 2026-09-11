"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore, type EdgeProps } from "@xyflow/react";
import { EDGE_TYPE_META } from "./node-meta";
import type { GraphFlowEdge } from "./flow-types";

export const GraphEdgeView = memo(function GraphEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<GraphFlowEdge>) {
  const zoom = useStore((state) => state.transform[2]);
  const edge = data?.edge;
  const meta = edge ? EDGE_TYPE_META[edge.type] : EDGE_TYPE_META.imports;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
    offset: 26,
  });

  const dimmed = Boolean(data?.dimmed);
  const highlighted = Boolean(data?.highlighted) || Boolean(selected);
  const active = Boolean(data?.active);
  const showLabel =
    !dimmed &&
    (highlighted ||
      active ||
      (zoom >= 1.05 && edge?.type !== "imports" && edge?.type !== "depends_on") ||
      (zoom >= 0.85 && edge?.type === "routes_to"));

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: active ? "#8b9cf9" : highlighted ? meta.color : dimmed ? "#262a31" : meta.color,
          strokeWidth: active ? 2.4 : highlighted ? 2 : dimmed ? 1 : 1.3,
          strokeOpacity: dimmed ? 0.5 : highlighted || active ? 1 : 0.75,
          strokeDasharray: active ? "7 7" : meta.dashed ? "5 4" : undefined,
          filter: highlighted || active ? `drop-shadow(0 0 5px ${meta.color}66)` : undefined,
        }}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="pointer-events-none absolute rounded border border-line bg-[#0d0f13]/95 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-ink-secondary"
          >
            {meta.label}
            {typeof edge?.metadata?.count === "number" && (edge.metadata.count as number) > 1
              ? ` ·${edge.metadata.count}`
              : ""}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

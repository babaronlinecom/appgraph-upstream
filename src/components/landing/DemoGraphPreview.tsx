"use client";

import { useMemo } from "react";
import { Background, BackgroundVariant, MarkerType, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AppGraphEdge, AppGraphNode, GraphEdgeType, GraphGroupId, GraphNodeType } from "@/lib/graph/model";
import { GraphNodeView } from "@/components/canvas/GraphNodeView";
import { GraphEdgeView } from "@/components/canvas/GraphEdgeView";
import { EDGE_TYPE_META } from "@/components/canvas/node-meta";
import type { AnyFlowNode, GraphFlowEdge } from "@/components/canvas/flow-types";

const nodeTypes = { graphNode: GraphNodeView };
const edgeTypes = { graphEdge: GraphEdgeView };

interface DemoSpec {
  id: string;
  type: GraphNodeType;
  label: string;
  subtitle: string;
  group: GraphGroupId;
  x: number;
  y: number;
}

const DEMO_NODES: DemoSpec[] = [
  { id: "demo:home", type: "page", label: "Home", subtitle: "/", group: "frontend", x: 0, y: 20 },
  { id: "demo:dashboard", type: "page", label: "Dashboard", subtitle: "/dashboard", group: "frontend", x: 0, y: 150 },
  { id: "demo:list", type: "component", label: "ProjectList", subtitle: "src/components/ProjectList.tsx", group: "frontend", x: 300, y: 20 },
  { id: "demo:hook", type: "state", label: "useProjects", subtitle: "src/hooks/useProjects.ts", group: "frontend", x: 300, y: 150 },
  { id: "demo:api", type: "api", label: "GET /api/projects", subtitle: "src/app/api/projects/route.ts", group: "backend", x: 600, y: 40 },
  { id: "demo:service", type: "service", label: "ProjectService", subtitle: "src/services/project-service.ts", group: "backend", x: 900, y: 40 },
  { id: "demo:env", type: "config", label: "Environment Variables", subtitle: "process.env · 4 keys", group: "config", x: 600, y: 170 },
  { id: "demo:db", type: "database", label: "PostgreSQL", subtitle: "Prisma", group: "data", x: 900, y: 170 },
  { id: "demo:stripe", type: "external", label: "Stripe", subtitle: "Payments", group: "external", x: 900, y: 300 },
];

const DEMO_EDGES: Array<{ source: string; target: string; type: GraphEdgeType }> = [
  { source: "demo:dashboard", target: "demo:list", type: "renders" },
  { source: "demo:list", target: "demo:hook", type: "calls" },
  { source: "demo:dashboard", target: "demo:api", type: "routes_to" },
  { source: "demo:api", target: "demo:service", type: "calls" },
  { source: "demo:service", target: "demo:db", type: "reads" },
  { source: "demo:service", target: "demo:env", type: "uses" },
  { source: "demo:service", target: "demo:stripe", type: "uses" },
];

function buildDemo(): { nodes: AnyFlowNode[]; edges: GraphFlowEdge[] } {
  const counts = new Map<string, number>();
  for (const edge of DEMO_EDGES) {
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }

  const nodes: AnyFlowNode[] = DEMO_NODES.map((spec) => {
    const node: AppGraphNode = {
      id: spec.id,
      type: spec.type,
      label: spec.label,
      subtitle: spec.subtitle,
      confidence: 1,
      granularity: "architecture",
      metadata: { group: spec.group },
    };
    return {
      id: spec.id,
      type: "graphNode",
      position: { x: spec.x, y: spec.y },
      data: { node, connectionCount: counts.get(spec.id) ?? 0 },
      draggable: false,
      selectable: false,
      focusable: false,
    };
  });

  const edges: GraphFlowEdge[] = DEMO_EDGES.map((spec, index) => {
    const edge: AppGraphEdge = {
      id: `demo-edge-${index}`,
      source: spec.source,
      target: spec.target,
      type: spec.type,
      confidence: 0.95,
    };
    return {
      id: edge.id,
      source: spec.source,
      target: spec.target,
      type: "graphEdge",
      data: { edge, dimmed: false, highlighted: false },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_TYPE_META[spec.type].color, width: 14, height: 14 },
      focusable: false,
      selectable: false,
    };
  });

  return { nodes, edges };
}

function DemoPreviewInner() {
  const elements = useMemo(buildDemo, []);
  return (
    <ReactFlow
      nodes={elements.nodes}
      edges={elements.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      panOnDrag
      minZoom={0.35}
      maxZoom={1.25}
      className="h-full w-full"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#191c22" className="ag-dot-pattern" />
    </ReactFlow>
  );
}

export function DemoGraphPreview() {
  return (
    <section className="mx-auto mt-16 w-full max-w-6xl px-6">
      <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-panel">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <span className="ag-section-label">Live preview</span>
          <span className="hidden text-2xs text-ink-muted sm:inline">
            A sample architecture — pages, API routes, services, data and external systems
          </span>
          <div className="ml-auto hidden items-center gap-3 text-2xs text-ink-muted md:flex">
            {(["renders", "routes_to", "reads", "uses"] as GraphEdgeType[]).map((type) => (
              <span key={type} className="inline-flex items-center gap-1.5">
                <span className="h-1 w-4 rounded-full" style={{ background: EDGE_TYPE_META[type].color }} />
                {EDGE_TYPE_META[type].label}
              </span>
            ))}
          </div>
        </div>
        <div className="relative h-[380px] w-full bg-canvas">
          <ReactFlowProvider>
            <DemoPreviewInner />
          </ReactFlowProvider>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-canvas to-transparent" />
        </div>
      </div>
      <p className="mt-3 text-center text-2xs text-ink-muted">
        Paste a repository above to build this map from real source code.
      </p>
    </section>
  );
}

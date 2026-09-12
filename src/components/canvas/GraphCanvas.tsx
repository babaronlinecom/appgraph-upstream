"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type OnNodeDrag,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MousePointerClick, X } from "lucide-react";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type AppGraphDocument,
  type AppGraphNode,
  type GraphGroupId,
  type GraphLayout,
} from "@/lib/graph/model";
import { useWorkspace } from "@/features/workspace/store";
import { connectionCounts, layoutFor, neighborsOf, visibleEdges, visibleNodes } from "@/features/workspace/selectors";
import { EDGE_PRIORITY, pathToTraceSetup } from "@/features/workspace/trace";
import { buildGitHubFileUrl } from "@/lib/github/url";
import { EDGE_TYPE_META, NODE_TYPE_META } from "./node-meta";
import { GraphNodeView } from "./GraphNodeView";
import { GroupNodeView } from "./GroupNodeView";
import { GraphEdgeView } from "./GraphEdgeView";
import { TracePlayer } from "./TracePlayer";
import { CanvasHoverCard, type HoverConnection } from "./CanvasHoverCard";
import { CanvasLegend, LegendButton } from "./CanvasLegend";
import { NodeContextMenu, type NodeContextMenuState } from "./NodeContextMenu";
import type { AnyFlowNode, GraphFlowEdge, GraphFlowNode, GroupFlowNode } from "./flow-types";

const nodeTypes = { graphNode: GraphNodeView, groupNode: GroupNodeView };
const edgeTypes = { graphEdge: GraphEdgeView };

const HINT_STORAGE_KEY = "appgraph:canvas-hint-dismissed";
const LEGEND_STORAGE_KEY = "appgraph:legend-open";

interface ElementCache {
  nodes: Map<string, { signature: string; node: AnyFlowNode }>;
  edges: Map<string, { signature: string; edge: GraphFlowEdge }>;
}

interface BuiltElements {
  nodes: AnyFlowNode[];
  edges: GraphFlowEdge[];
  absolute: Map<string, { x: number; y: number }>;
}

function buildElements(
  graph: AppGraphDocument,
  state: ReturnType<typeof useWorkspace>["state"],
  onToggleGroup: (groupId: GraphGroupId) => void,
  cache: ElementCache,
): BuiltElements {
  const layout = layoutFor(graph, state.granularity);
  if (!layout) return { nodes: [], edges: [], absolute: new Map() };
  const nodes = visibleNodes(graph, state.granularity, state.filters);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visibleIds = new Set(byId.keys());
  const edges = visibleEdges(graph, state.granularity, state.filters, visibleIds).filter((edge) => {
    if (!layout.nodePlacements[edge.source] || !layout.nodePlacements[edge.target]) return false;
    return true;
  });
  const counts = connectionCounts(graph);

  const nodeToGroup = new Map<string, (typeof layout.groups)[number]>();
  for (const group of layout.groups) {
    for (const nodeId of group.nodeIds) nodeToGroup.set(nodeId, group);
  }

  const collapsedSet = new Set(state.collapsedGroups);
  const overrides = state.manualPositions[state.granularity] ?? {};
  const trace = state.trace;
  const emphasis = trace ? undefined : state.focusNodeId ?? state.hoveredNodeId;
  const neighbor = emphasis && byId.has(emphasis) ? neighborsOf(graph, emphasis) : null;
  const selectedNeighbor = state.selectedNodeId ? neighborsOf(graph, state.selectedNodeId) : null;
  const hoveredEdge = state.hoveredEdgeId
    ? graph.edges.find((edge) => edge.id === state.hoveredEdgeId)
    : undefined;

  const tracedNodes = new Set<string>();
  const tracedEdges = new Set<string>();
  const activeNodes = new Set<string>();
  const activeEdges = new Set<string>();
  if (trace) {
    for (let index = 0; index <= trace.index && index < trace.steps.length; index += 1) {
      const step = trace.steps[index];
      for (const id of step.nodeIds) tracedNodes.add(id);
      for (const id of step.edgeIds) tracedEdges.add(id);
    }
    const current = trace.steps[trace.index];
    if (current) {
      for (const id of current.nodeIds) activeNodes.add(id);
      for (const id of current.edgeIds) activeEdges.add(id);
    }
  }

  const hiddenIds = new Set<string>();
  for (const node of nodes) {
    const group = nodeToGroup.get(node.id);
    if (group && collapsedSet.has(group.group)) hiddenIds.add(node.id);
  }

  const putNode = (id: string, signature: string, create: () => AnyFlowNode): AnyFlowNode => {
    const cached = cache.nodes.get(id);
    if (cached && cached.signature === signature) return cached.node;
    const node = create();
    cache.nodes.set(id, { signature, node });
    return node;
  };

  const flowNodes: AnyFlowNode[] = [];
  const absolute = new Map<string, { x: number; y: number }>();

  for (const group of layout.groups) {
    const members = group.nodeIds.filter((id) => byId.has(id));
    if (members.length === 0) continue;
    const collapsed = collapsedSet.has(group.group);
    const height = collapsed ? 46 : group.height;
    const signature = `g:${group.x}:${group.y}:${group.width}:${height}:${collapsed}:${members.length}`;
    flowNodes.push(
      putNode(group.id, signature, () => {
        const groupNode: GroupFlowNode = {
          id: group.id,
          type: "groupNode",
          position: { x: group.x, y: group.y },
          width: group.width,
          height,
          style: { width: group.width, height, zIndex: 0 },
          data: {
            groupId: group.group,
            title: group.title,
            count: members.length,
            collapsed,
            onToggle: onToggleGroup,
          },
          selectable: false,
          draggable: !collapsed,
          zIndex: 0,
        };
        return groupNode;
      }),
    );
  }

  for (const node of nodes) {
    const placement = layout.nodePlacements[node.id];
    if (!placement) continue;
    const group = nodeToGroup.get(node.id);
    const collapsed = group ? collapsedSet.has(group.group) : false;
    const override = overrides[node.id];
    const absolutePosition = override ?? { x: placement.x, y: placement.y };
    absolute.set(node.id, absolutePosition);

    const parent = group && !collapsed ? group : undefined;
    const position = parent
      ? { x: absolutePosition.x - parent.x, y: absolutePosition.y - parent.y }
      : absolutePosition;

    const classes: string[] = [];
    if (trace) {
      if (activeNodes.has(node.id)) classes.push("ag-trace-active");
      else if (tracedNodes.has(node.id)) classes.push("ag-trace-past");
      else classes.push("ag-node-muted");
    } else if (emphasis && neighbor) {
      if (emphasis === node.id) classes.push("ag-node-highlighted");
      else if (neighbor.nodes.has(node.id)) classes.push("ag-node-related");
      else classes.push("ag-node-dimmed");
    }
    if (
      !trace &&
      hoveredEdge &&
      (node.id === hoveredEdge.source || node.id === hoveredEdge.target) &&
      !classes.includes("ag-node-dimmed")
    ) {
      classes.push("ag-node-related");
    }
    if (
      !trace &&
      state.selectedNodeId &&
      state.selectedNodeId !== node.id &&
      selectedNeighbor?.nodes.has(node.id) &&
      !classes.includes("ag-node-dimmed")
    ) {
      classes.push("ag-node-related");
    }

    const connectionCount = counts.get(node.id) ?? 0;
    const traceActive = activeNodes.has(node.id) ? 1 : 0;
    const signature = `n:${position.x},${position.y}:${parent?.id ?? ""}:${collapsed}:${classes.join(
      ".",
    )}:${connectionCount}:${traceActive}`;

    flowNodes.push(
      putNode(node.id, signature, () => {
        const flowNode: GraphFlowNode = {
          id: node.id,
          type: "graphNode",
          position,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          parentId: parent?.id,
          extent: parent ? "parent" : undefined,
          hidden: collapsed,
          draggable: true,
          selectable: true,
          className: classes.join(" "),
          data: { node, connectionCount, traceActive: Boolean(traceActive) },
          zIndex: 1,
        };
        return flowNode;
      }),
    );
  }

  const putEdge = (id: string, signature: string, create: () => GraphFlowEdge): GraphFlowEdge => {
    const cached = cache.edges.get(id);
    if (cached && cached.signature === signature) return cached.edge;
    const edge = create();
    cache.edges.set(id, { signature, edge });
    return edge;
  };

  const flowEdges: GraphFlowEdge[] = edges
    .filter((edge) => !hiddenIds.has(edge.source) && !hiddenIds.has(edge.target))
    .filter((edge) => !trace || tracedEdges.has(edge.id))
    .map((edge) => {
      const meta = EDGE_TYPE_META[edge.type];
      const active = activeEdges.has(edge.id);
      const hovered = state.hoveredEdgeId === edge.id;
      const dimmed = trace ? false : neighbor ? !neighbor.edges.has(edge.id) : false;
      const highlighted = trace ? false : hovered || (neighbor ? neighbor.edges.has(edge.id) : false);
      const classes = active ? "ag-trace-edge" : trace ? "ag-edge-muted" : "";
      const markerColor = active || highlighted ? meta.color : "#3a4048";
      const signature = `e:${edge.source}->${edge.target}:${classes}:${dimmed}:${highlighted}:${active}:${markerColor}`;
      return putEdge(edge.id, signature, () => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "graphEdge",
        data: { edge, dimmed, highlighted, active },
        className: classes,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: markerColor,
          width: 14,
          height: 14,
        },
        selectable: true,
        focusable: true,
        zIndex: active || hovered ? 2 : 0,
      }));
    });

  return { nodes: flowNodes, edges: flowEdges, absolute };
}

interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function contentBounds(layout: GraphLayout): ContentBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const placement of Object.values(layout.nodePlacements)) {
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }
  for (const group of layout.groups) {
    minX = Math.min(minX, group.x);
    minY = Math.min(minY, group.y);
    maxX = Math.max(maxX, group.x + group.width);
    maxY = Math.max(maxY, group.y + group.height);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function boundsForNodeIds(layout: GraphLayout, ids: string[]): ContentBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const id of ids) {
    const placement = layout.nodePlacements[id];
    if (!placement) continue;
    found = true;
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }
  if (!found) return null;
  return { minX, minY, maxX, maxY };
}

const READABLE_ZOOM = 0.68;
const MIN_FIT_ZOOM = 0.55;
const FRAME_PADDING = 72;
const MAX_FIT_ZOOM = 1.1;

function computeFramingForBounds(
  bounds: ContentBounds,
  viewportWidth: number,
  viewportHeight: number,
  options: { padding?: number; minZoom?: number; maxZoom?: number } = {},
): { x: number; y: number; zoom: number } {
  const padding = options.padding ?? FRAME_PADDING;
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const fitZoom = Math.min(
    (viewportWidth - padding * 2) / contentWidth,
    (viewportHeight - padding * 2) / contentHeight,
  );
  const zoom = Math.min(
    Math.max(fitZoom, options.minZoom ?? 0.05),
    options.maxZoom ?? MAX_FIT_ZOOM,
  );
  return {
    x: (viewportWidth - contentWidth * zoom) / 2 - bounds.minX * zoom,
    y: (viewportHeight - contentHeight * zoom) / 2 - bounds.minY * zoom,
    zoom,
  };
}

/**
 * Deterministic framing that relies on server-side layout coordinates, so it is
 * independent of DOM measurement timing. Wide lane layouts are anchored to the
 * readable start of the flow instead of being zoomed into illegibility.
 */
function computeFraming(
  layout: GraphLayout,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number; zoom: number } {
  const bounds = contentBounds(layout);
  const framing = computeFramingForBounds(bounds, viewportWidth, viewportHeight);
  if (framing.zoom >= MIN_FIT_ZOOM) return framing;

  const targetZoom = READABLE_ZOOM;
  return {
    x: 48 - bounds.minX * targetZoom,
    y: viewportHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * targetZoom,
    zoom: targetZoom,
  };
}

function HoverCardLayer({
  node,
  connections,
  absolute,
}: {
  node?: AppGraphNode;
  connections: HoverConnection[];
  absolute: Map<string, { x: number; y: number }>;
}) {
  const transform = useStore((store) => store.transform);
  const viewportWidth = useStore((store) => store.width);
  const viewportHeight = useStore((store) => store.height);

  if (!node) return null;
  const position = absolute.get(node.id);
  if (!position || !viewportWidth) return null;

  const [translateX, translateY, zoom] = transform;
  const cardWidth = 300;
  const cardHeight = 230;
  const nodeLeft = position.x * zoom + translateX;
  const nodeTop = position.y * zoom + translateY;
  const nodeBottom = (position.y + NODE_HEIGHT) * zoom + translateY;

  let left = nodeLeft;
  if (left + cardWidth > viewportWidth - 8) left = Math.max(8, viewportWidth - cardWidth - 8);

  let top = nodeBottom + 14;
  if (top + cardHeight > viewportHeight - 8) {
    top = nodeTop - cardHeight - 14;
  }
  top = Math.min(Math.max(top, 8), Math.max(8, viewportHeight - cardHeight - 8));

  return <CanvasHoverCard node={node} connections={connections} style={{ left, top }} />;
}

function GraphCanvasInner() {
  const {
    state,
    dispatch,
    setManualPosition,
    resetPositions,
    toast,
    selectNode,
    startTrace,
    startDownstream,
    startImpact,
    startPathPick,
  } = useWorkspace();
  const graph = state.graph;
  const flow = useReactFlow();
  const viewportWidth = useStore((store) => store.width);
  const viewportHeight = useStore((store) => store.height);
  const absoluteRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const cacheRef = useRef<ElementCache>({ nodes: new Map(), edges: new Map() });
  const lastFitKey = useRef<string>("");
  const lastFocusRef = useRef<string | undefined>(undefined);
  const [edgeTip, setEdgeTip] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(null);

  useEffect(() => {
    try {
      setHintVisible(window.localStorage.getItem(HINT_STORAGE_KEY) !== "1");
      setLegendOpen(window.localStorage.getItem(LEGEND_STORAGE_KEY) === "1");
    } catch {
      setHintVisible(true);
    }
  }, []);

  const dismissHint = useCallback(() => {
    setHintVisible(false);
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      // ignore storage failures
    }
  }, []);

  const setLegend = useCallback((open: boolean) => {
    setLegendOpen(open);
    try {
      window.localStorage.setItem(LEGEND_STORAGE_KEY, open ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, []);

  const onToggleGroup = useCallback(
    (groupId: GraphGroupId) => dispatch({ type: "ui/toggleGroup", groupId }),
    [dispatch],
  );

  const fitToContent = useCallback(() => {
    if (!graph || !viewportWidth || !viewportHeight) return;
    const layout = layoutFor(graph, state.granularity);
    if (!layout) return;
    const target = computeFraming(layout, viewportWidth, viewportHeight);
    void flow.setViewport(target, { duration: 420 });
  }, [graph, state.granularity, viewportWidth, viewportHeight, flow]);

  const elements = useMemo<BuiltElements>(() => {
    if (!graph) return { nodes: [], edges: [], absolute: new Map() };
    return buildElements(graph, state, onToggleGroup, cacheRef.current);
  }, [graph, state, onToggleGroup]);

  absoluteRef.current = elements.absolute;

  useEffect(() => {
    if (!graph) return;
    if (state.focusNodeId || state.trace) return;
    if (!viewportWidth || !viewportHeight) return;
    const key = `${graph.commitSha}:${state.granularity}`;
    if (lastFitKey.current === key) return;
    lastFitKey.current = key;
    const layout = layoutFor(graph, state.granularity);
    if (!layout) return;
    const framing = computeFraming(layout, viewportWidth, viewportHeight);
    void flow.setViewport(framing, { duration: 420 });
  }, [graph, state.granularity, state.focusNodeId, state.trace, viewportWidth, viewportHeight, flow]);

  useEffect(() => {
    const focusId = state.focusNodeId;
    if (!focusId || !graph || state.trace) return;
    if (lastFocusRef.current === focusId) return;
    lastFocusRef.current = focusId;
    const position = absoluteRef.current.get(focusId);
    if (!position) return;
    const currentZoom = flow.getZoom();
    void flow.setCenter(position.x + NODE_WIDTH / 2, position.y + NODE_HEIGHT / 2, {
      zoom: Math.max(currentZoom, 0.75),
      duration: 520,
    });
  }, [state.focusNodeId, graph, state.trace, flow]);

  // Camera follows the active trace step.
  useEffect(() => {
    const trace = state.trace;
    if (!trace || !graph || !viewportWidth || !viewportHeight) return;
    const step = trace.steps[trace.index];
    if (!step) return;
    const layout = layoutFor(graph, state.granularity);
    if (!layout) return;
    const bounds = boundsForNodeIds(layout, step.nodeIds);
    if (!bounds) return;
    const framing = computeFramingForBounds(bounds, viewportWidth, viewportHeight, {
      padding: 220,
      minZoom: trace.steps.length > 6 ? 0.55 : 0.8,
      maxZoom: 1.35,
    });
    void flow.setViewport(framing, { duration: 620 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trace?.index, state.trace?.title, graph, state.granularity, viewportWidth, viewportHeight, flow]);

  const handleNodeClick = useCallback<NodeMouseHandler<AnyFlowNode>>(
    (_event, node) => {
      if (node.type !== "graphNode") return;
      setContextMenu(null);
      selectNode(node.id);
    },
    [selectNode],
  );

  const handleNodeDoubleClick = useCallback<NodeMouseHandler<AnyFlowNode>>(
    (_event, node) => {
      if (node.type !== "graphNode") return;
      dispatch({ type: "ui/focus", nodeId: node.id });
      selectNode(node.id);
    },
    [dispatch, selectNode],
  );

  const handleNodeMouseEnter = useCallback<NodeMouseHandler<AnyFlowNode>>(
    (_event, node) => {
      if (node.type !== "graphNode") return;
      dispatch({ type: "ui/hover", nodeId: node.id });
    },
    [dispatch],
  );

  const handleNodeMouseLeave = useCallback(() => {
    dispatch({ type: "ui/hover", nodeId: undefined });
  }, [dispatch]);

  const handleNodeContextMenu = useCallback<NodeMouseHandler<AnyFlowNode>>(
    (event, node) => {
      if (node.type !== "graphNode") return;
      event.preventDefault();
      const menuWidth = 224;
      const x = Math.min(event.clientX, (window.innerWidth ?? 1200) - menuWidth - 12);
      setContextMenu({ x, y: event.clientY, nodeId: node.id });
    },
    [],
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    dispatch({ type: "ui/select", nodeId: undefined });
    dispatch({ type: "ui/focus", nodeId: undefined });
  }, [dispatch]);

  const handleEdgeClick = useCallback<EdgeMouseHandler<GraphFlowEdge>>(
    (_event, edge) => {
      if (!graph) return;
      const graphEdge = graph.edges.find((candidate) => candidate.id === edge.id);
      if (!graphEdge) return;
      const setup = pathToTraceSetup(
        graph,
        { nodeIds: [graphEdge.source, graphEdge.target], edgeIds: [graphEdge.id] },
        { title: `Connection · ${graphEdge.type.replace("_", " ")}` },
      );
      startTrace(setup, { playing: false });
    },
    [graph, startTrace],
  );

  const handleEdgeMouseEnter = useCallback<EdgeMouseHandler<GraphFlowEdge>>((event, edge) => {
    setEdgeTip({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    dispatch({ type: "ui/hoverEdge", edgeId: edge.id });
  }, [dispatch]);

  const handleEdgeMouseMove = useCallback<EdgeMouseHandler<GraphFlowEdge>>((event, edge) => {
    setEdgeTip({ x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  const handleEdgeMouseLeave = useCallback(() => {
    setEdgeTip(null);
    dispatch({ type: "ui/hoverEdge", edgeId: undefined });
  }, [dispatch]);

  const handleNodeDragStop = useCallback<OnNodeDrag<AnyFlowNode>>(
    (_event, node) => {
      if (node.type !== "graphNode" && node.type !== "groupNode") return;
      let absolute = { x: node.position.x, y: node.position.y };
      if (node.parentId) {
        const parent = flow.getNode(node.parentId);
        if (parent) {
          absolute = { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y };
        }
      }
      setManualPosition(node.id, { x: Math.round(absolute.x), y: Math.round(absolute.y) });
    },
    [flow, setManualPosition],
  );

  const handleNodeDragStart = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    window.addEventListener("appgraph:fit", fitToContent);
    return () => window.removeEventListener("appgraph:fit", fitToContent);
  }, [fitToContent]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTyping) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "ui/palette", open: true });
        return;
      }
      if (event.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        if (state.pendingPathFrom) {
          dispatch({ type: "ui/pathPick" });
          return;
        }
        if (state.trace) {
          dispatch({ type: "trace/stop" });
          return;
        }
        dispatch({ type: "ui/select", nodeId: undefined });
        dispatch({ type: "ui/focus", nodeId: undefined });
        return;
      }
      if (event.key === " " && state.trace) {
        event.preventDefault();
        dispatch({ type: "trace/playing", playing: !state.trace.playing });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "f") {
        fitToContent();
      } else if (key === "r") {
        resetPositions();
        toast("Layout reset");
        fitToContent();
      } else if (key === "l") {
        setLegend(!legendOpen);
      } else if (key === "t" && state.selectedNodeId) {
        startDownstream(state.selectedNodeId);
      } else if (key === "i" && state.selectedNodeId) {
        startImpact(state.selectedNodeId);
      } else if (key === "p" && state.selectedNodeId) {
        startPathPick(state.selectedNodeId);
      } else if (key === "1") {
        dispatch({ type: "ui/granularity", granularity: "product" });
      } else if (key === "2") {
        dispatch({ type: "ui/granularity", granularity: "architecture" });
      } else if (key === "3") {
        dispatch({ type: "ui/granularity", granularity: "modules" });
      } else if (key === "4") {
        dispatch({ type: "ui/granularity", granularity: "files" });
      } else if (key === "5") {
        dispatch({ type: "ui/granularity", granularity: "symbols" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    dispatch,
    fitToContent,
    resetPositions,
    toast,
    state.selectedNodeId,
    state.trace,
    state.pendingPathFrom,
    startDownstream,
    startImpact,
    startPathPick,
    contextMenu,
    legendOpen,
    setLegend,
  ]);

  const nodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph],
  );

  const hoveredNode = useMemo(() => {
    if (!graph || state.trace || contextMenu) return undefined;
    if (!state.hoveredNodeId) return undefined;
    return nodeById.get(state.hoveredNodeId);
  }, [graph, state.trace, state.hoveredNodeId, contextMenu, nodeById]);

  const hoverConnections = useMemo<HoverConnection[]>(() => {
    if (!graph || !hoveredNode) return [];
    const outgoing: HoverConnection[] = [];
    const incoming: HoverConnection[] = [];
    for (const edge of graph.edges) {
      if (edge.source === hoveredNode.id) {
        const other = nodeById.get(edge.target);
        if (other) outgoing.push({ edge, other, direction: "out" });
      } else if (edge.target === hoveredNode.id) {
        const other = nodeById.get(edge.source);
        if (other) incoming.push({ edge, other, direction: "in" });
      }
    }
    outgoing.sort((a, b) => {
      const priority = (EDGE_PRIORITY[a.edge.type] ?? 9) - (EDGE_PRIORITY[b.edge.type] ?? 9);
      return priority !== 0 ? priority : b.edge.confidence - a.edge.confidence;
    });
    incoming.sort((a, b) => b.edge.confidence - a.edge.confidence);
    return [...outgoing, ...incoming];
  }, [graph, hoveredNode, nodeById]);

  const contextNode = contextMenu ? nodeById.get(contextMenu.nodeId) : undefined;
  const contextGithubUrl =
    contextNode?.path && graph
      ? buildGitHubFileUrl(
          { owner: graph.repository.owner, repo: graph.repository.name },
          graph.commitSha,
          contextNode.path,
          contextNode.source?.startLine,
        )
      : undefined;

  const tooltipEdge = useMemo(() => {
    if (!edgeTip || !graph) return null;
    const edge = graph.edges.find((candidate) => candidate.id === edgeTip.edgeId);
    if (!edge) return null;
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    return { edge, source, target };
  }, [edgeTip, graph]);

  if (!graph) return null;

  const lowConfidenceFiltered =
    state.filters.minConfidence > 0.5 || !state.filters.showExternal || !state.filters.showConfig;

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={elements.nodes}
        edges={elements.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onEdgeClick={handleEdgeClick}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseMove={handleEdgeMouseMove}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onPaneClick={handlePaneClick}
        onMoveStart={() => setContextMenu(null)}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements={elements.nodes.length > 350}
        minZoom={0.06}
        maxZoom={2.2}
        nodesConnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        nodeDragThreshold={2}
        defaultEdgeOptions={{ type: "graphEdge" }}
        className="h-full w-full"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#191c22" className="ag-dot-pattern" />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!bottom-4 !left-4 overflow-hidden rounded-md !border !border-line !bg-panel !shadow-panel [&>button]:!h-7 [&>button]:!w-7 [&>button]:!border-line [&>button]:!bg-panel [&>button]:!text-ink-secondary [&>button:hover]:!bg-elevated [&>button:hover]:!text-ink"
        />
        {graph.nodes.length > 24 ? (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeColor={(node) => {
              const data = node.data as { node?: { type?: keyof typeof NODE_TYPE_META } } | undefined;
              const type = data?.node?.type;
              return type ? NODE_TYPE_META[type]?.color ?? "#6b7280" : "#6b7280";
            }}
            maskColor="rgba(8,9,11,0.76)"
            className="!bottom-4 !right-4 !h-[124px] !w-[184px]"
          />
        ) : null}
        {elements.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-md border border-line bg-panel/90 px-3 py-2 text-xs text-ink-secondary">
              {lowConfidenceFiltered
                ? "No entities match the current filters."
                : "No entities at this granularity."}
            </p>
          </div>
        ) : null}
      </ReactFlow>

      {legendOpen ? <CanvasLegend onClose={() => setLegend(false)} /> : <LegendButton open={legendOpen} onToggle={() => setLegend(true)} />}

      {hintVisible && !state.trace && !legendOpen ? (
        <div className="absolute bottom-14 left-4 z-20 max-w-[340px] animate-slide-up rounded-lg border border-line bg-panel/95 p-3 shadow-panel">
          <div className="flex items-start gap-2">
            <MousePointerClick size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 text-2xs leading-5 text-ink-secondary">
              <p className="text-xs font-medium text-ink">Explore how this app works</p>
              <p className="mt-1">
                Hover for instant context, click to inspect. Press <span className="ag-kbd">T</span> to trace
                a flow, <span className="ag-kbd">I</span> for impact, <span className="ag-kbd">P</span> to find
                a path. Right-click a node for more.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissHint}
              className="ag-icon-button -mr-1 -mt-1 shrink-0"
              aria-label="Dismiss canvas hint"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {state.trace ? <TracePlayer /> : null}

      {!state.trace ? (
        <HoverCardLayer
          node={hoveredNode}
          connections={hoverConnections}
          absolute={elements.absolute}
        />
      ) : null}

      {contextMenu && contextNode ? (
        <NodeContextMenu
          menu={contextMenu}
          node={contextNode}
          githubUrl={contextGithubUrl}
          onTrace={() => {
            startDownstream(contextNode.id);
            setContextMenu(null);
          }}
          onImpact={() => {
            startImpact(contextNode.id);
            setContextMenu(null);
          }}
          onPath={() => {
            startPathPick(contextNode.id);
            setContextMenu(null);
          }}
          onFocus={() => {
            dispatch({ type: "ui/focus", nodeId: contextNode.id });
            selectNode(contextNode.id);
            setContextMenu(null);
          }}
          onCopyPath={() => {
            if (contextNode.path) {
              navigator.clipboard
                .writeText(contextNode.path)
                .then(() => toast("Source path copied"))
                .catch(() => toast("Could not copy path"));
            }
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {tooltipEdge ? (
        <div
          className="pointer-events-none fixed z-50 max-w-[320px] rounded-md border border-line-strong bg-panel/95 px-2.5 py-2 shadow-float"
          style={{ left: edgeTip!.x + 14, top: edgeTip!.y + 14 }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: EDGE_TYPE_META[tooltipEdge.edge.type].color }}
            />
            <span
              className="font-mono text-2xs uppercase tracking-wide"
              style={{ color: EDGE_TYPE_META[tooltipEdge.edge.type].color }}
            >
              {EDGE_TYPE_META[tooltipEdge.edge.type].label}
            </span>
            <span className="ml-auto font-mono text-2xs text-ink-muted">
              {Math.round(tooltipEdge.edge.confidence * 100)}%
            </span>
          </div>
          <div className="mt-1 text-xs text-ink">
            {tooltipEdge.source?.label ?? tooltipEdge.edge.source}
            <span className="mx-1 text-ink-muted">→</span>
            {tooltipEdge.target?.label ?? tooltipEdge.edge.target}
          </div>
          {typeof tooltipEdge.edge.metadata?.via === "string" ? (
            <div className="mt-0.5 truncate font-mono text-2xs text-ink-muted">
              via {tooltipEdge.edge.metadata.via}
            </div>
          ) : null}
          <div className="mt-1 text-2xs text-ink-muted">Click the edge to trace this connection</div>
        </div>
      ) : null}
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}

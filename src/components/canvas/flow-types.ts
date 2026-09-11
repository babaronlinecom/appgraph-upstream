import type { Edge, Node } from "@xyflow/react";
import type { AppGraphEdge, AppGraphNode, GraphGroupId } from "@/lib/graph/model";

export interface GraphNodeData extends Record<string, unknown> {
  node: AppGraphNode;
  connectionCount: number;
  traceActive?: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  groupId: GraphGroupId;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: (groupId: GraphGroupId) => void;
}

export interface GraphEdgeData extends Record<string, unknown> {
  edge: AppGraphEdge;
  dimmed: boolean;
  highlighted: boolean;
  active?: boolean;
}

export type GraphFlowNode = Node<GraphNodeData, "graphNode">;
export type GroupFlowNode = Node<GroupNodeData, "groupNode">;
export type GraphFlowEdge = Edge<GraphEdgeData, "graphEdge">;
export type AnyFlowNode = GraphFlowNode | GroupFlowNode;

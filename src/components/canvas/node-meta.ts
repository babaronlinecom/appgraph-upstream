import {
  Atom,
  Box,
  Database,
  FileCode2,
  Globe,
  LayoutTemplate,
  ServerCog,
  Settings2,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AppGraphNode, GraphEdgeType, GraphNodeType } from "@/lib/graph/model";

export interface NodeTypeMeta {
  label: string;
  icon: LucideIcon;
  color: string;
}

export const NODE_TYPE_META: Record<GraphNodeType, NodeTypeMeta> = {
  page: { label: "Page", icon: LayoutTemplate, color: "#67c7f0" },
  component: { label: "Component", icon: Box, color: "#8ba7f5" },
  api: { label: "API", icon: Zap, color: "#e0b05c" },
  service: { label: "Service", icon: ServerCog, color: "#57c99b" },
  database: { label: "Data", icon: Database, color: "#e08bb0" },
  external: { label: "External", icon: Globe, color: "#e29a5c" },
  state: { label: "State", icon: Atom, color: "#b490e8" },
  middleware: { label: "Middleware", icon: ShieldCheck, color: "#9aa6b8" },
  config: { label: "Config", icon: Settings2, color: "#8f98a3" },
  module: { label: "Module", icon: FileCode2, color: "#7d8797" },
  group: { label: "Group", icon: Box, color: "#8f98a3" },
};

export interface EdgeTypeMeta {
  label: string;
  color: string;
  dashed?: boolean;
  description: string;
}

export const EDGE_TYPE_META: Record<GraphEdgeType, EdgeTypeMeta> = {
  imports: { label: "imports", color: "#4a5261", description: "Direct module import" },
  renders: { label: "renders", color: "#5f9ed6", description: "Component renders another component" },
  calls: { label: "calls", color: "#4fae8c", description: "Function or service invocation" },
  reads: { label: "reads", color: "#61a5c2", description: "Reads from a data store" },
  writes: { label: "writes", color: "#d19a54", description: "Writes to a data store" },
  routes_to: { label: "routes to", color: "#8b7fd4", description: "Requests an internal API route" },
  uses: { label: "uses", color: "#6b7280", description: "Uses a service or dependency" },
  depends_on: { label: "depends on", color: "#4a5261", dashed: true, description: "Weak or type-level dependency" },
  unknown: { label: "related", color: "#4a5261", dashed: true, description: "Inferred relationship" },
};

export function nodeTypeMeta(type: GraphNodeType): NodeTypeMeta {
  return NODE_TYPE_META[type] ?? NODE_TYPE_META.module;
}

export function nodeDisplaySubtitle(node: AppGraphNode): string {
  if (node.path) return node.path;
  if (node.subtitle) return node.subtitle;
  return "";
}

export function roleLabel(node: AppGraphNode): string | null {
  const role = node.metadata.role;
  if (!role) return null;
  const map: Record<string, string> = {
    hook: "hook",
    layout: "layout",
    loading: "loading",
    error: "error",
    "global-error": "error",
    "not-found": "404",
    template: "template",
    default: "default",
    "app-shell": "shell",
    "server-entry": "server",
    "client": "client",
    "server-action": "server action",
    component: "component",
  };
  return map[role] ?? role;
}

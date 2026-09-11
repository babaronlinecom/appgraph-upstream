"use client";

import { Fragment, useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Database,
  Globe,
  Info,
  KeyRound,
  Play,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { connectionCounts } from "@/features/workspace/selectors";
import { detectFlows } from "@/features/workspace/trace";
import { NODE_TYPE_META } from "@/components/canvas/node-meta";
import type { AppGraphNode } from "@/lib/graph/model";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="ag-section-label">{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-line bg-elevated px-2 py-1.5">
      <div className="text-sm font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-2xs uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function InsightsPanel() {
  const { state, selectNode, startFlow, startTour } = useWorkspace();
  const graph = state.graph;
  const nodes = useMemo(() => graph?.nodes ?? [], [graph]);

  const counts = useMemo(() => (graph ? connectionCounts(graph) : new Map<string, number>()), [graph]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const flows = useMemo(() => (graph ? detectFlows(graph, { limit: 12 }) : []), [graph]);
  const hubs = useMemo(
    () =>
      [...nodes]
        .filter((node) => node.type !== "group")
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
        .slice(0, 8),
    [nodes, counts],
  );
  const externals = useMemo(
    () =>
      nodes
        .filter((node) => node.type === "external")
        .map((node) => ({ node, count: counts.get(node.id) ?? 0 }))
        .sort((a, b) => b.count - a.count),
    [nodes, counts],
  );
  const envNode = nodes.find((node) => node.type === "config");
  const envVars = Array.isArray(envNode?.metadata.envVars) ? (envNode.metadata.envVars as string[]) : [];
  const orphans = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            node.type !== "group" &&
            node.type !== "config" &&
            node.type !== "external" &&
            (counts.get(node.id) ?? 0) === 0,
        )
        .slice(0, 8),
    [nodes, counts],
  );

  if (!graph) return null;
  const stats = graph.stats;
  const maxHub = Math.max(1, ...hubs.map((node) => counts.get(node.id) ?? 0));

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      <Section title="Overview">
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="Entities" value={stats.entities} />
          <Stat label="Relations" value={stats.relationships} />
          <Stat label="Files" value={stats.analyzedFiles} />
          <Stat label="Pages" value={stats.pages} />
          <Stat label="APIs" value={stats.apis} />
          <Stat label="Services" value={stats.services} />
          <Stat label="Components" value={stats.components} />
          <Stat label="Data" value={stats.databaseNodes} />
          <Stat label="External" value={stats.externalServices} />
        </div>
      </Section>

      <Section
        title={`Flows · ${flows.length}`}
        action={
          flows.length > 0 ? (
            <button
              type="button"
              onClick={startTour}
              className="inline-flex items-center gap-1 rounded border border-line bg-elevated px-1.5 py-0.5 text-2xs text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              <Play size={10} aria-hidden />
              Play tour
            </button>
          ) : null
        }
      >
        {flows.length === 0 ? (
          <p className="text-2xs leading-4 text-ink-muted">
            No end-to-end flows were detected. Try the Architecture view for individual links.
          </p>
        ) : (
          <div className="space-y-1.5">
            {flows.map((flow) => (
              <button
                key={flow.id}
                type="button"
                onClick={() => startFlow(flow)}
                className="group w-full rounded-md border border-line bg-elevated/40 p-2 text-left transition-colors duration-180 hover:border-line-strong hover:bg-elevated"
                title={`Play flow: ${flow.title}`}
              >
                <div className="flex items-center gap-1.5 text-2xs text-ink-muted">
                  <Workflow size={11} className="text-success" aria-hidden />
                  <span>{flow.nodeIds.length} steps</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-ink-secondary opacity-0 transition-opacity group-hover:opacity-100">
                    <Play size={9} aria-hidden /> play
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {flow.nodeIds.map((id, index) => {
                    const node = nodeById.get(id);
                    const meta = node ? NODE_TYPE_META[node.type] : NODE_TYPE_META.module;
                    return (
                      <Fragment key={`${id}-${index}`}>
                        {index > 0 ? <ArrowRight size={9} className="shrink-0 text-ink-muted" aria-hidden /> : null}
                        <span className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-2xs text-ink-secondary">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                          {truncate(node?.label ?? id, 18)}
                        </span>
                      </Fragment>
                    );
                  })}
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Most connected">
        <div className="space-y-1">
          {hubs.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => selectNode(node.id)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-elevated"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: NODE_TYPE_META[node.type]?.color ?? "#6b7280" }}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{node.label}</span>
              <span className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-elevated">
                <span
                  className="block h-full rounded-full bg-[#3d4452]"
                  style={{ width: `${((counts.get(node.id) ?? 0) / maxHub) * 100}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-mono text-2xs text-ink-muted">
                {counts.get(node.id) ?? 0}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {externals.length > 0 ? (
        <Section title={`External services · ${externals.length}`}>
          <div className="space-y-1">
            {externals.map(({ node, count }) => (
              <button
                key={node.id}
                type="button"
                onClick={() => selectNode(node.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-elevated"
              >
                <Globe size={11} className="shrink-0 text-[#e29a5c]" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-ink">{node.label}</span>
                <span className="font-mono text-2xs text-ink-muted">{count}</span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {envVars.length > 0 ? (
        <Section title={`Environment · ${envVars.length}`}>
          <div className="flex flex-wrap gap-1">
            {envVars.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => envNode && selectNode(envNode.id)}
                className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-2xs text-ink-secondary hover:border-line-strong hover:text-ink"
              >
                {name}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {orphans.length > 0 ? (
        <Section title={`Unconnected · ${orphans.length}`}>
          <div className="space-y-0.5">
            {orphans.map((node: AppGraphNode) => (
              <button
                key={node.id}
                type="button"
                onClick={() => selectNode(node.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-elevated"
              >
                <Boxes size={11} className="shrink-0 text-ink-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">{node.label}</span>
                <span className="font-mono text-2xs text-ink-muted">0</span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {graph.warnings.length > 0 ? (
        <Section title={`Notes · ${graph.warnings.length}`}>
          <ul className="space-y-1.5">
            {graph.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex items-start gap-1.5 text-2xs leading-4">
                {warning.severity === "error" ? (
                  <AlertTriangle size={11} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                ) : warning.severity === "warning" ? (
                  <TriangleAlert size={11} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                ) : (
                  <Info size={11} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
                )}
                <span className="text-ink-secondary">{warning.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="flex items-center gap-2 rounded-md border border-line bg-elevated/40 px-2 py-1.5 text-2xs text-ink-muted">
        <KeyRound size={11} aria-hidden />
        <span>Variable names only — values are never read.</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-line bg-elevated/40 px-2 py-1.5 text-2xs text-ink-muted">
        <Database size={11} aria-hidden />
        <span>Static analysis · repository code is never executed.</span>
      </div>
    </div>
  );
}

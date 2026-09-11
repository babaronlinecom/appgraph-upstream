"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  GitBranch,
  Play,
  Share2,
} from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { connectionCounts } from "@/features/workspace/selectors";
import { detectFlows, pathToTraceSetup } from "@/features/workspace/trace";
import {
  detectCycles,
  graphHealth,
  toMarkdownReport,
  toMermaid,
  type GraphHealth,
} from "@/features/workspace/analytics";
import { copyText, downloadText } from "@/lib/utils/download";
import { EDGE_TYPE_META, NODE_TYPE_META } from "@/components/canvas/node-meta";
import { GROUP_COLORS } from "@/components/canvas/GroupNodeView";
import { cn } from "@/lib/utils/cn";
import type { AppGraphDocument, GraphEdgeType, GraphNodeType } from "@/lib/graph/model";

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="ag-section-label">{title}</span>
        {action}
      </div>
      {hint ? <p className="-mt-1 mb-2 text-2xs leading-4 text-ink-muted">{hint}</p> : null}
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-line bg-elevated px-2 py-1.5" title={hint}>
      <div
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
          tone === "bad" && "text-danger",
          tone === "default" && "text-ink",
        )}
      >
        {value}
      </div>
      <div className="text-2xs uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  icon?: typeof GitBranch;
}) {
  return (
    <div className="flex w-full items-center gap-2 rounded px-1 py-0.5" title={`${label}: ${value}`}>
      {Icon ? (
        <Icon size={11} className="shrink-0" style={{ color }} aria-hidden />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      )}
      <span className="w-[92px] shrink-0 truncate text-2xs text-ink-secondary">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }}
        />
      </span>
      <span className="w-6 shrink-0 text-right font-mono text-2xs text-ink-muted">{value}</span>
    </div>
  );
}

function typeLabel(type: GraphNodeType): string {
  return NODE_TYPE_META[type]?.label ?? type;
}

function edgeLabel(type: GraphEdgeType): string {
  return EDGE_TYPE_META[type]?.label ?? type;
}

export function AnalyticsPanel() {
  const { state, toast, selectNode, startTrace } = useWorkspace();
  const graph = state.graph;

  const health: GraphHealth | null = useMemo(() => (graph ? graphHealth(graph) : null), [graph]);
  const cycles = useMemo(() => (graph ? detectCycles(graph) : []), [graph]);
  const flows = useMemo(() => (graph ? detectFlows(graph, { limit: 10 }) : []), [graph]);
  const counts = useMemo(() => (graph ? connectionCounts(graph) : new Map<string, number>()), [graph]);
  const nodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph],
  );

  if (!graph || !health) return null;

  const maxType = Math.max(1, ...health.typeCounts.map((entry) => entry.count));
  const maxEdge = Math.max(1, ...health.edgeCounts.map((entry) => entry.count));
  const maxLayer = Math.max(1, ...health.layers.map((layer) => Math.max(layer.outgoing, layer.incoming)));

  const copyMermaid = async () => {
    const mermaid = toMermaid(graph, state.granularity);
    const ok = await copyText(mermaid);
    toast(ok ? "Mermaid diagram copied to clipboard" : "Could not access the clipboard");
  };

  const copyReport = async () => {
    const report = toMarkdownReport(graph, health, cycles, flows);
    const ok = await copyText(report);
    toast(ok ? "Architecture report copied" : "Could not access the clipboard");
  };

  const downloadJson = () => {
    downloadText(
      `${graph.repository.owner}-${graph.repository.name}-${graph.commitSha.slice(0, 7)}.appgraph.json`,
      JSON.stringify(graph, null, 2),
      "application/json",
    );
    toast("Graph JSON downloaded");
  };

  const downloadMermaid = () => {
    downloadText(
      `${graph.repository.owner}-${graph.repository.name}.mmd`,
      toMermaid(graph, state.granularity),
      "text/plain",
    );
    toast("Mermaid diagram downloaded");
  };

  const playCycle = (nodeIds: string[], edgeIds: string[]): void => {
    startTrace(
      pathToTraceSetup(graph, { nodeIds: [...nodeIds, nodeIds[0]], edgeIds }, {
        mode: "flow",
        title: `Cycle · ${nodeIds.length} entities`,
      }),
      { playing: true },
    );
  };

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      <Section title="Health">
        <div className="grid grid-cols-3 gap-1.5">
          <Metric
            label="Avg links"
            value={health.avgOutgoing.toFixed(1)}
            hint="Average number of relationships per entity"
          />
          <Metric
            label="Orphans"
            value={String(health.orphanCount)}
            tone={health.orphanCount === 0 ? "good" : "warn"}
            hint="Entities without any relationship"
          />
          <Metric
            label="Hubs"
            value={String(health.hubCount)}
            tone={health.hubCount > 6 ? "warn" : "default"}
            hint="Entities with 8 or more connections"
          />
          <Metric
            label="Cycles"
            value={String(cycles.length)}
            tone={cycles.length === 0 ? "good" : "bad"}
            hint="Circular dependency chains detected"
          />
          <Metric
            label="Confidence"
            value={`${Math.round(health.avgConfidence * 100)}%`}
            tone={health.avgConfidence >= 0.8 ? "good" : "warn"}
            hint="Average inference confidence across relationships"
          />
          <Metric
            label="Density"
            value={(health.density * 100).toFixed(2)}
            hint="Relationships divided by all possible entity pairs (×100)"
          />
        </div>
      </Section>

      <Section title="Entities by type">
        <div className="space-y-0.5">
          {health.typeCounts.map((entry) => (
            <BarRow
              key={entry.type}
              label={typeLabel(entry.type)}
              value={entry.count}
              max={maxType}
              color={NODE_TYPE_META[entry.type]?.color ?? "#6b7280"}
              icon={NODE_TYPE_META[entry.type]?.icon}
            />
          ))}
        </div>
      </Section>

      <Section title="Relationships by type">
        <div className="space-y-0.5">
          {health.edgeCounts.map((entry) => (
            <BarRow
              key={entry.type}
              label={edgeLabel(entry.type)}
              value={entry.count}
              max={maxEdge}
              color={EDGE_TYPE_META[entry.type]?.color ?? "#6b7280"}
            />
          ))}
        </div>
      </Section>

      <Section title="Layers" hint="Requests flow left to right across layers">
        <div className="space-y-1.5">
          {health.layers.map((layer) => (
            <div key={layer.group} className="rounded-md border border-line bg-elevated/40 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: GROUP_COLORS[layer.group] }}
                  aria-hidden
                />
                <span className="text-2xs font-medium text-ink">{layer.title}</span>
                <span className="ml-auto font-mono text-2xs text-ink-muted">{layer.nodes} entities</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-2xs text-ink-muted">
                <span className="inline-flex w-16 items-center gap-1">
                  <ArrowUpRight size={10} style={{ color: GROUP_COLORS[layer.group] }} aria-hidden />
                  {layer.outgoing}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(layer.outgoing / maxLayer) * 100}%`,
                      background: GROUP_COLORS[layer.group],
                    }}
                  />
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-2xs text-ink-muted">
                <span className="inline-flex w-16 items-center gap-1">
                  <ArrowDownLeft size={10} className="text-ink-muted" aria-hidden />
                  {layer.incoming}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
                  <span
                    className="block h-full rounded-full bg-[#3d4452]"
                    style={{ width: `${(layer.incoming / maxLayer) * 100}%` }}
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={`Circular dependencies · ${cycles.length}`}
        action={
          cycles.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-2xs text-success">
              <CheckCircle2 size={11} aria-hidden /> clean
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-2xs text-danger">
              <AlertTriangle size={11} aria-hidden /> review
            </span>
          )
        }
      >
        {cycles.length === 0 ? (
          <p className="text-2xs leading-4 text-ink-muted">
            No circular dependencies detected in the analyzed source.
          </p>
        ) : (
          <div className="space-y-1.5">
            {cycles.map((cycle) => (
              <button
                key={cycle.id}
                type="button"
                onClick={() => playCycle(cycle.nodeIds, cycle.edgeIds)}
                className="group w-full rounded-md border border-[rgba(229,100,95,0.25)] bg-[rgba(229,100,95,0.05)] p-2 text-left transition-colors duration-180 hover:border-[rgba(229,100,95,0.5)]"
                title="Play this cycle on the canvas"
              >
                <div className="flex items-center gap-1.5 text-2xs text-ink-muted">
                  <AlertTriangle size={10} className="text-danger" aria-hidden />
                  {cycle.nodeIds.length} entities
                  <span className="ml-auto inline-flex items-center gap-1 text-ink-secondary opacity-0 transition-opacity group-hover:opacity-100">
                    <Play size={9} aria-hidden /> play
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-ink-secondary">
                  {cycle.nodeIds.map((id, index) => (
                    <span key={`${id}-${index}`} className="inline-flex items-center gap-1">
                      {index > 0 ? <span className="text-ink-muted">→</span> : null}
                      <span className="truncate">{nodeById.get(id)?.label ?? id}</span>
                    </span>
                  ))}
                  <span className="text-ink-muted">↻</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Export & tools" hint="Works without leaving the page">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className="ag-button justify-start" onClick={copyMermaid}>
            <Share2 size={12} aria-hidden />
            Copy Mermaid
          </button>
          <button type="button" className="ag-button justify-start" onClick={downloadMermaid}>
            <FileText size={12} aria-hidden />
            Download .mmd
          </button>
          <button type="button" className="ag-button justify-start" onClick={downloadJson}>
            <Braces size={12} aria-hidden />
            Download JSON
          </button>
          <button type="button" className="ag-button justify-start" onClick={copyReport}>
            <Copy size={12} aria-hidden />
            Copy report
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-2xs leading-4 text-ink-muted">
          <Download size={10} aria-hidden />
          JSON is the full graph model; Mermaid is ready for docs and pull requests.
        </p>
      </Section>

      <Section title="Busiest entities">
        <div className="space-y-0.5">
          {[...graph.nodes]
            .filter((node) => node.type !== "group")
            .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
            .slice(0, 6)
            .map((node) => (
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
                <span className="font-mono text-2xs text-ink-muted">{counts.get(node.id) ?? 0}</span>
              </button>
            ))}
        </div>
      </Section>
    </div>
  );
}

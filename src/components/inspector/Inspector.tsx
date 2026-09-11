"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  Github,
  Globe,
  Radar,
  Route,
  X,
} from "lucide-react";
import type { AppGraphDocument, AppGraphEdge, AppGraphNode } from "@/lib/graph/model";
import { useWorkspace } from "@/features/workspace/store";
import { buildGitHubFileUrl } from "@/lib/github/url";
import { EDGE_TYPE_META, NODE_TYPE_META, roleLabel } from "@/components/canvas/node-meta";
import { cn } from "@/lib/utils/cn";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-3.5">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="ag-section-label">{title}</span>
        {typeof count === "number" ? (
          <span className="font-mono text-2xs text-ink-muted">{count}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EdgeRow({
  edge,
  direction,
  graph,
  onSelect,
}: {
  edge: AppGraphEdge;
  direction: "in" | "out";
  graph: AppGraphDocument;
  onSelect: (nodeId: string) => void;
}) {
  const otherId = direction === "in" ? edge.source : edge.target;
  const other = graph.nodes.find((node) => node.id === otherId);
  if (!other) return null;
  const meta = EDGE_TYPE_META[edge.type];
  const otherMeta = NODE_TYPE_META[other.type] ?? NODE_TYPE_META.module;
  const OtherIcon = otherMeta.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(other.id)}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-elevated"
      title={other.path}
    >
      {direction === "in" ? (
        <ArrowDownLeft size={12} className="shrink-0" style={{ color: meta.color }} aria-hidden />
      ) : (
        <ArrowUpRight size={12} className="shrink-0" style={{ color: meta.color }} aria-hidden />
      )}
      <span className="shrink-0 font-mono text-2xs" style={{ color: meta.color }}>
        {meta.label}
      </span>
      <OtherIcon size={12} className="shrink-0" style={{ color: otherMeta.color }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">{other.label}</span>
      <span className="shrink-0 font-mono text-2xs text-ink-muted">
        {Math.round(edge.confidence * 100)}%
      </span>
    </button>
  );
}

export function Inspector() {
  const { state, dispatch, selectNode, startDownstream, startImpact, startPathPick } = useWorkspace();
  const graph = state.graph;
  const [sourceExpanded, setSourceExpanded] = useState(false);

  const node = useMemo(() => {
    if (!graph || !state.selectedNodeId) return undefined;
    return graph.nodes.find((candidate) => candidate.id === state.selectedNodeId);
  }, [graph, state.selectedNodeId]);

  const nodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((candidate) => [candidate.id, candidate])),
    [graph],
  );

  if (!graph || !node) return null;

  const meta = NODE_TYPE_META[node.type] ?? NODE_TYPE_META.module;
  const Icon = meta.icon;
  const role = roleLabel(node);
  const incoming = graph.edges.filter((edge) => edge.target === node.id);
  const outgoing = graph.edges.filter((edge) => edge.source === node.id);
  const outgoingSorted = outgoing.sort((a, b) => b.confidence - a.confidence);
  const incomingSorted = incoming.sort((a, b) => b.confidence - a.confidence);
  const snippet = typeof node.metadata.snippet === "string" ? node.metadata.snippet : undefined;
  const imports = Array.isArray(node.metadata.imports) ? (node.metadata.imports as string[]) : [];
  const exportsList = Array.isArray(node.metadata.exports) ? (node.metadata.exports as string[]) : [];
  const envVars = Array.isArray(node.metadata.envVars) ? (node.metadata.envVars as string[]) : [];
  const methods = Array.isArray(node.metadata.methods) ? (node.metadata.methods as string[]) : [];
  const symbolInfos = Array.isArray(node.metadata.symbols)
    ? (node.metadata.symbols as Array<{
        name: string;
        kind: string;
        line: number;
        endLine?: number;
        exported?: boolean;
      }>)
    : [];
  const evidenceRows = [
    ...incomingSorted.flatMap((candidate) =>
      (candidate.metadata?.evidence ?? []).map((evidence) => ({
        edge: candidate,
        direction: "in" as const,
        evidence,
      })),
    ),
    ...outgoingSorted.flatMap((candidate) =>
      (candidate.metadata?.evidence ?? []).map((evidence) => ({
        edge: candidate,
        direction: "out" as const,
        evidence,
      })),
    ),
  ].slice(0, 12);

  const close = () => {
    dispatch({ type: "ui/inspector", open: false });
    dispatch({ type: "ui/select", nodeId: undefined });
  };

  const select = (nodeId: string) => selectNode(nodeId);

  const githubUrl = node.path
    ? buildGitHubFileUrl(
        { owner: graph.repository.owner, repo: graph.repository.name },
        graph.commitSha,
        node.path,
        node.source?.startLine,
      )
    : undefined;

  return (
    <aside
      className={cn(
        "z-30 flex w-[336px] shrink-0 flex-col border-l border-line bg-panel",
        "max-lg:fixed max-lg:bottom-7 max-lg:right-0 max-lg:top-12 max-lg:shadow-float max-lg:transition-transform max-lg:duration-200",
        state.inspectorOpen ? "max-lg:translate-x-0" : "max-lg:translate-x-full",
      )}
      aria-label="Inspector"
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
          style={{ borderColor: `${meta.color}44`, background: `${meta.color}14` }}
        >
          <Icon size={15} style={{ color: meta.color }} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-[0.14em]" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {role ? (
              <span className="rounded border border-line bg-elevated px-1 text-2xs uppercase tracking-wide text-ink-muted">
                {role}
              </span>
            ) : null}
            {node.framework ? (
              <span className="rounded border border-line px-1 font-mono text-2xs text-ink-muted">
                {node.framework}
              </span>
            ) : null}
          </div>
          <h2 className="mt-1 break-words text-sm font-semibold leading-5 text-ink">{node.label}</h2>
          {node.subtitle ? (
            <p className="mt-0.5 break-all font-mono text-2xs text-ink-muted">{node.subtitle}</p>
          ) : null}
        </div>
        <button type="button" className="ag-icon-button" onClick={close} aria-label="Close inspector">
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <button
          type="button"
          className="ag-button flex-1"
          onClick={() => startDownstream(node.id)}
          title="Trace where this entity leads (shortcut: T)"
        >
          <Route size={12} aria-hidden />
          Trace flow
        </button>
        <button
          type="button"
          className="ag-button flex-1"
          onClick={() => startImpact(node.id)}
          title="Find what depends on this entity (shortcut: I)"
        >
          <Radar size={12} aria-hidden />
          Impact
        </button>
        <button
          type="button"
          className="ag-icon-button"
          onClick={() => startPathPick(node.id)}
          title="Find a path from this entity (shortcut: P)"
          aria-label="Find path from this entity"
        >
          <GitBranch size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Overview">
          <p className="text-xs leading-5 text-ink-secondary">
            {typeof node.metadata.description === "string"
              ? node.metadata.description
              : "No deterministic description available."}
          </p>
          <div className="mt-3 space-y-1.5 text-2xs">
            {node.metadata.route ? (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-ink-muted">Route</span>
                <span className="font-mono text-ink-secondary">{String(node.metadata.route)}</span>
              </div>
            ) : null}
            {methods.length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-ink-muted">Methods</span>
                <span className="flex flex-wrap gap-1">
                  {methods.map((method) => (
                    <span key={method} className="rounded border border-line bg-elevated px-1 font-mono text-ink-secondary">
                      {method}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}
            {node.path ? (
              <div className="flex items-start gap-2">
                <span className="w-20 shrink-0 text-ink-muted">Source</span>
                <span className="break-all font-mono text-ink-secondary">{node.path}</span>
              </div>
            ) : null}
            {typeof node.metadata.usageCount === "number" ? (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-ink-muted">Referenced</span>
                <span className="font-mono text-ink-secondary">{node.metadata.usageCount} time(s)</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-ink-muted">Granularity</span>
              <span className="font-mono capitalize text-ink-secondary">{node.granularity}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-ink-muted">Confidence</span>
              <span className="flex flex-1 items-center gap-2">
                <span className="h-1 w-24 overflow-hidden rounded-full bg-elevated">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.round(node.confidence * 100)}%`, background: meta.color }}
                  />
                </span>
                <span className="font-mono text-ink-secondary">{Math.round(node.confidence * 100)}%</span>
              </span>
            </div>
          </div>
          {node.confidence < 0.8 ? (
            <p className="mt-2 rounded-md border border-line bg-elevated px-2 py-1.5 text-2xs leading-4 text-ink-muted">
              Inferred entity · {Math.round(node.confidence * 100)}% confidence. Treat as a hint, not a fact.
            </p>
          ) : null}
        </Section>

        <Section title="Evidence" count={evidenceRows.length}>
          <p className="mb-2 text-2xs leading-4 text-ink-muted">
            Provenance of the relationships touching this entity: which file and line proved each one.
          </p>
          {evidenceRows.length === 0 ? (
            <p className="text-2xs text-ink-muted">No recorded evidence for this entity yet.</p>
          ) : (
            <div className="space-y-1.5">
              {evidenceRows.map((row, index) => {
                const otherId = row.direction === "in" ? row.edge.source : row.edge.target;
                const other = nodeById.get(otherId);
                const edgeMeta = EDGE_TYPE_META[row.edge.type];
                const sourceUrl = buildGitHubFileUrl(
                  { owner: graph.repository.owner, repo: graph.repository.name },
                  graph.commitSha,
                  row.evidence.path,
                  row.evidence.startLine,
                );
                const kindTone =
                  row.evidence.kind === "exact"
                    ? "text-success"
                    : row.evidence.kind === "resolved"
                      ? "text-accent"
                      : "text-warning";
                return (
                  <a
                    key={`${row.edge.id}-${index}`}
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block rounded-md border border-line bg-elevated/40 px-2 py-1.5 transition-colors duration-180 hover:border-line-strong"
                    title={`Open ${row.evidence.path}:${row.evidence.startLine ?? 1}`}
                  >
                    <div className="flex items-center gap-1.5 text-2xs">
                      {row.direction === "in" ? (
                        <ArrowDownLeft size={10} style={{ color: edgeMeta.color }} aria-hidden />
                      ) : (
                        <ArrowUpRight size={10} style={{ color: edgeMeta.color }} aria-hidden />
                      )}
                      <span className="font-mono" style={{ color: edgeMeta.color }}>
                        {edgeMeta.label}
                      </span>
                      <span className="text-ink-muted">{row.direction === "in" ? "from" : "to"}</span>
                      <span className="truncate text-ink-secondary">{other?.label ?? otherId}</span>
                      <span className="ml-auto shrink-0 font-mono text-ink-muted">
                        {Math.round(row.edge.confidence * 100)}%
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-2xs">
                      <span className={`font-mono uppercase tracking-wide ${kindTone}`}>
                        {row.evidence.kind}
                      </span>
                      <span className="truncate font-mono text-ink-muted">
                        {row.evidence.path}
                        {row.evidence.startLine ? `:${row.evidence.startLine}` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-2xs text-ink-muted">
                      {row.evidence.reason ?? row.evidence.ruleId} · {row.evidence.analyzerId}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </Section>

        {symbolInfos.length > 0 ? (
          <Section title="Symbols" count={symbolInfos.length}>
            <ul className="space-y-0.5">
              {symbolInfos.map((symbol) => (
                <li key={`${symbol.name}-${symbol.line}`}>
                  <a
                    href={buildGitHubFileUrl(
                      { owner: graph.repository.owner, repo: graph.repository.name },
                      graph.commitSha,
                      node.path ?? "",
                      symbol.line,
                    )}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-elevated"
                    title={`${node.path}:${symbol.line}`}
                  >
                    <span
                      className="h-1 w-1 shrink-0 rounded-full"
                      style={{ background: meta.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 truncate font-mono text-2xs text-ink-secondary">
                      {symbol.name}
                    </span>
                    <span className="shrink-0 rounded border border-line px-1 text-2xs uppercase tracking-wide text-ink-muted">
                      {symbol.kind}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-2xs text-ink-muted">
                      L{symbol.line}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Incoming" count={incomingSorted.length}>
          {incomingSorted.length === 0 ? (
            <p className="text-2xs text-ink-muted">Nothing depends on this entity within the analyzed source.</p>
          ) : (
            <div className="space-y-0.5">
              {incomingSorted.slice(0, 30).map((edge) => (
                <EdgeRow key={edge.id} edge={edge} direction="in" graph={graph} onSelect={select} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Outgoing" count={outgoingSorted.length}>
          {outgoingSorted.length === 0 ? (
            <p className="text-2xs text-ink-muted">No outgoing relationships detected.</p>
          ) : (
            <div className="space-y-0.5">
              {outgoingSorted.slice(0, 30).map((edge) => (
                <EdgeRow key={edge.id} edge={edge} direction="out" graph={graph} onSelect={select} />
              ))}
            </div>
          )}
        </Section>

        {envVars.length > 0 ? (
          <Section title="Environment" count={envVars.length}>
            <div className="flex flex-wrap gap-1">
              {envVars.map((name) => (
                <span key={name} className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-2xs text-ink-secondary">
                  {name}
                </span>
              ))}
            </div>
            <p className="mt-2 text-2xs text-ink-muted">Variable names only. Values are never read or stored.</p>
          </Section>
        ) : null}

        {imports.length > 0 ? (
          <Section title="Imports" count={imports.length}>
            <ul className="space-y-1">
              {imports.slice(0, 14).map((specifier) => (
                <li key={specifier} className="truncate font-mono text-2xs text-ink-secondary" title={specifier}>
                  {specifier}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {exportsList.length > 0 ? (
          <Section title="Exports" count={exportsList.length}>
            <div className="flex flex-wrap gap-1">
              {exportsList.slice(0, 24).map((name) => (
                <span key={name} className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-2xs text-ink-secondary">
                  {name}
                </span>
              ))}
            </div>
          </Section>
        ) : null}

        {snippet ? (
          <Section title="Source">
            <pre
              className={cn(
                "overflow-auto rounded-md border border-line bg-[#0b0d10] p-2.5 font-mono text-[10.5px] leading-4 text-ink-secondary",
                sourceExpanded ? "max-h-none" : "max-h-52",
              )}
            >
              {snippet}
            </pre>
            <button
              type="button"
              onClick={() => setSourceExpanded((value) => !value)}
              className="mt-2 inline-flex items-center gap-1 text-2xs text-ink-muted hover:text-ink-secondary"
            >
              {sourceExpanded ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />}
              {sourceExpanded ? "Collapse snippet" : "Expand snippet"}
            </button>
          </Section>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-line p-3">
        {githubUrl ? (
          <a href={githubUrl} target="_blank" rel="noreferrer noopener" className="ag-button flex-1">
            <Github size={12} aria-hidden />
            Open on GitHub
            <ExternalLink size={10} aria-hidden />
          </a>
        ) : null}
        {typeof node.metadata.url === "string" ? (
          <a href={node.metadata.url} target="_blank" rel="noreferrer noopener" className="ag-button flex-1">
            <Globe size={12} aria-hidden />
            Visit website
          </a>
        ) : null}
      </div>
    </aside>
  );
}

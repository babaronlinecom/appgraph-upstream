"use client";

import { useMemo, useState } from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Database,
  KeyRound,
  Link2,
  Radar,
  Search,
  Table2,
  Tags,
} from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { toMermaidErd } from "@/features/workspace/analytics";
import { copyText, downloadText } from "@/lib/utils/download";
import { cn } from "@/lib/utils/cn";
import type { AppGraphNode } from "@/lib/graph/model";

interface FieldFact {
  name: string;
  type: string;
  kind: string;
  optional?: boolean;
  list?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: string;
  relation?: { target: string; cardinality: string; optional?: boolean; ownerField?: string };
}

function fieldsOf(node: AppGraphNode): FieldFact[] {
  return Array.isArray(node.metadata.fields) ? (node.metadata.fields as FieldFact[]) : [];
}

function isJoinTable(node: AppGraphNode): boolean {
  const fields = fieldsOf(node);
  const relations = fields.filter((field) => field.kind === "relation");
  const dataFields = fields.filter((field) => field.kind !== "relation" && !field.primaryKey);
  return relations.length >= 2 && dataFields.length === 0;
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "pk" | "fk" | "uq" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1 font-mono text-[9px] uppercase tracking-wide",
        tone === "muted" && "border-line text-ink-muted",
        tone === "pk" && "border-[rgba(224,176,92,0.45)] text-[#e0b05c]",
        tone === "fk" && "border-[rgba(224,139,176,0.45)] text-[#e08bb0]",
        tone === "uq" && "border-[rgba(87,201,155,0.4)] text-[#57c99b]",
      )}
    >
      {children}
    </span>
  );
}

export function DataPanel() {
  const { state, toast, selectNode, startImpact, startTrace } = useWorkspace();
  const graph = state.graph;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hideJoinTables, setHideJoinTables] = useState(false);

  const models = useMemo(
    () => (graph?.nodes ?? []).filter((node) => node.type === "data_model"),
    [graph],
  );
  const enums = useMemo(
    () => (graph?.nodes ?? []).filter((node) => node.type === "data_enum"),
    [graph],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return models
      .filter((model) => !hideJoinTables || !isJoinTable(model))
      .filter((model) => {
        if (!normalized) return true;
        if (model.label.toLowerCase().includes(normalized)) return true;
        return fieldsOf(model).some((field) => field.name.toLowerCase().includes(normalized));
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [models, query, hideJoinTables]);

  if (!graph) return null;

  const formats = [...new Set(models.map((model) => String(model.metadata.format ?? "schema")))];
  const provider = models.find((model) => model.metadata.provider)?.metadata.provider;

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyErd = async () => {
    const erd = toMermaidErd(graph);
    if (!erd) {
      toast("No parsed schema to export");
      return;
    }
    const ok = await copyText(erd);
    toast(ok ? "Mermaid ER diagram copied" : "Could not access the clipboard");
  };

  const downloadErd = () => {
    const erd = toMermaidErd(graph);
    if (!erd) {
      toast("No parsed schema to export");
      return;
    }
    downloadText(`${graph.repository.owner}-${graph.repository.name}-erd.mmd`, erd);
    toast("ER diagram downloaded");
  };

  const downloadSchemaJson = () => {
    const payload = {
      repository: graph.repository.fullName,
      commitSha: graph.commitSha,
      provider: provider ?? null,
      formats,
      models: models.map((model) => ({
        name: model.label,
        mappedName: model.metadata.mappedName ?? null,
        source: model.source,
        fields: fieldsOf(model),
      })),
      enums: enums.map((node) => ({ name: node.label, values: node.metadata.values ?? [] })),
    };
    downloadText(
      `${graph.repository.owner}-${graph.repository.name}-schema.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
    toast("Schema JSON downloaded");
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="rounded-md border border-line bg-elevated/40 px-2.5 py-2">
        <div className="flex items-center gap-2 text-2xs text-ink-muted">
          <Database size={11} aria-hidden />
          <span>Data schema</span>
          {provider ? (
            <span className="rounded border border-line bg-elevated px-1 font-mono uppercase text-ink-secondary">
              {String(provider)}
            </span>
          ) : null}
          <span className="ml-auto font-mono">
            {models.length} models · {enums.length} enums
          </span>
        </div>
        {formats.length > 0 ? (
          <div className="mt-1 font-mono text-2xs text-ink-muted">
            parsed from: {formats.join(", ")}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models and fields…"
          className="ag-input h-8 py-1 pl-7 text-xs"
          aria-label="Search data models"
        />
      </div>

      {models.length === 0 ? (
        <p className="rounded-md border border-line bg-elevated/40 px-3 py-4 text-2xs leading-5 text-ink-muted">
          No database schema was parsed for this repository. AppGraph shows data models only when a
          Prisma schema, Drizzle schema or SQL DDL file proves them.
        </p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((model) => {
            const fields = fieldsOf(model);
            const isOpen = expanded.has(model.id);
            const join = isJoinTable(model);
            return (
              <div key={model.id} className="rounded-md border border-line bg-elevated/30">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(model.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown size={11} className="shrink-0 text-ink-muted" aria-hidden />
                    ) : (
                      <ChevronRight size={11} className="shrink-0 text-ink-muted" aria-hidden />
                    )}
                    <Table2 size={11} className="shrink-0 text-[#e08bb0]" aria-hidden />
                    <span className="truncate text-xs font-medium text-ink">{model.label}</span>
                    {model.metadata.mappedName ? (
                      <span className="shrink-0 font-mono text-[9px] text-ink-muted">
                        {String(model.metadata.mappedName)}
                      </span>
                    ) : null}
                    {join ? <Badge>join</Badge> : null}
                    <span className="ml-auto shrink-0 font-mono text-2xs text-ink-muted">
                      {fields.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ag-icon-button h-6 w-6"
                    title="Show on canvas"
                    aria-label={`Show ${model.label} on canvas`}
                    onClick={() => selectNode(model.id)}
                  >
                    <Crosshair size={11} />
                  </button>
                  <button
                    type="button"
                    className="ag-icon-button h-6 w-6"
                    title="Impact: who reads or writes this model"
                    aria-label={`Impact of ${model.label}`}
                    onClick={() => startImpact(model.id)}
                  >
                    <Radar size={11} />
                  </button>
                </div>

                {isOpen ? (
                  <div className="border-t border-line px-2 py-1.5">
                    <ul className="space-y-0.5">
                      {fields.map((field) => (
                        <li key={field.name} className="flex items-center gap-1.5 text-2xs">
                          <span className="min-w-0 flex-1 truncate" title={`${field.name}: ${field.type}`}>
                            <span className="font-mono text-ink-secondary">{field.name}</span>
                            <span className="ml-1 font-mono text-ink-muted">{field.type}</span>
                          </span>
                          {field.primaryKey ? <Badge tone="pk">pk</Badge> : null}
                          {field.relation ? <Badge tone="fk">fk</Badge> : null}
                          {field.unique && !field.primaryKey ? <Badge tone="uq">uq</Badge> : null}
                          {field.optional ? <Badge>null</Badge> : null}
                          {field.list ? <Badge>list</Badge> : null}
                          {field.relation ? (
                            <button
                              type="button"
                              className="shrink-0 text-[9px] text-[#e08bb0] hover:underline"
                              title={`${field.relation.cardinality} → ${field.relation.target}`}
                              onClick={() => {
                                const target = models.find(
                                  (candidate) =>
                                    candidate.label.toLowerCase() ===
                                    field.relation!.target.toLowerCase(),
                                );
                                if (target) selectNode(target.id);
                              }}
                            >
                              → {field.relation.target}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {model.source?.path ? (
                      <button
                        type="button"
                        className="mt-1.5 inline-flex items-center gap-1 text-[9px] text-ink-muted hover:text-ink-secondary"
                        onClick={() =>
                          startTrace(
                            {
                              mode: "flow",
                              title: `Data flow · ${model.label}`,
                              steps: [
                                { nodeIds: [model.id], edgeIds: [], label: model.label },
                              ],
                            },
                            { playing: false },
                          )
                        }
                        title="Open the model in trace mode"
                      >
                        <Link2 size={9} aria-hidden />
                        {model.source.path}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <p className="px-1 text-2xs text-ink-muted">No models match the current search.</p>
          ) : null}
        </div>
      )}

      {enums.length > 0 ? (
        <div>
          <div className="ag-section-label mb-1.5">Enums</div>
          <div className="space-y-1">
            {enums.map((node) => {
              const values = Array.isArray(node.metadata.values) ? (node.metadata.values as string[]) : [];
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => selectNode(node.id)}
                  className="flex w-full items-center gap-1.5 rounded-md border border-line bg-elevated/30 px-2 py-1 text-left hover:border-line-strong"
                >
                  <Tags size={11} className="shrink-0 text-[#c9a0e8]" aria-hidden />
                  <span className="truncate text-xs text-ink">{node.label}</span>
                  <span className="ml-auto max-w-[55%] truncate font-mono text-[9px] text-ink-muted">
                    {values.join(" | ")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className="ag-button justify-start" onClick={copyErd}>
          <Copy size={12} aria-hidden />
          Copy Mermaid ER
        </button>
        <button type="button" className="ag-button justify-start" onClick={downloadErd}>
          <Braces size={12} aria-hidden />
          Download .mmd
        </button>
        <button type="button" className="ag-button justify-start" onClick={downloadSchemaJson}>
          <KeyRound size={12} aria-hidden />
          Schema JSON
        </button>
        <button
          type="button"
          className={cn("ag-button justify-start", hideJoinTables && "border-line-strong text-ink")}
          onClick={() => setHideJoinTables((value) => !value)}
          aria-pressed={hideJoinTables}
        >
          <Table2 size={12} aria-hidden />
          {hideJoinTables ? "Show join tables" : "Hide join tables"}
        </button>
      </div>

      <p className="text-2xs leading-4 text-ink-muted">
        Fields, keys and relations come from parsed schema files (Prisma / Drizzle / SQL DDL). No
        table is drawn unless a schema fact proves it.{" "}
        {provider ? "" : "Provider could not be determined statically."}
      </p>
    </div>
  );
}


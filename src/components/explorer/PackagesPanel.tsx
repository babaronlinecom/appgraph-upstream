"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Crosshair,
  Layers,
  Package,
  Radar,
  Search,
} from "lucide-react";
import { useWorkspace } from "@/features/workspace/store";
import { connectionCounts } from "@/features/workspace/selectors";
import { cn } from "@/lib/utils/cn";

const FRAMEWORK_LABELS: Record<string, string> = {
  "nextjs-app": "Next.js",
  "nextjs-pages": "Next.js Pages",
  react: "React",
  node: "Node.js",
  generic: "JS/TS",
};

const ROLE_TONES: Record<string, string> = {
  app: "border-[rgba(139,167,245,0.4)] text-[#8ba7f5]",
  library: "border-[rgba(87,201,155,0.4)] text-[#57c99b]",
  worker: "border-[rgba(224,176,92,0.4)] text-[#e0b05c]",
  package: "border-line text-ink-muted",
};

export function PackagesPanel() {
  const { state, selectNode, startImpact } = useWorkspace();
  const graph = state.graph;
  const [query, setQuery] = useState("");

  const packages = useMemo(
    () => (graph?.nodes ?? []).filter((node) => node.type === "package"),
    [graph],
  );
  const counts = useMemo(() => (graph ? connectionCounts(graph) : new Map<string, number>()), [graph]);
  const nodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph],
  );

  const dependencyInfo = useMemo(() => {
    const dependencies = new Map<string, Array<{ id: string; label: string }>>();
    const dependents = new Map<string, Array<{ id: string; label: string }>>();
    for (const edge of graph?.edges ?? []) {
      if (edge.type !== "depends_on" || !edge.metadata?.dependency) continue;
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target || source.type !== "package" || target.type !== "package") continue;
      const deps = dependencies.get(source.id) ?? [];
      deps.push({ id: target.id, label: String(edge.metadata.dependency) });
      dependencies.set(source.id, deps);
      const rev = dependents.get(target.id) ?? [];
      rev.push({ id: source.id, label: source.label });
      dependents.set(target.id, rev);
    }
    return { dependencies, dependents };
  }, [graph, nodeById]);

  if (!graph) return null;

  const capabilities = graph.capabilities;
  const isMonorepo = (capabilities?.monorepoPackages ?? 0) > 0;
  const filtered = packages.filter((node) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return (
      node.label.toLowerCase().includes(normalized) ||
      String(node.metadata.packagePath ?? "").toLowerCase().includes(normalized)
    );
  });

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="rounded-md border border-line bg-elevated/40 px-2.5 py-2">
        <div className="flex items-center gap-2 text-2xs text-ink-muted">
          <Layers size={11} aria-hidden />
          <span>Workspace</span>
          {capabilities?.monorepoTool ? (
            <span className="rounded border border-line bg-elevated px-1 font-mono uppercase text-ink-secondary">
              {capabilities.monorepoTool}
            </span>
          ) : null}
          <span className="ml-auto font-mono">{packages.length} package(s)</span>
        </div>
      </div>

      {!isMonorepo ? (
        <p className="rounded-md border border-line bg-elevated/40 px-3 py-4 text-2xs leading-5 text-ink-muted">
          No workspace packages detected. AppGraph shows this view only when npm/pnpm/yarn
          workspaces, Turborepo or Nx configuration proves a monorepo.
        </p>
      ) : (
        <>
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search packages…"
              className="ag-input h-8 py-1 pl-7 text-xs"
              aria-label="Search packages"
            />
          </div>

          <div className="space-y-1.5">
            {filtered.map((node) => {
              const role = String(node.metadata.role ?? "package");
              const frameworks = Array.isArray(node.metadata.frameworks)
                ? (node.metadata.frameworks as string[])
                : [];
              const deps = dependencyInfo.dependencies.get(node.id) ?? [];
              const dependents = dependencyInfo.dependents.get(node.id) ?? [];
              return (
                <div key={node.id} className="rounded-md border border-line bg-elevated/30 p-2">
                  <div className="flex items-center gap-1.5">
                    <Package size={11} className="shrink-0 text-[#c2a86b]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                      {node.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1 font-mono text-[9px] uppercase tracking-wide",
                        ROLE_TONES[role] ?? ROLE_TONES.package,
                      )}
                    >
                      {role}
                    </span>
                    <button
                      type="button"
                      className="ag-icon-button h-6 w-6"
                      title="Show on canvas"
                      aria-label={`Show ${node.label} on canvas`}
                      onClick={() => selectNode(node.id)}
                    >
                      <Crosshair size={11} />
                    </button>
                    <button
                      type="button"
                      className="ag-icon-button h-6 w-6"
                      title="Impact: what depends on this package"
                      aria-label={`Impact of ${node.label}`}
                      onClick={() => startImpact(node.id)}
                    >
                      <Radar size={11} />
                    </button>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
                    <span className="font-mono text-ink-muted">{String(node.metadata.packagePath ?? "")}</span>
                    {node.metadata.version ? (
                      <span className="font-mono text-ink-muted">v{String(node.metadata.version)}</span>
                    ) : null}
                    {frameworks.map((framework) => (
                      <span key={framework} className="rounded border border-line px-1 font-mono text-ink-secondary">
                        {FRAMEWORK_LABELS[framework] ?? framework}
                      </span>
                    ))}
                    <span className="ml-auto font-mono text-ink-muted">
                      {String(node.metadata.fileCount ?? 0)} files · {counts.get(node.id) ?? 0} links
                    </span>
                  </div>

                  {deps.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px]">
                      <ArrowUpRight size={9} className="text-ink-muted" aria-hidden />
                      <span className="text-ink-muted">uses</span>
                      {deps.map((dependency) => (
                        <button
                          key={dependency.id}
                          type="button"
                          onClick={() => selectNode(dependency.id)}
                          className="rounded border border-line px-1 font-mono text-ink-secondary hover:border-line-strong hover:text-ink"
                        >
                          {dependency.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {dependents.length > 0 ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
                      <ArrowDownLeft size={9} className="text-ink-muted" aria-hidden />
                      <span className="text-ink-muted">used by</span>
                      {dependents.map((dependent) => (
                        <button
                          key={dependent.id}
                          type="button"
                          onClick={() => selectNode(dependent.id)}
                          className="rounded border border-line px-1 font-mono text-ink-secondary hover:border-line-strong hover:text-ink"
                        >
                          {dependent.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-1 text-2xs text-ink-muted">No packages match the current search.</p>
            ) : null}
          </div>

          <p className="text-2xs leading-4 text-ink-muted">
            Package nodes and dependency edges come from workspace manifests: each shown dependency is
            declared in package.json and resolves to a package in this repository.
          </p>
        </>
      )}
    </div>
  );
}

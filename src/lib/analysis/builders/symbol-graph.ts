import type { AppGraphNode } from "@/lib/graph/model";
import { buildSymbolGraph, type SymbolFact } from "../resolvers/symbol-resolver";
import type { RepositoryContext } from "../types";
import { evidenceMetadata } from "./evidence";
import type { EdgeAccumulator } from "./edge-accumulator";
import { fileNodeId } from "./ids";

/** Symbol-level projection (Batch 2) built from resolved call/JSX facts. */

export const SYMBOL_NODE_PREFIX = "symbol:";

export function symbolNodeId(path: string, name: string): string {
  return `${SYMBOL_NODE_PREFIX}${path}#${name}`;
}

export function splitSymbolKey(key: string): { path: string; name: string } {
  const index = key.lastIndexOf("#");
  return { path: key.slice(0, index), name: key.slice(index + 1) };
}

export interface SymbolProjection {
  nodes: AppGraphNode[];
  facts: SymbolFact[];
  allowedKeys: Set<string>;
}

export function projectSymbols(context: RepositoryContext): SymbolProjection {
  const symbolGraph = buildSymbolGraph({
    parsed: context.parsed,
    resolvedImports: context.resolvedImports,
  });

  const symbolDegree = new Map<string, number>();
  const symbolKeys = new Set<string>();
  for (const fact of symbolGraph.facts) {
    if (fact.target.name === "*") continue;
    const sourceKey = `${fact.sourcePath}#${fact.sourceSymbol}`;
    const targetKey = `${fact.target.path}#${fact.target.name}`;
    symbolKeys.add(sourceKey);
    symbolKeys.add(targetKey);
    symbolDegree.set(sourceKey, (symbolDegree.get(sourceKey) ?? 0) + 1);
    symbolDegree.set(targetKey, (symbolDegree.get(targetKey) ?? 0) + 1);
  }

  const allowedKeys = new Set(
    [...symbolKeys]
      .filter((key) => {
        const { path, name } = splitSymbolKey(key);
        return name !== "*" && context.parsed.has(path);
      })
      .sort((a, b) => (symbolDegree.get(b) ?? 0) - (symbolDegree.get(a) ?? 0))
      .slice(0, context.limits.maxSymbolNodes),
  );

  const nodes: AppGraphNode[] = [];
  for (const key of allowedKeys) {
    const { path, name } = splitSymbolKey(key);
    const file = context.parsed.get(path);
    if (!file) continue;
    const symbol = file.symbols.find((candidate) => candidate.name === name);
    const classified = context.classified.get(path);
    nodes.push({
      id: symbolNodeId(path, name),
      type: "symbol",
      label: name,
      subtitle: `${symbol?.kind ?? "symbol"} · ${path}`,
      path,
      symbol: name,
      framework: classified?.framework,
      confidence: 0.95,
      granularity: "symbols",
      metadata: {
        group: classified?.group ?? "frontend",
        role: "symbol",
        symbolKind: symbol?.kind ?? "unknown",
        description: `Symbol ${name} declared in ${path}${
          symbol ? ` at line ${symbol.range.startLine}` : ""
        }. Relationships come from resolved imports, calls and JSX usage.`,
        imports: [],
        exports: [],
      },
      source: symbol?.range ?? { path },
    });
  }

  const facts = symbolGraph.facts
    .filter(
      (fact) =>
        fact.target.name !== "*" &&
        allowedKeys.has(`${fact.sourcePath}#${fact.sourceSymbol}`) &&
        allowedKeys.has(`${fact.target.path}#${fact.target.name}`),
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, context.limits.maxSymbolEdges);

  return { nodes, facts, allowedKeys };
}

export function addSymbolEdges(
  accumulator: EdgeAccumulator,
  context: RepositoryContext,
  projection: SymbolProjection,
): void {
  for (const key of projection.allowedKeys) {
    const { path, name } = splitSymbolKey(key);
    const file = context.parsed.get(path);
    const symbol = file?.symbols.find((candidate) => candidate.name === name);
    accumulator.addEdge(
      fileNodeId(path),
      symbolNodeId(path, name),
      "contains",
      1,
      evidenceMetadata(
        undefined,
        symbol?.range ?? { path, startLine: 1 },
        file?.parserId ?? "typescript-ast",
        "ir.symbol-declaration",
        "exact",
        `symbol ${name} declared in ${path}`,
      ),
    );
  }

  for (const fact of projection.facts) {
    accumulator.addEdge(
      symbolNodeId(fact.sourcePath, fact.sourceSymbol),
      symbolNodeId(fact.target.path, fact.target.name),
      fact.type,
      fact.confidence,
      evidenceMetadata(
        { via: fact.target.name },
        fact.range,
        context.parsed.get(fact.sourcePath)?.parserId ?? "typescript-ast",
        fact.ruleId,
        fact.evidenceKind,
        fact.reason,
      ),
    );
  }
}

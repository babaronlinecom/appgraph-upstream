import type { IrSourceRange, IrSymbolKind } from "../ir/model";
import type { ParsedFile } from "../types";

/**
 * Symbol-level resolution built strictly from static facts:
 * - named / default / namespace imports;
 * - barrel files (`export * from`, `export { a as b } from`) with cycle protection;
 * - calls and JSX usage attributed to the enclosing declared symbol.
 *
 * Nothing here is heuristic guesswork: a fact is only produced when the call
 * name actually matches a resolved import binding or a same-file declaration.
 */

export interface ResolvedSymbolRef {
  path: string;
  name: string;
  kind: IrSymbolKind | "namespace";
  range?: IrSourceRange;
}

export type SymbolFactType = "calls" | "renders";

export interface SymbolFact {
  sourcePath: string;
  sourceSymbol: string;
  sourceSymbolRange?: IrSourceRange;
  target: ResolvedSymbolRef;
  type: SymbolFactType;
  ruleId: string;
  confidence: number;
  evidenceKind: "exact" | "resolved" | "inferred";
  reason: string;
  range: IrSourceRange;
}

export interface SymbolGraphResult {
  facts: SymbolFact[];
  resolveExport: (path: string, name: string) => ResolvedSymbolRef | null;
}

interface LocalExport {
  kind: IrSymbolKind | "namespace";
  range?: IrSourceRange;
}

interface ImportBinding {
  localName: string;
  target: ResolvedSymbolRef | null;
  namespaceTargetPath: string | null;
}

const CALLABLE_KINDS = new Set<IrSymbolKind>(["function", "hook", "component", "method"]);

const MAX_REEXPORT_DEPTH = 8;

export function buildSymbolGraph(input: {
  parsed: Map<string, ParsedFile>;
  resolvedImports: Map<string, Map<string, string | null>>;
}): SymbolGraphResult {
  const { parsed, resolvedImports } = input;

  // --- Local declared exports per file (name -> kind + range) ---
  const localExports = new Map<string, Map<string, LocalExport>>();
  for (const [path, file] of parsed) {
    const map = new Map<string, LocalExport>();
    for (const symbol of file.symbols) {
      if (!symbol.exported) continue;
      map.set(symbol.name, { kind: symbol.kind, range: symbol.range });
    }
    if (file.defaultExport) {
      const namedSymbol = file.symbols.find(
        (symbol) => symbol.defaultExport || (file.defaultExport && symbol.name === file.defaultExport.name),
      );
      map.set("default", {
        kind: namedSymbol?.kind ?? exportKindToSymbolKind(file.defaultExport.kind),
        range: file.defaultExport.range,
      });
      if (file.defaultExport.name && file.defaultExport.name !== "default") {
        map.set(file.defaultExport.name, {
          kind: namedSymbol?.kind ?? exportKindToSymbolKind(file.defaultExport.kind),
          range: file.defaultExport.range,
        });
      }
    }
    localExports.set(path, map);
  }

  // --- Barrel-aware export resolution (memoized, cycle protected) ---
  const exportCache = new Map<string, ResolvedSymbolRef | null>();

  const resolveExport = (path: string, name: string, depth = 0, visited?: Set<string>): ResolvedSymbolRef | null => {
    if (depth > MAX_REEXPORT_DEPTH) return null;
    const key = `${path}#${name}`;
    const cached = exportCache.get(key);
    if (cached !== undefined) return cached;
    const seen = visited ?? new Set<string>();
    if (seen.has(key)) return null;
    seen.add(key);

    const result = resolveExportUncached(path, name, depth, seen);
    exportCache.set(key, result);
    return result;
  };

  const resolveExportUncached = (
    path: string,
    name: string,
    depth: number,
    visited: Set<string>,
  ): ResolvedSymbolRef | null => {
    const file = parsed.get(path);
    if (!file) return null;

    const declared = localExports.get(path)?.get(name);
    if (declared) {
      // A default export of a named function/component resolves to the real
      // symbol name so symbol nodes are stable and readable.
      const actualName =
        name === "default" && file.defaultExport?.name && file.defaultExport.name !== "default"
          ? file.defaultExport.name
          : name;
      return { path, name: actualName, kind: declared.kind, range: declared.range };
    }

    for (const reExport of file.reExports) {
      const targetPath = resolvedImports.get(path)?.get(reExport.specifier) ?? null;
      if (!targetPath) continue;

      if (reExport.sourceNames === "*") {
        if (reExport.exportedNames.length === 1) {
          // export * as ns from "./x"
          if (reExport.exportedNames[0] === name) {
            return { path: targetPath, name: "*", kind: "namespace" };
          }
          continue;
        }
        const resolved = resolveExport(targetPath, name, depth + 1, visited);
        if (resolved) return resolved;
        continue;
      }

      const index = reExport.sourceNames.indexOf(name);
      if (index >= 0) {
        const resolved = resolveExport(targetPath, reExport.sourceNames[index], depth + 1, visited);
        if (resolved) return resolved;
      }
      // exported alias: exportedNames[i] is the public name for sourceNames[i]
      const aliasIndex = reExport.exportedNames.indexOf(name);
      if (aliasIndex >= 0) {
        const resolved = resolveExport(targetPath, reExport.sourceNames[aliasIndex], depth + 1, visited);
        if (resolved) return resolved;
      }
    }

    return null;
  };

  // --- Import bindings per file ---
  const bindingsByFile = new Map<string, ImportBinding[]>();
  for (const [path, file] of parsed) {
    const bindings: ImportBinding[] = [];
    for (const entry of file.imports) {
      if (entry.typeOnly) continue;
      const targetPath = resolvedImports.get(path)?.get(entry.specifier) ?? null;
      if (!targetPath) continue;
      for (let index = 0; index < entry.localNames.length; index += 1) {
        const localName = entry.localNames[index];
        const importedName = entry.importedNames[index] ?? localName;
        if (importedName === "*") {
          bindings.push({ localName, target: null, namespaceTargetPath: targetPath });
          continue;
        }
        const resolved = resolveExport(targetPath, importedName);
        bindings.push({ localName, target: resolved, namespaceTargetPath: null });
      }
    }
    bindingsByFile.set(path, bindings);
  }

  // --- Symbol facts: calls and JSX usage attributed to declared symbols ---
  const facts: SymbolFact[] = [];
  const seenFacts = new Set<string>();

  const addFact = (fact: SymbolFact) => {
    const key = `${fact.sourcePath}#${fact.sourceSymbol}->${fact.target.path}#${fact.target.name}:${fact.type}`;
    if (seenFacts.has(key)) return;
    seenFacts.add(key);
    facts.push(fact);
  };

  for (const [path, file] of parsed) {
    const bindings = bindingsByFile.get(path) ?? [];
    const localCallable = new Map(
      file.symbols
        .filter((symbol) => CALLABLE_KINDS.has(symbol.kind))
        .map((symbol) => [symbol.name, symbol]),
    );

    for (const call of file.calls) {
      const sourceSymbol = call.symbol;
      if (!sourceSymbol) continue;
      const sourceRange = file.symbols.find((symbol) => symbol.name === sourceSymbol)?.range;

      // 1. Direct call on an imported binding (named/default).
      const binding = bindings.find((candidate) => candidate.localName === call.name);
      if (binding?.target && CALLABLE_KINDS.has(binding.target.kind as IrSymbolKind)) {
        addFact({
          sourcePath: path,
          sourceSymbol,
          sourceSymbolRange: sourceRange,
          target: binding.target,
          type: "calls",
          ruleId: "symbol.resolved-call",
          confidence: 0.95,
          evidenceKind: "exact",
          reason: `call ${call.name}() resolved to ${binding.target.path}#${binding.target.name}`,
          range: call.range,
        });
        continue;
      }

      // 2. Namespace member call: ns.member(...)
      const namespaceBinding = bindings.find(
        (candidate) => candidate.namespaceTargetPath && call.name.startsWith(`${candidate.localName}.`),
      );
      if (namespaceBinding?.namespaceTargetPath) {
        const member = call.name.slice(namespaceBinding.localName.length + 1).split(".")[0];
        const target = resolveExport(namespaceBinding.namespaceTargetPath, member);
        if (target && CALLABLE_KINDS.has(target.kind as IrSymbolKind)) {
          addFact({
            sourcePath: path,
            sourceSymbol,
            sourceSymbolRange: sourceRange,
            target,
            type: "calls",
            ruleId: "symbol.namespace-member-call",
            confidence: 0.9,
            evidenceKind: "resolved",
            reason: `call ${call.name}() resolved through namespace import ${namespaceBinding.localName}`,
            range: call.range,
          });
          continue;
        }
      }

      // 3. Same-file call to a declared symbol.
      const local = localCallable.get(call.name);
      if (local) {
        addFact({
          sourcePath: path,
          sourceSymbol,
          sourceSymbolRange: sourceRange,
          target: { path, name: local.name, kind: local.kind, range: local.range },
          type: "calls",
          ruleId: "symbol.local-call",
          confidence: 0.85,
          evidenceKind: "resolved",
          reason: `call ${call.name}() resolves to a symbol declared in this file`,
          range: call.range,
        });
      }
    }

    for (const tag of file.jsxTags) {
      const sourceSymbol = tag.symbol;
      if (!sourceSymbol) continue;
      const sourceRange = file.symbols.find((symbol) => symbol.name === sourceSymbol)?.range;
      const binding = bindings.find((candidate) => candidate.localName === tag.name);
      if (binding?.target) {
        addFact({
          sourcePath: path,
          sourceSymbol,
          sourceSymbolRange: sourceRange,
          target: binding.target,
          type: "renders",
          ruleId: "react.jsx-symbol-render",
          confidence: 0.93,
          evidenceKind: "resolved",
          reason: `JSX <${tag.name}> bound to ${binding.target.path}#${binding.target.name}`,
          range: tag.range,
        });
        continue;
      }
      const local = localCallable.get(tag.name);
      if (local) {
        addFact({
          sourcePath: path,
          sourceSymbol,
          sourceSymbolRange: sourceRange,
          target: { path, name: local.name, kind: local.kind, range: local.range },
          type: "renders",
          ruleId: "react.jsx-local-render",
          confidence: 0.88,
          evidenceKind: "resolved",
          reason: `JSX <${tag.name}> resolves to a symbol declared in this file`,
          range: tag.range,
        });
      }
    }
  }

  return { facts, resolveExport: (path, name) => resolveExport(path, name) };
}

function exportKindToSymbolKind(kind: string): IrSymbolKind {
  switch (kind) {
    case "component":
      return "component";
    case "hook":
      return "hook";
    case "const":
      return "const";
    case "class":
      return "class";
    case "function":
      return "function";
    default:
      return "unknown";
  }
}

# AppGraph graph schema

Current schema version: **1.1.0** (see `src/lib/graph/model.ts`).

The graph document is plain JSON and independent from the UI. It is produced by
the analyzer pipeline and can be cached, exported (`npm run analyze -- --out`) or
consumed by other tools.

## Versioning

| Version | Change |
| --- | --- |
| 1.0.0 | Initial public document shape. |
| 1.1.0 | Additive: `capabilities`, edge evidence (`edge.metadata.evidence`), node symbols (`node.metadata.symbols`). Older readers can ignore the new fields. |

Breaking changes require a new major schema version and a migration helper.
Any change that can alter analysis output must bump `APPGRAPH_ANALYSIS_VERSION`
so commit-addressed caches are invalidated.

## Document

```ts
interface AppGraphDocument {
  schemaVersion: string;        // "1.1.0"
  analysisVersion: string;      // analyzer revision that produced this graph
  repository: RepositoryMetadata;
  commitSha: string;            // cache key / evidence anchor
  ref: string;
  nodes: AppGraphNode[];
  edges: AppGraphEdge[];
  warnings: GraphWarning[];     // structured, code + severity (+ counts)
  stats: GraphStats;
  layouts: Record<GraphGranularity, GraphLayout>;
  capabilities: GraphCapabilities;
  generatedAt: string;
}
```

Granularities: `product → architecture → modules → files`. A node declares the
minimum granularity at which it becomes visible (`node.granularity`).

## Nodes

`AppGraphNode.type` (node kinds):

`page`, `component`, `api`, `service`, `database`, `external`, `state`,
`middleware`, `config`, `module`, `group` (UI-only lane).

Node metadata highlights:

- `group` — lane: `frontend | backend | data | config | external`
- `route`, `methods` — for pages and API routes
- `imports`, `exports`, `symbols` — located symbol info (`{ name, kind, line, endLine, exported }`)
- `envVars` — environment variable **names** only (values are never read)
- `snippet`, `snippetLanguage` — bounded source preview
- `description` — deterministic description generated from evidence

Every file-backed node carries `source: { path, startLine?, endLine? }` pointing
at its primary symbol.

## Edges

`AppGraphEdge.type` (relationship kinds):

| Kind | Meaning | Typical confidence |
| --- | --- | --- |
| `imports` | Module imports another module (deterministic resolution) | 1.0 |
| `renders` | JSX usage of an imported component binding | 0.92 |
| `calls` | Call expression on an imported binding | 0.85–0.86 |
| `reads` / `writes` | Classified data access on a database module/SDK | 0.80–0.85 |
| `routes_to` | `fetch("/api/...")` matched to a known route | 0.88 |
| `uses` | Integration/module usage (SDK import, env config, ORM→DB) | 0.60–0.95 |
| `depends_on` | Type-only / weak dependency | 0.55 |

Confidence bands:

```text
1.00 exact AST/schema fact
0.90 resolved symbol reference
0.80 framework convention with strong evidence
0.60 heuristic inference
<0.50 hidden by default (min-confidence filter)
```

### Evidence (trust)

Every relationship should answer *"why does AppGraph think these are connected?"*.
`edge.metadata.evidence` carries one or more provenance records:

```ts
interface EdgeEvidence {
  path: string;            // file that proves the relationship
  startLine?: number;      // 1-based line
  endLine?: number;
  symbol?: string;         // symbol name when applicable
  analyzerId: string;      // e.g. "typescript-ast", "nextjs-app", "prisma-schema"
  ruleId: string;          // e.g. "react.jsx-usage", "db.operation.classify"
  kind: "exact" | "resolved" | "inferred";
  reason?: string;         // human-readable explanation
}
```

The Inspector **Evidence** section renders these records and links to the exact
GitHub line (pinned to the analyzed commit). Rules that cannot point at source
code are explicitly marked `inferred` with a lower confidence.

Rule ids currently emitted:

```text
typescript-ast   import.resolve                exact
typescript-ast   import.type-only              exact
typescript-ast   import.database-module        resolved
typescript-ast   react.jsx-usage               resolved
typescript-ast   symbol.imported-call          resolved
typescript-ast   symbol.imported-reference     resolved
typescript-ast   db.operation.classify         inferred
typescript-ast   env.process-read              exact
typescript-ast   integration.package-import    exact
typescript-ast   integration.db-call           inferred
nextjs-app       nextjs.fetch-route-match      inferred
prisma-schema    prisma.datasource-provider    exact
```

## Capabilities

`capabilities` reports what the analyzer actually understood. The UI shows it
under **Insights → Analysis coverage**.

```ts
interface GraphCapabilities {
  languages: string[];          // detected languages, e.g. ["typescript"]
  frameworks: string[];         // detected adapters, e.g. ["nextjs-app", "react", "node"]
  databaseSchemas: string[];    // schema formats the analyzers parsed, e.g. ["prisma"]
  dataSchemaAnalyzers: string[];// registered schema analyzer ids
  apiProtocols: string[];       // e.g. ["http"]
  asyncSystems: string[];       // queues/events (empty until adapters exist)
  infrastructure: string[];     // containers/IaC (empty until adapters exist)
  symbolResolution: "full" | "partial" | "none";
  parsers: string[];            // parser ids that ran, e.g. ["typescript-ast"]
  integrations: number;         // registered integration detectors
}
```

An empty array means **not analyzed**, never "nothing exists".

## Analysis pipeline contract

```text
RepositoryProvider → tree → file selection → LanguageParser (registry)
→ FileIR (normalized IR: symbols, imports, calls, env reads, ranges)
→ resolvers & analyzers (frameworks, integrations, data schemas)
→ semantic nodes + evidenced edges
→ ELK layouts per granularity
→ AppGraphDocument
```

Parsers implement `LanguageParser` (`src/lib/analysis/parsers/contract.ts`) and
are resolved by extension from `ParserRegistry`; the pipeline has no
language-specific branches. New schema analyzers implement `DataSchemaAnalyzer`
(`src/lib/analysis/data/registry.ts`).

## Guarantees

- Repository code is never executed, installed or imported.
- Only facts proven by static analysis become edges; inference is always marked
  with `kind: "inferred"` and a reason.
- Environment variable **names** may appear; values are never read or stored.

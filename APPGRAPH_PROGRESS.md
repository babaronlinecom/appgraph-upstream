# AppGraph — Implementation Progress

Resume file for the next coding agent. Last updated after Roadmap **Batch 1**.

## Roadmap execution

The authoritative plan is `APPGRAPH_ROADMAP.md` (kept in-repo, statuses updated per batch).

### Batch 1 — Analyzer foundation (DONE)
- `LanguageParser` contract + `ParserRegistry`; TypeScript parser migrated behind
  the registry; pipeline has no language-specific branches.
- Normalized IR (`src/lib/analysis/ir/model.ts`): located symbols (function/method/
  class/interface/const/component/hook/enum/type), imports, calls, JSX tags, route
  handlers, environment reads — all with `IrSourceRange`.
- Central analyzer registries (`src/lib/analysis/registries/`): parsers, frameworks,
  integrations, data schemas. `DataSchemaAnalyzer` contract + registered Prisma
  schema analyzer (`provider`, `models`, ranges) in `src/lib/analysis/data/`.
- `GraphCapabilities` on the document + **Insights → Analysis coverage** UI.
- `EdgeEvidence` (path/line/analyzer/rule/kind/reason) attached to every edge;
  **Inspector → Evidence** with commit-pinned GitHub links.
- Graph schema **1.1.0** (additive) + `docs/graph-schema.md`; analysis version
  default now `0.2.0`.
- Tests: parser registry (language-agnostic registration), IR, evidence on every
  edge, capabilities, and a false-positive regression fixture
  (`tests/fixtures/sample-negative`) proving unused imports, look-alike `db.user.create`
  objects, doc strings and commented `process.env` never become semantic edges.

### Batch 2 — Symbol intelligence (DONE)
- New `symbols` granularity (`product → architecture → modules → files → symbols`)
  and `symbol` node type; file→symbol `contains` edges; `maxSymbolNodes`/`maxSymbolEdges`.
- `symbol-resolver.ts`: named/default/namespace imports, multi-hop barrel re-exports
  with aliases and cycle protection, same-file calls, enclosing-symbol attribution.
- Symbol edges carry confidence + evidence rules: `symbol.resolved-call` (0.95 exact),
  `symbol.namespace-member-call` (0.90), `react.jsx-symbol-render` (0.93),
  `symbol.local-call`/`react.jsx-local-render` (0.85/0.88).
- Only proven symbols become nodes (unused declarations are excluded).
- UI: Symbols granularity (Explorer, palette, shortcut `5`), symbol Inspector with
  Evidence, trace/impact/path work on symbol nodes.
- Analysis version bumped to `0.3.0`; layouts include the new granularity.

### Batch 3 — next (Data architecture)
- AG-DATA-001..007: data model nodes (model/field/enum), Prisma fields/relations,
  Drizzle schema parser, SQL DDL parser, code↔model read/write targets, ERD view.

## Status

MVP is implemented end-to-end and verified: paste a public GitHub URL → deterministic static
analysis → semantic architecture graph → interactive canvas.

## Completed

### Foundation
- Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind CSS 3.
- Design tokens in `src/app/globals.css`, Tailwind mapping in `tailwind.config.ts`.
- No UI library framework beyond `@xyflow/react` (React Flow v12), `lucide-react`, `clsx`.
- `elkjs` runs server-side (layout) and is marked `serverExternalPackages`.

### GitHub ingestion (`src/lib/github/`)
- Strict URL parser (`url.ts`): github.com only, owner/repo validation, `.git`/tree refs, SSRF-safe.
- `RepositoryProvider` abstraction + `GitHubPublicRepositoryProvider`:
  metadata, commit SHA, recursive tree, raw file content (raw.githubusercontent.com),
  optional server `GITHUB_TOKEN`, rate-limit aware errors, timeouts.
- `FixtureRepositoryProvider` for deterministic tests/E2E (enabled by `APPGRAPH_FIXTURE_DIR`).
- Protection limits in `limits.ts` (tree entries, analyzed files, bytes, timeout, concurrency).
- Filesystem + memory JSON cache (`src/lib/cache/cache.ts`), keyed by repo + commit + version.

### Analysis engine (`src/lib/analysis/`)
- Pipeline stages with progress events (`pipeline.ts`): resolve, index, select, fetch, parse,
  resolve-imports, graph, layout; overall timeout; partial results with warnings.
- File selection with priority scoring (`selection.ts`).
- Classifier (`file-classifier.ts`): Next.js App/Pages routes, layout/loading/error roles,
  components, hooks, services, database modules, schemas, middleware, state, config, tests.
- TS/JS parser (`parsers/ts-parser.ts`): imports, exports, components, hooks, JSX usage,
  call expressions, route handlers, env vars, fetch paths, directives.
- Import resolver (`resolvers/import-resolver.ts`): relative, tsconfig paths, baseUrl, index files,
  ESM `.js`→`.ts` mapping, workspace packages.
- Framework adapters (`frameworks/`): Next.js App Router, Pages Router, React, Node; provide
  `routes_to` edges for internal fetch calls; `FrameworkAnalyzer` interface for future adapters.
- Integrations table (`integrations.ts`): Stripe, Prisma, Drizzle, Supabase, Firebase, pg, MongoDB,
  Redis, Clerk, Auth.js, S3, OpenAI/Anthropic, Resend, PostHog, Sentry and more.
- Graph builder (`graph-builder.ts`): semantic nodes, renders/calls/reads/writes/routes_to/uses
  edges, ORM→DB link, env config node, product/modules caps, node/edge bounds, confidence scores,
  deterministic descriptions and snippet metadata.

### Graph + layout (`src/lib/graph/`)
- Serialisable model (`model.ts`), schema version 1.0.0, granularities and groups.
- ELK layered layout with partitions = lanes (Frontend → Backend → Data → Configuration →
  External), computed per granularity (`layout/elk-layout.ts`); grid fallback on ELK failure.

### API (`src/app/api/`)
- `POST /api/repositories/analyze` (rate-limited, dedupes concurrent jobs by repo).
- `GET /api/analysis/[id]` (progress steps, metadata, graph on completion).
- `GET /api/health`.
- In-process job manager with bounded concurrency (`src/lib/analysis/jobs.ts`).

### UI
- Landing: hero, URL validation, example repositories, interactive demo preview, feature strip.
- Workspace (`/github/[owner]/[repo]`): top bar, explorer (granularity, groups, filters),
  canvas (custom nodes, custom edges, lanes, minimap, controls), inspector (overview, connections,
  env, imports/exports, snippet, commit-pinned GitHub link), status bar with warnings,
  command palette (⌘K), progress pipeline UX, graceful error panel.
- Canvas interactions: pan/zoom, fit (F), reset layout (R), granularity 1–4, hover neighborhood
  highlight, double-click focus, node dragging with localStorage position persistence, group
  collapse, edge/confidence filters, shareable commit-pinned URL.
- Responsive: sidebars become sheets on small screens; keyboard shortcuts and reduced-motion support.

### Architecture intelligence (advanced layer)
- `src/features/workspace/trace.ts` — pure graph algorithms: downstream/impact BFS traversal,
  shortest `findPath`, bounded `detectFlows` (end-to-end chains through API/data/external),
  tour builder, required-granularity calculation.
- Trace player: animated step-by-step playback, camera follows each hop, play/pause/prev/next,
  progress dots, tour counter; activated from inspector, palette, insights, flow cards, edge clicks
  and keyboard shortcuts (`T`/`I`/`P`/`Space`/`Esc`).
- Impact analysis (reverse reachability), path finding between entities, click-to-trace edges,
  edge hover tooltips with type/confidence/endpoints.
- Insights tab: overview stats, detected flows with play buttons and "Play tour", most connected
  entities, external services, environment keys, unconnected entities, analysis notes.
- Canvas polish: smoothstep edges, animated dash flow on active trace edges, strong dimming for
  unrelated entities during traces, dismissible onboarding hint, trace edge labels.
- 9 unit tests for the trace algorithms + integration coverage for flows/paths/impact on the
  fixture repository.

### Canvas polish (round 2)
- Fixed a hover flicker: React Flow marks recreated node objects as dimensionless for one frame
  (`visibility: hidden`), which broke hover into an enter/leave loop. Nodes now carry fixed
  `width`/`height`, and `GraphCanvas` caches node/edge objects by signature so a hover only
  re-renders affected elements instead of rebuilding the whole graph.
- Hover card with description, source path, "Leads to"/"Depends on it" rows and shortcut hints;
  positioned below the node so it does not cover its neighbors.
- Per-type node accents (left strip + tint + colored labels), colored lane headers per group,
  glow on highlighted/selected nodes, hover lift.
- Map legend overlay (`L`), right-click context menu (trace/impact/path/focus/copy path/GitHub),
  smoothstep edges with drop-shadow highlights, edge hover also highlights its endpoints.

### Tests
- `tests/unit`: URL parser, classifier, import resolver, TS parser, integrations/routes.
- `tests/integration/fixture-analysis.test.ts`: full pipeline against `tests/fixtures/sample-nextjs`
  (pages, APIs, services, Prisma/Postgres, Stripe, env, renders/calls/reads/writes/routes_to,
  layouts, cache hit).
- `tests/e2e`: landing + workspace flows (Playwright, `channel: msedge`, fixture provider).
- `tests/manual/live-github.test.ts`: opt-in real GitHub check (`APPGRAPH_LIVE_TEST=1`).

### Docs / ops
- `README.md` (setup, env, architecture, safety, limitations), `.env.example`, `Dockerfile`
  (standalone output), `.dockerignore`, screenshots in `docs/screenshots/`.

## Verification status (last run)

- `npm run typecheck` — clean.
- `npm test` — 101 tests passed (12 files, incl. symbol resolver, IR, evidence and
  negative-regression suites; live GitHub/manual tests skipped by default).
- `npm run build` — succeeded (standalone output only when `NEXT_STANDALONE=1`, i.e. in Docker).
- `npx playwright test` — 8/8 passed: landing (2), workspace interactions, advanced exploration
  (analytics/exports, hover card/legend/context menu, trace/impact/path/tour), mobile sheets,
  screenshots.
- Dev-mode E2E (`playwright.dev.config.ts`, React StrictMode on) — workspace + advanced pass.
- CLI verified live: `npm run analyze -- nextjs/saas-starter --json` → 46 entities, 100
  relationships, health metrics, 5 key flows, cached rerun.
- Live GitHub smoke (production server, `leerob/next-saas-starter`): 46 entities, 100 relationships,
  1 external service, ~8s, cached afterwards; invalid-host error path returns structured JSON.
- Screenshots generated from a real production build with the fixture provider
  (`landing`, `workspace-architecture`, `workspace-inspector`, `workspace-trace`,
  `workspace-insights`, `workspace-analytics`, `workspace-hover`, `workspace-modules`).

## Open source packaging

- Repository: https://github.com/hi77x/appgraph (public, MIT).
- `LICENSE` (MIT), `.gitattributes`, `.github/workflows/ci.yml` (typecheck + tests + build).
- README with badges, screenshots, CLI usage, architecture pipeline and contribution guide.

## Fixed during QA (dev-mode hang)

Symptom: in `next dev`, the workspace progress screen stayed forever (e.g. 243s) although the
server finished the analysis in seconds. Cause: React StrictMode double-invokes mount effects; the
`startedRef` guard let the second run bail out while the first run's cleanup aborted its polling, so
the client never fetched the result. Fixes:

- `src/features/workspace/store.tsx` — the analysis effect now starts per mount and cleans up per
  unmount (StrictMode-safe); if a poll returns 404 (dev server restarted and dropped in-memory jobs)
  the client transparently restarts the analysis up to two times.
- `src/lib/analysis/jobs.ts` — per-job watchdog (`analysisTimeoutMs + 20s`) aborts the analysis and
  marks the job failed even if a provider promise ignores abort.
- `src/lib/analysis/selection.ts` — `mapWithConcurrency` stops pulling work once the signal aborts.
- `src/lib/analysis/pipeline.ts` — abort checks during parsing; signals passed to all fetch phases.
- `next.config.ts` — dev watcher ignores `.appgraph-cache*`, `.next*`, test artifacts so cache writes
  do not restart the dev server and kill in-memory jobs; optional `NEXT_DIST_DIR` for isolated builds.

## Known issues / follow-ups (non-blocking)

- Playwright browser downloads are blocked in the original environment; E2E uses installed Edge
  (`channel: msedge`). CI may switch to bundled Chromium.
- Job store and cache are per-process; multi-instance deployment needs a shared store behind
  `src/lib/cache/cache.ts` and `src/lib/analysis/jobs.ts`.
- Monorepo aliases beyond tsconfig/workspace names are not resolved.
- Product-layer page cap (60) and modules component cap (170) produce truncation info warnings.

## How to resume

1. `npm install`
2. `npm run typecheck && npm test`
3. `npm run dev` → open http://localhost:3000 and analyze a public Next.js repo.
4. For deterministic UI work: `APPGRAPH_FIXTURE_DIR=<abs path to tests/fixtures/sample-nextjs> npm run dev`.
5. After changes: `npm run build` then `npm run test:e2e` (E2E requires a fresh build).
6. Bump `APPGRAPH_ANALYSIS_VERSION` to invalidate cached graphs after analyzer changes.

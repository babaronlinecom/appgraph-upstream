# AppGraph — Senior+/Staff-Level Open Source Roadmap

> Target repository: `hi77x/appgraph`  
> Baseline branch: `main`  
> Baseline tree SHA inspected: `4af31e9072f09301c14e3bbda58f71461d95e840`  
> License: MIT  
> Purpose: turn AppGraph from a strong Next.js/TypeScript architecture visualizer into a serious multi-language software graph engine and architecture workspace.

---

## 0. Coding-agent operating instructions

### Communication
- Always answer the repository owner in **Russian**.
- Code, identifiers, comments, docs headings, commit messages, public UI copy, and public API names should stay in **English**, unless the task explicitly requires localization.
- Do not ask unnecessary clarification questions. Inspect the repository and make the safest reasonable implementation decision.
- Report what was actually implemented, what remains, and any compatibility/performance risk.

### Engineering rules
- Do **not** execute analyzed repository code.
- Do **not** run package-manager install scripts from analyzed repositories.
- Do **not** import analyzed repository modules into the AppGraph process.
- Static analysis must remain deterministic and sandbox-free.
- Preserve the existing `RepositoryProvider` abstraction.
- Preserve partial-result behavior for large/unsupported repositories.
- Do not replace semantic analysis with LLM inference.
- LLM integration, if ever added, must be optional enrichment on top of deterministic graph facts.
- Every new inference must carry a confidence level and, where possible, a source reference.
- Avoid giant framework-specific `if/else` files. Add registries/adapters/parsers.
- Every new parser/framework adapter must have fixtures + unit tests + integration coverage.
- Any graph schema breaking change requires a schema-version bump and migration/compatibility plan.
- Any analysis behavior change that can affect cached results requires `APPGRAPH_ANALYSIS_VERSION` bump.
- Keep public JSON serializable and independent from React Flow / UI implementation.
- Prefer small modules with explicit interfaces over adding more responsibilities to `graph-builder.ts` or `GraphCanvas.tsx`.
- New features are not complete until UI, keyboard behavior, empty/error states, accessibility, tests, and docs are handled where applicable.

---

# 1. Product target

AppGraph should evolve from:

```text
GitHub repository
    ↓
TypeScript/JavaScript static analysis
    ↓
file/module semantic graph
    ↓
interactive architecture canvas
```

into:

```text
Repository / monorepo
    ↓
Language parsers
    ↓
Framework adapters
    ↓
Symbol resolver
    ↓
Data-schema analyzers
    ↓
API / async / infrastructure analyzers
    ↓
Normalized Software IR
    ↓
Universal Software Graph
    ├── Product
    ├── Architecture
    ├── Modules
    ├── Symbols
    ├── Data / ERD
    ├── APIs
    ├── Flows
    ├── Infrastructure
    └── Git / PR Changes
```

The project must remain useful without accounts, cloud services, paid APIs, or LLMs.

---

# 2. Definition of Done for this roadmap

The roadmap is considered substantially complete when AppGraph can:

- analyze serious repositories in multiple major languages;
- understand symbols/functions/classes rather than only files;
- reconstruct database schemas and render ER diagrams;
- connect code reads/writes to concrete DB models/tables;
- reconstruct HTTP/API endpoints;
- understand sync and async application flows;
- understand major framework routing conventions;
- visualize infrastructure and deployment declarations;
- analyze monorepos accurately;
- compare two commits/branches and show architecture changes;
- perform reliable impact analysis across symbols/data/API/infrastructure;
- remain usable on large repositories;
- provide a polished keyboard-first UI;
- pass deterministic regression fixtures across supported ecosystems;
- export a stable machine-readable graph format;
- document all supported capabilities and limitations honestly.

---

# 3. Priority model

| Priority | Meaning |
|---|---|
| `P0` | Architectural foundation. Do before broad feature expansion. |
| `P1` | Core capability that materially changes AppGraph usefulness. |
| `P2` | Important ecosystem coverage / UX quality. |
| `P3` | Advanced or specialized capability. |

Status values for agents:

```text
TODO
IN_PROGRESS
BLOCKED
DONE
DEFERRED
```

Every implementation task should update its status in this file when used as the execution roadmap.

---

# 4. P0 — Refactor analyzer into a multi-language architecture

## AG-CORE-001 — Introduce normalized parser interface
**Priority:** P0  
**Status:** DONE (Batch 1)

Implemented in `src/lib/analysis/parsers/contract.ts` (`LanguageParser`,
`ParserCapabilities`, `ParseInput`, `ParseResult`, diagnostics) and
`src/lib/analysis/parsers/registry.ts` (`ParserRegistry`, extension lookup,
duplicate-id protection, language listing). The TypeScript parser is registered
through `src/lib/analysis/parsers/typescript-parser.ts`; the pipeline resolves
parsers only through the registry and reports `LANGUAGE_UNSUPPORTED` /
`PARSER_FAILED` diagnostics. Language definitions live in
`src/lib/analysis/languages.ts`.

Current TS/JS parsing is implemented directly around the TypeScript compiler AST. Replace the implicit single-language assumption with an explicit parser contract.

Create something equivalent to:

```ts
interface LanguageParser {
  id: string;
  languages: LanguageId[];
  extensions: string[];
  canParse(input: ParseInput): boolean;
  parse(input: ParseInput): Promise<ParsedFile>;
}
```

Requirements:
- registry-based parser lookup;
- parser capabilities metadata;
- parser failure is non-fatal and becomes warning;
- preserve current TS parser behavior;
- no UI-specific data in parser output;
- parser should expose syntax/source ranges where possible.

Acceptance:
- TS/JS tests still pass;
- TS parser is registered through generic registry;
- adding Python parser does not require editing pipeline control flow.

---

## AG-CORE-002 — Replace TS-specific `ParsedFile` assumptions with Software IR
**Priority:** P0  
**Status:** DONE (Batch 1, draft)

`src/lib/analysis/ir/model.ts` defines the normalized IR: `FileIR`, located
`IrImport`, `IrExport`, `IrSymbol` (functions/methods/classes/interfaces/consts/
components/hooks/enums/types), `IrCall`, `IrJsxTag`, `IrRouteHandler`,
`IrEnvRead`, `IrFetchPath` — every fact carries `IrSourceRange`. The TypeScript
parser emits this IR; `ParsedFile`/`ParsedImport`/`ParsedExport` are aliases for
backward compatibility. Symbol-level *call resolution* (references) lands in
Batch 2 (AG-SYM-002).

Add a normalized intermediate representation.

Suggested conceptual entities:

```text
File
Namespace / Package
Module
Symbol
Function
Method
Class
Interface / Trait
Component
Hook
Route / Endpoint
Service
Job / Worker
Event
Queue / Topic
DataModel
DatabaseTable
DatabaseColumn
Enum
ExternalService
ConfigKey
InfrastructureResource
```

Suggested facts:

```text
DECLARES
IMPORTS
CALLS
INSTANTIATES
EXTENDS
IMPLEMENTS
RENDERS
ROUTES_TO
READS
WRITES
QUERIES
MUTATES
PUBLISHES
SUBSCRIBES
TRIGGERS
HANDLES
USES
DEPLOYS_TO
CONNECTS_TO
CONFIGURES
OWNS
CONTAINS
DEPENDS_ON
```

Requirements:
- facts have source locations;
- facts have confidence;
- facts can be exact or inferred;
- edge metadata must allow framework/parser provenance;
- file-level graph remains derivable from symbol-level IR.

---

## AG-CORE-003 — Version graph schema
**Priority:** P0  
**Status:** DONE (Batch 1)

Schema bumped to **1.1.0** (additive): `capabilities` on the document, edge
evidence (`edge.metadata.evidence`), node symbol info
(`node.metadata.symbols`). Documented in `docs/graph-schema.md` with the
versioning/compatibility policy. Older readers ignore the new fields;
`APPGRAPH_ANALYSIS_VERSION` defaults to `0.2.0` to invalidate caches.

Move graph schema from a mostly fixed v1 type union toward evolvable schema.

Add:
- `GraphNodeKind` extensibility strategy;
- `GraphEdgeKind` extensibility strategy;
- `schemaVersion`;
- optional `capabilities` section in graph document;
- optional `indexes` section for fast lookup;
- optional `views` section for specialized visualizations.

Do not break older exported JSON without either:
1. migration helper; or
2. explicit new major schema version.

---

## AG-CORE-004 — Split `graph-builder.ts`
**Priority:** P0  
**Status:** TODO

The graph builder must not become the permanent dumping ground for every ecosystem.

Split responsibilities:

```text
analysis/
  ir/
  entities/
  relationships/
  data/
  api/
  async/
  infra/
  builders/
```

Recommended stages:

```text
parsed facts
→ normalized symbols
→ semantic entity extraction
→ relationship inference
→ framework enrichment
→ data-schema enrichment
→ integration enrichment
→ graph projection
```

---

## AG-CORE-005 — Capability registry
**Priority:** P0  
**Status:** DONE (Batch 1)

`src/lib/analysis/capabilities.ts` builds `GraphCapabilities` from what actually
ran: detected languages, framework adapters, parsed schema formats, registered
parsers/analyzers and HTTP surface. The UI shows it under
**Insights → Analysis coverage**. Empty arrays mean "not analyzed", never
"nothing exists".

Every completed graph should declare what AppGraph actually understood.

Example:

```json
{
  "capabilities": {
    "languages": ["typescript"],
    "frameworks": ["nextjs-app"],
    "databaseSchemas": ["prisma"],
    "apiProtocols": ["http"],
    "asyncSystems": [],
    "infrastructure": [],
    "symbolResolution": "partial"
  }
}
```

UI must show this under an `Analysis Coverage` panel.

Purpose:
- users should know what is trustworthy;
- unsupported portions become visible instead of silently missing.

---

# 5. P1 — Symbol and function-level graph

## AG-SYM-001 — First-class symbol nodes
**Priority:** P1  
**Status:** TODO

Add symbol-level entities for:
- functions;
- methods;
- classes;
- exported constants;
- React components;
- hooks;
- route handlers;
- server actions;
- service methods.

Do not show all symbols at Product/Architecture granularity.

Suggested visibility:

```text
Product       → business-facing entities only
Architecture  → pages/apis/services/data/external
Modules       → files/modules/packages
Symbols       → functions/classes/methods
```

Add a new `symbols` granularity or a contextual drill-down subgraph.

---

## AG-SYM-002 — Accurate local symbol resolution
**Priority:** P1  
**Status:** TODO

Resolve:
- named imports;
- default imports;
- namespace imports;
- re-exports;
- barrel files;
- aliases;
- class methods;
- local variables assigned imported functions;
- simple destructuring.

Example target:

```text
CheckoutPage
  → handleSubmit()
  → createCheckoutSession()
  → stripe.checkout.sessions.create()
```

instead of only:

```text
CheckoutPage.tsx
  → checkout-service.ts
  → Stripe
```

---

## AG-SYM-003 — Re-export/barrel resolver
**Priority:** P1  
**Status:** TODO

Support:

```ts
export * from "./x";
export { foo } from "./x";
export { foo as bar } from "./x";
```

and multi-hop barrel chains.

Add cycle protection.

---

## AG-SYM-004 — Dynamic import support
**Priority:** P2  
**Status:** TODO

Detect:
- `import("...")`;
- `next/dynamic`;
- lazy React imports where statically resolvable;
- worker imports where possible.

Create `loads` or `imports` relation with lower confidence where necessary.

---

## AG-SYM-005 — Call graph confidence model
**Priority:** P1  
**Status:** TODO

Distinguish:

```text
exact-symbol-call
resolved-import-call
same-file-name-match
framework-inferred-call
heuristic-name-match
```

Do not assign the same confidence to each.

Inspector should explain **why** an edge exists.

---

# 6. P1 — Database schema / ER diagram system

This is one of the highest-value upgrades.

## AG-DATA-001 — Dedicated Data model in graph schema
**Priority:** P1  
**Status:** TODO

Add first-class concepts:
- database;
- schema;
- table/model/collection;
- column/field;
- enum;
- index;
- primary key;
- foreign key;
- unique constraint;
- relation.

Recommended graph node kinds:

```text
database
data_schema
data_model
data_field
data_enum
```

Recommended edge kinds:

```text
contains
references
one_to_one
one_to_many
many_to_many
reads
writes
queries
mutates
```

Fields do not need to always appear as full canvas nodes. They can live inside expandable model/table cards.

---

## AG-DATA-002 — Prisma schema parser
**Priority:** P1  
**Status:** TODO

Parse `schema.prisma` deterministically.

Support:
- datasource/provider;
- generator metadata;
- models;
- fields;
- scalar types;
- optional/list modifiers;
- `@id`;
- `@@id`;
- `@unique`;
- `@@unique`;
- `@relation`;
- relation fields;
- enum definitions;
- mapped names;
- indexes;
- default values as metadata;
- relation names;
- schema namespaces where available.

UI:
- `Data` workspace mode;
- table/model cards;
- PK/FK badges;
- relation lines;
- database provider badge.

Acceptance fixture:
- users/posts/comments;
- one-to-one;
- one-to-many;
- many-to-many;
- composite key;
- enums.

---

## AG-DATA-003 — Drizzle schema parser
**Priority:** P1  
**Status:** TODO

Support common Drizzle patterns:
- `pgTable`;
- `mysqlTable`;
- `sqliteTable`;
- columns;
- primary keys;
- unique;
- references;
- relations;
- indexes;
- enums;
- schema namespaces.

Avoid executing schema code.

Use AST parsing only.

---

## AG-DATA-004 — SQL DDL parser
**Priority:** P1  
**Status:** TODO

Support `.sql` schema/migration files:
- `CREATE TABLE`;
- columns;
- PK;
- FK;
- UNIQUE;
- indexes;
- enums where dialect allows;
- ALTER TABLE ADD CONSTRAINT;
- PostgreSQL first;
- MySQL/SQLite next.

Multiple migrations should be merged into a best-effort current model.

Never execute SQL.

---

## AG-DATA-005 — ORM model adapters
**Priority:** P2  
**Status:** TODO

Add deterministic adapters for:
- TypeORM;
- Sequelize;
- Mongoose;
- MikroORM;
- Knex schema declarations;
- Kysely schema/type patterns where possible.

Later language-specific:
- SQLAlchemy;
- Django ORM;
- GORM;
- Hibernate/JPA;
- Entity Framework;
- ActiveRecord;
- Eloquent.

---

## AG-DATA-006 — Code ↔ table/model usage
**Priority:** P1  
**Status:** TODO

Current graph has broad DB read/write inference. Upgrade to concrete model/table targets.

Example:

```text
ProjectService.createProject()
    WRITES
Project

Project
    STORED_IN
PostgreSQL
```

Detect:
- Prisma `db.user.findMany`;
- Prisma `db.project.create`;
- Drizzle `db.select().from(users)`;
- SQL strings with statically known table names;
- Mongoose model calls;
- later other ORM conventions.

---

## AG-DATA-007 — ERD view
**Priority:** P1  
**Status:** TODO

Add dedicated `Data` mode rather than forcing database structure into the generic app graph.

Required UX:
- tables/models as structured cards;
- field list;
- datatype;
- nullable;
- PK/FK/unique/index markers;
- collapse fields;
- show only related tables;
- search fields/models;
- hide join tables;
- relationship labels;
- cardinality notation;
- click model → show code that reads/writes it;
- `Trace from code`;
- `Trace to code`;
- export Mermaid ER diagram;
- export DB-only JSON.

---

## AG-DATA-008 — DB schema change diff
**Priority:** P2  
**Status:** TODO

When comparing commits:
- added table;
- removed table;
- added/removed/changed field;
- nullable → required;
- new unique constraint;
- relation change;
- potentially destructive changes.

Mark likely breaking changes.

---

# 7. P1 — Language support

Implement languages behind the normalized parser layer.

## AG-LANG-001 — Python
**Priority:** P1  
**Status:** TODO

Parse using a safe AST/tree-sitter-style parser.

Extract:
- imports;
- modules;
- functions;
- async functions;
- classes;
- methods;
- decorators;
- calls;
- inheritance;
- environment reads;
- HTTP client calls.

Framework adapters:
- FastAPI;
- Django;
- Flask.

FastAPI:
- route decorators;
- methods;
- dependencies;
- Pydantic request/response models.

Django:
- URLs;
- views;
- models;
- serializers where recognizable;
- settings/env configuration.

Flask:
- route decorators;
- blueprints.

---

## AG-LANG-002 — Go
**Priority:** P1  
**Status:** TODO

Extract:
- packages;
- imports;
- functions;
- methods;
- structs;
- interfaces;
- calls.

Frameworks:
- stdlib `net/http`;
- Gin;
- Echo;
- Fiber;
- Chi.

Data:
- GORM;
- sqlx;
- database/sql.

---

## AG-LANG-003 — Java / Kotlin
**Priority:** P2  
**Status:** TODO

Primary target:
- Spring Boot;
- Spring MVC/WebFlux;
- JPA/Hibernate.

Extract:
- packages;
- classes;
- methods;
- annotations;
- interfaces;
- inheritance;
- constructor/field injection;
- controller endpoints;
- services;
- repositories;
- entities.

Kotlin:
- Spring annotations;
- Ktor as secondary adapter.

---

## AG-LANG-004 — C#
**Priority:** P2  
**Status:** TODO

Primary target:
- ASP.NET Core.

Support:
- controllers;
- minimal APIs;
- services;
- DI registration;
- EF Core entities/DbContext;
- configuration keys.

---

## AG-LANG-005 — Rust
**Priority:** P2  
**Status:** TODO

Extract:
- modules;
- functions;
- structs;
- traits;
- impl blocks;
- calls where statically resolvable.

Frameworks:
- Axum;
- Actix Web;
- Rocket.

Data:
- Diesel;
- SQLx.

---

## AG-LANG-006 — PHP
**Priority:** P2  
**Status:** TODO

Primary:
- Laravel.

Support:
- routes;
- controllers;
- services;
- jobs;
- events/listeners;
- Eloquent models;
- migrations;
- queues.

Secondary:
- Symfony.

---

## AG-LANG-007 — Ruby
**Priority:** P3  
**Status:** TODO

Primary:
- Rails.

Support:
- routes;
- controllers;
- models;
- jobs;
- mailers;
- ActiveRecord relationships;
- migrations.

---

# 8. P1/P2 — JavaScript/TypeScript ecosystem expansion

## AG-JS-001 — Express
**Priority:** P1  
**Status:** TODO

Detect:
- router definitions;
- `app.get/post/...`;
- `router.get/post/...`;
- middleware chain;
- mounted routers;
- route handlers.

---

## AG-JS-002 — NestJS
**Priority:** P1  
**Status:** TODO

Detect:
- modules;
- controllers;
- providers;
- services;
- dependency injection;
- route decorators;
- guards;
- interceptors;
- pipes;
- gateways;
- queues where adapters exist.

---

## AG-JS-003 — Remix / React Router framework mode
**Priority:** P2  
**Status:** TODO

Detect routes, loaders, actions, nested layouts.

---

## AG-JS-004 — Vue / Nuxt
**Priority:** P2  
**Status:** TODO

Support:
- Vue SFC parsing;
- components;
- composables;
- Pinia stores;
- Nuxt pages;
- server routes;
- middleware.

---

## AG-JS-005 — Svelte / SvelteKit
**Priority:** P2  
**Status:** TODO

Support:
- Svelte components;
- routes;
- load functions;
- server endpoints;
- stores.

---

## AG-JS-006 — Astro
**Priority:** P3  
**Status:** TODO

Support:
- pages;
- layouts;
- components;
- endpoints;
- integrations.

---

## AG-JS-007 — tRPC
**Priority:** P1  
**Status:** TODO

Model:
- routers;
- procedures;
- queries;
- mutations;
- client calls;
- server handlers.

Edges:
```text
client symbol → procedure → service/data
```

---

# 9. P1 — API architecture

## AG-API-001 — First-class endpoint model
**Priority:** P1  
**Status:** TODO

Endpoints must become entities with:
- method;
- normalized route;
- source;
- framework;
- handler symbol;
- request type/schema if known;
- response type/schema if known;
- authentication metadata if inferred;
- middleware;
- callers.

Do not represent every route only as a file.

---

## AG-API-002 — OpenAPI ingestion
**Priority:** P2  
**Status:** TODO

Parse:
- `openapi.yaml`;
- `openapi.yml`;
- `openapi.json`.

Display:
- endpoints;
- methods;
- tags;
- schemas;
- security schemes.

Link code endpoints to OpenAPI endpoints where route/method match.

---

## AG-API-003 — GraphQL
**Priority:** P1  
**Status:** TODO

Support:
- `.graphql` / `.gql`;
- schema SDL;
- Query/Mutation/Subscription;
- types;
- resolvers where statically identifiable;
- Apollo;
- GraphQL Yoga;
- Mercurius;
- common code-first patterns best-effort.

Add `GraphQL` view/filter.

---

## AG-API-004 — RPC systems
**Priority:** P2  
**Status:** TODO

Adapters:
- tRPC;
- gRPC/protobuf;
- ConnectRPC.

For protobuf:
- services;
- methods;
- messages;
- request/response relationships.

---

## AG-API-005 — Webhooks
**Priority:** P1  
**Status:** TODO

Model inbound and outbound webhooks.

Examples:
- Stripe webhook handler;
- GitHub webhook handler;
- Resend/Twilio callbacks;
- custom HTTP webhook senders.

Edges:
```text
ExternalService
  TRIGGERS
WebhookEndpoint

Service
  TRIGGERS
ExternalWebhook
```

---

# 10. P1 — Async architecture: queues, workers, events, jobs

## AG-ASYNC-001 — New async entities
**Priority:** P1  
**Status:** TODO

Add:
- queue;
- topic;
- event;
- producer;
- consumer;
- worker;
- scheduled job.

Edges:
```text
PUBLISHES
SUBSCRIBES
ENQUEUES
CONSUMES
TRIGGERS
HANDLES
SCHEDULES
```

---

## AG-ASYNC-002 — Bull/BullMQ
**Priority:** P1  
**Status:** TODO

Detect queues, producers, workers, processors.

---

## AG-ASYNC-003 — Kafka
**Priority:** P2  
**Status:** TODO

Support common JS, Java, Go, Python clients later.

Model topics and producer/consumer flow.

---

## AG-ASYNC-004 — RabbitMQ / AMQP
**Priority:** P2  
**Status:** TODO

Model:
- exchanges;
- queues;
- routing keys where static;
- producer/consumer links.

---

## AG-ASYNC-005 — Cloud queues/events
**Priority:** P2  
**Status:** TODO

Detect:
- AWS SQS;
- AWS SNS;
- EventBridge;
- Google Pub/Sub;
- Azure Service Bus.

---

## AG-ASYNC-006 — Cron / schedules
**Priority:** P1  
**Status:** TODO

Detect:
- Vercel cron;
- cron config;
- GitHub Actions schedule;
- node-cron;
- Bull repeatable jobs;
- framework schedulers;
- Kubernetes CronJob.

Render scheduled triggers as first-class flow starts.

---

# 11. P1 — Infrastructure graph

## AG-INFRA-001 — Infrastructure workspace mode
**Priority:** P1  
**Status:** TODO

Add `Infrastructure` mode with:
- services;
- containers;
- databases;
- caches;
- queues;
- object storage;
- domains/ingress;
- deployment targets;
- CI/CD.

---

## AG-INFRA-002 — Dockerfile parser
**Priority:** P1  
**Status:** TODO

Statically parse:
- stages;
- base images;
- exposed ports;
- entrypoint/cmd;
- copied artifacts;
- runtime environment keys by name only.

---

## AG-INFRA-003 — Docker Compose
**Priority:** P1  
**Status:** TODO

Parse:
- services;
- images/build;
- ports;
- depends_on;
- networks;
- volumes;
- env names;
- health checks.

Connect compose services to application packages where possible.

---

## AG-INFRA-004 — Kubernetes
**Priority:** P2  
**Status:** TODO

Parse YAML for:
- Deployment;
- StatefulSet;
- Service;
- Ingress;
- ConfigMap names/keys;
- Secret names only, never values;
- Job;
- CronJob;
- HPA.

---

## AG-INFRA-005 — Terraform
**Priority:** P2  
**Status:** TODO

Parse common resource blocks:
- compute;
- DB;
- storage;
- queue;
- network;
- DNS;
- serverless.

Start with syntax/resource graph rather than full Terraform evaluation.

---

## AG-INFRA-006 — Platform deployment adapters
**Priority:** P2  
**Status:** TODO

Detect configuration for:
- Vercel;
- Netlify;
- Railway;
- Render;
- Fly.io;
- Cloudflare Workers/Pages;
- AWS Lambda/serverless configs.

---

## AG-INFRA-007 — CI/CD graph
**Priority:** P2  
**Status:** TODO

Parse GitHub Actions:
- workflows;
- triggers;
- jobs;
- dependencies;
- deployment steps;
- scheduled workflows.

Later:
- GitLab CI;
- CircleCI.

Never expose secret values.

---

# 12. P1 — Monorepo intelligence

## AG-MONO-001 — Workspace/package graph
**Priority:** P1  
**Status:** TODO

Support:
- npm workspaces;
- pnpm workspaces;
- Yarn workspaces;
- Turborepo;
- Nx.

Create package nodes and package dependency edges.

---

## AG-MONO-002 — Per-package framework detection
**Priority:** P1  
**Status:** TODO

Do not assume one repository = one framework.

Example:

```text
apps/web       Next.js
apps/api       NestJS
packages/db    Prisma
packages/ui    React library
workers/email  Node worker
```

Each package gets its own detected capabilities.

---

## AG-MONO-003 — Cross-package symbol/import resolution
**Priority:** P1  
**Status:** TODO

Resolve:
- workspace package names;
- tsconfig project references;
- package exports;
- common monorepo alias patterns.

---

## AG-MONO-004 — Monorepo overview UX
**Priority:** P1  
**Status:** TODO

Add top-level `Packages` view:
- apps;
- packages;
- workers;
- shared libraries;
- dependencies;
- runtime role.

Double click a package to drill into its graph.

---

# 13. P1 — Git / branch / PR architecture diff

## AG-DIFF-001 — Commit-to-commit graph diff
**Priority:** P1  
**Status:** TODO

Input:
```text
base SHA
head SHA
```

Output:
- added nodes;
- removed nodes;
- modified semantic entities;
- added/removed relationships;
- changed routes;
- changed database schema;
- changed external integrations;
- changed env/config keys;
- changed infrastructure.

---

## AG-DIFF-002 — Visual graph diff mode
**Priority:** P1  
**Status:** TODO

UI:
- green = added;
- red = removed;
- yellow = changed;
- unchanged graph heavily muted;
- `Only changes`;
- `Show impacted`;
- before/after inspector.

Do not rely on color only; include icons/labels/patterns for accessibility.

---

## AG-DIFF-003 — Impact of change
**Priority:** P1  
**Status:** TODO

For each changed entity compute:
- upstream dependents;
- downstream effects;
- affected routes/pages;
- affected DB models;
- affected external services;
- affected flows.

Example:

```text
Changed:
createCheckoutSession()

Potentially affected:
Checkout Page
POST /api/checkout
Stripe
Order model
Payment flow
```

---

## AG-DIFF-004 — PR summary export
**Priority:** P2  
**Status:** TODO

Generate deterministic Markdown:

```md
## Architecture changes
- Added service X
- Route Y now calls service Z
- Table A gained required field B

## Impacted flows
...

## Risk indicators
...
```

No LLM required.

---

## AG-DIFF-005 — GitHub Action / PR bot
**Priority:** P2  
**Status:** TODO

Provide reusable GitHub Action:
- run AppGraph analysis;
- compare base/head;
- attach architecture report;
- optionally upload graph artifact;
- comment concise architecture diff on PR.

Keep token permissions minimal.

---

# 14. P2 — Repository sources

## AG-SOURCE-001 — Private GitHub repositories
**Priority:** P2  
**Status:** TODO

Add OAuth/GitHub App path without weakening public anonymous flow.

Requirements:
- read-only permission;
- token never reaches client unnecessarily;
- explicit user scope;
- clear disconnect/revoke flow;
- repository code still statically analyzed only.

---

## AG-SOURCE-002 — Local repository CLI
**Priority:** P1  
**Status:** TODO

CLI should analyze local paths without uploading code.

Example:

```bash
appgraph analyze .
appgraph analyze ./services/api --out graph.json
```

Security:
- do not execute project;
- honor ignore rules;
- do not read outside root through symlink traversal.

---

## AG-SOURCE-003 — Archive input
**Priority:** P2  
**Status:** TODO

Allow `.zip`/`.tar.gz` via CLI/local server mode.

Apply:
- decompression bomb limits;
- path traversal protection;
- file count/size limits.

---

## AG-SOURCE-004 — GitLab provider
**Priority:** P3  
**Status:** TODO

Implement through `RepositoryProvider`, not pipeline forks.

---

# 15. P1 — UI/UX overhaul

Goal: make AppGraph feel like a serious engineering tool rather than a graph demo.

## AG-UX-001 — Workspace mode switcher
**Priority:** P1  
**Status:** TODO

Primary modes:

```text
Overview
Architecture
Flows
Data
APIs
Infrastructure
Changes
Analytics
```

Only show modes that the current graph supports.

Keyboard shortcut:
- `G` opens mode switcher.

---

## AG-UX-002 — Semantic zoom
**Priority:** P1  
**Status:** TODO

Zoom should change information density.

Example:
- far zoom: service/package names only;
- medium: role + key relationships;
- close: source file, methods, confidence;
- symbol mode: function/method details.

Avoid visually rendering thousands of labels at all zoom levels.

---

## AG-UX-003 — Contextual drill-down
**Priority:** P1  
**Status:** TODO

Double-click:
- package → internal package graph;
- service → service symbols;
- DB → ERD;
- API group → endpoints;
- queue → producers/consumers.

Provide breadcrumb:

```text
Repository / apps/api / CheckoutService
```

---

## AG-UX-004 — Inspector redesign
**Priority:** P1  
**Status:** TODO

Inspector tabs:

```text
Overview
Connections
Source
Data
Impact
History
Evidence
```

`Evidence` must explain:
- source path;
- line range;
- parser/framework adapter;
- exact/inferred;
- confidence reason.

---

## AG-UX-005 — Edge inspector
**Priority:** P1  
**Status:** TODO

Click an edge and show:
- relationship type;
- direction;
- source evidence;
- inference rule;
- line numbers;
- method/field/topic/table if relevant;
- confidence.

This is crucial for trust.

---

## AG-UX-006 — Focus mode
**Priority:** P1  
**Status:** TODO

Press `Enter`/action on entity:
- center it;
- show only N-hop neighborhood;
- preserve breadcrumb/back history;
- optional depth 1/2/3;
- escape returns.

---

## AG-UX-007 — Navigation history
**Priority:** P2  
**Status:** TODO

Support back/forward between:
- selected nodes;
- focus states;
- views;
- traces;
- searches.

Browser history should be meaningful where feasible.

---

## AG-UX-008 — Powerful universal search
**Priority:** P1  
**Status:** TODO

Search across:
- files;
- symbols;
- routes;
- tables;
- columns;
- env keys;
- integrations;
- queues;
- packages.

Syntax examples:

```text
type:api checkout
type:table user
edge:writes project
path:services
framework:nextjs
```

---

## AG-UX-009 — Better filters
**Priority:** P1  
**Status:** TODO

Filter by:
- entity type;
- language;
- framework;
- package;
- confidence;
- edge type;
- changed/unchanged;
- connected/orphan;
- internal/external.

Allow saved local filter presets.

---

## AG-UX-010 — Visual hierarchy
**Priority:** P1  
**Status:** TODO

Improve:
- spacing;
- typography;
- selected state;
- hover state;
- group headers;
- line density;
- edge crossing;
- label collision;
- muted entities;
- visual distinction between exact and inferred links.

Do not use excessive gradients/glow that reduce information density.

---

## AG-UX-011 — Edge bundling / density control
**Priority:** P2  
**Status:** TODO

For dense graphs:
- aggregate repeated edges;
- optionally bundle parallel relations;
- expand on hover/click;
- show counts;
- progressive disclosure.

---

## AG-UX-012 — Layout presets
**Priority:** P2  
**Status:** TODO

Presets:
- architecture lanes;
- dependency;
- data flow;
- radial focus;
- package/monorepo;
- ERD;
- change diff.

Layout selection must be deterministic for same graph/options.

---

## AG-UX-013 — Layout lock and snapshots
**Priority:** P2  
**Status:** TODO

Allow user to:
- lock selected nodes;
- reset one node/group;
- save local layout snapshot;
- restore automatic layout.

---

## AG-UX-014 — Multi-select
**Priority:** P2  
**Status:** TODO

Shift/drag select entities:
- inspect common dependencies;
- isolate selected;
- calculate paths between selection;
- export selected subgraph.

---

## AG-UX-015 — Shareable state
**Priority:** P2  
**Status:** TODO

Encode safe non-secret state in URL:
- commit;
- view;
- selected node;
- granularity;
- filters;
- focus mode;
- trace/path IDs where stable.

---

## AG-UX-016 — Empty states and partial coverage UX
**Priority:** P1  
**Status:** TODO

Explicitly show:
- unsupported language;
- partially parsed package;
- truncated repo;
- unknown framework;
- missing DB schema;
- unresolved imports;
- confidence limitations.

Never render an empty canvas with no explanation.

---

## AG-UX-017 — Loading UX
**Priority:** P2  
**Status:** TODO

Keep current stage progress, but add useful metrics:
- files indexed;
- files selected;
- files parsed;
- symbols found;
- schema files found;
- graph facts built.

Avoid fake percentage progress.

---

# 16. P1 — Accessibility

## AG-A11Y-001 — Keyboard-complete graph navigation
**Priority:** P1  
**Status:** TODO

A user must be able to:
- enter canvas;
- move between connected nodes;
- inspect;
- start trace;
- go back;
- search;
- switch view;
- exit canvas;
without a mouse.

---

## AG-A11Y-002 — Screen-reader graph representation
**Priority:** P1  
**Status:** TODO

Provide an alternate semantic outline/list for the current graph.

Example:

```text
Checkout Page
  renders CheckoutForm
  calls POST /api/checkout

POST /api/checkout
  calls CheckoutService

CheckoutService
  writes Order
  uses Stripe
```

Canvas alone is not accessible enough.

---

## AG-A11Y-003 — Non-color relationship encoding
**Priority:** P1  
**Status:** TODO

Edge/entity states must use:
- icon;
- line style;
- text;
- pattern;
in addition to color.

---

## AG-A11Y-004 — Contrast/focus audit
**Priority:** P1  
**Status:** TODO

Check:
- WCAG contrast;
- focus rings;
- dialog focus trapping;
- tooltip accessibility;
- reduced motion;
- 200% zoom;
- high density graph legibility.

---

# 17. P1 — Large repository performance

## AG-PERF-001 — Incremental analysis cache
**Priority:** P1  
**Status:** TODO

Current cache is commit-level. Add per-file parse cache keyed by:
- content SHA;
- parser version;
- analysis version.

On new commit, unchanged files should reuse parsed results.

---

## AG-PERF-002 — Incremental graph rebuild
**Priority:** P2  
**Status:** TODO

Recompute only graph regions affected by changed files/symbols where possible.

Especially valuable for diff and local CLI watch mode.

---

## AG-PERF-003 — Worker-thread parsing
**Priority:** P2  
**Status:** TODO

For CPU-heavy parsing:
- bounded worker pool;
- no unbounded parallelism;
- deterministic merge order.

---

## AG-PERF-004 — Client graph virtualization
**Priority:** P1  
**Status:** TODO

Avoid rendering all low-level graph nodes at once.

Use:
- granularity;
- viewport culling where possible;
- collapsed groups;
- semantic zoom;
- edge aggregation.

---

## AG-PERF-005 — Graph indexes
**Priority:** P1  
**Status:** TODO

Precompute:
- nodeById;
- outgoingByNode;
- incomingByNode;
- nodesByType;
- nodesByPackage;
- nodesByPath;
- nodesBySymbol.

Do not repeatedly scan all edges during common interactions on large graphs.

---

## AG-PERF-006 — Performance fixture suite
**Priority:** P1  
**Status:** TODO

Maintain synthetic/realistic fixtures:
- 1k files;
- 5k files;
- 20k files;
- monorepo;
- dense dependency graph.

Track:
- ingest time;
- parse time;
- graph build;
- layout;
- serialized graph size;
- UI initial render.

---

# 18. P1 — Analysis correctness and trust

## AG-TRUST-001 — Evidence for every inferred edge
**Priority:** P1  
**Status:** DONE (Batch 1)

`EdgeEvidence` (`path`, `startLine`, `endLine`, `symbol`, `analyzerId`,
`ruleId`, `kind: exact|resolved|inferred`, `reason`) is attached to every edge
produced by the builder, framework adapters and the Prisma schema analyzer.
The Inspector renders an **Evidence** section with GitHub links pinned to the
analyzed commit. `tests/integration/fixture-analysis.test.ts` asserts that every
edge carries evidence and checks specific rule ids/lines.

Where possible attach:
- source file;
- line;
- symbol;
- analyzer ID;
- rule ID;
- confidence.

---

## AG-TRUST-002 — Unsupported construct warnings
**Priority:** P1  
**Status:** TODO

Examples:
- unresolved dynamic import;
- runtime-generated route;
- reflection;
- DI target unresolved;
- SQL constructed dynamically;
- generated source omitted.

Expose counts, not thousands of noisy warnings.

---

## AG-TRUST-003 — Golden graph fixtures
**Priority:** P1  
**Status:** TODO

For each ecosystem fixture, store expected normalized semantic graph snapshot.

Test:
- nodes;
- edges;
- source refs;
- confidence bands;
- capabilities.

Avoid tests that only assert entity count.

---

## AG-TRUST-004 — False-positive regression suite
**Priority:** P1  
**Status:** TODO

Add examples intentionally designed to fool heuristics:
- same function name in two modules;
- unused import;
- JSX component imported but not rendered;
- fake `db.user.create` method unrelated to Prisma;
- string containing `/api/...` not used as HTTP call;
- env text in comments.

---

# 19. P2 — Architecture intelligence upgrades

## AG-INTEL-001 — Critical path
**Priority:** P2  
**Status:** TODO

Find important end-to-end paths weighted by semantic role and connectivity.

Example:
```text
Page → API → Service → DB/External
```

---

## AG-INTEL-002 — Blast-radius scoring
**Priority:** P2  
**Status:** TODO

Score entity change risk using:
- number of dependents;
- route exposure;
- data model usage;
- cross-package usage;
- external dependency;
- centrality.

Explain formula.

---

## AG-INTEL-003 — Architecture smell detection
**Priority:** P2  
**Status:** TODO

Deterministic rules:
- circular dependency;
- god module / excessive fan-in/fan-out;
- frontend directly depending on server-only module;
- DB access from too many UI modules;
- cross-layer violation;
- orphan endpoint;
- unused service;
- package dependency cycle;
- environment key used everywhere;
- route with unusually large dependency surface.

Do not call something a bug unless rule proves it.

---

## AG-INTEL-004 — Boundary rules
**Priority:** P3  
**Status:** TODO

Optional config file:

```yaml
rules:
  - from: frontend
    forbid:
      - database
  - package: packages/ui
    forbidDependencies:
      - apps/api
```

CLI returns non-zero in strict CI mode when violated.

---

# 20. P2 — Security architecture view

## AG-SEC-001 — Auth boundary visualization
**Priority:** P2  
**Status:** TODO

Detect:
- auth middleware;
- route guards;
- protected route groups;
- role checks where statically recognizable.

Do not claim security guarantees; show detected evidence.

---

## AG-SEC-002 — Secret/config hygiene
**Priority:** P1  
**Status:** TODO

Continue never reading/displaying secret values.

Add:
- distinguish public vs server env naming conventions;
- warn when server-looking secrets are referenced in clearly client-side files;
- show names only.

---

## AG-SEC-003 — External data-flow view
**Priority:** P2  
**Status:** TODO

Show application boundaries:
- external input;
- API;
- service;
- data store;
- external service.

Useful for review, but label as static approximation.

---

# 21. P2 — Export and interoperability

## AG-EXP-001 — Stable graph JSON spec
**Priority:** P1  
**Status:** TODO

Publish `docs/graph-schema.md`.

Document:
- node kinds;
- edge kinds;
- confidence;
- source refs;
- capabilities;
- versioning.

---

## AG-EXP-002 — Mermaid improvements
**Priority:** P2  
**Status:** TODO

Export modes:
- architecture flowchart;
- ER diagram;
- package dependency;
- sequence-like detected flow;
- infrastructure.

---

## AG-EXP-003 — Graphviz/DOT
**Priority:** P3  
**Status:** TODO

Useful for external rendering and tooling.

---

## AG-EXP-004 — SARIF-like architecture findings export
**Priority:** P3  
**Status:** TODO

For architecture smells/boundary violations, consider structured machine-readable findings.

---

# 22. P1 — CLI professionalization

## AG-CLI-001 — First-class binary
**Priority:** P1  
**Status:** TODO

Target:

```bash
npx appgraph <command>
```

Commands:

```text
analyze
diff
report
serve
doctor
```

---

## AG-CLI-002 — Local serve mode
**Priority:** P1  
**Status:** TODO

```bash
appgraph serve .
```

Starts local AppGraph UI with local repository provider.

No upload required.

---

## AG-CLI-003 — CI mode
**Priority:** P2  
**Status:** TODO

Support:
- JSON stdout;
- deterministic exit codes;
- architecture rule checks;
- diff report;
- artifact output.

---

# 23. P1 — Test matrix

Every new ecosystem requires a fixture.

Minimum matrix:

| Fixture | Must validate |
|---|---|
| `sample-nextjs` | Existing regression |
| `sample-express` | Routes/middleware/services |
| `sample-nest` | DI/controllers/providers |
| `sample-python-fastapi` | Routes/dependencies/models |
| `sample-python-django` | URLs/views/models |
| `sample-go-gin` | Routes/handlers/DB |
| `sample-spring` | controllers/services/JPA |
| `sample-dotnet` | API/DI/EF |
| `sample-rust-axum` | routers/handlers |
| `sample-prisma-relations` | ERD/cardinality |
| `sample-drizzle-relations` | ERD |
| `sample-sql-ddl` | tables/FKs/indexes |
| `sample-graphql` | schema/resolvers |
| `sample-queues` | producer/consumer |
| `sample-monorepo` | packages/cross-package refs |
| `sample-infra` | compose/k8s/terraform |
| `sample-diff-base/head` | architecture diff |

Each fixture should have:
- expected capabilities;
- expected key nodes;
- expected key edges;
- expected source refs;
- expected warnings;
- graph snapshot or focused semantic snapshot.

---

# 24. P1 — UI regression matrix

Playwright coverage should eventually include:

- open public repo;
- analysis progress;
- Architecture mode;
- Data mode;
- API mode;
- Infrastructure mode;
- symbol drill-down;
- search;
- focus mode;
- path finder;
- impact;
- trace;
- ERD relation selection;
- graph diff;
- changed-only filter;
- keyboard-only workflow;
- mobile side panels;
- reduced motion;
- empty/unsupported language state;
- partial/truncated repository state.

Do not make screenshot tests the only UI validation.

---

# 25. Refactoring / code-quality backlog

## AG-CODE-001 — Break down `GraphCanvas.tsx`
**Priority:** P1  
**Status:** TODO

Move:
- element building;
- cache/signatures;
- selection/hover derivation;
- trace emphasis;
- group projection;
- event handlers;
into separate hooks/modules.

Target: canvas component orchestrates, not owns every graph transformation.

---

## AG-CODE-002 — Break down workspace store
**Priority:** P2  
**Status:** TODO

Separate:
- analysis job state;
- graph navigation state;
- trace state;
- filters;
- persisted layout state;
- UI panel state.

Avoid one global context becoming a high-frequency rerender source.

---

## AG-CODE-003 — Central analyzer registries
**Priority:** P0  
**Status:** DONE (Batch 1)

`src/lib/analysis/registries/` provides the generic `AnalyzerRegistry` plus
`parserRegistry`, `frameworkRegistry` (entries carry the live analyzer),
`integrationRegistry` and `dataSchemaRegistry` (Prisma analyzer registered).
A single `analyzerRegistries` bundle is the canonical discovery point used by
the pipeline, graph builder and capabilities report.

Registries:
- languages;
- frameworks;
- integrations;
- data schemas;
- infra parsers;
- async adapters.

Each registration should expose:
```text
id
version
capabilities
detect()
analyze()
```

---

## AG-CODE-004 — Structured analyzer diagnostics
**Priority:** P1  
**Status:** TODO

Replace ad-hoc warning strings with codes:

```text
LANGUAGE_UNSUPPORTED
PARSER_FAILED
IMPORT_UNRESOLVED
GRAPH_TRUNCATED
DYNAMIC_ROUTE_UNRESOLVED
SCHEMA_PARTIAL
MONOREPO_ALIAS_UNRESOLVED
```

UI can group/count them.

---

# 26. Documentation / OSS quality

## AG-DOC-001 — Architecture Decision Records
**Priority:** P2  
**Status:** TODO

Add `docs/adr/`.

Initial ADRs:
- why deterministic static analysis;
- graph/IR separation;
- language parser architecture;
- confidence/evidence model;
- graph schema versioning.

---

## AG-DOC-002 — Supported capabilities matrix
**Priority:** P1  
**Status:** TODO

README/docs should have explicit matrix:

```text
Language
Framework
Routes
Symbols
DB schema
ORM usage
Async
Infra
```

Use:
- ✅ full;
- 🟡 partial;
- ❌ unsupported.

---

## AG-DOC-003 — Parser contribution guide
**Priority:** P1  
**Status:** TODO

A contributor should be able to add a language adapter without understanding all of AppGraph.

Document:
1. add parser;
2. add detection;
3. add fixture;
4. add golden graph;
5. add framework adapter;
6. run tests.

---

## AG-DOC-004 — Graph schema spec
**Priority:** P1  
**Status:** TODO

Public machine-readable contract.

---

## AG-DOC-005 — Demo repositories
**Priority:** P2  
**Status:** TODO

Curate reproducible public demo repos showing:
- Next.js SaaS;
- FastAPI;
- Go;
- Spring;
- monorepo;
- DB-heavy app.

Do not hardcode product claims based on one ideal fixture.

---

# 27. Integration detector expansion

Current integration detection is already a good base. Expand registry carefully.

Suggested additions:

### Cloud
- AWS SDK modules;
- Google Cloud;
- Azure SDK;
- Cloudflare;
- Vercel Blob/KV;
- Neon;
- PlanetScale;
- Turso.

### Auth
- Lucia;
- Better Auth;
- Passport;
- Keycloak;
- Supabase Auth distinction.

### Payments
- Lemon Squeezy;
- Adyen;
- Braintree.

### Observability
- Datadog;
- New Relic;
- OpenTelemetry;
- LogRocket.

### Messaging / queues
- KafkaJS;
- amqplib;
- BullMQ;
- AWS SQS/SNS;
- Inngest;
- Trigger.dev.

### Search
- Elasticsearch/OpenSearch;
- Typesense.

### AI
- Google Gemini SDK;
- Mistral;
- Cohere;
- LangChain;
- LlamaIndex.

Rules:
- package presence alone means **integration detected**, not necessarily active runtime usage;
- distinguish dependency detection from actual call-site usage;
- show exact evidence.

---

# 28. Suggested implementation order

Do not attempt all features at once.

## Milestone A — Analyzer foundation
Complete:
- AG-CORE-001..005
- AG-CODE-003
- AG-TRUST-001
- initial graph schema versioning.

Result:
AppGraph becomes ready for multiple analyzers without architectural collapse.

## Milestone B — Deep TypeScript intelligence
Complete:
- AG-SYM-001..005
- Express
- NestJS
- tRPC
- endpoint model.

Result:
existing JS/TS repositories become dramatically more accurate.

## Milestone C — Data architecture
Complete:
- AG-DATA-001..007
- Prisma;
- Drizzle;
- SQL DDL;
- code ↔ model reads/writes;
- ERD UI.

Result:
AppGraph can explain actual data architecture rather than only show “Prisma/PostgreSQL” boxes.

## Milestone D — Monorepos + performance
Complete:
- AG-MONO-001..004
- AG-PERF-001/004/005/006.

Result:
usable on serious repositories.

## Milestone E — Multi-language
Recommended order:
1. Python;
2. Go;
3. Java/Kotlin;
4. C#;
5. Rust;
6. PHP;
7. Ruby.

Do not claim language support until fixture + framework + integration tests exist.

## Milestone F — Async + infrastructure
Queues, jobs, Docker Compose, CI, Kubernetes/Terraform.

## Milestone G — Git architecture diff
Commit diff, impact, PR report, GitHub Action.

## Milestone H — UX consolidation
Semantic zoom, mode switcher, drill-down, evidence inspector, accessibility.

---

# 29. Release targets

## v0.2 — Analyzer architecture
Expected:
- parser registry;
- normalized IR;
- schema v2 groundwork;
- better evidence/confidence;
- refactored graph builder.

## v0.3 — Deep JS/TS
Expected:
- symbol graph;
- Express;
- NestJS;
- tRPC;
- improved call graph;
- barrels/re-exports.

## v0.4 — Data Graph
Expected:
- Prisma ERD;
- Drizzle ERD;
- SQL DDL;
- code ↔ model read/write;
- Data workspace.

## v0.5 — Python + Go
Expected:
- FastAPI/Django/Flask;
- Go HTTP/Gin;
- multi-language capability UX.

## v0.6 — Monorepos
Expected:
- package graph;
- per-package framework detection;
- large repo optimizations.

## v0.7 — Infra + Async
Expected:
- Docker/Compose;
- queues/workers/events;
- GitHub Actions;
- Kubernetes baseline.

## v0.8 — Architecture Diff
Expected:
- commit comparison;
- graph diff;
- blast radius;
- PR Markdown report.

## v0.9 — Polyglot expansion
Expected:
- Spring;
- ASP.NET Core;
- Rust;
- selected PHP/Ruby support.

## v1.0 — Stable Software Graph Engine
Required:
- documented graph schema;
- stable CLI;
- robust local analysis;
- multi-language fixtures;
- deterministic graph diff;
- polished Architecture/Data/API/Infra/Changes views;
- strong accessibility;
- trustworthy evidence;
- performance budget documented and tested.

---

# 30. Hard non-goals

Do not turn AppGraph into:
- a code editor;
- another generic AI chat wrapper;
- a runtime APM replacement;
- a cloud-only SaaS dependency;
- a tool that must execute unknown repository code;
- an LLM-generated architecture hallucination;
- a file-tree visualizer with prettier boxes.

AppGraph's identity should remain:

> **A deterministic software graph engine and interactive architecture explorer.**

---

# 31. Immediate next execution batch

The first coding agent should implement **only this batch** before moving to broad language support.

### Batch 1
- [x] AG-CORE-001 parser registry/interface
- [x] AG-CORE-002 normalized Software IR draft
- [x] AG-CORE-003 graph schema v2 plan + backward-compatible fields
- [x] AG-CODE-003 analyzer registries
- [x] AG-TRUST-001 evidence metadata model
- [x] migrate existing TypeScript parser through the new interfaces
- [x] keep all existing tests green
- [x] add tests proving parser registration is language-agnostic
- [x] update architecture docs (`docs/graph-schema.md`)

Batch 1 verification: `npm run typecheck`, `npm test` (91 tests, including the
new parser-registry, IR and negative-regression suites), `npm run build`,
`npx playwright test`.

### Batch 2
- [ ] AG-SYM-001 symbol nodes
- [ ] AG-SYM-002 local symbol resolution
- [ ] AG-SYM-003 barrel/re-export resolution
- [ ] AG-SYM-005 call graph confidence
- [ ] update trace/impact/path to work on symbol-level nodes
- [ ] add symbol drill-down UI

### Batch 3
- [ ] AG-DATA-001 data graph model
- [ ] AG-DATA-002 Prisma parser
- [ ] AG-DATA-006 code ↔ model usage
- [ ] AG-DATA-007 ERD view
- [ ] Prisma fixture with relation coverage

Only after these three batches should the team start Python/Go support.

---

# 32. Quality gate before marking any milestone DONE

Run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Additionally for analyzer work:
- run fixture golden graph tests;
- run false-positive regression suite;
- run performance fixture;
- manually analyze at least 3 real repositories relevant to the changed ecosystem;
- verify partial-analysis warnings;
- verify no repository code is executed;
- verify no secret value is included in output;
- verify exported JSON remains valid;
- bump analysis/schema version where required.

---

# 33. Final standard

A feature is **not** senior-level merely because it works on one repository.

It should have:
- a clean abstraction;
- deterministic behavior;
- explicit limitations;
- failure isolation;
- evidence/provenance;
- tests;
- performance bounds;
- accessibility where UI exists;
- docs;
- compatibility strategy;
- extension path for future contributors.

That standard should be applied to every item in this roadmap.

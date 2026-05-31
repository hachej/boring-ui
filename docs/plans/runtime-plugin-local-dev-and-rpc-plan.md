# Runtime Plugin DX (CLI): hot-reload, importable deps, route-free data access

## Status

Proposal / design north star. Not started. Captures the architecture converged on while
shipping the `niche-explorer` factory plugin. **Scoped to CLI mode**; remote/hosted concerns
are explicit non-goals (below). Sibling to [workspace-bridge-rpc-plan.md](./workspace-bridge-rpc-plan.md).

> **Pending decision:** Principle 1 (workspace-built deps) is **open decision #1** in
> [plugin-system-roadmap.md](./plugin-system-roadmap.md) — it conflicts with the allowlist
> model assumed by the canonical trust-modes / agent-generation / hot-reload plans. This
> document argues the case and the recommendation is **accepted** (see "Decision #1"): CLI
> plugins may `npm install` arbitrary deps. Track B stays flagged (B2) until greenlight criteria pass.

## Goal

A **simple but robust** runtime plugin system for CLI mode, with three properties:

1. **Authoring feels like local Vite dev** — declare a `package.json`, `npm install` any
   dependency, plain `import`, save-and-see hot reload via `/reload`.
2. **A clean, route-free path for panes to display *and update* data, and to navigate the
   workspace** (open files / surfaces / panes) — via host capabilities + UI effects, **never a
   plugin-owned route**. (Update example: tagging transactions from a pane.)
3. **The agent can self-test a plugin pane and read back errors** — so it iterates on a plugin
   without a human loading the browser to report what broke.

## Non-goals (deliberately out of this plan)

- **Remote / Vercel sandbox build path** — CLI-local only here; remote is a later plan.
- **Full capability-RPC bridge + sandbox-backed handlers for arbitrary custom server logic**
  → owned by the [workspace-bridge-rpc-plan](./workspace-bridge-rpc-plan.md) epic
  (`boring-ui-v2-reorg-14a9`). This plan needs only the *data* capability.
- **Remote DBs (Postgres/MySQL), Quack, DuckLake, writes to file formats** → future.
- **Raw-SQL query arm** → deferred; structured queries only in v1.
- **Hosted/iframe plugin model and trust tiers beyond CLI-local** → trust-modes plan.

## Problem

Two limits surfaced while building real runtime (`.pi/extensions/<name>/`) plugins:

1. **The host-singleton import allowlist does not scale.** Runtime fronts are transformed on
   the fly by the CLI host (`packages/cli/src/server/pluginFrontRuntime.ts`) and may import
   only an allowlisted set (`HOST_SINGLETON_MODULES`: React + `@hachej/boring-workspace{,/plugin,/events}`).
   Any other bare import (`@hachej/boring-data-explorer`, `sql.js`, `d3`, …) is rejected at
   `resolveId` (~line 1039). You can't hand-maintain an allowlist of every library — this is
   the wall `niche-explorer` hit using `DataExplorer`.
2. **Per-plugin backend routes are the wrong primitive.** A `boring.server` Fastify route is
   unstructured, unscoped transport that every plugin reinvents — and for data display it
   means each plugin ships its own DB wiring. There should be **one** clean data path, not N.

## Key enabling insight

**The workspace is already isolated.** The agent already installs and runs arbitrary code in
the workspace, and already serves arbitrary plugin `.tsx` into the workspace UI origin. So
bundling a plugin's *own* dependencies from inside the workspace crosses **no new trust
boundary** — it removes any supply-chain argument for the allowlist.

But supply chain was never the canonical plans' main reason. trust-modes / agent-generation
keep the allowlist mostly to **avoid bundler + React-dedupe complexity** and to **stay portable
across local and hosted runtimes**. Those are the real objections, and they're mechanical, not
security:

- *no build step* → add the workspace build (Principle 1);
- *browsers can't resolve bare specifiers* → the bundler resolves them at build time;
- *single-React requirement* → preserved by the externals contract;
- *hosted portability* → out of scope here (CLI-only); revisit when remote builds are planned.

Whether the added install/bundle machinery is worth it vs. keeping the allowlist is exactly
**decision #1**. This section argues *for* building deps in CLI mode; see the recommendation below.

## North star

> **Authoring a runtime plugin should feel like local dev of a small Vite library** — a real
> `package.json`, `npm install` any dep, plain `import`, save-and-see HMR — **where React and
> the workspace SDK are host-provided peers (externalized), the CLI host runs the toolchain in
> the workspace, and the output mounts as a module into the shared UI.** Data comes from one
> host capability, not a plugin-owned route.

---

## Principle 1 — Host-peer externals + workspace-built deps

### Externals contract

Exactly these stay host-provided singletons (must be a single shared instance — duplicate React
breaks hooks; a second workspace client breaks registry/identity):

```
react, react-dom, react-dom/client, react/jsx-runtime, react/jsx-dev-runtime
@hachej/boring-workspace, @hachej/boring-workspace/plugin, @hachej/boring-workspace/events
```

**Everything else** the plugin declares in its `package.json` `dependencies`; the bundler
resolves + bundles those leaf deps and externalizes only the contract above.

### Mechanism

In `pluginFrontRuntime.ts` `resolveId`, replace the "throw on non-allowlisted bare import"
branch with: resolve the specifier from the **workspace's `node_modules`** and let the existing
Vite instance bundle/serve it. The Vite server already exists (`createServer`, `react()` plugin)
— the change is to *allow* node_modules resolution for leaf deps instead of refusing it. The
externals contract is injected as rollup `external` entries that resolve to the existing
`virtualSingletonId` modules, so React/workspace stay the host's single shared instances and are
**never bundled**.

**One resolution path, not a mode branch.** Always *resolve-from-`node_modules` + externalize the
contract*. The "allowlist" stops being a code path and becomes simply *what is installed*: hosted
ships only the contract in `node_modules`; CLI additionally installs the plugin's declared deps.
So a future hosted mode adds **no `mode === "cli"` fork** in `resolveId` — it just ships a smaller
install set. (An unresolved bare import still fails — now as a normal "not installed" error.)

### Install / cache flow ("allow installing")

- Plugin manifest declares `dependencies` (normal `package.json`).
- **Install scope — recommendation:** one **shared workspace `node_modules`** with a single
  lockfile. Simplest, dedupes across plugins, and matches how the workspace already runs Node.
  Per-plugin isolation is a later option only if version conflicts appear.
- **Package manager:** use the workspace's (`pnpm` if present, else `npm`) and its global store
  for offline-friendly installs.
- **Cache key** = `hash(plugin package.json deps + workspace lockfile + plugin source files)`.
  A hit skips both install and rebuild; the per-plugin bundle is regenerated only when the key
  changes. Configure Vite `optimizeDeps` so deps are pre-bundled → fast HMR after first install.

### Build cost

The bundle step is **not** the cost — esbuild/Vite bundles a small plugin + a few deps in tens
to low-hundreds of ms, cached. The one-time `install` of a new dep is seconds (network-bound),
then cached. After that, `/reload` stays hot-reload-grade.

### Risks

- **Externals must be exact** — the biggest correctness risk (mis-externalizing → duplicate
  React / mismatched workspace instances). Needs a test that asserts the contract (Track B, B1).
- Bundle size for heavy deps — a first-load concern; mitigated because data now comes from the
  host data capability (Principle 3), not a front-bundled engine.
- Install latency / reproducibility — needs lockfile + cache.

---

## Principle 2 — Plugins never create routes; the host provides capabilities

A plugin does **not** register Fastify routes. Anything it needs from the server is a
**host-provided capability** it *calls*. In v1 the only capability a plugin needs is **data
access** (Principle 3).

**Transport — v1 is a single host-owned endpoint:**

- **v1:** the host provides one endpoint (`POST /api/v1/data/query`) — *the host owns it, not
  the plugin*. Available now, no dependency on the bridge epic. This is the simple, robust path.
- **Later:** when the WorkspaceBridge `call` lane lands, the same op moves behind
  `bridge.call("data.v1.query", …)` (capability-scoped, audited) with **no change to the
  plugin-facing contract** (`createBridgeDataSource` hides the transport).

Either way the plugin owns no routes; the data path is shared, not reinvented per plugin.
Arbitrary *custom* plugin server logic (a plugin's own compute/handlers) is **out of scope
here** → the bridge epic's sandbox-backed-handler work.

### Navigation = UI effects, not routes or `<a href>`

A pane navigates the workspace by **emitting a UI effect** on the bridge's `emitUiEffect` lane —
never by browser navigation or a plugin route. Effects reuse the existing schemas:

```txt
openFile        # open/focus a workspace file
openSurface     # open a registered surface (e.g. a record by id — a niche slug)
openPanel       # open/focus a panel
navigateToLine  # jump to a line in an open file
```

Provide a `<WorkspaceLink to={effect}>` helper (from `@hachej/boring-workspace`, allowlisted)
that renders a real `<a>` for affordance (hover, copy, middle-click) but intercepts the click
and calls `emitUiEffect`, so navigation stays in-app and deep links resolve through
`surfaceResolvers`. Front-only, route-free, unblocked (`postUiCommand`/`emitUiEffect` are
already exported). The niche-explorer catalog→detail open is this pattern today.

---

## Principle 3 — Clean data access path (`data.v1.query`)

One host-owned, source-agnostic query capability, so every plugin displays data the same way:
no per-plugin route, no DB driver in the plugin, and **no dataset bundled into the front** (the
anti-pattern `niche-explorer` currently uses).

### Shape — "named source + structured query → rows"

A plugin references a **source by name** and sends a **structured query**; the host resolves and
executes it. Source descriptors are host-owned (declared by app composition), never exposed to
plugin/browser code:

```txt
{ name: "niches", kind: "json",    path: "apps/.../niche-explorer-data.json" }
{ name: "events", kind: "parquet", path: "data/events/*.parquet" }   # globs ok
{ name: "app",    kind: "sqlite",  path: "app.db" }
```

v1 source kinds are **local files only**: `json`, `csv`, `parquet`, `sqlite`, `duckdb`.

### Operations

```txt
data.v1.query    # {source, query, filters, group, sort, limit, offset} -> {columns, rows, total, hasMore}
data.v1.facets   # {source, filters} -> value/count per facet key (server-side facet counts)
data.v1.schema   # {source} -> columns + types + facetable (a generic table/grid renders with no plugin code)
```

Structured only in v1 (no raw-SQL arm — that would break source-agnosticism and complicate the
guard). Output is bounded (`maxRows`/`maxOutputBytes`/`timeoutMs`), read-only. The structured
contract mirrors the data-explorer `ExplorerDataSource` (`search`/`fetchFacets`), so a front
helper `createBridgeDataSource(source)` is a **drop-in `ExplorerDataSource`** for
`DataExplorer`/data-catalog catalogs — the niche-explorer's exact need.

**This path is independent of decision #1.** `createBridgeDataSource` ships from
`@hachej/boring-workspace` (already on the import allowlist), and `data.v1.query` is a host
capability — so a plugin gets clean, route-free data access **under today's import rules**, with
no workspace-built-deps change. Data access (Track A) and import-any-dep (Track B) are separable;
only Track B waits on decision #1.

### Engine: in-process DuckDB

`@duckdb/node-api` (already a workspace-playground dependency) reads `json`/`csv`/`parquet`
natively and `ATTACH`es local `sqlite`/`duckdb` — one engine, one SQL dialect, no per-source
code (the playground already uses `create or replace view … read_csv_auto(…)`).

**Connection + view caching (perf).** Running `read_json_auto(file)` per call re-reads and
re-parses the whole file on every keystroke. Instead the host keeps **one cached
`DuckDBConnection` per workspace** and registers a **view per source** once
(`create or replace view <source> as select * from read_*('<path>')`); queries run against the
view. Recreate the view only when the file's `mtimeMs` changes (from `workspace.stat`), so edits
are picked up without re-parsing every query. This makes search-as-you-type cheap.

**Safe by construction (no injection surface).** Because the caller sends a *structured* query,
the host builds the SQL itself with quoted identifiers + bound parameters
(`quotedIdentifier`/`quotedString`, already used in the playground) against a fixed template
(`SELECT … WHERE <bound filters> ORDER … LIMIT/OFFSET`; `count(*)` for total; `GROUP BY` for
facets). The regex `execute_sql` guard is **not** the safety mechanism here — it only applies to
the deferred raw-SQL arm. Structured input cannot inject SQL.

### Writes (constrained — e.g. transaction tagging)

Reads are the MVP, but real panes also write — tagging a transaction, editing a field. For
writable data the **`sqlite`/`duckdb` source is the primary store** (source of truth for both
reads and writes); `json`/`csv`/`parquet` remain read-only inputs. Add a **separate, constrained
mutation op** (not arbitrary SQL):

```txt
data.v1.mutate   # {source, op, key, set, expectedVersion?, idempotencyKey} -> {changed, idempotentReplay, version}

# tagging example:
data.v1.mutate { source: "txns", op: "update", key: { id: "t_123" }, set: { tags: ["rent"] } }
```

- **Writable sources only:** `sqlite` / `duckdb` (transactional). `json`/`csv`/`parquet` stay
  read-only in v1 — whole-file rewrite / columnar-immutable are not safe write targets.
- **Separate capability** `data:write:<source>`, granted independently of read.
- **Idempotent:** every mutation carries an idempotency key. The v1 transport is the host
  endpoint (not the bridge yet), so the key store is **host-side** — a small table keyed by
  `(source, idempotencyKey)` holding the prior result; a replay returns it
  (`idempotentReplay: true`) without re-applying.
- **Concurrency — optimistic, in v1 (not deferred):** an agent and a human can write at the same
  time, so serializing requests at the host is not enough (stale-read clobber). Every
  `update`/`upsert` carries an **`expectedVersion`** (a per-row `rev`/`updatedAt`); the host
  rejects a stale write with `WRITE_CONFLICT`, and the caller re-reads + retries. A shared
  *physical* multi-writer DB across processes is still the Quack/DuckLake future; this is logical
  concurrency control over one DB.
- **Structured + audited:** `op`/`key`/`set` only (no raw SQL); writes audited like reads.

### Boundaries / security

- Plugins reference sources by `name` only — never raw paths.
- File sources are path-validated and workspace-confined.
- Reads are read-only; mutations go only through capability-gated `data.v1.mutate` on writable sources.

### Future (non-goals here)

Remote DBs (DuckDB `ATTACH` postgres/mysql + host-side secrets), writes to file-format sources
(json/parquet), and a **shared physical multi-writer** DB across processes via
[Quack](https://duckdb.org/2026/05/12/quack-remote-protocol) /
[DuckLake](https://www.definite.app/blog/duckdb-quack-ducklake-catalog) (beta; stable target
DuckDB v2.0, fall 2026). If adopted, the **host stays the only Quack client** — never hand a DB
token to browser/plugin code. Spike first: can `@duckdb/node-api` act as a Quack client?

---

## Principle 4 — The agent self-tests the pane and reads back errors

Today a runtime-plugin error only surfaces when a human opens the browser and reports it. This
session's `niche-explorer` cost ~10 reload cycles because every failure was invisible to the
agent: a non-allowlisted import **rejected** at transform, a **dual-React `ReactSharedInternals.H
is null`** crash, a **blank pane**, a file-fetch **400**. The agent must close its own loop.
`verify-plugin` only checks the manifest + files ("does NOT execute plugin code") — there's a
missing rung between that and a human eyeballing the UI.

Three layers, cheapest first — reuse what exists, add the missing reporting:

1. **Server-side load/transform diagnostics (exists).** `/reload` returns structured
   diagnostics; `/api/v1/agent-plugins/:id/error` and `/api/v1/agent-plugins/events` report
   load/transform failures. Catches manifest errors, **non-allowlisted imports** (the
   data-explorer reject), and syntax/transform errors. The agent reads these after reload — no
   browser needed.
2. **Pane runtime-error reporting (new, lightweight).** Wrap each plugin pane in the host's
   error boundary + a scoped `window.onerror`/`unhandledrejection` listener, and route caught
   render-time errors to the **same** `:id/error` store. Catches crashes the server can't see
   (the dual-React null-dispatcher). Bonus: also helps a human session, not just self-test.
3. **Headless render self-test (new, heavier; the active check).** Load the plugin's
   pane/surface headlessly (the e2e Playwright/chromium already in the repo), open it via the
   plugin's command/surface, and capture: module-load errors, `console.error`/`pageerror`,
   **whether the pane actually mounted vs stayed blank**, and **failed network requests** (the
   data 400). Returns a structured verdict. This is the only layer that catches "no error but
   renders nothing / no data."

**Pane lifecycle signal (makes layer 3 deterministic).** The host's pane wrapper sets a DOM
state attribute the harness waits on, instead of guessing from DOM contents:
`data-boring-pane="loading"` → `"ready"` on the pane's first successful commit, or `"error"`
from the error boundary. `test-plugin` waits for `ready | error | timeout`. A blank-but-stuck
pane stays `loading` → reported as a **timeout failure, not a false pass** — this is what makes
"mounted vs blank" reliable.

**One health channel.** All three layers write to a single host-side store (`:id/health` +
`:id/error`): layer 1 on reload, layer 2 from the pane error boundary + the `data-boring-pane`
signal, layer 3 from the pane's own reporting of failed fetches. So `boring-ui test-plugin <name>`
is a **thin orchestrator** — reload → open the pane → poll `:id/health` until
`ready | error | timeout` — returning `SelfTestResult` (see Contracts). It does **not** parse
console/DOM itself; the pane and host report structured state, which also serves a human session.
Redaction follows the bridge rules. **Scope:** CLI-local; hosted/iframe self-test is a non-goal here.

---

## Contracts (v1)

Pin the integration surface so tracks can be built/bead-ed independently. Shapes are
platform-neutral (no `node:*`); the host implements them, the front consumes them.

```ts
// ---- Source registry (host-owned; declared by app composition, never by a plugin) ----
type SourceKind = "json" | "csv" | "parquet" | "sqlite" | "duckdb"
interface SourceDescriptor {
  name: string                 // plugins reference this; never the path
  kind: SourceKind
  path: string                 // workspace-relative; globs allowed for file kinds
  table?: string               // for sqlite/duckdb: which table/view (default: inferred)
  facetable?: string[]         // columns offered to data.v1.facets / the UI
  writable?: boolean           // gates data.v1.mutate; only sqlite/duckdb may be true
}
// App composition wires sources + grants on a host object — NO module-global registry
// (mirrors how the bridge plan injects via composition; keeps multi-workspace isolation clean):
interface DataHost {
  registerSources(defs: SourceDescriptor[]): void
  grant(pluginId: string, g: { read?: string[]; write?: string[] }): void  // names or ["*"]; write ⊆ writable
}

// ---- data.v1.query / facets / schema (read) ----
// Field-for-field the data-explorer SearchArgs shape (+ a rows-level `sort`), so
// createBridgeDataSource is a near-identity adapter on the request side (one vocabulary).
interface QueryArgs {
  source: string
  query?: string                          // free-text search (ILIKE across text columns)
  filters?: Record<string, string[]>      // column -> allowed values (OR within, AND across)
  group?: { key: string; value: string }  // scope to one group while paginating
  sort?: { column: string; dir: "asc" | "desc" }[]
  limit: number                            // <= host maxRows
  offset: number
}
interface QueryResult {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  total: number
  hasMore: boolean
}
interface FacetsArgs  { source: string; filters?: Record<string, string[]> }
type    FacetsResult  = Record<string, { value: string; count: number }[]>
interface SchemaResult { columns: { name: string; type: string }[]; facetable: string[] }

// ---- data.v1.mutate (write; writable sources only) ----
interface MutateArgs {
  source: string
  op: "update" | "insert" | "upsert"
  key?: Record<string, unknown>           // required for update/upsert
  set: Record<string, unknown>
  expectedVersion?: string | number       // optimistic concurrency; mismatch -> WRITE_CONFLICT
  idempotencyKey: string                  // required; dedupes double-submit
}
interface MutateResult { changed: number; idempotentReplay: boolean; version: string | number }

// ---- stable error contract (returned, never thrown across the boundary) ----
type DataErrorCode =
  | "SOURCE_NOT_FOUND" | "SOURCE_UNREADABLE" | "QUERY_INVALID"
  | "OUTPUT_TOO_LARGE" | "CAPABILITY_DENIED" | "READONLY_SOURCE"
  | "WRITE_CONFLICT"   | "IDEMPOTENCY_REQUIRED" | "TIMEOUT"
interface DataError { code: DataErrorCode; message: string }   // redacted: no paths/secrets/payloads

// ---- front helpers (from @hachej/boring-workspace; allowlisted) ----
// Drop-in ExplorerDataSource for DataExplorer/data-catalog:
declare function createBridgeDataSource(opts: {
  source: string
  rowToItem: (row: Record<string, unknown>) => import("@hachej/boring-data-explorer/shared").ExplorerItem
}): import("@hachej/boring-data-explorer/shared").ExplorerDataSource
// Navigation (Principle 2): renders <a>, intercepts click -> emitUiEffect.
// `to` is a discriminated union of the real effect payloads (no `[k]: unknown`):
type NavEffect =
  | { kind: "openFile"; path: string }
  | { kind: "openSurface"; surface: string; target: string; meta?: Record<string, unknown> }
  | { kind: "openPanel"; panelId: string }
  | { kind: "navigateToLine"; path: string; line: number }
declare function WorkspaceLink(props: { to: NavEffect; children: React.ReactNode }): JSX.Element

// ---- self-test (Track C) ----
// Layers 1–3 all write to ONE host-side health store; test-plugin triggers a mount then polls it.
interface PluginHealthEvent { layer: 1 | 2 | 3; code?: string; message: string }  // one error shape
interface PluginHealth {
  state: "loading" | "ready" | "error"               // from the data-boring-pane signal
  errors: PluginHealthEvent[]                          // redacted
  failedRequests: { status: number; url: string }[]   // url redacted
}
type SelfTestResult = PluginHealth & { ok: boolean }   // ok = state === "ready" && errors.length === 0
```

Notes: `data.v1.schema.facetable` feeds the front facet popover (the front no longer hard-codes
facet keys). `OUTPUT_TOO_LARGE` is returned when a query would exceed `maxRows`/`maxOutputBytes`
before serialization — callers page via `limit`/`offset`.

---

## Phasing — independent tracks

The goal's parts have **different dependencies**, so they ship independently. (Track A realizes
Principles 2–3; Track B realizes Principle 1; Track C realizes Principle 4.)

### Track A — Clean data access (unblocked; ship first)

Independent of decision #1: needs only a host op + a front helper exported from the
already-allowlisted `@hachej/boring-workspace`. Works under today's import rules.

- **A1.** Host `data.v1.query` + `data.v1.facets` over local files via in-process DuckDB
  (structured, read-only, cached views), exposed as `POST /api/v1/data/query`. (`data.v1.schema`
  optional in v1.)
- **A2.** `createBridgeDataSource(source)` helper in `@hachej/boring-workspace` → drop-in
  `ExplorerDataSource`.
- **A3.** Migrate `niche-explorer` off its bundled blob to the data capability (proves read).
- **A4.** `<WorkspaceLink>` nav helper in `@hachej/boring-workspace` over `emitUiEffect`
  (openFile / openSurface / openPanel / navigateToLine).
- **A5.** Constrained writes: `data.v1.mutate` (update/insert/upsert by key, idempotent,
  **optimistic-concurrency via `expectedVersion`→`WRITE_CONFLICT`**, capability-gated) for
  `sqlite`/`duckdb` primary-store sources — e.g. transaction tagging. Reads ship first.
- *Later:* move the transport behind the bridge `call` lane when the epic lands — no
  plugin-facing change.

→ delivers **"route-free data display, update, and in-app navigation."**

### Track B — Import-any-dep + hot reload (gated on decision #1)

- **B1.** Externals contract + dedupe test (fails on duplicate React / non-singleton workspace).
  No behavior change.
- **B2.** `resolveId` resolves non-allowlisted bare imports from the workspace `node_modules` and
  bundles them; externalize the contract. Behind a flag.
- **B3.** Manifest `dependencies` → workspace install, lockfile, cache, `optimizeDeps`;
  `/reload` re-bundles.
- **B4.** **Update the authoring + build skills** (`packages/pi/skills/boring-plugin-authoring/SKILL.md`,
  `.agents/skills/boring-plugin-build/SKILL.md`): replace the import-allowlist guidance with
  workspace-built-deps + `data.v1` (allowlist guidance is superseded). **Keep the timeless
  footguns**: no `@hachej/boring-workspace` React hooks (dual-React `ReactSharedInternals.H` crash);
  a `leftTab` needs a `component`; CLI workspaces-mode needs the `x-boring-workspace-id` header; the
  catalog pattern. *(The skills are deliberately **not** edited ahead of execution — the allowlist
  guidance would contradict this plan until Tracks A/B land.)*

→ delivers **"import any dep + hot reload."**

### Track C — Agent self-test loop (unblocked)

Independent of decision #1; reuses existing reload diagnostics + the repo's e2e headless browser.

- **C1.** Expose layer-1 reload/load diagnostics as an agent-readable result.
- **C2.** Pane error boundary + scoped `window.onerror` + `data-boring-pane` lifecycle signal +
  failed-fetch reporting → **one host-side `:id/health` store** (layers 2–3 report here).
- **C3.** `boring-ui test-plugin <name>`: reload → open the pane → **poll `:id/health`** until
  `ready|error|timeout` → return `SelfTestResult`. Thin orchestrator (no bespoke console/DOM
  assertions); reuses the e2e headless browser only to trigger the mount. Wire into the loop.

→ delivers **"agent self-tests the pane and reads back errors."**

Track A delivers the data half today; Track C makes the loop self-correcting today; Track B
delivers the authoring half once decision #1 lands.

### Dependency graph

```
Track A:  A1 ── A2 ── A3            read MVP (niche-explorer migrated)
                 ├── A4             nav helper — independent (needs only emitUiEffect)
                 └── A5             writes — needs A1 engine + source registry (sqlite/duckdb)
Track B:  B1 ── B2 ── B3            gated on decision #1
Track C:  C1 ── C2 ── C3            C3 needs the pane-state signal from C2
```

No cross-track dependency for A/C; B is independent. A2 (`createBridgeDataSource`) ships in the
workspace package, so package plugins benefit too.

### Acceptance criteria (per task — bead-ready)

- **A1** — `data.v1.query`/`facets` over a json + a sqlite source return correct
  `rows`/`total`/facets; the per-source view is cached and recreated on `mtimeMs` change;
  exceeding `maxRows` returns `OUTPUT_TOO_LARGE`.
- **A2** — `createBridgeDataSource` drives `<DataExplorer>` (search + facet filter + pagination)
  against A1 with **no plugin-side DB code**.
- **A3** — niche-explorer renders catalog + detail from `data.v1.query` (no bundled
  `niche-data.ts`); `/reload` clean and `test-plugin` green.
- **A4** — `<WorkspaceLink>` opens file/surface/panel via `emitUiEffect`; middle-click/copy
  behave like a link; **no route registered**.
- **A5** — `data.v1.mutate` update-by-key persists to a sqlite source; same `idempotencyKey`
  twice → `idempotentReplay:true` and one change; a stale `expectedVersion` → `WRITE_CONFLICT`
  (concurrent agent+human); non-writable source → `READONLY_SOURCE`; missing grant →
  `CAPABILITY_DENIED`.
- **B1** — a test fails if a plugin bundle contains a second React or workspace instance.
- **B2** — a plugin importing a non-allowlisted dep (e.g. `dayjs`) loads and renders (flag on).
- **B3** — adding a dep to `package.json` + `/reload` installs once (cached after) and re-bundles;
  warm reload sub-second.
- **C1** — the agent reads layer-1 diagnostics after `/reload` (an import-reject surfaces with no
  browser).
- **C2** — a thrown render error reaches `:id/error` redacted; the pane shows
  `data-boring-pane="error"`.
- **C3** — `test-plugin <name>` returns `SelfTestResult` and catches a seeded crash, a seeded
  `400`, and a stuck-blank pane (timeout, not false pass).

## Relationship to other plans

- **Bridge epic (`reorg-14a9`):** provides the `call` lane this plan's data capability rides on
  when present; until then a single host endpoint serves it. Custom/sandbox handlers are the
  bridge epic's concern, not this plan's.
- **trust-modes / agent-generation:** own hosted + trust concerns (non-goals here). Track C's
  headless self-test should **reuse the existing e2e Playwright/eval harness**, not a parallel
  one — agent-generation/end-to-end-fix already drive Playwright; Track C adds a per-plugin
  pane-mount check on top.
- **Roadmap decision #1** (deps vs allowlist) gates **Track B only**; Tracks A and C are independent.

## Decision #1 — accepted

**Accepted: adopt workspace-built deps for CLI mode — plugins may `npm install` arbitrary
dependencies.** Rationale: (a) the allowlist
demonstrably blocks real plugins (`niche-explorer` could not use `DataExplorer`); (b) workspace
isolation removes the security objection; (c) the two mechanical objections are mitigated — the
externals contract + the B1 dedupe test preserve single-React, and CLI portability is the only
target here (hosted is a separate plan). **Greenlight criteria:** B1 dedupe test green on a
sample plugin; warm `/reload` stays under ~2 s with a representative dep; install cache hit-rate
verified. **Coexistence:** if hosted portability later needs it, the allowlist remains the
hosted-mode subset — the two are mode-scoped and can coexist. Ship Track B behind a flag (B2).

## Migration & back-compat

- Existing allowlist-only plugins keep working unchanged — the allowlist becomes the *subset*
  that needs no install (React + workspace); Track B only **adds** resolution for declared deps.
- Bundled-data plugins (today's `niche-explorer`) keep working until migrated; **A3** migrates
  the canonical one as the proof.
- `data.v1.*` is additive; `/api/v1/files/raw` stays for byte reads (unchanged).
- Transport migration (host endpoint → bridge `call`) is invisible to plugins —
  `createBridgeDataSource` hides it.

## Test matrix

| Area | Tests |
| --- | --- |
| Externals (B1) | exactly one React + one workspace instance per bundle; dedupe test fails on violation |
| Dep resolution (B2/B3) | non-allowlisted import loads; install cache hit/miss; warm reload latency |
| data.v1 read (A1/A2) | json/csv/parquet/sqlite correctness; facets; pagination; view mtime-invalidation; `OUTPUT_TOO_LARGE` |
| data.v1 write (A5) | update/insert/upsert; idempotent replay; `READONLY_SOURCE`; `CAPABILITY_DENIED`; `WRITE_CONFLICT` |
| Navigation (A4) | each effect kind opens the right target; deep-link via `surfaceResolver`; no route registered |
| Self-test (C) | layer-1 import-reject; layer-2 render crash (redacted); layer-3 seeded `400` + stuck-blank timeout |
| Security | source name-only; path confinement; grant enforcement; redaction in errors/logs |

## Open questions

1. When to migrate `data.v1` transport from the v1 host endpoint to the bridge `call` lane —
   what's the trigger (epic milestone, multi-caller need)?
2. Bundle-size budget / lazy-loading policy for heavy front deps (rarer now that data goes
   through `data.v1`).
3. `data.v1.mutate` write engine for `sqlite`: DuckDB's sqlite-extension DML vs a native writer
   (`better-sqlite3`)? Avoid a second engine if DuckDB's writes are sound (`.duckdb` writes are
   native). Confirm before A5.
4. `expectedVersion` source for `data.v1.mutate`: a dedicated per-row `rev` column vs reusing
   `updatedAt`/rowid — which must sources expose? (The concurrency *model* is decided: optimistic,
   `WRITE_CONFLICT` on mismatch — agent + human may write concurrently.)

*(Resolved during refinement: install scope → shared workspace `node_modules`; package manager →
workspace's pnpm/npm; "mounted vs blank" → `data-boring-pane` lifecycle signal.)*

## Reference points in code

- `packages/cli/src/server/pluginFrontRuntime.ts` — `HOST_SINGLETON_MODULES` (allowlist),
  `RUNTIME_SINGLETON_EXPORTS`, the `resolveId` reject branch (~1039), the Vite `createServer`.
- `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx` and
  `packages/cli/src/front/App.tsx` — where `__BORING_RUNTIME_SINGLETONS__` is populated.
- `apps/workspace-playground/src/plugins/playgroundDataCatalog/` — app-package plugin that
  already imports data-catalog/DuckDB freely (the "trusted package" shape this generalizes); also
  the `DuckDBConnection` + cached-view + `quotedIdentifier`/`quotedString` pattern reused here.

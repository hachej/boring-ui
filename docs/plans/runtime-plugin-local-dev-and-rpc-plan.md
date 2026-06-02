# Runtime Plugin DX (CLI): hot-reload, importable deps, route-free data access

## Status

**Ready for detailed review.** Design proposal — nothing is built yet. Scoped to **CLI mode**
(the `boring-ui workspaces` local server); remote/hosted concerns are explicit non-goals.
Sibling to [workspace-bridge-rpc-plan.md](./workspace-bridge-rpc-plan.md); indexed by
[plugin-system-roadmap.md](./plugin-system-roadmap.md).

Decisions that were the product owner's call are **made** (see "Decisions made" — arbitrary
npm deps; a real DB as the store; agent+human concurrent edits). Remaining choices are
engineering defaults, recorded with justification in "Engineering decisions" so a reviewer can
challenge them, not re-derive them.

---

## TL;DR (read this first)

A plugin author (human or agent) should be able to build a workspace plugin the way you'd build
a small local web app, and the plugin should be able to **show data, edit data, link around the
workspace, and check its own health** — without standing up any backend of its own.

Concretely, four capabilities:

1. **Author like local Vite dev** — a normal `package.json`, `npm install` any library, plain
   `import`, save → hot reload (`/reload`).
2. **Show & edit data with one shared path** — query/update a file or DB through a single
   host-provided capability; the plugin never writes its own server route or DB code.
3. **Navigate the workspace** — a link in a pane opens a file/record/panel, in-app.
4. **Self-test** — the agent loads its own pane headlessly and reads back errors, instead of a
   human opening the browser to report what broke.

Everything is **CLI-local** and leans on machinery that already exists (the CLI's Vite server,
the `/reload` pipeline, DuckDB in the playground, the bridge's UI-effect lane).

---

## Why this plan exists (the motivating story)

This plan was written after building a real runtime plugin — `niche-explorer` in the
`boring-ui-factory` app — and hitting a wall at every step. Each failure was a symptom of a
missing capability:

| What happened building niche-explorer | Root cause | This plan's answer |
| --- | --- | --- |
| Couldn't `import { DataExplorer }` — module load rejected | Runtime fronts may import only an allowlist (React + workspace) | **Principle 1** — let plugins install/import any dep |
| Calling a workspace React hook crashed (`ReactSharedInternals.H is null`) | Two React copies (dual-React) | **Principle 1** externals contract — one shared React |
| Reading the data 400'd, then required a bundled 600 KB JSON blob | No clean way to read workspace data; ended up shipping the dataset inside the plugin | **Principle 3** — one host data capability |
| ~10 reload cycles, each needing a human to open the browser and report the error | The agent can't see runtime/render errors | **Principle 4** — agent self-test |

So the plan is **grounded in observed pain**, not speculation. niche-explorer is the canonical
test case: when it can read from a DB (not a baked-in blob), render, tag a row, and pass an
agent self-test, this plan is proven.

## Goal

A **simple but robust** runtime plugin system for CLI mode, with the four TL;DR properties.
"Simple but robust" is the explicit bias: prefer fewer moving parts; reuse what exists; don't
build for hosted/remote scale we don't yet need.

## Non-goals (deliberately out of scope)

Naming these keeps the plan small and prevents scope creep during implementation.

- **Remote / Vercel sandbox builds** — CLI-local only; remote is a later plan.
- **Arbitrary custom plugin server logic** (a plugin's own compute/handlers) → owned by the
  [workspace-bridge-rpc-plan](./workspace-bridge-rpc-plan.md) epic (`boring-ui-v2-reorg-14a9`).
  This plan needs only the *data* capability, not general RPC.
- **Remote DBs (Postgres/MySQL), Quack/DuckLake, file-format writes** → future (see "Future").
- **Raw-SQL from plugins** → deferred; structured queries only.
- **Hosted/iframe model and trust tiers beyond CLI-local** → trust-modes plan.

---

## Background: how a runtime plugin works today (context for reviewers)

A *runtime plugin* lives at `.pi/extensions/<name>/` in a workspace. It is **not** built
ahead of time — the CLI host (`packages/cli/src/server/pluginFrontRuntime.ts`) runs a Vite
server that transforms each `.tsx` on the fly when the browser requests it, and `/reload`
re-scans. This is what makes hot-reload instant and lets the agent author plugins live.

Two consequences shape this whole plan:

- **Imports are gated.** Because there's no real build/install, the transform only resolves an
  **allowlist** of bare imports (`HOST_SINGLETON_MODULES`: React + `@hachej/boring-workspace*`),
  injected as shared singletons via a global. Anything else is rejected at `resolveId`. This is
  why React must be shared (two copies → the null-dispatcher crash) — and why niche-explorer
  couldn't use `DataExplorer`.
- **No backend.** A runtime plugin can't safely own a Fastify route (untrusted, hot-reloaded).
  So anything server-side must be a **host-provided capability** the plugin *calls*.

The contrast is an **app/internal package plugin** (e.g. the playground's `playgroundDataCatalog`):
bundled with the app's real build, so it *can* import anything and own routes — at the cost of a
redeploy instead of `/reload`. This plan's aim is to give runtime plugins most of that power
while keeping hot-reload.

---

## Principle 1 — Authoring feels like local Vite dev (workspace-built deps)

**Goal:** `npm install <anything>`, `import` it, save, see it. Today you can't.

### The key enabling insight

**The workspace is already isolated.** The agent already installs and runs arbitrary code in the
workspace, and already serves arbitrary plugin `.tsx` into the workspace's browser origin. So
letting a plugin bundle *its own* dependencies from inside that workspace crosses **no new trust
boundary** — it's the same sandbox. That removes the security argument against lifting the
allowlist. The remaining objections are mechanical (no build step; browsers can't resolve bare
names; React must stay single) — and all three are solvable below.

### Externals contract (the one rule that keeps it robust)

These stay **host-provided singletons** — a single shared instance, never bundled into a plugin
(two Reacts break hooks; two workspace clients break registry/identity):

```
react, react-dom, react-dom/client, react/jsx-runtime, react/jsx-dev-runtime
@hachej/boring-workspace, @hachej/boring-workspace/plugin, @hachej/boring-workspace/events
```

**Everything else** the plugin declares in `package.json` `dependencies`; the bundler resolves +
bundles those, externalizing only the contract above.

### Mechanism

In `pluginFrontRuntime.ts` `resolveId`, replace the "throw on non-allowlisted import" branch with
"resolve from the workspace's `node_modules` and let the existing Vite instance bundle it." The
externals contract is injected as rollup `external` entries pointing at the existing
`virtualSingletonId` modules.

**One resolution path, not a mode branch.** Always *resolve-from-`node_modules` + externalize the
contract*. The "allowlist" stops being a code path and becomes simply *what is installed*: a
future hosted mode just ships a smaller install set — **no `mode === "cli"` fork** in `resolveId`.
An unresolved import fails as an ordinary "not installed" error.

### Install + cache

- Plugin `package.json` declares `dependencies`.
- Host installs into a **shared workspace `node_modules`** with one lockfile (see Engineering
  decision E1).
- **Cache key** = `hash(deps + lockfile + plugin source)`; a hit skips install *and* rebuild.
  Vite `optimizeDeps` pre-bundles deps → warm `/reload` stays sub-second after first install.

### Build cost (anticipating "won't this be slow?")

Bundling a small plugin + a few deps is tens-to-low-hundreds of ms, cached. The only slow step
is the **one-time** `npm install` of a *new* dep (seconds, network-bound), then cached. After
that, `/reload` is hot-reload-grade.

### Risks

- **Externals must be exact** — the #1 correctness risk (mis-externalize → dual-React). Guarded
  by the B1 dedupe test.
- Heavy deps inflate first-load bundle — mitigated because data now comes from the host
  capability (Principle 3), not a front-bundled DB engine.
- Install reproducibility — handled by lockfile + cache.

---

## Principle 2 — Plugins never create routes; the host provides capabilities

A plugin does **not** register backend routes. Whatever it needs from the server is a
**host-provided capability it calls**. In v1 that's exactly one capability: **data access**
(Principle 3). This keeps one shared, audited data path instead of N per-plugin DB wirings.

### Transport — v1 is a single host-owned endpoint

- **v1:** the host exposes `POST /api/v1/data/query` (and `…/mutate`) — *the host owns it, not
  the plugin*. No dependency on the bridge epic, so Track A ships today.
- **Later:** when the WorkspaceBridge `call` lane lands, the same op moves behind
  `bridge.call("data.v1.query", …)` with **no change to the plugin-facing API** — the front
  helper `createBridgeDataSource` hides the transport. (See Engineering decision E4.)

### Navigation = UI effects, not routes or `<a href>`

A pane navigates by **emitting a UI effect** on the bridge's existing `emitUiEffect` lane — never
browser navigation or a route:

```txt
openFile        # open/focus a workspace file
openSurface     # open a registered surface (a record by id — e.g. a niche slug)
openPanel       # open/focus a panel
navigateToLine  # jump to a line in an open file
```

A `<WorkspaceLink to={effect}>` helper renders a real `<a>` (so hover/copy/middle-click feel
native) but intercepts the click → `emitUiEffect`, so deep links resolve through
`surfaceResolvers`. Front-only, route-free, **already unblocked** (`emitUiEffect`/`postUiCommand`
are exported today). niche-explorer's catalog→detail open already works this way.

---

## Principle 3 — One clean data access path (`data.v1.*`)

**Goal:** any plugin shows and edits data from a file or DB the same way — no per-plugin route,
no DB driver in the plugin, **no dataset baked into the front** (niche-explorer's current
anti-pattern).

### Shape — "named source + structured query → rows"

The app composition declares **named sources** (host-owned; plugins never see paths or
credentials). A plugin references a source by **name** and sends a **structured query**:

```txt
{ name: "niches", kind: "json",    path: "apps/.../niche-explorer-data.json" }
{ name: "events", kind: "parquet", path: "data/events/*.parquet" }   # globs ok
{ name: "txns",   kind: "sqlite",  path: "ledger.db", writable: true }
```

v1 source kinds: `json`, `csv`, `parquet`, `sqlite`, `duckdb` — **local files only**.

### Operations (two, not three)

```txt
data.v1.query    # {source, query, filters, group, sort, limit, offset} -> {columns, rows, total, hasMore}
data.v1.schema   # {source} -> {columns, types, facetable}  (lets a generic grid/list render with no plugin code)
```

`data.v1.schema` is **required, ships in A1** — the generic-render story and facet popover depend
on it (see Engineering decision E2, which also explains why there is no separate `facets` op:
facet counts are just a `group`+`count` query, and which columns are facetable comes from
`schema`).

Structured-only (no raw SQL — that would break source-agnosticism and widen the attack surface).
Output is bounded (`maxRows`/`maxOutputBytes`/`timeoutMs`), read-only on the query side. The
arg shape mirrors data-explorer's `ExplorerDataSource` (`search`/`fetchFacets`), so the front
helper `createBridgeDataSource({ source })` is a near-identity adapter — a **drop-in
`ExplorerDataSource`** for `DataExplorer`/data-catalog catalogs.

**Independence note (important for sequencing):** the data *capability* is independent of
decision D1 — `createBridgeDataSource` and `data.v1.query` ship from the allowlisted
`@hachej/boring-workspace`, so a plugin gets clean data access under today's import rules.
*Rendering* with the shared `<DataExplorer>` component still needs Principle 1 (it's a
non-allowlisted import). So **A3 migrates niche-explorer using its existing hand-rolled list** —
proving the data path without waiting on Track B.

### Engine: in-process DuckDB (one engine for every source kind)

`@duckdb/node-api` (already a playground dependency) reads json/csv/parquet natively and
`ATTACH`es local sqlite/duckdb — one engine, one SQL dialect, no per-source code.

- **Connection + view caching (perf):** keep **one cached `DuckDBConnection` per workspace**;
  register a **view per source** once (`create or replace view <source> as select * from
  read_*('<path>')`); queries run against the view. Recreate the view only when the file's
  `mtimeMs` changes (`workspace.stat`). Makes search-as-you-type cheap.
- **Safe by construction:** the caller sends *structured* input, so the host builds the SQL with
  quoted identifiers + bound params (`quotedIdentifier`/`quotedString`, as the playground does)
  against a fixed template. There is no SQL string from the plugin to inject.

### Writes (constrained — e.g. transaction tagging)

Real panes edit data (tag a transaction, fix a field). Writable data uses a **`sqlite`/`duckdb`
source as the primary store** (source of truth for reads *and* writes); json/csv/parquet stay
read-only. A **separate, constrained** op (not arbitrary SQL):

```txt
data.v1.mutate  # {source, op, key, set, expectedVersion, idempotencyKey} -> {changed, idempotentReplay, version}

# tagging:
data.v1.mutate { source: "txns", op: "update", key: { id: "t_123" }, set: { tags: ["rent"] }, expectedVersion: 7 }
```

- **Ops:** `update` + `upsert` only (keyed by `key`). `insert` is deferred — no v1 flow needs it,
  and dropping it removes a "which columns are required" validation path.
- **Writable sources only** (`sqlite`/`duckdb`); a write to a read-only source → `READONLY_SOURCE`.
- **Capability-gated:** `data:write:<source>`, granted separately from read.
- **Idempotent:** a host-side table keyed by `(source, idempotencyKey)` holds the prior result; a
  replay returns it (`idempotentReplay: true`) without re-applying.
- **Concurrency — optimistic, in v1 (NOT deferred):** an agent and a human can write at the same
  time, so serializing at the host isn't enough (stale-read clobber). `expectedVersion` is
  therefore **required** on every write. **Closed loop:** each `QueryResult` row carries a
  host-maintained `_version`; the caller sends it back; a mismatch → `WRITE_CONFLICT` (re-read +
  retry). See Engineering decisions E3 (reads/writes share one connection — avoids split-brain)
  and E5 (what `_version` is).
- **Structured + audited:** `op`/`key`/`set` only; writes audited like reads.

### Boundaries / security

- Plugins reference sources by **name** only — never raw paths/credentials.
- File sources are path-validated and workspace-confined.
- Reads are read-only; mutations only through capability-gated `data.v1.mutate` on writable
  sources.

### Future (explicitly out of v1)

Remote DBs (DuckDB `ATTACH` postgres/mysql + host-side secrets), file-format writes, and a
**shared physical multi-writer** DB across processes via
[Quack](https://duckdb.org/2026/05/12/quack-remote-protocol) /
[DuckLake](https://www.definite.app/blog/duckdb-quack-ducklake-catalog) (beta; stable target
DuckDB v2.0, fall 2026). If adopted, the **host stays the only Quack client** — never hand a DB
token to browser/plugin code.

---

## Principle 4 — The agent self-tests its pane and reads back errors

**Goal:** the agent closes its own loop. Today a plugin error only surfaces when a human opens
the browser — that's the ~10-cycle niche-explorer tax. `verify-plugin` only checks manifest +
files ("does NOT execute plugin code"); there's a missing rung between that and a human eyeball.

Three layers, cheapest first — reuse what exists, add the missing reporting:

1. **Server-side diagnostics (exists).** `/reload` + `/api/v1/agent-plugins/:id/error` +
   `…/events` already report load/transform failures — catches manifest errors, non-allowlisted
   imports, syntax errors. The agent reads these after reload, no browser.
2. **Pane runtime-error reporting (new, light).** Wrap each pane in the host's error boundary +
   a scoped `window.onerror`/`unhandledrejection`, routed to the same store. Catches crashes the
   server can't see (the dual-React null-dispatcher). Also helps human sessions.
3. **Headless render self-test (new; the active check).** Open the pane headlessly (the e2e
   Playwright/chromium already in the repo) and capture module-load errors, `console.error`,
   **mounted-vs-blank**, and **failed network requests** (the data 400). The only layer that
   catches "no error but renders nothing."

**Pane lifecycle signal (makes layer 3 deterministic).** The pane wrapper sets a DOM attribute the
harness waits on: `data-boring-pane="loading"` → `"ready"` on first successful commit, or
`"error"` from the boundary. A blank-but-stuck pane stays `loading` → reported as a **timeout
failure, not a false pass**. (This is why mounted-vs-blank is reliable — no DOM guessing.)

**One health channel.** All three layers write to a single host-side store (`:id/health`). So
`boring-ui test-plugin <name>` is a **thin orchestrator**: reload → open the pane → poll
`:id/health` until `ready | error | timeout` → return `SelfTestResult`. It does **not** parse
console/DOM itself. CLI-local only; hosted self-test is a non-goal.

---

## Contracts (v1)

The integration surface, pinned so the three tracks can be built independently. Platform-neutral
shapes (no `node:*`); host implements, front consumes.

```ts
// ---- Named sources (host-owned; declared by app composition, never by a plugin) ----
type SourceKind = "json" | "csv" | "parquet" | "sqlite" | "duckdb"
interface SourceDescriptor {
  name: string                 // plugins reference this; never the path
  kind: SourceKind
  path: string                 // workspace-relative; globs allowed for file kinds
  table?: string               // for sqlite/duckdb: which table/view (default inferred)
  facetable?: string[]         // columns offered as facets / to the UI
  writable?: boolean           // gates data.v1.mutate; only sqlite/duckdb may be true
}
// Wired on a host object — NO module-global registry (matches how the bridge plan injects via
// composition; keeps multi-workspace isolation clean):
interface DataHost {
  registerSources(defs: SourceDescriptor[]): void
  grant(pluginId: string, g: { read?: string[]; write?: string[] }): void  // names or ["*"]; write ⊆ writable
}

// ---- data.v1.query / schema (read) ----
// Arg shape == data-explorer SearchArgs (+ rows-level `sort`) so createBridgeDataSource is a
// near-identity adapter (one vocabulary, not a translation layer).
interface QueryArgs {
  source: string
  query?: string                          // free-text (ILIKE across text columns)
  filters?: Record<string, string[]>      // column -> allowed values (OR within, AND across)
  group?: { key: string; value: string }  // scope to one group while paginating
  sort?: { column: string; dir: "asc" | "desc" }[]
  limit: number                            // <= host maxRows
  offset: number
}
interface QueryResult {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]          // writable-source rows include `_version` (see mutate)
  total: number
  hasMore: boolean
}
interface SchemaResult { columns: { name: string; type: string }[]; facetable: string[] }

// ---- data.v1.mutate (write; writable sources only) ----
interface MutateArgs {
  source: string
  op: "update" | "upsert"                 // insert deferred (no v1 use case)
  key: Record<string, unknown>            // required
  set: Record<string, unknown>
  expectedVersion: string | number        // REQUIRED — the `_version` from the row you read
  idempotencyKey: string                  // required; dedupes double-submit
}
interface MutateResult { changed: number; idempotentReplay: boolean; version: string | number }

// ---- stable error contract (returned, never thrown across the boundary) ----
// E6: source these from the bridge plan's canonical error-code module before implementation;
// listed here only to pin the v1 set.
type DataErrorCode =
  | "SOURCE_NOT_FOUND" | "SOURCE_UNREADABLE" | "QUERY_INVALID"
  | "OUTPUT_TOO_LARGE" | "CAPABILITY_DENIED" | "READONLY_SOURCE"
  | "WRITE_CONFLICT"   | "IDEMPOTENCY_REQUIRED" | "TIMEOUT"
interface DataError { code: DataErrorCode; message: string }   // redacted: no paths/secrets/payloads

// ---- front helpers (from @hachej/boring-workspace; allowlisted) ----
// rowToItem OPTIONAL: defaults from data.v1.schema (title = first text col, etc.); override only
// for custom badges — so "no plugin code" holds for the common case.
declare function createBridgeDataSource(opts: {
  source: string
  rowToItem?: (row: Record<string, unknown>) => import("@hachej/boring-data-explorer/shared").ExplorerItem
}): import("@hachej/boring-data-explorer/shared").ExplorerDataSource

// Navigation: renders <a>, intercepts click -> emitUiEffect. Discriminated union (no [k]:unknown):
type NavEffect =
  | { kind: "openFile"; path: string }
  | { kind: "openSurface"; surface: string; target: string; meta?: Record<string, unknown> }
  | { kind: "openPanel"; panelId: string }
  | { kind: "navigateToLine"; path: string; line: number }
declare function WorkspaceLink(props: { to: NavEffect; children: React.ReactNode }): JSX.Element

// ---- self-test (Track C) ----
interface PluginHealthEvent { layer: 1 | 2 | 3; code?: string; message: string }  // one error shape
interface PluginHealth {
  state: "loading" | "ready" | "error"               // from the data-boring-pane signal
  errors: PluginHealthEvent[]                          // redacted
  failedRequests: { status: number; url: string }[]   // url redacted
}
type SelfTestResult = PluginHealth & { ok: boolean }   // ok = state==="ready" && errors.length===0
```

---

## Decisions made (product owner — settled)

These were genuine product calls and are **decided**; the rest of the plan builds on them.

| # | Decision | Why |
| --- | --- | --- |
| **D1** | **Runtime plugins may `npm install` arbitrary deps** (adopt Principle 1). | The allowlist demonstrably blocked a real plugin (niche-explorer ↔ DataExplorer); workspace isolation removes the security objection; single-React is preserved by the externals contract. Ship behind a flag (B2) until greenlight criteria pass. |
| **D2** | **Writable data lives in a real `sqlite`/`duckdb` DB** (the primary store), not the JSON snapshot. | JSON/parquet aren't safe write targets (whole-file rewrite / columnar-immutable); a transactional DB is. |
| **D3** | **Agent + human may edit concurrently** → optimistic concurrency (`expectedVersion`/`WRITE_CONFLICT`) is in v1, not deferred. | Both an agent and a person can tag at once; serializing requests doesn't stop stale-read clobber. |

**D1 greenlight criteria** (gate before flipping the flag on): B1 dedupe test green on a sample
plugin; warm `/reload` < ~2 s with a representative dep; install cache hit-rate verified.

## Engineering decisions (defaults — challenge these in review)

Recorded so a reviewer can push back without re-deriving. Each has a fallback.

| # | Decision | Justification | Fallback |
| --- | --- | --- | --- |
| **E1** | **One shared workspace `node_modules` + one lockfile** (not per-plugin). | Simplest; dedupes across plugins; matches how the workspace already runs Node. | Per-plugin isolation if version conflicts appear. |
| **E2** | **Two ops (`query`, `schema`); no separate `facets` op.** `schema` is required. | Facet counts = a `group`+`count` query; "which columns are facetable" = `schema`. A third op re-derives what the other two already express. | Re-add `facets` if a perf or shape need emerges. |
| **E3** | **Reads and writes for a writable source share the *same* DuckDB connection; a successful `mutate` refreshes that source's cached view synchronously.** | Prevents split-brain (write via one path, read a stale cached view via another) — which "agent+human concurrent" would make visible. Strongly implies **DuckDB-native DML**, not a second engine. | A separate writer (better-sqlite3) only if DuckDB DML proves unsound — and then with explicit synchronous invalidation. |
| **E4** | **Ship `data.v1` over the host endpoint now; migrate behind `bridge.call` later, no plugin-facing change.** | Unblocks Track A without waiting on the bridge epic; `createBridgeDataSource` hides the transport so migration is invisible. | If the bridge lands first, skip the interim endpoint. |
| **E5** | **`_version` = a host-maintained per-row token** exposed as an optional row field (`_version?`); consumers strip it from display. | Closes the optimistic-concurrency loop without forcing a fixed column convention on every source. The token's backing (dedicated `rev` column vs `updatedAt` vs a host shadow table) is settled at A5 against the chosen store. | — (mechanism detail, decided at build) |
| **E6** | **`DataErrorCode` merges into the bridge plan's canonical error-code module** before implementation. | Avoids a forked error vocabulary (the bridge plan already mandates one import site). | — |

---

## Phasing — three independent tracks

Different dependencies → ship independently. Track A realizes Principles 2–3; Track B realizes
Principle 1; Track C realizes Principle 4. **Only Track B is gated on D1**; A and C are unblocked.

### Track A — Clean data access (unblocked; ship first)

- **A1.** Host `data.v1.query` + **`data.v1.schema`** over local files via in-process DuckDB
  (structured, read-only, cached views per E3), exposed as `POST /api/v1/data/query`.
- **A2.** `createBridgeDataSource({ source })` in `@hachej/boring-workspace` (default `rowToItem`
  from schema).
- **A3.** Migrate `niche-explorer` off its bundled blob to `data.v1.query`, **using its existing
  hand-rolled list** (no `DataExplorer` import → allowlist-safe, independent of D1). Proves read.
- **A4.** `<WorkspaceLink>` nav helper over `emitUiEffect`.
- **A5.** Writes: `data.v1.mutate` (`update`/`upsert`, idempotent, **`expectedVersion` required →
  `WRITE_CONFLICT`**, capability-gated) on a `sqlite`/`duckdb` source — transaction tagging. Reads
  ship first.

→ **"route-free data display, update, and in-app navigation."**

### Track B — Import-any-dep + hot reload (gated on D1)

- **B1.** Externals contract + dedupe test (fails on duplicate React / non-singleton workspace).
- **B2.** `resolveId` resolves workspace `node_modules` + bundles; externalize the contract.
  Behind a flag.
- **B3.** Manifest `dependencies` → workspace install, lockfile, cache, `optimizeDeps`; `/reload`
  re-bundles.
- **B4.** Update the authoring + build skills: replace allowlist guidance with workspace-built
  deps + `data.v1`; **keep the timeless footguns** (no workspace React hooks; leftTab needs a
  `component`; CLI workspaces-mode needs `x-boring-workspace-id`; catalog pattern). *(Skills are
  intentionally not edited before execution — allowlist guidance would contradict this plan until
  A/B land.)*

→ **"import any dep + hot reload."**

### Track C — Agent self-test loop (unblocked)

- **C1.** Expose layer-1 reload/load diagnostics as an agent-readable result.
- **C2.** Pane error boundary + scoped `window.onerror` + `data-boring-pane` signal + failed-fetch
  reporting → one host-side `:id/health` store.
- **C3.** `boring-ui test-plugin <name>`: reload → open pane → poll `:id/health` until
  `ready|error|timeout` → return `SelfTestResult`. Thin orchestrator; reuses the e2e headless
  browser only to trigger the mount.

→ **"agent self-tests the pane and reads back errors."**

### Dependency graph

```
Track A:  A1 ── A2 ── A3            read MVP (niche-explorer migrated)
                 ├── A4             nav helper — independent (needs only emitUiEffect)
                 └── A5             writes — needs A1 engine + a writable source
Track B:  B1 ── B2 ── B3 ── B4      gated on D1
Track C:  C1 ── C2 ── C3            C3 needs the pane-state signal from C2
```

No cross-track dependency for A/C; B is independent. A2 ships in the workspace package, so
app/internal package plugins benefit too.

### Acceptance criteria (per task — bead-ready)

- **A1** — `query`/`schema` over a json + a sqlite source return correct `rows`/`total`/columns;
  the per-source view is cached and recreated on `mtimeMs` change; over-`maxRows` →
  `OUTPUT_TOO_LARGE`.
- **A2** — `createBridgeDataSource` drives search + facet-filter + pagination against A1 with **no
  plugin-side DB code** (default `rowToItem` from schema).
- **A3** — niche-explorer renders catalog + detail from `data.v1.query` via its hand-rolled list
  (no bundled `niche-data.ts`, no `DataExplorer` import); `/reload` clean; `test-plugin` green.
- **A4** — `<WorkspaceLink>` opens file/surface/panel via `emitUiEffect`; middle-click/copy behave
  like a link; **no route registered**.
- **A5** — `update` by key persists to a sqlite source; same `idempotencyKey` twice →
  `idempotentReplay:true`, one change; stale `expectedVersion` → `WRITE_CONFLICT` (agent+human);
  read-only source → `READONLY_SOURCE`; missing grant → `CAPABILITY_DENIED`; a write is visible to
  the next read (E3 — no split-brain).
- **B1** — a test fails if a plugin bundle contains a second React or workspace instance.
- **B2** — a plugin importing a non-allowlisted dep (e.g. `dayjs`) loads and renders (flag on).
- **B3** — adding a dep + `/reload` installs once (cached after) and re-bundles; warm reload
  sub-second.
- **B4** — skills no longer claim "allowlist only"; the four footguns remain documented.
- **C1** — the agent reads layer-1 diagnostics after `/reload` (an import-reject surfaces with no
  browser).
- **C2** — a thrown render error reaches the health store redacted; the pane shows
  `data-boring-pane="error"`.
- **C3** — `test-plugin <name>` returns `SelfTestResult` and catches a seeded crash, a seeded
  `400`, and a stuck-blank pane (timeout, not false pass).

---

## Relationship to other plans

- **Bridge epic (`reorg-14a9`):** provides the `call` lane the data capability migrates onto
  (E4); custom/sandbox handlers are its concern, not this plan's.
- **trust-modes / agent-generation:** own hosted + trust concerns (non-goals here). Track C reuses
  their existing Playwright/eval harness rather than a parallel one.
- **Roadmap decision #1** (deps vs allowlist) = **D1**; gates Track B only.

## Migration & back-compat

- Existing allowlist-only plugins keep working — the allowlist becomes the *subset* needing no
  install (React + workspace); Track B only **adds** resolution for declared deps.
- Bundled-data plugins (today's niche-explorer) keep working until migrated; **A3** migrates the
  canonical one as proof.
- `data.v1.*` is additive; `/api/v1/files/raw` stays for byte reads.
- Transport migration (E4) is invisible to plugins.

## Test matrix

| Area | Tests |
| --- | --- |
| Externals (B1) | exactly one React + one workspace instance per bundle; dedupe test fails on violation |
| Dep resolution (B2/B3) | non-allowlisted import loads; install cache hit/miss; warm reload latency |
| data.v1 read (A1/A2) | json/csv/parquet/sqlite correctness; schema; pagination; view mtime-invalidation; `OUTPUT_TOO_LARGE` |
| data.v1 write (A5) | update/upsert; idempotent replay; `WRITE_CONFLICT`; `READONLY_SOURCE`; `CAPABILITY_DENIED`; read-after-write visible (E3) |
| Navigation (A4) | each effect kind opens the right target; deep-link via `surfaceResolver`; no route |
| Self-test (C) | layer-1 import-reject; layer-2 render crash (redacted); layer-3 seeded `400` + stuck-blank timeout |
| Security | source name-only; path confinement; grant enforcement; redaction in errors/logs |

## Remaining open question

Only one genuine unknown remains (everything else is decided above):

1. **Quack/DuckLake viability for the *future* multi-process story** — can `@duckdb/node-api`
   act as a Quack *client* (docs are DuckDB↔DuckDB / Wasm)? Out of v1 scope; spike before any
   shared-writable-DB work. Not a blocker for Tracks A/B/C.

## Reference points in code

- `packages/cli/src/server/pluginFrontRuntime.ts` — `HOST_SINGLETON_MODULES` (allowlist),
  `RUNTIME_SINGLETON_EXPORTS`, the `resolveId` reject branch (~1039), the Vite `createServer`.
- `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx` &
  `packages/cli/src/front/App.tsx` — where `__BORING_RUNTIME_SINGLETONS__` is populated.
- `apps/workspace-playground/src/plugins/playgroundDataCatalog/` — the app/internal package plugin
  this generalizes; also the `DuckDBConnection` + cached-view + `quotedIdentifier`/`quotedString`
  pattern reused by Principle 3.

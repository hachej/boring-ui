# Runtime Plugin DX (CLI): hot-reload, importable deps, route-free data access

## Status

Proposal / design north star. Not started. Captures the architecture converged on while
shipping the `niche-explorer` factory plugin. **Scoped to CLI mode**; remote/hosted concerns
are explicit non-goals (below). Sibling to [workspace-bridge-rpc-plan.md](./workspace-bridge-rpc-plan.md).

> **Pending decision:** Principle 1 (workspace-built deps) is **open decision #1** in
> [plugin-system-roadmap.md](./plugin-system-roadmap.md) — it conflicts with the allowlist
> model assumed by the canonical trust-modes / agent-generation / hot-reload plans. This
> document argues the case; it is not yet ratified.

## Goal

A **simple but robust** runtime plugin system for CLI mode, with two properties:

1. **Authoring feels like local Vite dev** — declare a `package.json`, `npm install` any
   dependency, plain `import`, save-and-see hot reload via `/reload`.
2. **A clean, shared data-access path** so a plugin can display data from local files/DBs
   **without creating its own server routes** — it calls one host-provided capability.

## Non-goals (deliberately out of this plan)

- **Remote / Vercel sandbox build path** — CLI-local only here; remote is a later plan.
- **Full capability-RPC bridge + sandbox-backed handlers for arbitrary custom server logic**
  → owned by the [workspace-bridge-rpc-plan](./workspace-bridge-rpc-plan.md) epic
  (`boring-ui-v2-reorg-14a9`). This plan needs only the *data* capability.
- **Remote DBs (Postgres/MySQL), Quack, DuckLake, writes** → future (see "Future" in §Data access).
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
keep the allowlist mostly to **avoid bundler + React-dedupe complexity** and to **stay
portable across local and hosted runtimes**. Those are the real objections, and they're
mechanical, not security:

- *no build step* → add the workspace build (Principle 1);
- *browsers can't resolve bare specifiers* → the bundler resolves them at build time;
- *single-React requirement* → preserved by the externals contract;
- *hosted portability* → out of scope here (CLI-only); revisit when remote builds are planned.

Whether the added install/bundle machinery is worth it vs. keeping the allowlist is exactly
**decision #1**. This section argues *for* building deps in CLI mode; it is not a ruling.

## North star

> **Authoring a runtime plugin should feel like local dev of a small Vite library** — a real
> `package.json`, `npm install` any dep, plain `import`, save-and-see HMR — **where React and
> the workspace SDK are host-provided peers (externalized), the CLI host runs the toolchain in
> the workspace, and the output mounts as a module into the shared UI.** Data comes from one
> host capability, not a plugin-owned route.

---

## Principle 1 — Host-peer externals + workspace-built deps

### Externals contract

Exactly these stay host-provided singletons (must be a single shared instance — duplicate
React breaks hooks; a second workspace client breaks registry/identity):

```
react, react-dom, react-dom/client, react/jsx-runtime, react/jsx-dev-runtime
@hachej/boring-workspace, @hachej/boring-workspace/plugin, @hachej/boring-workspace/events
```

**Everything else** the plugin declares in its `package.json` `dependencies`; the bundler
resolves + bundles those leaf deps and externalizes only the contract above.

### Mechanism

In `pluginFrontRuntime.ts` `resolveId`, replace the "throw on non-allowlisted bare import"
branch with: resolve the specifier from the **workspace's `node_modules`** and let the
existing Vite instance bundle/serve it. Keep the `virtualSingletonId` path for the externals
contract. The Vite server already exists (`createServer`, `react()` plugin) — the change is to
*allow* node_modules resolution for leaf deps instead of refusing it.

### Install / cache flow ("allow installing")

- Plugin manifest declares `dependencies` (normal `package.json`).
- Host installs them into a plugin- or workspace-scoped `node_modules` at load, with a
  lockfile + content-addressed cache so reloads don't reinstall.
- Configure Vite `optimizeDeps` so installed deps are pre-bundled → fast HMR after first install.

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

---

## Principle 3 — Clean data access path (`data.v1.query`)

One host-owned, source-agnostic query capability, so every plugin displays data the same way:
no per-plugin route, no DB driver in the plugin, and **no dataset bundled into the front**
(the anti-pattern `niche-explorer` currently uses).

### Shape — "named source + structured query → rows"

A plugin references a **source by name** and sends a **structured query**; the host resolves
and executes it. Source descriptors are host-owned (declared by app composition), never
exposed to plugin/browser code:

```txt
{ name: "niches", kind: "json",    path: "apps/.../niche-explorer-data.json" }
{ name: "events", kind: "parquet", path: "data/events/*.parquet" }   # globs ok
{ name: "app",    kind: "sqlite",  path: "app.db" }
```

v1 source kinds are **local files only**: `json`, `csv`, `parquet`, `sqlite`, `duckdb`.

### Operations

```txt
data.v1.query    # {source, query, filters, group, limit, offset} -> {columns, rows, total, hasMore}
data.v1.facets   # {source, filters} -> value/count per facet key (server-side facet counts)
data.v1.schema   # {source} -> columns + types (a generic table/grid can render with no plugin code)
```

Structured only in v1 (no raw-SQL arm — that would break source-agnosticism and complicate the
guard). Output is bounded (`maxRows`/`maxOutputBytes`/`timeoutMs`), read-only. The structured
contract mirrors the data-explorer `ExplorerDataSource` (`search`/`fetchFacets`), so a front
helper `createBridgeDataSource(source)` is a **drop-in `ExplorerDataSource`** for
`DataExplorer`/data-catalog catalogs — the niche-explorer's exact need.

**This path is independent of decision #1.** `createBridgeDataSource` ships from
`@hachej/boring-workspace` (already on the import allowlist), and `data.v1.query` is a host
capability — so a plugin gets clean, route-free data access **under today's import rules**,
with no workspace-built-deps change. Data access (Track A) and import-any-dep (Track B) are
separable; only Track B waits on decision #1.

### Engine: in-process DuckDB

`@duckdb/node-api` (already a workspace-playground dependency) reads `json`/`csv`/`parquet`
natively and `ATTACH`es local `sqlite`/`duckdb` — one engine, one SQL dialect, no per-source
code. The structured query compiles to read-only DuckDB SQL (`SELECT … WHERE … ORDER … LIMIT`,
`count(*)` for total, `GROUP BY` for facets) behind the existing `execute_sql` guard.

### Boundaries / security

- Plugins reference sources by `name` only — never raw paths.
- File sources are path-validated and workspace-confined; read-only.

### Future (non-goals here)

Remote DBs (DuckDB `ATTACH` postgres/mysql + host-side secrets), writes, and a shared-writable
workspace DB via [Quack](https://duckdb.org/2026/05/12/quack-remote-protocol) /
[DuckLake](https://www.definite.app/blog/duckdb-quack-ducklake-catalog) (beta; stable target
DuckDB v2.0, fall 2026). If adopted, the **host stays the only Quack client** — never hand a DB
token to browser/plugin code. Spike first: can `@duckdb/node-api` act as a Quack client?

---

## Phasing — two independent tracks

The goal's two halves have **different dependencies**, so they ship independently. (Track A
realizes Principles 2–3; Track B realizes Principle 1.)

### Track A — Clean data access (unblocked; ship first)

Independent of decision #1: needs only a host op + a front helper exported from the
already-allowlisted `@hachej/boring-workspace`. Works under today's import rules.

- **A1.** Host `data.v1.query` + `data.v1.facets` over local files via in-process DuckDB
  (structured, read-only), exposed as `POST /api/v1/data/query`. (`data.v1.schema` optional in v1.)
- **A2.** `createBridgeDataSource(source)` helper in `@hachej/boring-workspace` → drop-in
  `ExplorerDataSource`.
- **A3.** Migrate `niche-explorer` off its bundled blob to the data capability (proves it).
- *Later:* move the transport behind the bridge `call` lane when the epic lands — no
  plugin-facing change.

→ delivers **"clean route-free data path."**

### Track B — Import-any-dep + hot reload (gated on decision #1)

- **B1.** Externals contract + dedupe test (fails on duplicate React / non-singleton workspace).
  No behavior change.
- **B2.** `resolveId` resolves non-allowlisted bare imports from the workspace `node_modules`
  and bundles them; externalize the contract. Behind a flag.
- **B3.** Manifest `dependencies` → workspace install, lockfile, cache, `optimizeDeps`;
  `/reload` re-bundles.

→ delivers **"import any dep + hot reload."**

Track A delivers the data half today; Track B delivers the authoring half once decision #1 lands.

## Relationship to other plans

- **Bridge epic (`reorg-14a9`):** provides the `call` lane this plan's data capability rides on
  when present; until then a single host endpoint serves it. Custom/sandbox handlers are the
  bridge epic's concern, not this plan's.
- **trust-modes / agent-generation:** own hosted + trust concerns (non-goals here).
- **Roadmap decision #1** (deps vs allowlist) gates **Track B only**; Track A is independent.

## Open questions

1. Install scope: per-plugin vs shared workspace `node_modules` (dedupe vs isolation)?
2. Package manager + lockfile in-workspace (npm vs pnpm; offline cache)?
3. When to migrate `data.v1` transport from the v1 host endpoint to the bridge `call` lane —
   what's the trigger (epic milestone, multi-caller need)?
4. Bundle-size budget for heavy front deps (now rarer, since data goes through `data.v1`).

## Reference points in code

- `packages/cli/src/server/pluginFrontRuntime.ts` — `HOST_SINGLETON_MODULES` (allowlist),
  `RUNTIME_SINGLETON_EXPORTS`, the `resolveId` reject branch (~1039), the Vite `createServer`.
- `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx` and
  `packages/cli/src/front/App.tsx` — where `__BORING_RUNTIME_SINGLETONS__` is populated.
- `apps/workspace-playground/src/plugins/playgroundDataCatalog/` — app-package plugin that
  already imports data-catalog/DuckDB freely (the "trusted package" shape this generalizes).

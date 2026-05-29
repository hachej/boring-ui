# Runtime Plugin DX: Workspace-Built Deps + Route-Free Capability RPC

## Status

Proposal / design north star. Not started. Captures the architecture converged on while
shipping the `niche-explorer` factory plugin. Sibling to and partially extends
`[workspace-bridge-rpc-plan.md](./workspace-bridge-rpc-plan.md)`.

## Problem

Two limits surfaced while building real runtime (`.pi/extensions/<name>/`) plugins:

1. **The host-singleton import allowlist does not scale.** Runtime plugin fronts are
ransformed on the fly by the CLI host (`packages/cli/src/server/pluginFrontRuntime.ts`)
nd may only import an allowlisted set of bare specifiers
`HOST_SINGLETON_MODULES`: React + `@hachej/boring-workspace{,/plugin,/events}`).
ny other bare import (`@hachej/boring-data-explorer`, `sql.js`, `duckdb-wasm`, `d3`, …)
s rejected at `resolveId` (line ~1039: *"runtime plugin fronts may only import
llowlisted host singleton packages"*). You cannot hand-maintain an allowlist of every
ibrary a plugin might want. This is the wall `niche-explorer` hit when it tried to use
DataExplorer`.
2. **Plugin-owned backend routes are the wrong primitive.** A `boring.server` Fastify route
s unstructured, unscoped transport that every plugin reinvents. The
workspace-bridge-rpc-plan` already argues for removing plugin routes in favour of
apability-scoped RPC, but it explicitly **defers** generated/runtime-plugin handlers —
o a runtime plugin still has no first-class way to do custom server-side work.

## Key enabling insight

**The workspace is already isolated.** The agent already installs and executes arbitrary
code in the workspace sandbox, and already serves arbitrary front `.tsx` that runs in the
workspace UI origin. Therefore:

- Resolving + bundling a plugin's *own* dependencies from inside the workspace crosses **no
new server-side trust boundary** — it is the same sandbox the agent already runs in.
- The bundled plugin JS runs in the workspace page origin, which is **already true today**;
bundling deps adds third-party code by volume, not a new capability tier.

This neutralizes the supply-chain objection that justified the singleton allowlist. The only
*real* reasons left are mechanical (no build step, browsers can't resolve bare specifiers,
single-React requirement) — and all three are solvable.

## North star

> **Authoring a runtime plugin should feel like local dev of a small Vite library** — a real
> `package.json`, `npm install` any dep, plain `import`, save-and-see HMR — **where React and
> the workspace SDK are host-provided peers (externalized), the host runs the toolchain inside
> the isolated workspace, and the output mounts as a module into the shared UI.**

This collapses today's two plugin shapes: "trusted package vs runtime plugin" becomes purely
*where it is loaded from and what server authority it gets*, **not** *what it is allowed to import*.

---

## Principle 1 — Host-peer externals + workspace-built deps

### Externals contract

Exactly these stay host-provided singletons (must be a single shared instance — duplicate
React breaks hooks; a second workspace client breaks registry/identity):

```
react, react-dom, react-dom/client, react/jsx-runtime, react/jsx-dev-runtime
@hachej/boring-workspace, @hachej/boring-workspace/plugin, @hachej/boring-workspace/events
```

**Everything else** the plugin declares in its `package.json` `dependencies`, installs into the
workspace, and `import`s normally. The bundler resolves + bundles those leaf deps; it
externalizes only the contract above.

### Mechanism

In `pluginFrontRuntime.ts` `resolveId`, replace the "throw on non-allowlisted bare import"
branch with: resolve the specifier from the **workspace's `node_modules`** and let the existing
Vite instance bundle/serve it. Keep the `virtualSingletonId` path for the externals contract.
The Vite server already exists (`createServer`, `react()` plugin, `root: repoRoot`) — the change
is to *allow* node_modules resolution for leaf deps instead of refusing it.

### Install / cache flow ("allow installing")

- Plugin manifest declares `dependencies` (normal `package.json`).
- Host installs them into a plugin-scoped (or workspace-scoped) `node_modules` before/at load,
with a lockfile + content-addressed cache so reloads don't reinstall.
- Configure Vite `optimizeDeps` so installed deps are pre-bundled → fast HMR after first install.

### Remote-sandbox story

For `direct`/`local`/`bwrap` the install+build runs on the host's real fs. For the Vercel
(remote) sandbox, install+build runs **inside the sandbox** and the bundle is streamed out —
slower cold start, same model.

### Build cost (answer to "is build long?")

The bundle step is **not** the cost — esbuild/Vite bundles a small plugin + a few deps in tens
to low-hundreds of ms, cached.


| Cost                                   | Magnitude                       | Frequency                 |
| -------------------------------------- | ------------------------------- | ------------------------- |
| `install` of a **new** dep             | seconds (network-bound)         | once per dep, then cached |
| Warm re-bundle on `/reload`            | sub-second → ~1–2s w/ dep graph | every reload              |
| First browser load of a heavy wasm dep | bundle-size bound               | once per session          |


After the one-time install, `/reload` stays hot-reload-grade.

### Risks

- **Externals must be exact** — the single biggest correctness risk. Mis-externalizing yields
duplicate React / mismatched workspace instances and subtle, nasty bugs. Needs a test that
asserts the contract.
- Bundle size for heavy deps (duckdb-wasm) — first-load concern.
- Install latency / reproducibility — needs lockfile + cache.
- Needs a package manager in the workspace (present for direct/local; in-sandbox for remote).

---

## Principle 2 — No plugin backend routes; capability RPC only

Plugins never register Fastify routes. They use the WorkspaceBridge two-lane model:

- `**emitUiEffect**` — one-way UI events (open pane, focus file, toast).
- `**call(op, input)**` — request/response RPC to a registered, capability-scoped handler.

A route is *transport*; the bridge replaces transport with scoped, validated, audited,
idempotent RPC that works uniformly for in-process, browser, and sandbox callers. But the
bridge changes *where logic is registered and how it is invoked* — not whether it exists.

### Handler-placement rule


| Plugin needs…                                                                  | Where it runs             | How it's reached                              |
| ------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------- |
| an existing host capability (files, ask-user, macro…)                          | host (already trusted)    | `bridge.call(existing op)`                    |
| pure data/compute (parse JSON, even SQLite via bundled `sql.js`/`duckdb-wasm`) | **the front**             | nothing — local, enabled by Principle 1       |
| custom server compute (own DB/schema, secret-bearing API)                      | **the workspace sandbox** | `bridge.call` → host proxies into the sandbox |
| host-process Fastify routes                                                    | —                         | ❌ removed                                     |


The critical consequence of Principle 1: once a runtime plugin can bundle deps, most "needs a
server" cases (including reading/querying SQLite via `sql.js` or `duckdb-wasm`) become
**front-only**, so "no routes" holds for them by elimination.

### The gap to close

Custom plugin server logic via RPC — the *sandbox-backed handler* row — does **not** exist
today. The `workspace-bridge-rpc-plan` ships only host-owned `human-input.*`/`macro.*` ops and
forbids runtime plugins registering host-process handlers. The new work item is a
**manifest-declared, sandbox-executed RPC handler** the bridge can route to, so a runtime
plugin gets server logic *without a host route* and *without host-process trust* — running in
the same isolated workspace it already owns.

---

## Phasing

1. **Externals contract + tests.** Pin the exact externalized set; add a test that fails on
uplicate React / non-singleton workspace import. (Prereq for everything; no behavior change.)
2. **Workspace dep resolution (Principle 1 core).** `resolveId` resolves non-allowlisted bare
mports from workspace `node_modules` + bundles; externalize the contract. Behind a flag.
3. **Install + cache mechanism.** Manifest `dependencies` → workspace install, lockfile, cache,
optimizeDeps`. Make` /reload` re-bundle.
4. **Remote-sandbox build path.** Install/build inside the Vercel sandbox; stream the bundle.
5. **Sandbox-backed RPC handler (Principle 2 gap).** Manifest-declared handler executed in the
orkspace sandbox, invoked via `bridge.call`; capability-scoped, schema-validated, audited.
6. **Remove `boring.server` route affordance for plugins** (or fail-fast) once 1–5 cover the
eal use cases; migrate any examples. Update authoring skill + docs (the current authoring
anual wrongly tells runtime plugins to import `@hachej/boring-data-explorer`).

Phases 1–4 deliver "local-dev-feel front with any deps." Phase 5 delivers "route-free custom
server logic." Phase 6 makes it the only supported shape.

## Relationship to the WorkspaceBridge RPC plan

- Reuses its bridge lanes, capability/op registry, auth, idempotency, and audit.
- Extends its explicitly-deferred "generated/runtime plugin RPC" with the sandbox-backed handler.
- Consistent with its "no generic `workspace-files.v1.*` op" stance: file *bytes* keep using the
existing `/api/v1/files/raw`; this plan does not add a generic file RPC.

## Open questions

1. Install scope: per-plugin `node_modules` vs a shared workspace `node_modules` (dedupe vs isolation)?
2. Package manager + lockfile strategy in-workspace (npm vs pnpm; offline cache)?
3. Sandbox-handler execution model: long-lived worker vs per-call `executeIsolatedCode`?
4. Bundle-size budget / lazy-loading policy for heavy wasm deps.
5. Do we still gate any front capability by trust, or is the front fully democratized and only
he sandbox-handler/secret access gated?

## Reference points in code

- `packages/cli/src/server/pluginFrontRuntime.ts` — `HOST_SINGLETON_MODULES` (allowlist),
`RUNTIME_SINGLETON_EXPORTS`, the `resolveId` reject branch (~1039), the Vite `createServer`.
- `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx` and
`packages/cli/src/front/App.tsx` — where `__BORING_RUNTIME_SINGLETONS__` is populated.
- `apps/workspace-playground/src/plugins/playgroundDataCatalog/` — app-package plugin that
already imports data-catalog/DuckDB freely (the "trusted package" shape this plan generalizes).
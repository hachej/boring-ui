# PR 02 — Server runtime backend MVP

## Goal

Make external CLI/local `boring.server` entries work through the hot gateway, without adding install commands yet.

A plugin in `.pi/extensions/<id>` can expose backend handlers via `boring.server`, reload them with `/reload`, and serve them through the stable gateway. Whether `boring.server` is activated as boot-time internal code or hot gateway code is decided by internal/external source classification, not a separate plugin manifest field.

## Scope

This PR is the server MVP:

```txt
jiti import -> capture exact routes -> atomic registry swap -> gateway dispatch
```

## Public API

Runtime server modules must be loadable without a package-local dependency on `@hachej/boring-workspace`.

Canonical `.pi/extensions` shape is a plain validated default export:

```ts
export default {
  routes(router) {
    router.get("/messages", async (ctx) => ({ messages: [] }))
    router.post("/send", async (ctx) => {
      const body = ctx.body
      return { ok: true, body }
    })
  },
  async dispose() {},
}
```

A public helper/type subpath may still exist for publishable/build-based packages:

```txt
@hachej/boring-workspace/runtime-server
```

But the loader must validate plain objects and must not require plugins to import the helper. This follows PR #166's lesson: host-provided imports are useful, but local runtime plugins should not need to install or resolve workspace packages just to load.

Rules:

- Runtime module must not declare `id`.
- Loader supplies plugin id from manifest/source record.
- `defineRuntimeServerPlugin()` is optional convenience, not an activation requirement. Loader validation is authoritative.
- Exact-match route paths only.
- No params/wildcards/order.
- No raw Fastify request/reply.
- No `workspace` facade in MVP context.
- No raw workspace root exposure.

## Modules

Keep module count small. Start with four files plus an export barrel:

```txt
packages/workspace/src/server/runtimeBackend/
  defineRuntimeServerPlugin.ts  # optional public helper/types + validation utilities
  routerCapture.ts             # exact route capture + path validation
  runtimeBackendRegistry.ts    # jiti load, per-plugin snapshot, dispatch, dispose, diagnostics
  runtimeBackendGateway.ts     # Fastify adapter only
  index.ts
```

Do not create `runtimeBackendHealth.ts` or `runtimeBackendResponse.ts` unless the code becomes too large to read. In MVP, health is a projection of registry state and response coercion can stay as a small pure helper in the registry/gateway layer.

## Handler context MVP

Keep request body support JSON-only in MVP.

```ts
type RuntimePluginContext = {
  pluginId: string
  method: string
  path: string
  query: URLSearchParams
  headers: ReadonlyHeaders
  signal: AbortSignal
  body: unknown
  logger: PluginLogger
}
```

No `text()` / raw-body helpers in MVP. Add them later only when a real plugin needs non-JSON payloads.

## Gateway

Plugin-owned endpoint:

```txt
ALL /api/v1/plugins/:pluginId/*
```

Host metadata/health namespace stays outside gateway, but a new host health route is deferred unless it is almost free to expose from existing diagnostics:

```txt
future: GET /api/v1/agent-plugins/:pluginId/health
```

## Registry invariants

Use the simplest robust policy: **per-plugin prepare, then commit**.

For each runtime-capable plugin:

```txt
load next module + capture routes without mutating current state
if load succeeds: swap this plugin's snapshot, then dispose old instance
if load fails and old snapshot exists: keep old snapshot live and record diagnostic
if load fails and no old snapshot exists: plugin backend stays disabled
```

For removed plugins:

```txt
remove snapshot, then dispose old instance
```

Other invariants:

- one reload at a time;
- one plugin failure must not break other plugins;
- dispose failures become diagnostics, not reload aborts.

This avoids global two-phase complexity while still prevents half-written per-plugin state.

## Reload integration

Add runtime backend reload into the only reload endpoint:

```txt
/api/v1/agent/reload
```

It should run:

```txt
assetManager.load()
runtimeBackendRegistry.reloadFromLoadedPlugins(loaded inspection records)
rebuildServerPlugins() diagnostic-only for boring.server
collect restart warnings + backend diagnostics
runRuntimeProvisioning()
opts.beforeReload()
merge diagnostics/restart_warnings
```

Do not reintroduce `/api/boring.reload` or any second reload endpoint.

If this makes `createWorkspaceAgentServer.ts` grow materially, extract the reload body into a focused helper such as `reloadWorkspacePlugins(...)` in this PR. Do not add that helper earlier just for abstraction symmetry.

## Source gating

During reload, only external sources participate in the gateway registry:

```ts
if (plugin.source.kind !== "external") skipGatewayReload(plugin)
```

Policy for MVP:

- internal sources activate `boring.server` through the existing boot-time `WorkspaceServerPlugin` path;
- external sources activate `boring.server` through the hot gateway contract;
- workspace-local source must match current workspace in workspaces mode if `workspaceId` is present.

Gateway dispatches only against the registry snapshot. Gateway must not re-evaluate source classification.

## Gateway normalization

Exact routing stays simple, but normalization must be explicit:

- validate `pluginId` before dispatch;
- route key is uppercase HTTP method + normalized tail path;
- query string is not part of route key;
- empty tail becomes `/`;
- duplicate slashes are not normalized magically; they must match exactly after Fastify decoding;
- reject paths containing `..` segments or backslashes.

## Request body

MVP accepts JSON request bodies only through `ctx.body`.

Reuse existing Fastify/body-size behavior. Do not add a second raw-body reader, text parser, or body limit in this layer.

## Response/error contract

Keep MVP response contract small:

- `undefined` / `null` => 204;
- JSON-serializable values => JSON;
- explicit response metadata requires `{ kind: "response", ... }`.

No automatic text or byte response coercion in MVP. Plugins that need those can use explicit response metadata with headers/body.

Stable errors must come from canonical error enum/import path, never raw strings:

```txt
RUNTIME_PLUGIN_NOT_FOUND
RUNTIME_PLUGIN_ROUTE_NOT_FOUND
RUNTIME_PLUGIN_HANDLER_FAILED
RUNTIME_PLUGIN_LOAD_FAILED
RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED
```

## Non-goals

- No `boring-ui install`.
- No npm/git/local package manager.
- No bwrap worker.
- No permission prompts/grants.
- No route params/wildcards.
- No hosted/cloud plugin support.

## Tests

- Plain default-export object runtime module loads without importing `@hachej/boring-workspace`.
- Optional `runtime-server` subpath import works for build-based/package authors.
- Runtime module with `id` is rejected.
- Unsafe route paths rejected.
- Duplicate method/path rejected.
- Exact route table dispatch works.
- jiti-loaded runtime server captures handlers.
- Plugin backend responds after `/reload`.
- Source edit + `/reload` changes response without restart.
- Syntax error keeps previous response live.
- Removed plugin unloads gateway handlers.
- Dispose called on replace/unload/close.
- Concurrent reloads serialize.
- Wrong workspace gateway call rejected.
- `boring-ui-plugin verify` explains `boring.server` activation by source: app/internal sources are boot-time, workspace/global CLI sources are hot gateway.
- Backend diagnostics are included in reload output.
- Plugin-owned `/health` route, if registered by a plugin, stays under gateway and does not conflict with deferred host health namespace.
- `/api/v1/agent/reload` includes backend diagnostics.
- `/api/boring.reload` remains removed/not registered.

## Acceptance

- Existing `.pi/extensions/<id>` plugin with `boring.server` can hot-reload JSON backend handlers in CLI/local mode.
- Backend diagnostics are visible in reload responses.
- No install command, backend host-import aliasing, or host health route is required to prove the server MVP.

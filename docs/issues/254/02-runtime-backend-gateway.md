# 02 — Runtime backend gateway

## Goal

Allow CLI/local external plugins to expose hot-reloadable backend handlers without mutating Fastify routes at runtime.

## Non-goals

- No raw `app.get()` / `app.post()` from runtime plugins.
- No dynamic host `agentTools` rewiring in this phase.
- No remote sandbox backend support.
- No bwrap worker/proxy in MVP.
- No app/internal route migration.

## Manifest field

Use the single plugin-facing server field:

```jsonc
{
  "name": "email-client",
  "boring": {
    "front": "front/index.tsx",
    "server": "server/index.ts"
  }
}
```

Rules:

- `boring.server` is boot-time/raw Fastify only for internal/app trusted plugins.
- `boring.server` is CLI/local external runtime backend when discovered from external Pi package sources.
- External runtime backend modules use the constrained runtime-server contract; raw Fastify is not allowed.
- Server path must be safe and contained in plugin root.
- Runtime server module never declares identity; loader supplies `pluginId` from manifest/source metadata.

## Public API

Subpath:

```txt
@hachej/boring-workspace/runtime-server
```

Example:

```ts
import { defineRuntimeServerPlugin } from "@hachej/boring-workspace/runtime-server"

export default defineRuntimeServerPlugin({
  routes(router) {
    router.get("/messages", async (ctx) => ({ messages: [] }))
    router.post("/send", async (ctx) => {
      const body = await ctx.json()
      return { ok: true }
    })
  },
  async dispose() {
    // cleanup timers/watchers/resources
  },
})
```

The runtime module must not include `id`. Reject or ignore `id`; prefer reject to keep API clean.

## Handler context MVP

```ts
type RuntimePluginContext = {
  pluginId: string
  method: string
  path: string
  query: URLSearchParams
  headers: ReadonlyHeaders
  signal: AbortSignal
  json<T = unknown>(): Promise<T>
  text(): Promise<string>
  logger: PluginLogger
}
```

No `workspace` in MVP. Add a future facade only after exact methods are defined. Never expose `workspace.root` or raw host paths.

## Gateway endpoint

Plugin-owned gateway space:

```txt
/api/v1/plugins/:pluginId/*
```

Host management/health must not live under this same wildcard. Use existing management namespace:

```txt
/api/v1/agent-plugins
/api/v1/agent-plugins/:pluginId/health
```

If a plugin registers `/health`, it is plugin-owned under:

```txt
/api/v1/plugins/:pluginId/health
```

Self-test may call plugin `/health`; host health must use `/api/v1/agent-plugins/:pluginId/health`.

## Router MVP

Exact-match only.

```txt
key = METHOD + normalizedPath
```

No params, wildcards, route order, or custom mini-router in MVP. If params become necessary later, use a real router/matcher dependency.

## Modules

```txt
packages/workspace/src/server/pluginImports/
  importServerModule.ts

packages/workspace/src/server/runtimeBackend/
  defineRuntimeServerPlugin.ts
  routerCapture.ts
  runtimeServerLoader.ts
  runtimeBackendRegistry.ts
  runtimeBackendGateway.ts
  runtimeBackendResponse.ts
  runtimeBackendHealth.ts
  index.ts
```

`importServerModule.ts` should extract the existing jiti/native import helper from `pluginEntryResolver.ts`. Existing internal `boring.server` diagnostics and external runtime `boring.server` loading use it.

## Response contract

Avoid magical ambiguous return types.

Use either plain JSON values or explicit response objects:

```ts
type RuntimePluginResult =
  | null
  | undefined
  | string
  | Uint8Array
  | JsonValue
  | { kind: "response"; status?: number; headers?: Record<string, string>; body?: RuntimePluginResultBody }
```

A plain object with `status` is still JSON unless `kind: "response"` is present.

Stable errors:

```txt
RUNTIME_PLUGIN_NOT_FOUND
RUNTIME_PLUGIN_ROUTE_NOT_FOUND
RUNTIME_PLUGIN_HANDLER_FAILED
RUNTIME_PLUGIN_LOAD_FAILED
RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED
```

Use canonical error-code enum/import path. No raw string codes.

## Registry invariants

- `reloadFromLoadedPlugins()` is serialized/single-flight.
- Replacement installs next table before disposing previous.
- Failed load keeps previous table live.
- First failed load leaves backend disabled.
- Dispose errors become diagnostics/health entries, never full reload aborts.
- App close disposes all active backends exactly once.

## Tests

Required:

- jiti module cache false sees source edits;
- runtime module with `id` is rejected;
- exact-match route dispatch;
- unsafe route paths rejected;
- duplicate method/path rejected;
- syntax error keeps previous handler live;
- remove/unload disposes handlers;
- app close disposes handlers;
- host health path does not conflict with plugin gateway path;
- workspaces mode rejects cross-workspace gateway calls.

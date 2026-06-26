# PR 05 — Runtime backend loader + registry

## Goal

Load external-source `boring.server` runtime modules with the shared jiti helper and atomically manage executable handler tables.

## Scope

No HTTP gateway yet; this PR makes backend state loadable/testable in isolation.

## Proposed files

- `packages/workspace/src/server/runtimeBackend/runtimeServerLoader.ts`
- `packages/workspace/src/server/runtimeBackend/runtimeBackendRegistry.ts`
- `packages/workspace/src/server/runtimeBackend/runtimeBackendResponse.ts`
- `packages/workspace/src/server/runtimeBackend/runtimeBackendHealth.ts`
- tests

## Registry invariants

- Serialized/single-flight reload.
- Atomic replace by plugin id.
- Failed load preserves previous table.
- First failed load leaves backend disabled.
- Dispose old instance on replace/unload/close.
- Dispose failures become diagnostics/health, not full reload aborts.

## Response/error contract

Stable errors via canonical error enum:

```txt
RUNTIME_PLUGIN_NOT_FOUND
RUNTIME_PLUGIN_ROUTE_NOT_FOUND
RUNTIME_PLUGIN_HANDLER_FAILED
RUNTIME_PLUGIN_LOAD_FAILED
RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED
```

Response metadata object must be discriminated:

```ts
{ kind: "response", status?: number, headers?: Record<string, string>, body?: unknown }
```

Plain object with `status` remains JSON.

## Non-goals

- No Fastify gateway.
- No install command.
- No bwrap worker.
- No route params.

## Tests

- jiti-loaded runtime server captures handlers.
- Syntax error keeps previous backend live.
- Dispose called on replace/unload/close.
- Dispose error surfaces as diagnostic.
- Concurrent reloads serialize.
- Unsupported response value returns stable error.

## Acceptance

- Runtime backend registry can load, dispatch internally, reload, fail safely, and dispose.

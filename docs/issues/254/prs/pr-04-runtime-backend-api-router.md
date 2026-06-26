# PR 04 — Runtime backend API + exact route capture

## Goal

Add the public runtime backend authoring API and exact-match route capture.

## Scope

Add `@hachej/boring-workspace/runtime-server` for external CLI runtime backend modules.

## Proposed files

- `packages/workspace/src/server/runtimeBackend/defineRuntimeServerPlugin.ts`
- `packages/workspace/src/server/runtimeBackend/routerCapture.ts`
- `packages/workspace/src/server/runtimeBackend/index.ts`
- `packages/workspace/package.json` exports
- build/tsup config if needed
- tests

## API

```ts
import { defineRuntimeServerPlugin } from "@hachej/boring-workspace/runtime-server"

export default defineRuntimeServerPlugin({
  routes(router) {
    router.get("/messages", async (ctx) => ({ messages: [] }))
  },
  async dispose() {},
})
```

Rules:

- Runtime module must not declare `id`.
- Loader supplies plugin id from manifest/source record later.
- Exact-match route paths only.
- No params/wildcards/order.
- No raw Fastify request/reply.
- No `workspace` facade in MVP context.

## Non-goals

- No jiti loader for runtime backend yet.
- No Fastify gateway yet.
- No reload integration.

## Tests

- Subpath import works.
- Importing subpath does not pull app/server orchestration.
- Module with `id` is rejected.
- Unsafe route paths rejected.
- Duplicate method/path rejected.
- Exact route table produced.

## Acceptance

- Runtime backend modules can be authored and route-captured in isolation.

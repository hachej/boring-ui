# Thermo-nuclear review — simplicity + robustness

Reviewed canonical docs:

- `context.md`
- `implementation-plan.md`
- `prs/01-foundation.md`
- `prs/02-server-runtime-mvp.md`
- `prs/03-cli-install-and-verification.md`

Verdict: **close, but revise PR 02 and PR 03 before implementation**

The plan is now much healthier: three PRs is the right scale, `runtimeBackendAllowed` is gone, install is separated from server MVP, and PR 02 avoids raw Fastify hot registration. The remaining risk is not “too ambitious” anymore; it is **accidentally re-growing complexity through response/body/health/install polish**.

## Executive recommendation

Use this as the final implementation shape:

```txt
PR 01 — Foundation
  source origin model
  one canActivateRuntimeBackend() policy
  reload coordinator extraction
  jiti helper extraction

PR 02 — Server MVP
  runtime-server authoring API
  exact route capture
  registry snapshot
  stable gateway
  reload integration
  minimal diagnostics

PR 03 — Install MVP
  install/list/remove only first
  update and backend self-test can be follow-up if they expand scope
```

The biggest simplification is: **PR 02 should not try to be an HTTP framework.** It should be a tiny gateway from Fastify to exact handlers.

## Blocker 1 — PR 02 still has too much response machinery for MVP

Current PR 02 supports:

- `undefined` / `null` => 204;
- string => text;
- `Uint8Array` => bytes;
- plain objects/arrays/primitives => JSON;
- explicit `{ kind: "response" }`.

This is probably more than needed for the first server MVP. It creates response coercion complexity, content-type choices, error branches, and tests before there is evidence plugins need all of it.

### Simpler robust version

For MVP, support only:

```txt
plain JSON return value -> JSON response
{ kind: "response", status?, headers?, body? } -> explicit response
undefined/null -> 204
```

Defer string/bytes special casing. If a plugin needs text/bytes, it can use explicit response metadata:

```ts
return {
  kind: "response",
  headers: { "content-type": "text/plain" },
  body: "ok",
}
```

### Required plan change

Cut automatic string and `Uint8Array` response branches from MVP. Keep JSON + explicit response only.

This deletes ambiguous coercion while preserving escape hatch.

## Blocker 2 — `defineRuntimeServerPlugin()` branding may be over-engineering

The plan says the helper must validate/brand or be removed. Good instinct. But branding can become type ceremony that does not improve runtime safety.

### Simpler robust version

Make `defineRuntimeServerPlugin()` a tiny validation helper only:

- reject unknown top-level keys like `id`;
- require `routes` function if present;
- return a plain object.

Do not add hidden symbols/brands unless loader actually needs them.

Runtime validation in loader should validate the default export shape anyway, because third-party modules can bypass TypeScript/helper.

### Required plan change

Replace “validate/brand” with “validate at helper and loader boundary; no private branding unless needed.”

## Blocker 3 — Cached body helpers may be unnecessary in first MVP

`json()` and `text()` are convenient, but body parsing is a rich source of edge cases. The plan says cached raw body, which is robust, but implementation can get messy depending on Fastify setup.

### Simpler robust version

If Fastify already gives parsed `request.body`, expose only:

```ts
body: unknown
```

or:

```ts
json<T = unknown>(): T | Promise<T>
```

Do not expose both `json()` and `text()` unless text bodies are required immediately.

If keeping both, make one rule explicit:

```txt
MVP accepts JSON request bodies only. text() is deferred.
```

### Required plan change

Choose one:

1. JSON-only MVP: `body: unknown` or `json()` only; or
2. cached raw body with both helpers, but this is knowingly more work.

I recommend JSON-only MVP. External plugins mostly need app-like JSON endpoints.

## Blocker 4 — Host health endpoint is still probably too much for PR 02

PR 02 includes:

```txt
GET /api/v1/agent-plugins/:pluginId/health
```

This is useful, but not necessary to prove server runtime MVP. It risks adding a second mini-product: health output shape, status aggregation, frontend display, self-test integration.

### Simpler robust version

PR 02 registry exposes diagnostics internally and reload response includes them. No new host health route yet.

Then PR 03 or follow-up adds host health if needed for install/test UX.

### Required plan change

Move host health endpoint out of PR 02 unless an existing route already has a natural place to expose registry diagnostics with almost no code.

Keep the namespace decision in context, but defer route implementation.

## Blocker 5 — PR 03 mixes install MVP with update and backend self-test polish

PR 03 includes install/list/remove/update and backend self-test. That is likely too much for one PR after PR 02.

The robust/simple thing is:

```txt
PR 03a — install/list/remove
PR 03b — update
PR 03c — backend self-test
```

But if you want only three canonical PRs, make PR 03 acceptance focus on install/list/remove and mark update/self-test as optional/stretch.

### Required plan change

In PR 03:

- make `update` optional or follow-up;
- make backend self-test optional or follow-up;
- make acceptance only require install/list/remove + reload works.

This avoids a PR that touches package manager, source registry, Playwright/self-test, and backend diagnostics at once.

## Strong keepers — do not simplify these away

These are the robustness minimum. Keep them.

### Keep one source policy helper

Good:

```ts
function canActivateRuntimeBackend(source: BoringPluginSource): boolean
```

Do not reintroduce `runtimeBackendAllowed`.

### Keep reload coordinator extraction first

This is code-judo. It prevents PR 02 from growing `createWorkspaceAgentServer.ts`, already ~801 lines.

### Keep exact-match routing only

No params/wildcards/custom router. Correct.

### Keep old handler live on failed reload

This is essential robustness. Do not simplify it away.

### Keep gateway as adapter only

Correct boundary:

```txt
Fastify request -> normalized dispatch request -> registry.dispatch() -> reply
```

Gateway must not know jiti, manifests, source policy, install, or scan internals.

## Best final simplified PR 02 shape

Recommended PR 02 after cuts:

```txt
Files:
  defineRuntimeServerPlugin.ts
  routerCapture.ts
  runtimeBackendRegistry.ts
  runtimeBackendGateway.ts
  index.ts

Supports:
  JSON request body only
  JSON return values
  explicit response object escape hatch
  exact paths only
  per-plugin safe reload
  diagnostics in reload response

Defers:
  text()/raw body helpers
  automatic string/bytes responses
  host health route
  backend test-plugin integration
  route params
```

This is the right simplicity/robustness level.

## Suggested plan edits

### PR 02

Replace response section with:

```txt
MVP response contract:
- undefined/null => 204
- JSON-serializable value => JSON
- { kind: "response", status?, headers?, body? } => explicit response

No automatic text/bytes coercion in MVP.
```

Replace body section with:

```txt
MVP request body:
- JSON body only through ctx.body or ctx.json()
- text/raw helpers deferred
```

Move host health route to deferred/follow-up.

### PR 03

Rename to:

```txt
PR 03 — Pi-style install/list/remove MVP
```

Move `update` and backend self-test to stretch/follow-up unless implementation is tiny.

## Final verdict

The architecture is now basically right. The plan needs one more simplification pass:

```txt
cut response magic
cut raw/text body handling
cut PR02 host health route
cut PR03 update/self-test from required acceptance
```

After those cuts, implementation should be robust without becoming a framework.

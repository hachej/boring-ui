# Nuclear review — PR 02 server runtime MVP plan

Plan reviewed: `prs/02-server-runtime-mvp.md`

Verdict: **revise before implementation**

The MVP boundary is mostly right: no install, no bwrap, no permissions, no params. But the plan still underspecifies the hardest parts: atomic commit semantics, request/body normalization, and Fastify/gateway boundaries. If implemented as written, this can easily become a set of ad-hoc route and reload branches.

## Blockers

### 1. Atomic registry semantics are not precise enough

“Atomic replace by plugin id” is not enough. Reload touches multiple plugins. A naïve implementation can leave the registry half-updated across plugins, or dispose old handlers before all new handlers are known to be loadable.

Required plan change: specify a two-phase commit:

```txt
prepare next records for all loaded runtime-capable plugins
  -> collect diagnostics without mutating current registry
  -> commit a new registry snapshot atomically
  -> dispose replaced/removed old instances after commit
```

Then decide failure policy explicitly:

- per-plugin fallback: failed plugin keeps its previous handler while other plugins update; or
- all-or-nothing global reload.

I recommend per-plugin fallback, but it must be stated and tested.

### 2. Gateway path normalization is underdefined

`ALL /api/v1/plugins/:pluginId/*` is not enough. Bugs will hide in slash handling and encoded paths.

Required plan change: define:

- plugin id validation before dispatch;
- decoded vs raw path behavior;
- trailing slash normalization;
- duplicate slash handling;
- query string exclusion from route key;
- method normalization;
- behavior for `/api/v1/plugins/:pluginId` with no tail;
- rejection of `..`, encoded slash/backslash escape vectors if relevant.

Exact-match routing only works if normalization is exact and tested.

### 3. Request body helpers can become a hidden footgun

Context exposes both `json()` and `text()`, but Fastify request bodies are not always safely re-readable. If each helper reads the raw stream independently, handlers become order-dependent and flaky.

Required plan change: define a cached body accessor:

```ts
type RuntimeBodyReader = {
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
}
```

Both helpers read from the same cached raw body. Define body size/error behavior by reusing existing Fastify/body limits, not inventing a new limit in this layer.

### 4. The API wrapper risks becoming a thin identity abstraction

`defineRuntimeServerPlugin()` is justified only if it actively owns validation/branding/type boundary. If it is just `return plugin`, it is unearned indirection.

Required plan change: state what the helper buys:

- rejects `id`;
- validates `routes` shape;
- brands runtime plugin object so loader can distinguish it from random default exports;
- keeps the public import type-stable.

If not doing those, delete the wrapper and import a typed object directly.

### 5. `runtimeBackendHealth.ts` may be premature in server MVP

The plan includes `runtimeBackendHealth.ts` and host health endpoint. That can be useful, but it risks another parallel state store duplicating registry diagnostics.

Code-judo move: make health a projection of the registry snapshot, not its own owner.

Required plan change: health module can format/project state, but registry remains source of truth for:

- active/inactive;
- last load error;
- revision;
- dispose error;
- source scope/kind.

No independent health cache in PR 02.

### 6. Source gating needs one canonical policy call

The plan correctly says workspace/global sources may activate and default/app sources may not. But if this check appears in loader, registry, gateway, and coordinator, it becomes spaghetti.

Required plan change: PR 02 must call the PR 01 policy function once during reload preparation. Gateway should dispatch only against registry snapshot; it should not re-evaluate source trust.

### 7. Error code ownership is vague

The plan says stable errors via canonical enum, but does not identify where new codes are added or how they are serialized. This is how raw string codes creep in.

Required plan change:

- name the canonical error-code file/import path;
- include tests that response bodies use enum values, not local string literals;
- ensure loader diagnostics and HTTP errors use the same code source.

## Strong recommendations

### A. Keep gateway as an adapter only

`runtimeBackendGateway.ts` should do only:

```txt
Fastify request -> normalized dispatch request -> registry.dispatch() -> Fastify reply
```

It must not know jiti, source policy, load diagnostics, or plugin manifests.

### B. Split registry internals into pure functions

Avoid one giant `RuntimeBackendRegistry` class doing everything. Keep pure pieces:

- `captureRoutes()`;
- `normalizeGatewayPath()`;
- `coerceRuntimePluginResult()`;
- `prepareRuntimeBackendSnapshot()`.

The class, if any, should own current snapshot and lifecycle only.

### C. Add a “bad plugin cannot poison server” integration test

One malformed plugin should not break:

- other plugins;
- host health endpoint;
- front runtime plugin events;
- future reloads.

This test is more important than several happy-path tests.

### D. Watch file-size thresholds

`createWorkspaceAgentServer.ts` is already ~801 lines and `BoringPluginAssetManager` is ~488 lines. PR 02 must not push large runtime backend logic into either. If `createWorkspaceAgentServer.ts` approaches 900+ lines, the PR is structurally suspect.

## Suggested revised acceptance

- Runtime backend reload uses two-phase prepare/commit/dispose semantics.
- Per-plugin failure policy is explicit and tested.
- Gateway normalization is fully specified and covered by tests.
- Request body helpers use one cached body read.
- `defineRuntimeServerPlugin()` earns its existence through validation/branding or is removed.
- Health is a projection of registry state, not a second source of truth.
- Source gating happens through one canonical policy call during reload preparation.
- Gateway is a thin adapter over `registry.dispatch()`.

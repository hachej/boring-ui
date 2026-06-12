# Ask-user CLI integration — long-term canonical plugin runtime plan

## Goal

Make folder mode, full apps, and CLI workspaces mode use one canonical workspace plugin runtime model.

If a package works as a default plugin in `createWorkspaceAgentServer()`, it should work in CLI workspaces mode without CLI-specific server code.

Ask-user is the motivating example, but the long-term model must cover:

- plugin tools
- plugin prompts
- Pi packages/extensions/skills
- runtime provisioning
- UI state preservation
- frontend plugin assets
- server routes
- reload/rebuild lifecycle
- disposal

## Current problem

The codebase has two plugin integration paths:

1. Single-workspace composition via `createWorkspaceAgentServer()`.
2. CLI workspaces-mode multiplexing inside `packages/cli/src/server/cli.ts`.

The first path can load `defaultPluginPackages` naturally. The second path manually recreates enough pieces to serve many local workspaces behind one Fastify app selected by `x-boring-workspace-id` or `?workspaceId=`.

That split forces plugin-specific exceptions whenever a plugin needs server routes or per-workspace runtime state. Ask-user exposed this because it needs a tool, prompt, UI state preservation, store/runtime, and `/api/v1/questions/commands`.

## Design principle

Do not make CLI workspaces mode a second plugin system.

The canonical owner should be workspace app-server code. The CLI should only provide:

- workspace registry
- workspace id resolution
- per-workspace root path
- per-workspace bridge
- runtime/front-target host integration
- request dispatch into canonical workspace plugin contributions

## Near-term vs long-term abstraction names

The near-term B3 fix should introduce:

```ts
createWorkspacePluginContributions(...)
```

That is intentionally not an agent kernel. It collects plugin/default-package contributions.

The long-term architecture may then introduce:

```ts
createWorkspaceAgentKernel(...)
```

That kernel can compose:

- workspace core behavior
- workspace UI tools
- plugin contributions
- route dispatch
- reload lifecycle
- runtime provisioning

Do not use both names for the same concept. The long-term kernel should be a higher-level orchestration object built from the contribution collector, not a renamed duplicate.

## Target architecture

Long term, `createWorkspaceAgentKernel()` owns one workspace's agent/workspace composition:

```ts
type WorkspaceAgentKernel = {
  workspaceRoot: string
  bridge: UiBridge

  agent: {
    tools: AgentTool[]
    systemPromptAppend?: string
    pi: AgentPiOptions
    runtimeProvisioning: WorkspaceRuntimeProvisioning[]
    beforeReload(): Promise<ReloadResult | undefined>
  }

  ui: {
    preservedStateKeys: string[]
  }

  plugins: {
    contributions: WorkspacePluginContributions
    assetManager: BoringPluginAssetManager
    rebuild(): Promise<PluginRebuildResult>
    inspectLoaded(): PluginRuntimeSnapshot[]
  }

  routes: WorkspaceRouteDispatcher

  dispose(): Promise<void>
}
```

`createWorkspaceAgentServer()` becomes the single-workspace Fastify wrapper around this kernel.

CLI workspaces mode creates/caches one kernel per registered local workspace and dispatches shared routes to the correct kernel.

## Route model

The largest architectural gap is server routes. Opaque Fastify plugins are easy in a single-workspace app, but awkward in a multiplexed app where the same URL belongs to many workspace kernels.

Long term, add explicit route contributions:

```ts
type WorkspaceRouteContribution = {
  id: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  handler(ctx: WorkspaceRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<unknown>
}

type WorkspaceRouteContext = {
  workspaceId: string
  workspaceRoot: string
  bridge: UiBridge
  kernel: WorkspaceAgentKernel
}
```

Single-workspace apps mount these directly.

CLI workspaces mode registers one route per unique method/path and dispatches by workspace id:

```ts
app.post("/api/v1/questions/commands", async (request, reply) => {
  const workspace = await workspaceFromRequest(request)
  const kernel = await getKernel(workspace)
  return kernel.routes.dispatch("POST", "/api/v1/questions/commands", request, reply)
})
```

Keep `routes?: FastifyPluginAsync` as a compatibility path for single-workspace apps during migration. Do not require external plugins to migrate immediately.

## Route semantics required before broad implementation

Before migrating beyond ask-user, define these semantics explicitly:

1. **Collision policy**
   - What happens if two plugins claim the same method/path?
   - Recommended: fail at contribution collection with a stable diagnostic.

2. **Path params and wildcards**
   - Are route paths exact only, or do they support params like `/files/:path`?
   - Recommended for initial version: exact paths only. Add params after a first plugin needs them.

3. **Body handling**
   - JSON body, multipart upload, binary body, and streaming body need different Fastify setup.
   - Recommended for initial version: JSON routes only. Ask-user is JSON-only.

4. **Streaming/SSE**
   - Streaming routes should not be added until there is a concrete first-party route to migrate.
   - Recommended: keep existing first-party SSE routes outside generic plugin route contributions for now.

5. **Auth/CSRF/origin policy**
   - Route contributions need a clear place to enforce plugin-owned auth policy.
   - Recommended: handler owns policy; kernel provides workspace context only.

6. **Error semantics**
   - Decide whether route handlers throw Fastify/http errors directly or return typed route results.
   - Recommended: use Fastify reply directly for now, with tests for status/body behavior.

7. **Lifecycle cleanup**
   - Route contributions must be tied to the workspace kernel lifetime.
   - Recommended: route handlers close over per-workspace contribution state; `kernel.dispose()` owns cleanup.

Ask-user's one JSON POST route should be the conformance seed for these semantics.

## Migration strategy

### Phase 1 — Contribution collector

Extract plugin/default-package composition into `createWorkspacePluginContributions()`.

Deliverables:

- `createWorkspacePluginContributions()` exists.
- `createWorkspaceAgentServer()` uses it.
- Existing tests pass unchanged.
- CLI workspaces mode consumes tools/prompts/Pi/state/runtime provisioning from contributions.
- CLI workspaces mode dispatches ask-user's one JSON POST route through a narrow dispatcher.

This phase corresponds to the B3 plan.

### Phase 2 — Agent kernel

Introduce `createWorkspaceAgentKernel()` as a higher-level composition object built from the contribution collector.

Deliverables:

- `createWorkspaceAgentServer()` becomes a thin wrapper around the kernel.
- CLI workspaces mode caches kernels instead of manually assembling agent route inputs.
- Workspace UI tools, plugin tools, prompts, Pi, reload, and preserved state are all grouped by kernel concern.

### Phase 3 — Route contributions API

Promote the narrow B3 dispatcher into an explicit route contribution API.

Deliverables:

- `defineServerPlugin()` accepts `routeContributions?: WorkspaceRouteContribution[]`.
- Kernel collects route contributions.
- `createWorkspaceAgentServer()` mounts both old opaque `routes` and new route contributions.
- CLI workspaces mode supports new route contributions by workspace dispatch.
- Collision and exact-path semantics are tested.

### Phase 4 — Migrate ask-user routes

Move ask-user from opaque `routes` to explicit route contributions.

Deliverables:

- Ask-user owns `POST /api/v1/questions/commands` as a route contribution.
- CLI workspaces mode no longer knows ask-user route semantics.
- Folder/full-app mode still exposes the same URL.
- Tests prove submitting/canceling questions works in both CLI modes.

### Phase 5 — Migrate first-party plugins opportunistically

Migrate first-party plugins with server routes to explicit route contributions when they need workspaces-mode support.

Do not force third-party plugin migration immediately.

### Phase 6 — Conformance tests

Add a conformance suite for default plugin packages across server modes:

- single-workspace server
- CLI folder mode
- CLI workspaces mode

For a test plugin package, assert identical behavior for:

- catalog tool visibility
- system prompt contribution
- Pi contribution
- preserved UI state key
- JSON route contribution
- plugin asset loading
- reload diagnostics

## Non-goals

- Do not proxy whole per-workspace Fastify apps.
- Do not mount each workspace under a unique route prefix as the primary architecture.
- Do not break existing `routes?: FastifyPluginAsync` plugins.
- Do not require plugin authors to learn CLI-specific APIs.
- Do not make frontend plugins responsible for server route dispatch.
- Do not build wildcard, multipart, or streaming route support before a first-party plugin needs it.

## Why not per-workspace Fastify apps?

Creating one full `createWorkspaceAgentServer()` app per workspace sounds simple, but the CLI currently exposes shared URLs selected by workspace headers/query. Proxying requests into per-workspace apps would need careful handling for:

- streaming chat responses
- SSE plugin events
- file upload/download bodies
- request headers
- error handling
- lifecycle cleanup
- duplicate route registration

That would be more magical and brittle than extracting canonical composition and dispatching explicit route contributions.

## Anti-sprawl guardrails

- No PR may push `packages/cli/src/server/cli.ts` over 1,000 lines without decomposing first.
- `createWorkspaceAgentServer()` should become thinner, not larger.
- New route dispatch files should stay narrow and exact-path-focused until real requirements expand them.
- Avoid `unknown`/cast-heavy contribution payloads; unclear typing means the boundary is not ready.
- No plugin-specific server construction in CLI.
- No route framework features without a first-party conformance test.

## Acceptance criteria

- `packages/cli/src/server/cli.ts` contains no plugin-specific server wiring for ask-user or any other first-party plugin.
- Any default plugin package that contributes tools, prompts, Pi resources, preserved UI state, runtime provisioning, and explicit JSON routes works in CLI folder mode and CLI workspaces mode.
- `createWorkspaceAgentServer()` is a thin wrapper around `createWorkspaceAgentKernel()`.
- CLI workspaces mode is a multiplexing adapter, not a plugin composition implementation.
- Backwards compatibility exists for old opaque Fastify route plugins in single-workspace mode.
- Conformance tests cover mode parity.

## Risks

- Route contribution API design can become too generic. Keep it exact-path and JSON-only until forced wider.
- Kernel can become a bag of unrelated state. Keep the returned shape grouped by concern: `agent`, `ui`, `plugins`, `routes`.
- Compatibility with opaque Fastify route plugins can hide mode differences. Document clearly that opaque routes are single-workspace only until migrated.
- Reload/rebuild logic can become more indirect than today. The kernel should delete duplication, not add another layer that merely forwards calls.

## Open questions

1. Should CLI workspaces mode intentionally reject opaque Fastify route plugins with diagnostics, or silently omit them?
2. Should route contributions support path params in v1, or stay exact-path only until needed?
3. Should route handlers use typed result objects or Fastify reply directly?
4. Should route contribution auth policy be declared metadata or handler-owned logic?
5. Should third-party plugins get a migration guide immediately, or only after ask-user proves the model?

## Recommended sequencing

1. Land/release media viewer and ask-user scrollbar fixes without CLI ask-user default integration.
2. Keep PR #194 open as the behavior target.
3. Implement the B3 contribution collector plan.
4. Rewrite PR #194 to use the collector and remove ask-user-specific CLI server code.
5. Promote the narrow dispatcher into the long-term route contribution API after ask-user proves the model.

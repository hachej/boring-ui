# Ask-user CLI integration — B3 contribution collector fix plan

## Goal

Replace the ask-user-specific workspaces-mode wiring in the CLI with a workspace-owned **plugin contribution collector** plus a narrow workspace-aware route dispatcher.

The behavior target is PR #194:

- CLI folder mode exposes `ask_user` by default.
- CLI workspaces mode exposes `ask_user` by default for every registered local workspace.
- `/api/v1/questions/commands` works in workspaces mode by dispatching to the active workspace.
- The CLI frontend mounts `askUserPlugin` by default.

The structural target is stricter:

- `packages/cli/src/server/cli.ts` must not construct ask-user server internals.
- The workspace package owns plugin/default-package composition.
- The CLI only resolves workspace identity, caches per-workspace contribution objects, and dispatches requests.

## Current problem

Folder mode already uses the canonical single-workspace path:

```ts
createWorkspaceAgentServer({
  defaultPluginPackages: ["@hachej/boring-ask-user"],
})
```

Workspaces mode bypasses that path. It manually registers agent routes, UI routes, plugin asset runtime state, dynamic Pi snapshots, and per-workspace bridges. PR #194 therefore added ask-user-specific setup for store/runtime/tool/prompt/routes/state/cleanup directly to `packages/cli/src/server/cli.ts`.

That is working-code debt. It makes CLI workspaces mode a second plugin system.

## Non-goals

- Do not introduce the full long-term route contribution API in this fix.
- Do not proxy whole per-workspace Fastify apps.
- Do not mount each workspace under a unique API prefix.
- Do not break existing `routes?: FastifyPluginAsync` support in single-workspace apps.
- Do not move plugin authoring/runtime front loading out of the CLI in this plan.

## Code-judo move

Do **not** create a large `AgentKernel` god object in the near-term fix.

Split responsibilities:

1. **Contribution collection**: workspace app-server resolves default plugin packages and returns tools, prompts, Pi resources, state keys, route handles, plugin asset manager, and reload hooks.
2. **Workspace route dispatch**: CLI resolves workspace id and calls the collected route handle for that workspace.

Composition collects. Dispatch dispatches. CLI does not know plugin internals.

## Proposed near-term API

Add to `@hachej/boring-workspace/app/server`:

```ts
createWorkspacePluginContributions({
  workspaceRoot,
  bridge,
  defaultPluginPackages,
  additionalBoringPluginDirs,
  pluginHotReload,
  frontTargetResolver,
  includeLegacyFrontUrl,
})
```

Return a grouped, non-god-object shape:

```ts
type WorkspacePluginContributions = {
  agent: {
    tools: AgentTool[]
    systemPromptAppend?: string
    pi: {
      additionalSkillPaths: string[]
      packages: WorkspacePiPackageSource[]
      extensionPaths: string[]
      getHotReloadableResources?: () => WorkspacePluginPackagePiSnapshot
    }
    runtimeProvisioning: WorkspaceRuntimeProvisioning[]
  }

  ui: {
    preservedStateKeys: string[]
  }

  assets: {
    manager: BoringPluginAssetManager
    rebuild(): Promise<PluginRebuildResult>
    beforeReload(): Promise<PluginReloadResult | undefined>
  }

  routes: WorkspacePluginRouteDispatcher

  dispose(): Promise<void>
}
```

The important detail: this is **not** an agent kernel. It is only plugin/default-package contribution collection.

## Minimal route dispatcher for this fix

Because ask-user must preserve `/api/v1/questions/commands`, B3 must include concrete route dispatch. Do not hand-wave it.

Add the smallest possible dispatcher shape:

```ts
type WorkspacePluginRouteDispatcher = {
  has(method: "POST", path: "/api/v1/questions/commands"): boolean
  dispatch(
    method: "POST",
    path: "/api/v1/questions/commands",
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown>
}
```

### Where the ask-user route handle comes from

B3 must also add the route handle source. Use this exact near-term mechanism:

1. Add an optional first-party route contribution field to `WorkspaceServerPlugin` collection, scoped narrowly to exact JSON routes:

   ```ts
   type WorkspaceServerPluginRouteContribution = {
     method: "POST"
     path: "/api/v1/questions/commands"
     handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown>
   }
   ```

2. Update the ask-user server plugin package to expose its questions command endpoint as one such route contribution, bound to the same per-workspace `store` and `runtime` it already creates.

3. `createWorkspacePluginContributions()` collects those route contributions and builds `WorkspacePluginRouteDispatcher` from them.

4. CLI workspaces mode dispatches by method/path only. It must not import ask-user schemas/classes or construct ask-user runtime state.

This is deliberately smaller than the long-term route API: exact method, exact path, JSON body, Fastify request/reply. No path params. No wildcard routing. No streaming. No multipart. No generic auth metadata.

For B3, the dispatcher only needs to support route handles produced by default plugin packages that can be safely bound to one workspace contribution instance. Ask-user is the conformance seed.

Do not adapt opaque `FastifyPluginAsync` routes into workspaces mode in this PR. That would create magic proxy behavior and hide the real route boundary. Opaque routes remain single-workspace compatibility until the long-term route contribution API lands.

## Implementation steps

### 1. Extract contribution collection from `createWorkspaceAgentServer()`

Move existing logic from `createWorkspaceAgentServer()` into `createWorkspacePluginContributions()`:

- `resolveDefaultWorkspacePluginPackagePaths(...)`
- default plugin dir entry resolution
- server plugin entry resolution
- `collectWorkspaceAgentServerPlugins(...)`
- `BoringPluginAssetManager` creation
- static/dynamic Pi snapshot setup
- runtime provisioning plugin input collection
- plugin rebuild closure
- preserved UI state collection

Keep behavior identical for single-workspace apps.

### 2. Refactor `createWorkspaceAgentServer()` to consume contributions

`createWorkspaceAgentServer()` should remain the single-workspace app wrapper:

1. Create bridge and workspace UI tools.
2. Create plugin contributions.
3. Call `createAgentApp(...)` with:
   - caller tools + UI tools + `contributions.agent.tools`
   - workspace prompt + plugin-authoring prompt + `contributions.agent.systemPromptAppend`
   - merged Pi options from `contributions.agent.pi`
   - reload hook that composes `contributions.assets.beforeReload()` with `opts.beforeReload`
4. Register:
   - `uiRoutes(... preserveStateKeys: contributions.ui.preservedStateKeys)`
   - `boringPluginRoutes(... contributions.assets.manager, contributions.assets.rebuild)`
   - existing opaque `routes?: FastifyPluginAsync` for single-workspace compatibility

Acceptance for this step: existing `createWorkspaceAgentServer()` tests pass without semantic changes.

### 3. Convert CLI workspaces mode to per-workspace contributions

In `createWorkspacesModeApp()`, replace ask-user-specific state with:

```ts
const contributionsByWorkspace = new Map<string, WorkspacePluginContributions>()
```

Create/cached contributions with:

```ts
createWorkspacePluginContributions({
  workspaceRoot: workspace.path,
  bridge: getBridge(workspace.id),
  defaultPluginPackages: ["@hachej/boring-ask-user"],
  additionalBoringPluginDirs: [getGlobalPiExtensionsRoot(), ...resolveCliBoringPluginDirs(workspace.path)],
  frontTargetResolver: runtimeHost.createFrontTargetResolver(workspace.id),
  includeLegacyFrontUrl: false,
})
```

Use outputs in the existing CLI workspaces-mode wiring:

- `getExtraTools` appends `contributions.agent.tools`
- `getSystemPromptDynamic` appends `contributions.agent.systemPromptAppend`
- `getPi().getHotReloadableResources` merges plugin Pi resources with workspace `.agents/skills`
- runtime provisioning reads `contributions.agent.runtimeProvisioning`
- `uiRoutes` preserves `contributions.ui.preservedStateKeys`
- `disposeWorkspaceRuntime()` calls `contributions.dispose()`

### 4. Add the ask-user exact JSON route contribution

In the ask-user server package, add a route contribution for `POST /api/v1/questions/commands` that uses the same runtime/store as the ask-user tool.

The route contribution should replace the need for CLI to know about:

- `QuestionsCommandSchema`
- `QuestionsBridge`
- `QuestionsBridgeError`
- ask-user auth/session fallback behavior

Single-workspace `createWorkspaceAgentServer()` can continue registering the existing opaque Fastify `routes` during this B3 fix. The new exact route contribution exists so workspaces mode has a canonical dispatchable handle.

### 5. Register the concrete route dispatcher in CLI workspaces mode

In CLI workspaces mode, keep one generic dispatch route:

```ts
app.post("/api/v1/questions/commands", async (request, reply) => {
  const workspace = await workspaceFromRequest(request)
  const contributions = await getContributions(workspace)
  return contributions.routes.dispatch("POST", "/api/v1/questions/commands", request, reply)
})
```

This is allowed because the CLI is only dispatching by method/path. It must not import ask-user server classes or know ask-user command schema details.

### 6. Delete ask-user-specific CLI server wiring

Remove direct server imports/usages from `packages/cli/src/server/cli.ts`:

- `@hachej/boring-ask-user/server`
- `@hachej/boring-ask-user/shared`
- `FileAskUserStore`
- `AskUserRuntime`
- `AskUserStatePublisher`
- `createAskUserTool`
- `QuestionsBridge`
- `QuestionsBridgeError`

The CLI package may still depend on `@hachej/boring-ask-user` because it declares it as a default plugin and imports the frontend plugin.

## Tests

Required tests:

- folder mode catalog contains `ask_user`
- workspaces mode catalog contains `ask_user`
- workspaces mode dispatches `POST /api/v1/questions/commands` without ask-user imports in CLI server code
- workspace removal calls `dispose()` for that workspace's contributions
- `createWorkspaceAgentServer()` still loads default plugin package tools, prompts, Pi resources, routes, and preserved UI state
- plugin reload still reports diagnostics and restart warnings

## Anti-sprawl guardrails

- `packages/cli/src/server/cli.ts` must not cross 1,000 lines because of this work.
- Any new helper file over 300 lines needs a decomposition check.
- No ask-user-specific server construction in CLI.
- No cast-heavy route dispatch. If the dispatcher needs `unknown` everywhere, the boundary is not explicit enough.
- Do not introduce a generic route router beyond the single method/path needed for B3.

## Acceptance criteria

- PR #194 behavior is preserved.
- Ask-user server details live outside CLI.
- Folder mode and workspaces mode both expose `ask_user` by default.
- `createWorkspaceAgentServer()` and CLI workspaces mode share plugin contribution collection.
- Route support is concrete for ask-user, not deferred.
- Full quality gates pass:
  - `pnpm --filter @hachej/boring-workspace run test`
  - `pnpm --filter @hachej/boring-ui-cli run test`
  - `pnpm typecheck`
  - `pnpm lint:invariants`

## Risks

- The route dispatcher can accidentally become the full long-term route framework. Keep it deliberately narrow.
- Contribution collection can become a god object. Keep the returned shape grouped and avoid naming it an agent kernel.
- If opaque Fastify routes are forced through CLI workspaces mode, the fix will sprawl. Only support explicit collected route handles needed for ask-user.

## Rollout

1. Land/release media viewer and ask-user scrollbar fixes without CLI ask-user default integration.
2. Keep PR #194 as the behavior target.
3. Implement contribution collection and narrow route dispatch.
4. Rewrite PR #194 to remove ask-user-specific CLI server code.
5. Merge CLI ask-user integration after the release that intentionally excludes it.

# Reload pluggability — small, harness-agnostic seams

Status: proposal, builds on PR #18.
Scope: cut workspace ↔ Pi coupling in the reload path. Keep Pi as the default
harness; let a future custom harness slot in without forking the workspace.

## Two-track reload, no callback between tracks

```
POST /api/v1/agent/reload
  ├─ Track A — workspace owns it
  │    BoringPluginAssetManager.load() → SSE → front hot-swap
  │    (errors → 422 with details; preserves last-good UI)
  └─ Track B — harness owns it (optional)
       harness.reloadSession?(sessionId)
       Pi today; custom harness later; missing method = skip.
```

The two tracks do not call into each other. The workspace stops registering Pi
extensions and stops mutating arrays that Pi later reads.

## Single new seam: dynamic prompt provider

```ts
// packages/agent/src/shared/harness.ts
interface AgentHarnessFactoryInput {
  // ...existing
  /**
   * Optional source of additional system prompt content. Harness reads it
   * each time it builds/rebuilds a session prompt. Returning `undefined`
   * means "nothing to add right now". Workspace plugin layer supplies it;
   * harness decides when to call it.
   */
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
}
```

- Workspace passes `systemPromptDynamic: () => aggregatePluginPrompts(boringAssetManager)`.
- Pi adapter, internally, registers a `before_agent_start` extension that calls
  the provider and appends to `event.systemPrompt`. Pi's native
  `reloadSession` already re-fires `before_agent_start`, so /reload picks up
  fresh plugin prompts with no extra lifecycle plumbing.
- Other harnesses call the provider during their own session-init flow, or
  ignore it.

## Audit — other leaky abstractions in today's reload path

### 1. Workspace mutates Pi-owned arrays in place (high)

`createWorkspaceAgentServer.ts → syncPackageJsonPiOptions()` calls
`piAdditionalSkillPaths.splice(...)`, `piPackages.splice(...)`,
`piExtensionPaths.splice(...)` to mutate the *same* arrays that were passed
into `pi: { ... }` on `createAgentApp`. This relies on Pi re-reading those
arrays inside `reloadSession`. Two bad properties:

- It's invisible coupling — neither side declares the contract.
- A non-Pi harness has no reason to read those arrays again, so the mutation
  is silently meaningless.

**Fix:** replace the snapshot arrays with a single getter:

```ts
// On PiHarnessOptions:
interface PiHarnessOptions {
  // ...existing
  getResources?: () => {
    additionalSkillPaths?: string[]
    packages?: WorkspacePiPackageSource[]
    extensionPaths?: string[]
    extensionFactories?: ExtensionFactory[]
  }
}
```

Pi's resource-loader rebuild reads from `getResources()` each time. Workspace
provides one getter that merges static + package.json-discovered values. No
splices. No shared array references.

This is Pi-internal and doesn't change the workspace's public surface much,
but it removes the most surprising piece of coupling in the file.

### 2. Pi-shaped helpers live in the workspace package (medium)

`createBoringPiPackageSource(workspaceRoot)` builds `{ source, skills:
["skills/boring-plugin-authoring"] }` — a Pi `WorkspacePiPackageSource` shape.
It lives in `createWorkspaceAgentServer.ts` and gets prepended to `piPackages`.

A non-Pi harness has no use for this shape and shouldn't have to pretend it
does. **Fix:** move the helper into the Pi-default composition path:

```ts
// pseudo
const harnessFactory = opts.harnessFactory ?? composePiHarnessFactory({
  workspaceRoot,
  pi: opts.pi,
  bundledSkillPackage: createBoringPiPackageSource(workspaceRoot),
})
```

Workspace stops constructing Pi-shaped values when a non-default harness is
in use.

### 3. Pi's bundled skill package is provisioned unconditionally (medium)

`createBoringPiPackageProvisioningContribution()` materializes
`@hachej/boring-pi` into the child workspace's `node_modules` regardless of
which harness is active. It should only run when the Pi adapter is the
selected harness.

**Fix:** make provisioning contributions a *harness adapter* responsibility
too:

```ts
interface AgentHarnessFactory {
  contributeProvisioning?(workspaceRoot: string): WorkspaceProvisioningContribution[]
}
```

`composePiHarnessFactory` returns the Pi-bundled provisioning entry from
`contributeProvisioning`. Workspace collects them generically. Custom
harnesses contribute their own asset packages, or nothing.

### 4. `/reload` response shape is harness-shaped (low)

`reloadRoutes` returns `{ ok, sessionId, reloaded }`. `reloaded: boolean` is
fine for Pi but doesn't carry boring-plugin reload outcomes (loaded count,
errors-but-still-usable, last-good UI kept), so the front always renders the
same "Agent plugins reloaded." message regardless of what really happened.

**Fix:** widen the response without breaking the existing field:

```ts
{
  ok: true,
  sessionId,
  reloaded,                          // keep — harness reload result
  boring?: {                         // new — workspace track
    loaded: number,
    errors: { id: string; message: string }[],
  }
}
```

Front `/reload` handler uses `boring.errors` to surface compile failures
without forcing a 422 (today's `throw` model conflates "reload broken"
with "some plugins broken").

### 5. Naming creep — `pi` in the workspace public API (defer)

`WorkspaceAgentServerOptions.pi`, `WorkspacePiPackageSource`,
`compactPiPackages` are exported by `@hachej/boring-workspace`. Hard to fix
without a breaking change for plugin authors. Leave for the day a second
harness lands; rename then under one umbrella (`harness?: { pi?: ..., ...}`)
with one release of aliases.

## Tradeoff acknowledged once

Track A and Track B don't share a callback. If a custom harness wants
plugin `systemPrompt`s to refresh inside a running session, it implements
the `systemPromptDynamic` getter call into its own session-init flow. Pi
already does this for free via `before_agent_start`. Other harnesses opt
in or accept static prompts.

## Execution order

| # | Change | Risk | Notes |
|---|--------|------|-------|
| 1 | Add `systemPromptDynamic` on `AgentHarnessFactoryInput`. Pi adapter consumes it via an internal `before_agent_start` extension. Delete `packages/workspace/src/server/agentPlugins/boringPiExtension.ts` and its test. Workspace passes the getter. | Low — same runtime behavior, code moves. | Step 1 keeps every existing test green. |
| 2 | Replace `syncPackageJsonPiOptions` array splices with a single `getResources()` getter on `PiHarnessOptions`. Pi reads it on every session rebuild. Workspace stops mutating shared arrays. | Low | Drops 30+ lines of mutation glue. |
| 3 | Move `createBoringPiPackageSource` and Pi-bundled provisioning into a `composePiHarnessFactory` helper. Workspace constructs them only on the Pi-default path. | Low | Custom harness path now allocates zero Pi-shaped data. |
| 4 | Widen `/api/v1/agent/reload` response with optional `boring` block. Update front `/reload` handler to surface compile errors without 422. | Low | Strictly additive on the wire. |
| 5 (later) | Rename workspace public types to drop `pi` prefix; ship `harness: { pi?: ... }` namespacing with deprecated aliases. | Medium | Wait until a second harness justifies the churn. |

Steps 1–4 are independent commits. Each can land on its own.

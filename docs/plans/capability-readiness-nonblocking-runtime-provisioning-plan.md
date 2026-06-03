# Capability Readiness + Non-Blocking Runtime Provisioning Plan

**Status:** draft plan  
**Date:** 2026-06-02  
**Primary packages:** `packages/agent`, `packages/core`, `packages/workspace`, macro child app integration  
**Related docs:**

- `packages/core/docs/CHAT_FIRST_WORKSPACE_BOOT.md`
- `packages/core/docs/plans/chat-first-auth-workspace-boot-plan.md`
- `docs/plans/preprovisioned-base-runtime-acceleration-plan.md`
- `packages/agent/docs/runtime.md`
- `packages/agent/docs/ERROR_CODES.md`

## 1. Goal

Reduce perceived cold-start latency by separating agent readiness into three user-visible capability levels instead of treating Python/package provisioning as a global blocker.

Today the user often waits for the whole `.boring-agent` provisioning path before the runtime is considered ready:

```txt
sandbox setup + layout + skills + uv + venv + pandas + bm
≈ 7.5–8.2s after recent batching work
```

That is wrong for product UX. A user can chat long before pandas is installed, and the agent can often inspect/edit files before macro Python dependencies are needed.

Target user experience:

```txt
1. Chat can start and first token can stream.
2. Workspace/files become available as soon as workspace substrate is ready.
3. Runtime dependencies become available in the background/lazily.
```

Expected perceived latency:

```txt
first token:             ~2–4s
file/tool readiness:     ~2–5s depending sandbox wake/root setup
macro deps readiness:    ~7–9s today, ~3–5s with runtime bundle seed
```

## 2. Non-goals

- Do not replace existing provisioning correctness/fingerprint logic.
- Do not make the browser perform package-manager or `.boring-agent` reconciliation work.
- Do not introduce a full core worker/saga state machine for v1.
- Do not require Vercel snapshots for this plan.
- Do not hide real dependency/provisioning failures from the user or agent.

## 3. Existing constraints and facts

### 3.1 Existing chat-first plan already supports background shell/workbench warmup

`packages/core/docs/CHAT_FIRST_WORKSPACE_BOOT.md` says the default composed route mounts the shell once workspace identity is valid and warms files/sessions/sandbox in the background.

However, it also currently says runtime provisioning is synchronous before declaring the agent runtime ready. This plan amends that boundary by making runtime provisioning capability-scoped.

### 3.2 Existing provisioning remains the source of truth

`provisionWorkspaceRuntime()` remains the correctness path for:

- `.boring-agent` layout
- skills
- workspace file templates
- node packages
- Python SDK/venv/deps
- fingerprints
- fallback repair

Any optimistic cache/bundle/background path must still flow through existing fingerprint checks.

### 3.3 Existing capability/readiness seams already exist

This plan does **not** need a new capability system from scratch. Reuse and extend the existing seams.

Existing UI/plugin capabilities:

- `packages/core/src/server/app/capabilities.ts` serves `/api/v1/capabilities`.
- `packages/workspace/src/front/registry/PanelRegistry.ts` gates panels by `requiresCapabilities`.
- This is mostly for UI/plugin feature availability, not per-tool runtime readiness.

Existing tool readiness:

- `packages/agent/src/shared/tool.ts` already defines `ToolReadinessRequirement`.
- `packages/agent/src/server/catalog/toolReadiness.ts` already provides `wrapToolForReadiness()`.
- `packages/agent/src/server/catalog/mergeTools.ts` already applies readiness wrappers when `checkReadiness` is supplied.
- Filesystem and upload tools already declare `readinessRequirements: ['workspace-fs']`.
- UI bridge tools already declare `readinessRequirements: ['ui-bridge']`.
- Structured `WORKSPACE_NOT_READY` tool results are already preserved by tests in the stream/projection path.

Therefore the implementation should extend the existing `ToolReadinessRequirement` union and readiness wrapper, not create a parallel abstraction.

Scope implication: the first useful backend slice is smaller than a new capability architecture. It is mainly:

```txt
extend ToolReadinessRequirement
  -> make toolReadiness runtime-aware
  -> add binding runtimeDependencies state
  -> pass checkReadiness into existing mergeTools
  -> run provisioning in background
```

### 3.4 Recent live measurements

After batching remote Vercel provisioning round-trips:

```txt
TOTAL provisionWorkspaceRuntime: 7489–8153ms

first sandbox setup + layout:     ~3.0–3.7s
skills reset:                     ~0.5–0.7s
python3 --version:                ~0.4–0.8s
uv probe + symlink:               ~0.3–0.6s
SDK artifact pack/copy:           ~0.5–1.0s
uv venv + uv pip + fingerprint:   ~2.0s
```

The slow path is not mostly wheel download. `uv pip install` itself is roughly 2s. The product problem is that all of it is blocking readiness.

## 4. Readiness model

Introduce a capability readiness model with three levels.

```ts
type CapabilityState = 'not-started' | 'preparing' | 'ready' | 'failed'

type AgentReadiness = {
  chat: CapabilityState
  workspace: CapabilityState
  runtimeDependencies: CapabilityState
}
```

### Level 1 — chat ready

User can send a normal chat message and receive model tokens.

Requires:

- auth/session valid where applicable
- selected workspace identity valid for authenticated workspace routes
- harness/model stream can be created

Does not require:

- `.boring-agent` runtime provisioning
- `bm`
- pandas
- macro SDK
- advanced sandbox package setup

### Level 2 — workspace/files ready

Agent can inspect and edit files.

Requires:

- workspace root exists
- template/starter files seeded, if applicable
- filesystem tools can operate
- file tree/search/read/write/edit tools are safe to expose

Does not require:

- Python macro SDK
- pandas/numpy
- `bm`
- plugin-provided dependency installs

### Level 3 — runtime dependencies ready

Agent can use provisioned dependency-backed tools and commands.

Requires:

- `.boring-agent` layout reconciled
- skills mirrored where needed
- `uv` available
- Python venv available
- macro SDK installed
- `bm` on PATH
- pandas/requests/numpy installed
- fingerprints match expected runtime contributions

## 5. Tool readiness requirements

Extend the **existing** tool readiness mechanism beyond substrate requirements.

Current code already has:

```ts
// packages/agent/src/shared/tool.ts
export type ToolReadinessRequirement =
  | 'workspace-fs'
  | 'sandbox-exec'
  | 'ui-bridge'

export interface AgentTool {
  readinessRequirements?: ToolReadinessRequirement[]
}
```

and already wraps tools through:

```ts
// packages/agent/src/server/catalog/toolReadiness.ts
wrapToolForReadiness(tool, checkReadiness)
```

The change is to extend the existing union:

```ts
export type ToolReadinessRequirement =
  | 'workspace-fs'
  | 'sandbox-exec'
  | 'ui-bridge'
  | 'runtime-dependencies'
  | `runtime:${string}`
```

No parallel capability registry is needed for tool execution. Tool registration should continue to declare its minimum required level via the existing `readinessRequirements` field.

Examples:

| Tool/action | Requirement |
|---|---|
| normal chat | none / `chat` |
| read/write/edit/tree/search | `workspace-fs` |
| bash in Vercel sandbox | `sandbox-exec` |
| `bm` / macro transform | `runtime:python` |
| Python package-dependent plugin tool | `runtime:python` |

## 6. Structured readiness errors

Tool calls must return adapted structured errors, not raw `command not found`, missing path, or scary provisioning failures when the real issue is a still-preparing capability.

The existing helper already returns structured `WORKSPACE_NOT_READY`:

```ts
// packages/agent/src/server/catalog/toolReadiness.ts
workspaceNotReadyToolResult(requirement)
```

Extend this helper path with runtime-aware error selection instead of adding a second wrapper. Conceptually:

```ts
function readinessToolResult(requirement, state) {
  if (requirement === 'runtime-dependencies' || requirement.startsWith('runtime:')) {
    return agentRuntimeNotReadyToolResult(requirement, state)
  }
  return workspaceNotReadyToolResult(requirement)
}
```

### Workspace substrate not ready

Existing shape stays valid:

```json
{
  "code": "WORKSPACE_NOT_READY",
  "retryable": true,
  "requirement": "workspace-fs",
  "message": "Files are still preparing. Try again shortly."
}
```

### Runtime dependency not ready

Use `AGENT_RUNTIME_NOT_READY` for preparing dependency-backed runtime capabilities:

```json
{
  "code": "AGENT_RUNTIME_NOT_READY",
  "retryable": true,
  "requirement": "runtime:python",
  "state": "preparing",
  "workspaceId": "...",
  "message": "Python runtime dependencies are still installing. This usually takes a few seconds."
}
```

### Runtime dependency failed

Use `RUNTIME_PROVISIONING_FAILED` for failed runtime provisioning:

```json
{
  "code": "RUNTIME_PROVISIONING_FAILED",
  "retryable": true,
  "requirement": "runtime:python",
  "state": "failed",
  "workspaceId": "...",
  "causeCode": "PROVISIONING_UV_INSTALL_FAILED",
  "message": "Runtime setup failed. Retry provisioning or reload the workspace."
}
```

### UI/agent adaptation

Structured details must survive:

```txt
tool executor
  -> adaptToolForPi
  -> stream projection
  -> frontend tool renderer
  -> model-visible tool result text
```

Friendly copy mapping:

| Requirement | User/tool copy |
|---|---|
| `workspace-fs` | Files are still preparing. |
| `sandbox-exec` | Sandbox is still waking. |
| `ui-bridge` | Workspace UI is still connecting. |
| `runtime-dependencies` | Runtime dependencies are still installing. |
| `runtime:python` | Python runtime dependencies are still installing. |

The model-visible text should explicitly say the condition is retryable so the agent can wait/retry instead of hallucinating a workaround.

## 7. Architecture

### 7.1 Split binding creation from dependency provisioning

Current `registerAgentRoutes.createRuntimeBinding()` effectively does:

```txt
runRuntimeProvisioning()
create runtime bundle
create tools/harness with provisioning env/PATH/skills
binding ready
```

Target shape:

```txt
create runtime bundle                  -> enables Level 1/2
create tools/harness                   -> chat/files can work
start dependency provisioning task      -> Level 3 in background
binding ready for chat                  -> before dependency task completes
```

Conceptual runtime binding:

```ts
interface RuntimeBinding {
  runtimeBundle: RuntimeBundle
  readiness: AgentCapabilityReadinessTracker
  runtimeProvisioning?: WorkspaceProvisioningResult
  runtimeProvisioningTask?: Promise<WorkspaceProvisioningResult | undefined>
  reprovision: (request?: FastifyRequest) => Promise<WorkspaceProvisioningResult | undefined>
  harness: AgentHarness
  tools: AgentTool[]
  readyTracker: ReadyStatusTracker // existing compatibility surface
}
```

The harness/tool env accessor must become live/dynamic:

```ts
getCurrent: () => runtimeProvisioning
  ? { env: runtimeProvisioning.env, pathEntries: runtimeProvisioning.pathEntries }
  : undefined
```

This pattern already exists for `buildHarnessAgentTools()`. Keep it and ensure runtimeProvisioning updates when the background task finishes.

Tool readiness should plug into the existing `mergeTools({ checkReadiness })` path:

```ts
const tools = mergeTools({
  standardTools,
  extraTools,
  pluginTools,
  checkReadiness: (requirement) => binding.readiness.isReady(requirement),
})
```

This means dependency gating is mostly an extension of current wrappers, not a new tool execution path.

### 7.2 Background runtime dependency task

For each binding:

```txt
if provisioning configured:
  readiness.runtimeDependencies = preparing
  start provisionRuntime(...)
  on success:
    runtimeProvisioning = result
    readiness.runtimeDependencies = ready
    refresh runtime skill paths / harness skill scope if needed
  on failure:
    readiness.runtimeDependencies = failed
    store error
```

Important: do not start duplicate dependency tasks per workspace/scope. Reuse the existing `runtimeBindings` keyed map and add task state to the binding.

### 7.3 Skill scope after background provisioning

Current harness creation includes:

```ts
additionalSkillPaths: [
  ...(runtimeProvisioning?.skillPaths ?? []),
  ...(scope.pi?.additionalSkillPaths ?? []),
]
```

If runtime provisioning becomes background, runtime-provisioned skill paths may not be available at harness creation.

Options:

1. **Minimal v1:** Create harness with user/package skills only. Runtime-provisioned skills become available after `/api/v1/agent/reload` or next session/harness recreation. This is acceptable only if macro-critical skills are also available via package Pi config or system prompt.
2. **Better v1:** When background provisioning finishes, call the same reload path used by `/api/v1/agent/reload` or refresh the Pi resource scope if the harness supports it.
3. **Best later:** Add a first-class harness `updateSkillPaths()`/resource reload method.

Recommendation: implement option 2 if current harness reload infrastructure can do it without broad refactor; otherwise choose option 1 and document that dependency-backed skills are not required for first token.

### 7.4 Tools requiring runtime dependencies

Dependency-backed tools must check readiness before executing.

For generic shell/bash, two protections are needed:

1. If the command is clearly dependency-backed (`.boring-agent/*`, Python import/module failures, or a missing command while runtime deps are preparing), return `AGENT_RUNTIME_NOT_READY` while runtime deps are preparing.
2. If the command still runs and fails with obvious missing-runtime text (`bm: command not found`), adapt that into `AGENT_RUNTIME_NOT_READY` when the runtime dependency state is preparing.

Do not block all bash. Basic shell commands like `ls`, `pwd`, `grep`, and file operations can run before Level 3.

## 8. Runtime bundle seed integration

A `.boring-agent` tarball seed remains compatible with this plan.

Cold workspace flow:

```txt
1. create runtime bundle / sandbox
2. optionally extract .boring-agent seed tarball
3. mark chat/workspace capabilities according to substrate readiness
4. run existing provisioning in background
5. fingerprints decide whether seed is valid or needs repair
```

The seed is only an optimization. Correctness remains:

```txt
existing provisioning fingerprints + fallback install
```

If the seed is stale, provisioning repairs it in the background. If user invokes a dependency-backed tool before repair is done, they receive `AGENT_RUNTIME_NOT_READY` / `RUNTIME_PROVISIONING_FAILED` as appropriate.

## 9. API/readiness endpoints

### 9.1 Existing `/api/v1/ready-status`

Preserve the current shape for compatibility:

```json
{
  "sandboxReady": true,
  "harnessReady": true
}
```

### 9.2 Add capability readiness detail

Extend without breaking old clients:

```json
{
  "sandboxReady": true,
  "harnessReady": true,
  "capabilities": {
    "chat": { "state": "ready" },
    "workspace": { "state": "ready" },
    "runtimeDependencies": {
      "state": "preparing",
      "requirement": "runtime:python",
      "startedAt": "2026-06-02T...Z"
    }
  }
}
```

Failed example:

```json
{
  "capabilities": {
    "runtimeDependencies": {
      "state": "failed",
      "requirement": "runtime:python",
      "errorCode": "PROVISIONING_UV_INSTALL_FAILED",
      "retryable": true
    }
  }
}
```

### 9.3 Retry/reprovision

Reuse existing reload/reprovision mechanisms where possible. If needed, add an explicit endpoint later:

```txt
POST /api/v1/agent/runtime/retry
```

Initial implementation can let `/api/v1/agent/reload` trigger `binding.reprovision()` and then refresh harness/tools.

## 10. Frontend UX

### 10.1 Composer/chat

Chat composer can be enabled when Level 1 is ready.

If the user sends while Level 2/3 is not ready, the agent can still answer conversationally. Tool calls that require unavailable capabilities return structured retryable errors.

### 10.2 Workbench panels

File tree/editor/plugin panels should follow Level 2 readiness:

```txt
workspace preparing -> show local "Preparing files…"
workspace ready     -> mount file/workbench UI
workspace failed    -> local retry/error state
```

### 10.3 Runtime dependency indicator

Show non-blocking status, not a global blocker:

```txt
Macro runtime installing…
```

When ready:

```txt
Macro runtime ready
```

On failure:

```txt
Macro runtime setup failed. Retry
```

## 11. Implementation milestones

### Milestone 1 — Plan/docs alignment

- Update `packages/core/docs/CHAT_FIRST_WORKSPACE_BOOT.md` to replace the current synchronous runtime boundary with the three-level capability model.
- Update `packages/core/docs/plans/chat-first-auth-workspace-boot-plan.md` section 8 to reference capability-scoped runtime provisioning.
- Update `packages/agent/docs/ERROR_CODES.md` with runtime dependency readiness detail examples.

Acceptance:

- Docs clearly distinguish Level 1 chat, Level 2 workspace/files, Level 3 runtime deps.
- Existing error codes remain canonical.

### Milestone 2 — Extend existing readiness seams

- Extend `ToolReadinessRequirement` in `packages/agent/src/shared/tool.ts` with runtime dependency requirements.
- Extend `packages/agent/src/server/catalog/toolReadiness.ts` so runtime requirements return `AGENT_RUNTIME_NOT_READY` / `RUNTIME_PROVISIONING_FAILED` instead of `WORKSPACE_NOT_READY`.
- Add lightweight binding-level readiness state or extend `ReadyStatusTracker` to track `runtimeDependencies` independently.
- Pass `checkReadiness` into the existing `mergeTools()` path from `registerAgentRoutes`.
- Extend `/api/v1/ready-status` response with backward-compatible `capabilities` detail.

Acceptance tests:

- Existing ready-status and tool-readiness tests still pass.
- New tests cover preparing/ready/failed runtimeDependencies states.
- Existing `WORKSPACE_NOT_READY` behavior for `workspace-fs`/`ui-bridge` is unchanged.
- Runtime requirements produce `AGENT_RUNTIME_NOT_READY` while preparing.
- Response remains backward compatible for clients reading only `sandboxReady`/`harnessReady`.

### Milestone 3 — Non-blocking runtime binding

- Refactor `registerAgentRoutes.createRuntimeBinding()` so harness/chat can be created before dependency provisioning completes.
- Start `runRuntimeProvisioning()` as a binding-owned background task when configured.
- Store success/failure state on the binding.
- Ensure no duplicate provisioning tasks for the same runtime scope.

Acceptance tests:

- Chat route can obtain a binding while runtime dependency provisioning is pending.
- Pending provisioning returns `AGENT_RUNTIME_NOT_READY` only for dependency-required tools, not for normal chat.
- Failed provisioning marks runtimeDependencies failed and preserves retryable details.

### Milestone 4 — Dependency-backed tool marking/adaptation

- Mark dependency-backed tools with the new runtime readiness requirements.
- Preserve structured runtime readiness details through the already-tested tool-result/projection path.
- Add focused tests for `AGENT_RUNTIME_NOT_READY` preservation mirroring the existing `WORKSPACE_NOT_READY` projection tests.
- Adapt obvious missing-runtime shell errors into readiness errors when runtimeDependencies is preparing.

Acceptance tests:

- Tool result with `AGENT_RUNTIME_NOT_READY` survives projection.
- Frontend renders friendly copy for `runtime:python`.
- Bash/file tools that do not require Level 3 still work while deps are preparing.
- Existing `workspace-fs` tool readiness behavior remains unchanged.

### Milestone 5 — Background provisioning completion behavior

- On successful background provisioning, update runtime env/PATH/skill paths.
- Decide and implement harness skill refresh behavior:
  - reload harness on completion, or
  - document that runtime skills appear on next reload/session.
- Emit telemetry for background provisioning duration and result.

Acceptance tests:

- After background provisioning resolves, `bm`/runtime-dependent tool can run without recreating the workspace.
- Env/PATH includes `.boring-agent/venv/bin` and `.boring-agent/sdk/uv/bin` after completion.
- Failure state can recover via reload/retry.

### Milestone 6 — Optional `.boring-agent` seed tarball

- Add optional runtime bundle URL/config.
- On cold workspace, extract seed before background provisioning.
- Let normal provisioning validate/repair via fingerprints.

Acceptance tests:

- Valid seed causes provisioning skip and faster runtimeDependencies ready.
- Stale seed triggers normal repair.
- Missing/bad seed does not prevent chat/workspace readiness.

## 12. Telemetry

Track:

```txt
agent.capability.chat.ready_ms
agent.capability.workspace.ready_ms
agent.capability.runtime_dependencies.started
agent.capability.runtime_dependencies.ready_ms
agent.capability.runtime_dependencies.failed
agent.tool.readiness_blocked
```

Include:

- workspaceId/sessionId/requestId where safe
- runtimeMode
- requirement
- errorCode/causeCode
- retryable

Success metric:

```txt
p95 first token no longer includes runtime dependency install time
```

## 13. Risks and mitigations

### Risk: agent tries to use `bm` before it is ready

Mitigation: dependency-backed tools declare readiness; bash adapts obvious missing-runtime errors while runtimeDependencies is preparing.

### Risk: harness created before runtime-provisioned skills exist

Mitigation: reload/refresh harness on provisioning completion, or ensure critical macro instructions are also provided through static system prompt/package skills.

### Risk: background task failure is ignored

Mitigation: store failed state on binding, expose through ready-status, render local retry UI, and use `RUNTIME_PROVISIONING_FAILED` for dependency-backed tool calls.

### Risk: race between reload/reprovision and background provisioning

Mitigation: one task per binding scope; use monotonically increasing task id or replace-on-reload semantics; ignore stale completions.

### Risk: overcomplicated core runtime state machine

Mitigation: keep capability tracking inside agent binding. Do not expand core DB `workspace_runtimes` states in this pass.

## 14. Open decisions

1. Should runtime-provisioned skills be available immediately after background completion via harness reload, or is next-session availability acceptable for v1?
2. Should `bash` proactively parse commands for `bm`/Python imports, or only adapt failures while runtimeDependencies is preparing?
3. Should macro split pandas into an optional extra after this plan, or is background provisioning enough for now?
4. Should `.boring-agent` seed tarball be implemented before or after non-blocking provisioning?

## 15. Recommended order

1. Extend the existing `ToolReadinessRequirement` union and `toolReadiness.ts` result helper for runtime requirements.
2. Add binding-level `runtimeDependencies` state and pass `checkReadiness` through the existing `mergeTools()` path.
3. Make runtime dependency provisioning background for `registerAgentRoutes`.
4. Mark dependency-backed tools and add structured `AGENT_RUNTIME_NOT_READY` projection/UI tests.
5. Add UI copy/status for runtimeDependencies.
6. Prototype `.boring-agent` seed tarball as an optimization.
7. Later: split pandas into optional SDK extra if runtime dependency readiness still takes too long or if cold seed is not enough.

This order keeps scope smaller because it reuses the existing readiness wrapper first, then changes provisioning scheduling.

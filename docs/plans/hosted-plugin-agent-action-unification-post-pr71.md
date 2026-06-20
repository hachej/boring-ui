# Hosted plugin + agent action unification after WorkspaceBridge RPC v1

## Status

Post-PR #71 follow-up plan. This is **not** part of the first hosted iframe external plugin PR.

This revision incorporates thermo-nuclear review rounds 1 and 2. The largest corrections are:

1. Do not assume PR #71 exists in this tree; Phase 0 inventories the landed symbols and rewrites assumptions before implementation.
2. Do not confuse UI bridge dispatch with capability/action dispatch.
3. Do not place the canonical action seam in `packages/workspace` if agent tools must call it; the shared action core must live in `packages/agent` or a new lower-level package.
4. Do not confuse same handler code with same remote runtime binding; hosted plugin actions must bind to the same Workspace/Sandbox runtime mode as agent actions for that workspace, or fail closed.

## Goal

Unify the abstraction agents and hosted plugins use to act on a workspace.

Target invariant:

> If an agent can perform an approved workspace action, a hosted iframe plugin can request the same action through the same canonical operation implementation, validation path, runtime-mode Workspace/Sandbox binding, permission gate, and stable error contract.

Important qualifier:

> Same action substrate does **not** mean same ambient authority. Agents and plugins share operation implementations and permission checks, but each call carries caller identity and only receives explicit grants.

User intent:

- Agents and hosted plugins should not have separate bespoke tool stacks.
- They should use the same underlying operations wherever the action is conceptually the same.
- Auditability and role-control product UX comes later for both together.
- Therefore this phase builds the shared action/policy/event seam now, but not the dashboard/role editor/org policy product yet.

## Package ownership

The canonical action core cannot live only in `packages/workspace`.

Current dependency direction:

```txt
packages/workspace -> packages/agent
packages/agent     -> no workspace dependency
```

Agent tools live in `packages/agent`. If agent tools are to call the shared action seam, that seam must be available from agent without importing workspace.

Placement options:

1. **Preferred for first pass:** action core in `packages/agent/src/server/actions/*`.
   - Agent tools can call it directly.
   - Workspace server can import it because workspace already depends on agent.
   - Workspace front/shared must not value-import it.

2. **Later extraction if it grows:** a new lower package such as `@hachej/boring-actions`.
   - Only if `packages/agent` becomes too broad.
   - Do not create a package solely for aesthetics before Phase 1 proves the model.

Workspace-owned pieces:

- hosted iframe route/front transport;
- plugin manifest capability request scanning;
- trusted host grant config composition;
- bridging browser/iframe requests to server;
- core/full-app multi-workspace wiring.

Agent-owned or lower-layer pieces:

- operation definition model if PR #71 does not supply one;
- canonical action registry/dispatcher;
- caller context shape used by agent tools;
- shared file/shell operation handlers or adapters;
- stable action error model if PR #71 error model is unavailable.

## UI bridge vs capability gateway

Do **not** overload the existing UI bridge concept.

- **UI bridge**: host UI effects only (`openFile`, `openPanel`, notifications, etc.).
- **Capability gateway / Action gateway**: typed request/response action dispatch with permissions.

Invariant:

> Capability actions never flow through `UiBridge.postCommand` / UI effect dispatch, and UI effects never bypass the action permission gate by pretending to be capability calls.

If PR #71 exports `WorkspaceBridgeRegistry`, Phase 0 decides whether that registry is the capability gateway transport/registry. Even then, docs must distinguish it from the existing front/UI bridge.

## Non-goals

- Do not give iframe plugins direct backend URLs, bearer tokens, local file paths, or localhost services.
- Do not load hosted plugin JavaScript into the host React tree.
- Do not execute hosted plugin `boring.front`, `boring.server`, Pi extensions, Pi skills, agent tools, routes, or backend code in the host.
- Do not add a generic route proxy such as `bridge.call('/api/anything')`.
- Do not expose existing runtime-backend catch-all routing to hosted untrusted plugins.
- Do not add unscoped generic workspace filesystem access. File operations must be typed, scoped, and adapter-validated.
- Do not solve full audit dashboards, long-term audit storage, role editor UI, or org policy UX in this phase.
- Do not let plugin manifests self-grant authority. Manifest declarations are requests; trusted host policy grants authority.
- Do not create a second competing RPC registry if PR #71 lands a usable one.

## Current baseline

### Local trusted external plugins

`externalPlugins` remains trusted local developer mode. It can load `.pi/extensions` native surfaces such as:

- `boring.front` native React plugin factories.
- `boring.server` trusted server entries.
- Pi extensions, skills, packages, and system prompts.
- Agent-visible tools and command surfaces via Pi resources.

This trusted-local mode is intentionally outside the hosted-plugin capability model.

### Hosted remote-safe iframe plugins

`hostedExternalPlugins` is intentionally much smaller:

- Host scans `.pi/extensions/<plugin>/package.json` through `Workspace`.
- Host honors only `boring.iframePanels`.
- Plugin UI is self-contained HTML in an iframe with `sandbox="allow-scripts"` and strict CSP.
- The current iframe bridge is diagnostics only: `ready`, `log`, and `error`.
- No plugin backend execution, Pi resources, routes, host React imports, network proxy, or arbitrary RPC.

This is safe but not useful enough for remote plugin parity.

### Existing runtime backend gateway

The repo already has a runtime backend/plugin dispatch area under `packages/workspace/src/server/runtimeBackend/*`. Phase 0 must inventory it alongside PR #71.

Plan stance:

- Treat existing runtime backend catch-all dispatch as trusted/native-runtime infrastructure, not the hosted untrusted plugin capability path.
- Do not route hosted iframe capability calls through a generic `/api/v1/plugins/:pluginId/*` route.
- If reusable pieces exist (stable errors, registry patterns, router capture), reuse concepts carefully, but keep hosted plugin actions typed and capability-scoped.

### PR #71 dependency

PR #71 is expected to provide some WorkspaceBridge RPC v1 foundation. This plan must verify what actually lands.

Required Phase 0 inventory:

- exact registry/dispatch symbols;
- operation-definition type, if any;
- caller-class enum/union;
- auth context shape;
- token/runtime env injection shape;
- idempotency support;
- HTTP route/client entrypoints;
- stable error type and codes;
- ask-user/human-input bridge ops, if any;
- generated/runtime plugin RPC explicit deferrals;
- relationship to existing runtime backend gateway.

If PR #71 lands less than the needed gateway substrate, Phase 1 builds the missing pieces in agent/lower-layer code. Do not treat this as a small wiring task.

## Runtime binding invariant

The shared action invariant has two parts:

1. same operation implementation and validation path;
2. same runtime-mode Workspace/Sandbox binding for the workspace.

Remote mode risk:

- Agent tools may operate on a remote sandbox Workspace/Sandbox pair.
- Hosted plugin server code must not accidentally read/write the host filesystem for the same workspace.

Therefore every action dispatch must resolve a `RuntimeActionBinding` from trusted server context:

```ts
interface RuntimeActionBinding {
  workspaceId: string
  workspace: Workspace
  sandbox?: SandboxLike
  runtimeMode: "direct" | "vercel-sandbox" | "remote-worker" | string
}
```

Binding rules:

- Agent calls use the same RuntimeBundle / operations binding already selected for the agent session/tool invocation.
- Hosted plugin calls resolve the workspace's current runtime-mode binding through workspace/core server composition, never raw host paths.
- If no safe runtime binding exists for hosted-plugin caller, fail closed with stable error.
- Tests must prove remote hosted-plugin read uses the remote Workspace abstraction, not host filesystem paths.

Open decision:

- Should hosted plugin actions bind to a workspace-level runtime binding or an active agent session binding?
- Default recommendation: workspace-level binding for file/read/query/artifact actions; session-specific binding only for actions that explicitly require an agent runtime session.

## Core architecture

```txt
Agent/lower-layer CapabilityActionCore
  ├─ operation definitions and schemas
  ├─ caller identity
  ├─ runtime binding contract
  ├─ permission/grant policy hook
  ├─ canonical action implementation
  ├─ stable validation/error path
  └─ normalized event seam for later audit/roles

Adapters
  ├─ Agent operations adapter   -> existing Pi tool factories call gateway-backed operations
  ├─ Workspace server adapter   -> hosted iframe HTTP/postMessage calls dispatch to gateway
  ├─ Browser/product adapter    -> optional trusted product UI calls
  └─ Server adapter             -> trusted in-process calls
```

Same handler function powers both agent tools and plugin calls for each unified action.

Example:

```txt
workspace.files.read
  ├─ agent read tool -> filesystem Operations object -> gateway -> handler
  └─ hosted plugin -> iframe postMessage -> workspace server route -> gateway -> same handler
```

The hosted iframe front cannot import agent/server action code. It only relays to workspace server.

## Concrete agent insertion seam

Do not invent an `AgentToolAdapter` layer that does not exist.

Current filesystem tools are built from a Pi factory plus an `operations` object. The realistic insertion point is the operations object passed to the tool factory.

Target migration shape:

```txt
buildFilesystemAgentTools(...)
  -> create gateway-backed FilesystemOperations implementation
  -> pass it to existing createReadToolDefinition / createWriteToolDefinition / etc.
```

Phase 1 should name exact files/functions after inventory. Candidate seam:

- `packages/agent/src/server/tools/filesystem/index.ts`
- operation implementations under `packages/agent/src/server/tools/operations/*`

This preserves the existing Pi tool package boundary while making the operations implementation shared.

## Definition ownership

Use one operation definition type.

Preferred after PR #71:

```txt
PR71 operation definition
  + optional adapter metadata for agent tool naming/descriptions
  + optional resource-scope extractor used by permission policy
```

Fallback if PR #71 lacks one:

```txt
packages/agent/src/server/actions/CapabilityOperationDefinition
```

Definition owns:

- input schema;
- output schema if available;
- max input bytes;
- max output bytes;
- timeout;
- mutation flag;
- idempotency policy;
- required capabilities;
- allowed caller kinds/classes;
- resource-scope extraction metadata.

Adapter owns presentation/transport only.

## Validation ownership

There is already mode-specific validation today. The goal is not to erase legitimate runtime-mode differences; the goal is to avoid agent-vs-plugin forks.

Current reality:

- Bound/local operations have local path containment behavior.
- Vercel/remote operations have remote workspace path rules.

Target rule:

> For a given runtime mode, agent and hosted plugin calls use the same validation path. Runtime modes may have different adapters, but caller type must not choose a different filesystem authority.

For `workspace.files.read`, the action handler should either:

1. delegate to the same runtime-mode operations adapter used by agent tools; or
2. centralize validation in a new lower-level helper that both bound and remote operations use.

Do not create one path validator for plugins and another for agents.

## Caller identity model

Use one caller context across adapters. Exact enum names depend on PR #71 inventory, but semantics must cover:

```ts
type CapabilityCaller =
  | { kind: "agent"; workspaceId: string; sessionId?: string; toolCallId?: string; runtimeId?: string }
  | { kind: "hosted-plugin"; workspaceId: string; pluginId: string; panelId?: string; userSessionId?: string }
  | { kind: "browser"; workspaceId: string; userSessionId?: string }
  | { kind: "server"; workspaceId: string; serviceId: string }
```

Open decision:

- If PR #71 only supports `browser | runtime | server`, either add `hosted-plugin` or represent plugins as `browser` with required plugin attribution.
- Prefer a distinct hosted-plugin kind if it reduces policy ambiguity.

Caller metadata must be threaded to the operations/gateway layer. Existing tool context does not automatically reach low-level operations, so Phase 1 must add that plumbing where needed.

## Permission and grant model for this phase

Build a real grant source now, even if product role UI comes later.

Inputs:

1. Operation definition.
2. Caller metadata.
3. Runtime binding metadata.
4. Resource scope extracted from typed input.
5. Trusted host grant policy.

Interim grant source:

```ts
interface StaticCapabilityGrantConfig {
  agents?: {
    defaultCapabilities?: string[]
  }
  hostedPlugins?: Record<string, {
    capabilities: string[]
    scopes?: Record<string, unknown>
  }>
}
```

Rules:

- Source is trusted host config, not plugin manifest.
- Plugin manifests only request capabilities.
- Host config may grant a subset.
- Future role-control UI replaces/augments this grant source without changing action handlers.
- Hosted plugins default deny.
- Agent operations also call the gateway policy; they do not bypass it once migrated.
- Migration safety invariant: already-shipped agent capabilities must preserve current behavior under empty/default config; agents get compatibility default grants for actions they already had, while hosted plugins remain fail-closed until explicitly granted.
- Local trusted/native plugins remain separate trusted mode.

## Idempotency model

Do not leave idempotency as a decorative flag.

Minimum v1 enforcement:

- Operation definition declares `idempotencyPolicy`.
- Gateway rejects mutation calls that require idempotency when the key/request id is absent.
- Presence-only enforcement is acceptable for Phase 1 if no PR #71 dedupe store lands.
- Full dedupe can be added before broad mutation exposure.

Full dedupe design, if needed:

- key scope: `(workspaceId, callerKind, callerId/pluginId/sessionId, op, idempotencyKey)`;
- TTL configured by host;
- pending/completed states;
- failed calls release the key unless policy says otherwise;
- stable conflict/replay errors.

## Hosted iframe bridge design

Keep iframe CSP `connect-src 'none'`. Hosted iframe plugins must not call the backend directly.

Flow:

```txt
iframe plugin JS
  -> postMessage({ type: "boring.plugin.call", nonce, request })
  -> Workspace front HostedPluginIframePanel validates source + nonce + plugin/panel identity
  -> Workspace front sends request to workspace server hosted-plugin action endpoint
  -> Workspace server resolves runtime binding + caller context + grants
  -> Workspace server dispatches to agent/lower-layer capability gateway
  -> response returns to iframe over MessageChannel
```

Bridge constraints:

- source must equal iframe `contentWindow`;
- nonce must match per-load nonce;
- request id required or generated by host;
- request/response byte limits enforced on front and server;
- operation name must be requested and granted;
- mutation idempotency policy enforced;
- stable errors only;
- no stack traces, host paths, tokens, raw auth headers, or full sensitive payloads.

Iframe API:

```js
await boring.call("workspace.files.read", { path: "data/input.csv" })
await boring.call("artifact.v1.create", { title: "Chart", contentType: "text/html", body })
```

The host should inject the tiny `boring.call` bootstrap before plugin HTML so plugin authors do not reimplement transport.

## Manifest capability requests

Extend hosted plugin manifest with requested capabilities. Candidate field:

```jsonc
{
  "name": "example-hosted-plugin",
  "version": "0.1.0",
  "boring": {
    "iframePanels": [
      { "id": "main", "title": "Example", "entry": "panel.html" }
    ],
    "hostedCapabilities": [
      "workspace.files.read",
      "artifact.v1.create"
    ]
  }
}
```

Rules:

- Requests are not grants.
- Unknown capability requests are diagnostics and denied.
- Host may grant subset.
- Capability names are stable and product-shaped.
- Per-panel capabilities may come later if plugin-wide is too coarse.
- Diagnostics should explain missing grants without leaking host internals.

## Action catalog tracks

Split actions into two tracks to avoid fake proof of unification.

### Track A: extraction actions with existing agent behavior

These prove the thesis because an existing agent tool migrates to the shared gateway:

1. `workspace.files.read`
   - First proof-of-thesis action.
   - Existing agent read behavior becomes gateway-backed operations adapter.
   - Hosted plugin gets scoped read only when granted.

2. `workspace.files.write`
   - Later mutation track.
   - Scoped paths, overwrite policy, idempotency.

3. `workspace.command.run` / `workspace.shell.run`
   - Sharp edge.
   - Same sandbox adapter as agent shell.
   - Defer until permission/approval story is explicit.

### Track B: net-new product capabilities

These may be useful but do not prove unification by themselves:

1. `artifact.v1.create`
   - Good hosted-plugin UX capability.
   - Mutation; idempotency required.

2. `data.v1.query`
   - Host-approved named data source.
   - Read-only, bounded outputs.
   - Likely aligns with PR #71 Macro/data work if that lands.

3. `human-input.v1.*`
   - Only if PR #71 actually lands ask-user/human-input bridge operations.
   - Otherwise treat as net-new.

Phase 1 must use Track A, preferably `workspace.files.read`.

## File asset pointers

File-asset pointers are their own capability surface, not a loophole.

If an action returns a large file/resource pointer, one of these must be true:

1. Host renders/streams it without giving iframe independent dereference authority; or
2. Dereference is a first-class operation with its own definition, grant, scope check, expiration, and runtime binding.

Rules:

- Pointer must be scoped to workspace, caller, op, and request id when possible.
- Pointer dereference must revalidate authority.
- Iframe cannot dereference a pointer minted for another plugin/panel/session.
- Pointers must not contain raw host paths.

## Agent tool migration path

Do not rewrite every tool at once.

For each candidate:

1. Identify existing agent behavior and current validation owner.
2. Identify the runtime binding and mode-specific adapter.
3. Create or reuse one gateway operation definition.
4. Move caller-independent schema/scope/permission into the gateway/action seam.
5. Make existing agent operations object call the gateway.
6. Add hosted plugin server adapter only after grants and runtime binding are clear.
7. Prove both callers hit the same handler path for the same runtime mode.

First migration target:

```txt
workspace.files.read
  old: agent read tool -> Operations/Workspace directly
  new: agent read tool -> gateway-backed Operations -> canonical read handler -> runtime-mode Workspace adapter
       hosted plugin -> iframe bridge -> workspace server -> gateway -> same canonical read handler -> same runtime-mode Workspace adapter
```

## Implementation phases

### Phase 0: inventory and hard design choices

Tasks:

- Inventory PR #71 final exported symbols by name.
- Inventory existing runtime backend gateway symbols and decide relationship.
- Decide whether gateway core lives in `packages/agent` or a new lower package.
- Decide whether to reuse PR #71 registry directly or wrap it.
- Resolve UI bridge naming collision in docs/code.
- Resolve caller kind enum: `hosted-plugin` vs `browser` with plugin attribution.
- Resolve one operation definition type.
- Resolve runtime binding source for hosted plugin calls.
- Resolve validation owner for `workspace.files.read`.
- Spike the exact Pi filesystem operations interface: confirm whether per-call context (`toolCallId`, trace/session data) can reach gateway through the operations object, or whether the insertion point must move up to the tool `execute`/adapter wrapper.
- Confirm idempotency support level.

Exit criteria:

- no fictional foundation remains;
- one registry/dispatch path chosen;
- one package owner chosen;
- one operation definition type chosen;
- one caller context shape chosen;
- one runtime binding strategy chosen;
- one validation owner chosen for first action;
- one concrete agent insertion seam chosen after checking the actual operations call signature;
- compatibility default-grant behavior for pre-existing agent actions specified.

### Phase 1: agent-layer gateway proof with `workspace.files.read`

Tasks:

- Add/reuse capability gateway core in agent/lower layer.
- Add caller context for agent calls.
- Add runtime binding parameter to action dispatch.
- Add static trusted grant config seam.
- Add compatibility default grants for pre-existing agent read behavior, while hosted plugins remain default-deny.
- Define `workspace.files.read`.
- Create gateway-backed filesystem read operations implementation for existing Pi read tool, or move the seam up to the execute/adapter wrapper if the operations interface cannot carry required call context.
- Preserve runtime-mode validation behavior.
- Emit normalized internal action event to test/debug sink.

Exit criteria:

- existing agent read behavior still works in direct and remote runtime modes under empty/default grant config;
- policy denial can block agent read through the gateway when explicitly configured to deny;
- tests prove gateway handler is the implementation path;
- no hosted plugin exposure yet.

### Phase 2: hosted iframe postMessage RPC for `workspace.files.read`

Tasks:

- Add host-injected `boring.call` iframe API.
- Add workspace server endpoint for hosted plugin action calls, or reuse PR #71 route if safe and typed.
- Validate source + nonce + plugin/panel identity in front.
- Validate plugin/workspace/auth context on server.
- Resolve runtime binding on server.
- Dispatch `workspace.files.read` as hosted-plugin caller.
- Enforce request/response size limits.
- Return stable errors.
- Keep CSP `connect-src 'none'`.

Exit criteria:

- iframe can call granted `workspace.files.read` in tests;
- iframe cannot call without valid nonce/source;
- iframe cannot call ungranted op;
- remote hosted-plugin read uses remote Workspace binding, not host filesystem;
- no URL/token exposed to iframe;
- agent and hosted plugin hit same handler for same runtime mode.

### Phase 3: manifest capability requests and host grants

Tasks:

- Add `boring.hostedCapabilities` validation.
- Store requested capabilities in hosted plugin records.
- Add trusted host static grant config.
- Surface safe diagnostics for requested-but-denied capabilities.
- Keep grants out of plugin manifest authority.

Exit criteria:

- plugin can request but not self-grant;
- host grants subset;
- denied calls fail with stable codes;
- future role UI can replace static config without action-handler changes.

### Phase 4: expand safe capability set

Add after Phase 1-3 prove the path:

- `artifact.v1.create` with idempotency;
- `data.v1.query` if backed by PR #71/data work;
- `workspace.files.write` with scoped grants and conflict policy.

Exit criteria:

- each operation has one handler shared by relevant adapters;
- mutations enforce idempotency policy;
- file asset pointer rules are implemented if used.

### Phase 5: command/shell parity decision

Command execution is the dangerous parity edge.

Tasks:

- Compare current agent shell behavior and remote sandbox pairing.
- Define whether plugins can execute commands directly or only propose commands for user/agent approval.
- Define command scopes/allowlists and approval UX requirements.
- Decide if this belongs in same PR or a separate plan.

Exit criteria:

- explicit go/no-go for direct hosted-plugin command execution;
- no accidental shell capability.

## Required tests

### Core proof tests

- Agent operations adapter and hosted plugin adapter invoke the same handler path for `workspace.files.read`.
- Existing agent read behavior still passes through Pi factory package boundary.
- Empty/default grant config preserves current agent read behavior.
- Policy denial blocks both callers through the same error path when explicit deny config is used.
- Direct and remote runtime modes preserve their current path validation semantics.

### Hosted iframe tests

- Hosted iframe cannot call without valid nonce/source.
- Hosted iframe cannot call undeclared capability.
- Hosted iframe cannot call declared but ungranted capability.
- Iframe request/response size limits apply.
- CSP still prevents direct network calls.
- No backend URL/token is exposed to iframe.

### Runtime binding tests

- Hosted plugin read in remote sandbox uses remote Workspace abstraction.
- Hosted plugin read fails closed when no safe runtime binding exists.
- Hosted plugin action never receives raw host workspace/root path.

### Permission/scope tests

- Static host grant allows a subset of requested capabilities.
- Plugin manifest request alone grants nothing.
- Path scope denial works for agent and plugin.
- Unknown capability request becomes diagnostic and denial.

### Mutation/idempotency tests

- Mutation requiring idempotency rejects missing key/request id.
- If full dedupe exists, duplicate in-flight/completed requests produce stable behavior.

### Asset pointer tests, if used

- Pointer dereference revalidates scope and runtime binding.
- Iframe cannot dereference pointer minted for another caller.
- Pointer never exposes raw host path.

### Security regression tests

- No hosted `boring.front`, `boring.server`, or Pi code execution is introduced.
- Stable errors do not leak host paths, stack traces, tokens, or sensitive payloads.
- Remote mode uses runtime Workspace/Sandbox seam, not host raw paths.
- Hosted plugin calls do not use existing generic runtime backend route dispatch.

## Event seam for future audit/roles

Full auditability and role-control product UX is deferred. Still, every gateway call should emit one normalized internal event shape now.

```ts
interface CapabilityActionEvent {
  traceId: string
  requestId: string
  parentRequestId?: string
  op: string
  workspaceId: string
  runtimeMode?: string
  callerKind: "agent" | "hosted-plugin" | "browser" | "server"
  pluginId?: string
  panelId?: string
  sessionId?: string
  toolCallId?: string
  outcome: "allowed" | "denied" | "failed" | "succeeded"
  errorCode?: string
  startedAt: string
  durationMs?: number
}
```

Trace origin:

- agent tool call: derive from existing request/tool call/session context when available;
- hosted plugin call: derive from hosted iframe request id and server request context;
- if no external trace exists, gateway generates one.

For this phase, event sink may be in-memory/test/debug only. Do not build dashboard/storage/role editor now.

## Documentation to update

- `packages/workspace/docs/PLUGIN_SYSTEM.md`
- `packages/agent/docs/README.md` or action/tool docs if new agent-layer action core lands
- PR #71 bridge docs or successor docs
- hosted plugin authoring docs
- plugin CLI manifest validation docs
- security/trust-mode docs
- example hosted plugin with capability request and static host grant

## Risks and mitigations

1. **Fictional PR #71 baseline.**
   - Mitigation: Phase 0 symbol-level inventory; plan update before implementation.

2. **Wrong package ownership / dependency cycle.**
   - Mitigation: action core in agent/lower layer; workspace server consumes it; workspace front only transports.

3. **UI bridge/capability gateway confusion.**
   - Mitigation: distinct names and invariant banning cross-use.

4. **Second competing registry.**
   - Mitigation: one operation definition type; reuse PR #71 registry if sufficient.

5. **Same code but wrong filesystem.**
   - Mitigation: runtime binding invariant and remote binding tests.

6. **Validation forks between agent and plugin.**
   - Mitigation: same runtime-mode operations/validation path for both callers.

7. **No real grant source.**
   - Mitigation: static trusted host grant config now; product role UI later.

8. **Manifest self-grant.**
   - Mitigation: manifest requests only; host config grants.

9. **File pointer becomes hidden file API.**
   - Mitigation: pointer dereference is first-class or host-rendered only.

10. **Audit/roles deferral loses metadata.**
   - Mitigation: normalized event seam with trace/request IDs now.

11. **Shell parity too dangerous.**
   - Mitigation: defer shell to Phase 5 explicit decision.

## Open questions

1. What exact PR #71 symbols exist after merge?
2. Does the gateway core live in agent or a new lower package?
3. Should hosted plugin be a distinct caller kind or browser caller with plugin attribution?
4. Should capability requests be plugin-wide or panel-specific?
5. What is the trusted static grant config shape for full-app/core/standalone?
6. Does idempotency start presence-only or full dedupe?
7. Where should `workspace.files.read` canonical validation live after migration?
8. How does hosted plugin action dispatch resolve runtime binding in each server mode?
9. Should file asset pointers be host-rendered or dereferenceable by iframes?
10. Should command execution be direct plugin capability or proposed action only?

## Success criteria

- At least one pre-existing agent tool (`workspace.files.read`) is served to both the agent operations adapter and hosted plugin adapter through the same handler path.
- Direct and remote runtime modes use the same runtime Workspace/Sandbox binding semantics for agent and plugin calls.
- Hosted iframe plugins gain useful remote action capability without native host code execution.
- Permission checks are centralized and caller-aware.
- Future audit/role work has one event/policy seam to attach to.
- Local trusted plugin mode remains unchanged.
- No generic route proxy, unscoped file API, UI-bridge confusion, host-token exposure, or hosted plugin backend execution is introduced.

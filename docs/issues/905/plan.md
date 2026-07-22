---
github: https://github.com/hachej/boring-ui/issues/905
issue: 905
state: ready-for-human
updated: 2026-07-22
flag: not-flaggable
track: owner
---

# gh-905 Extract the multi-Agent Host and Gateway boundary

## Glossary

These terms are normative throughout this plan:

| Term | Definition |
| --- | --- |
| **Seneca** | The SaaS/product application. It composes Core, Workspace, Agent Gateways, domains, managed deployment policy, and the trusted Agent pool. |
| **Core** | Identity, authentication, membership, and account boundary only. Core does not choose Agents or execution providers. |
| **Workspace** | The product/project context and Vercel-like console: workbench, files UI, Agent/session navigation, authorization adapters, and inter-Agent orchestration. It is not the Agent execution process. |
| **Workspace scope** | An opaque, stable identifier carried by an Agent session so the Host can fail closed on cross-Workspace access. It is not a filesystem root or a claim that Workspace owns the transcript. |
| **Workspace scope grant** | Short-lived control-plane-signed Host-wire authorization binding one Workspace scope, Host audience, allowed Agent/operation, command/request digest, expiry, nonce, and signing-key ID. It is minted after pool routing; browser input cannot mint one. |
| **Model access grant** | Short-lived Seneca-issued capability binding Workspace, Host, Agent session/invocation, provider/model, limits, expiry, nonce, and key ID to a bounded model proxy. It contains no raw provider credential. |
| **Workbench** | Workspace-owned browser framework for panes, file tree, editors, viewers, artifact surfaces, and project-wide navigation. |
| **Agent** | The current logical composition of authored identity/instructions, trusted plugin behavior, tools/skills/Pi resources, model policy, and Environment configuration. Agent does not mean a process or VM. |
| **Agent definition** | The current safe `AuthoredAgentSourceV1` identity/instructions input. Executable behavior remains selected by trusted host/plugin policy; #905 does not add a v2 schema. |
| **Agent Runtime** | Actor-neutral execution of one Agent type inside an Agent Host. It runs Pi/model/tool behavior for many independently scoped sessions. |
| **Agent Host** | A process/service hosting one or more Agent Runtimes and their durable sessions/events. One Host may serve many Agent types and many sessions. |
| **Agent Host placement** | Whether the Host is embedded in an application process or reached remotely. This is independent of Environment mode. |
| **Agent Host protocol** | Agent-owned bounded remote wire for catalog/session/control/events, member-safe file operations, immutable plugin-asset snapshots, and typed delegation/UI-command request/receipt egress. It is not a generic plugin RPC surface and never exposes Bash/Sandbox/provider values. |
| **Agent Gateway** | Agent-owned, location-transparent client contract for Agent Host capabilities. Workspace receives it by injection. |
| **Agent Pool** | Seneca-owned routing/deployment composition over one or more Agent Gateways/Hosts. It is policy/configuration, not a base Workspace feature. |
| **Agent session** | Agent-Host-owned native Pi conversation: ID, transcript, title, status, follow-up, replay, compaction, model loop, controls, and terminal event. Every product session is Workspace-scoped. |
| **Host ID** | Stable logical deployment/pool-slot identity used for routing across process/revision replacement. It is not a URL or process identity. |
| **Host instance ID** | Ephemeral process/revision identity used only for diagnostics, writer fencing, and drain. It never appears as the durable session route. |
| **Environment** | The file/shell execution context used by Agent tools and the workbench. Canonical bytes belong to the Environment; provider mechanics remain behind Agent/Bash/Sandbox boundaries. |
| **Environment mode** | Agent execution choice—direct, local/bwrap, Vercel Sandbox, or remote-worker. It is independent of embedded/remote Agent Host placement. |
| **Environment placement** | Server-trusted mapping from Workspace scope to the Host-local or network/shared Environment that owns its canonical bytes. Workspace sees no provider value. |
| **Environment placement epoch** | Monotonic writer-fence version for one Workspace placement. Mutating file/exec operations must match the active epoch or fail; it prevents old and new placements writing concurrently during cutover. |
| **Workspace affinity** | Rule that pins all same-Workspace Agents to one Host when bytes are Host-local; cross-Host routing is permitted only for a qualified shared/network Environment. |
| **boring-bash** | Package owning filesystem/shell binding contracts, operations, and routes used by Agent execution. |
| **boring-sandbox** | Package owning provider/isolation contracts and implementations, including the canonical remote-worker provider. |
| **remote-worker** | Existing remote Environment/Sandbox backend. It executes file/shell operations remotely but owns no Agent, Pi session, transcript, or model loop. |
| **Remote Agent Host** | Agent Host reached over the Agent Host protocol. Unlike remote-worker, it owns Agent sessions and model loops. |
| **Embedded Gateway** | Direct in-process adapter used by CLI, playgrounds, and tests. It implements the same semantic Gateway contract without a network hop. |
| **Remote Gateway** | Authenticated client adapter for one remote Agent Host. |
| **Host-trusted plugin** | Existing app/internal plugin allowed to contribute native host front/server/Agent behavior under app-owner trust. |
| **External/runtime plugin** | Existing runtime/generated plugin class with its current sandbox/route restrictions; #905 does not redesign it. |
| **Durable stream** | Agent-Host-owned monotonic session event log supporting offset catch-up and live tail. Workspace is a consumer, never a second producer. |
| **Host egress** | Bounded Host→Workspace request/receipt channel for only delegation and UI commands. Workspace remains policy authority; Hosts cannot call the Agent pool or arbitrary Workspace/plugin RPC directly. |
| **Delegation request** | Idempotent Host egress asking Workspace to authorize and route work from an active source session to a target Agent. Workspace owns lineage/guards/attenuation; target Host owns the child session. |
| **UI-command egress** | Bounded typed Host egress requesting a Workspace UI command; Workspace re-authorizes and invokes the sole `UiBridge.postCommand`, then returns an idempotent receipt. It is not arbitrary remote code/RPC. |
| **Composition root** | Executable app code that chooses concrete Hosts, Gateways, plugins, model credentials, and Environment providers. Seneca, CLI, and playgrounds are composition roots. |
| **Canonical authority** | The sole component allowed to persist or mutate a given state. A UI cache/projection is not canonical authority. |
| **RuntimeBundle** | Existing Agent server structure pairing Workspace, Sandbox, file search, strategies, provisioning, and disposal. It remains implementation evidence/adaptation input, not a Workspace public contract. |

## Decision

Preserve the current Agent, Workspace, plugin, workbench, Pi-session, and
Environment-mode ownership. Do **not** rewrite either package core.

Extract one missing architectural boundary:

> Workspace consumes an Agent-owned `AgentGateway`. Applications decide whether
> the Gateway is embedded or routes to one or more remote Agent Hosts.

Seneca owns its SaaS Agent pool and remote deployment topology. CLI and
`workspace-playground` remain simple all-in-one compositions. One Agent Host may
run multiple Agent types and many sessions; there is no service per Agent or per
plugin.

## Owner decisions from the architecture grill

The owner ratified these decisions after the first #905 draft:

1. **Agent sessions are Agent-owned.** Agent owns native IDs, Pi transcripts,
   status, replay, follow-up, compaction, model-loop, interrupt/stop, rename, and
   delete mechanics. Workspace authorizes, lists, routes, and displays them.
2. **Every product session is Workspace-scoped.** Scope does not transfer
   transcript/session authority to Workspace.
3. **Current workbench ownership is correct.** Agent front owns chat/transcript/
   status/tool cards. Workspace owns the global workbench, file tree, editors,
   viewers, panes, and artifact surface. Workspace composes Agent components; it
   does not iframe remote UI.
4. **Current plugin model is retained.** Internal/host-trusted and external/
   runtime plugin distinctions remain. #905 does not introduce a full-surface
   Agent-definition v2 or migrate plugin manifests.
5. **Agent execution owns Environment mechanics.** `boring-bash` supplies file/
   shell operations and `boring-sandbox` supplies providers. Workspace does not
   directly import or select either.
6. **Agent placement and Environment placement are orthogonal.** An Agent Host
   may be embedded or remote; its Environment mode may be direct, bwrap/local,
   Vercel Sandbox, or remote-worker.
7. **Remote worker is not a remote Agent Host.** The canonical remote-worker
   provider now lives in `@hachej/boring-sandbox/providers/remote-worker`; Bash
   supplies its operation layer. Old Agent-local copies are migration residue.
8. **One shared Host may run all managed Agents.** Dedicated/customer Hosts are
   optional deployment policy, not Agent identity.
9. **Application composition owns topology.** Seneca builds the managed pool;
   CLI and playgrounds compose embedded forms from Agent/Workspace primitives.
10. **Only boundary-required internal consolidation is in scope.** The new Host
    path must have one event/replay authority and one lifecycle owner. General
    Agent/Workspace cleanup is not a #905 objective.

These decisions supersede the first #905 draft's assumptions that one Agent
means one deployment, product-session/Environment-lifecycle authority belongs
in Workspace, and both packages need isolated core rewrites.

## Why these decisions

| Decision | Source-grounded reason | Rejected alternative and why |
| --- | --- | --- |
| Agent Host owns sessions | Native session storage and Pi handles already live in Agent: [`PiSessionStore`](../../../packages/agent/src/server/harness/pi-coding-agent/sessions.ts#L110), harness session construction/map ([`createHarness.ts`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L473-L480)), and Agent chat channels/status ([`harnessPiChatService.ts`](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts#L77-L102)). | A Workspace session database would duplicate IDs/status and create two authorities over existing Pi files. Workspace keeps only authorization and projections. |
| Preserve the workbench split | Workspace already imports Agent chat/session components ([`WorkspaceAgentFront.tsx`](../../../packages/workspace/src/app/front/WorkspaceAgentFront.tsx#L1-L19)) while owning artifact surfaces, panes, and file UI. Agent tool renderers already emit host-open intent rather than owning the workbench ([`toolRenderers.tsx`](../../../packages/agent/src/front/toolRenderers.tsx#L75-L108)). | Moving the workbench into Agent would duplicate file/editor infrastructure and make cross-Agent navigation/review harder. Remote HTML embedding would weaken host trust. |
| Preserve the plugin model | Current authored definitions deliberately keep executable behavior in trusted host/plugin policy ([`agent-definition.ts`](../../../packages/agent/src/shared/agent-definition.ts#L170-L223), [`materializeAgentDirectory.ts`](../../../packages/agent/src/server/agentDefinition/materializeAgentDirectory.ts#L59-L61)). Existing plugins already contribute Pi packages, prompts, skills, tools, bridge handlers, provisioning, and routes ([`defineServerPlugin.ts`](../../../packages/workspace/src/server/plugins/defineServerPlugin.ts#L28-L52)). | A new full-surface `AgentDefinition v2` would turn this boundary extraction into a plugin/platform migration and is not required to host current Agents remotely. |
| Agent owns the Gateway contract | The Gateway exposes Agent catalog/session/control/event behavior, whose implementation and state live in Agent. Workspace currently imports and constructs Agent internals directly ([`createWorkspaceAgentServer.ts`](../../../packages/workspace/src/app/server/createWorkspaceAgentServer.ts#L1-L27), [`createWorkspaceAgentServer.ts`](../../../packages/workspace/src/app/server/createWorkspaceAgentServer.ts#L879-L896)). | A Workspace-owned wire would let the consumer redefine provider semantics. A Seneca-owned canonical wire would make CLI/playground depend on the SaaS app. Agent owns the protocol; Seneca only composes/routes it. |
| Seneca owns the pool | Pool membership, domains, managed deployment, and routing are SaaS policy. CLI already composes Agent and Workspace packages directly rather than needing Core ([`modeApps.ts`](../../../packages/cli/src/server/modeApps.ts#L128-L154)). | Putting the pool in Workspace would make a reusable console package own product deployment policy; putting it in Core would violate identity-only scope. |
| One Host may run many Agents | Existing executable behavior is host/plugin-composed rather than inherently one process per authored definition. A Host catalog can select current compositions without changing plugin semantics. | One service per Agent/plugin creates avoidable microservice deployment, routing, versioning, and inter-Agent complexity. Dedicated Hosts remain an explicit policy option. |
| Agent execution owns Environment mechanics | Agent's current `RuntimeModeAdapter` returns the paired Workspace/Sandbox/file-search/strategy bundle ([`mode.ts`](../../../packages/agent/src/server/runtime/mode.ts#L44-L58), [`mode.ts`](../../../packages/agent/src/server/runtime/mode.ts#L90-L114)). Workspace's direct provider construction is the coupling to remove ([`sandboxRuntimeHost.ts`](../../../packages/workspace/src/app/server/sandboxRuntimeHost.ts#L1-L33)). | Moving Bash/Sandbox into Workspace would expose execution providers to a package whose desired job is workbench/orchestration. |
| Remote worker is an Environment backend | The extracted provider is published by boring-sandbox ([`package.json`](../../../packages/boring-sandbox/package.json#L44-L52)) and documented as a provider split from the worker server ([`providers/README.md`](../../../packages/boring-sandbox/src/providers/README.md#L1-L17)). The old Agent mode creates remote Workspace and Sandbox proxies only ([`remote-worker.ts`](../../../packages/agent/src/server/runtime/modes/remote-worker.ts#L21-L44)). | Treating remote-worker as an Agent Host conflates file/exec transport with Pi/session/model ownership. |
| Use embedded and remote Gateways | `workspace-playground`/CLI need a one-process experience, while Seneca needs failure/scaling isolation. The current Agent playground's backward Workspace adapter import demonstrates that topology is not yet explicit ([`agent-playground`](../../../apps/agent-playground/src/server/index.ts#L7-L16)). | Remote-only would make local use unnecessarily distributed; embedded-only cannot provide a separately managed SaaS execution plane. |
| Add one durable Host stream | Agent already has a transactional idempotent SQLite event-store seam ([`eventStreamStore.ts`](../../../packages/agent/src/server/events/eventStreamStore.ts#L25-L34), [`eventStreamStore.ts`](../../../packages/agent/src/server/events/eventStreamStore.ts#L88-L143)), but also has live/core replay layers. Remote reconnect needs exactly one authority. | Leaving multiple replay owners makes offsets, terminal events, restart recovery, and lost acknowledgements ambiguous. Rewriting all caches is unnecessary; adapt only what the Host boundary requires. |
| Do not rewrite package cores | The desired session, plugin, workbench, Pi, and Environment ownership already exists. The concrete defects are composition and duplicated authority at the new remote boundary. | Full/isolated core rewrites would discard tested behavior to implement ownership the owner explicitly rejected. |

### Current-source map

| Concern | Current source/evidence | Plan use |
| --- | --- | --- |
| Agent composition roots | [`core/createAgent.ts`](../../../packages/agent/src/core/createAgent.ts#L71), [`server/createAgent.ts`](../../../packages/agent/src/server/createAgent.ts#L49), [`createAgentApp.ts`](../../../packages/agent/src/server/createAgentApp.ts#L160), [`registerAgentRoutes.ts`](../../../packages/agent/src/server/registerAgentRoutes.ts#L454) | Wrap behind one Host; do not create another model loop. |
| Competing live/replay state | [`AgentLiveEventBuffer`](../../../packages/agent/src/core/createAgent.ts#L519-L520), [`PiChatReplayBuffer`](../../../packages/agent/src/server/pi-chat/piChatReplayBuffer.ts#L29), service channels ([`harnessPiChatService.ts`](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts#L77-L92)) | Select one Host stream authority; retain compatibility adapters. |
| Native session owner | [`PiSessionStore`](../../../packages/agent/src/server/harness/pi-coding-agent/sessions.ts#L110), Pi session map ([`createHarness.ts`](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L473-L480)) | Agent Host remains canonical. |
| Browser session preference | [`activeSessionStorage.ts`](../../../packages/agent/src/front/chat/session/activeSessionStorage.ts#L16-L42) | Treat active selection as UI state, not durable session authority. |
| Workspace session/workbench composition | [`WorkspaceAgentFront.tsx`](../../../packages/workspace/src/app/front/WorkspaceAgentFront.tsx#L570-L667) | Inject Gateway/session source while retaining pane/pin/layout state. |
| Workspace workbench leaves | [`ArtifactSurfacePane.tsx`](../../../packages/workspace/src/front/chrome/artifact-surface/ArtifactSurfacePane.tsx#L124), [`FileTree.tsx`](../../../packages/workspace/src/plugins/filesystemPlugin/front/file-tree/FileTree.tsx#L23), [`CodeEditor.tsx`](../../../packages/workspace/src/plugins/filesystemPlugin/front/code-editor/CodeEditor.tsx#L36), [`MarkdownEditor.tsx`](../../../packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/MarkdownEditor.tsx#L612) | Preserve; no workbench rewrite. |
| Current artifact routing | Agent open intent ([`toolRenderers.tsx`](../../../packages/agent/src/front/toolRenderers.tsx#L75-L108)); Workspace tool/path mapping ([`useArtifactRouting.ts`](../../../packages/workspace/src/front/hooks/useArtifactRouting.ts#L18-L48)) | Preserve behavior; provenance redesign stays out. |
| Plugin trust/layout | [`PLUGIN_STRUCTURE.md`](../../../packages/workspace/docs/PLUGIN_STRUCTURE.md#L8-L57), [`defineServerPlugin.ts`](../../../packages/workspace/src/server/plugins/defineServerPlugin.ts#L28-L52) | Preserve internal/generated distinction and contribution fields. |
| Environment/runtime pair | [`mode.ts`](../../../packages/agent/src/server/runtime/mode.ts#L44-L58), [`RuntimeBundle`](../../../packages/agent/src/server/runtime/mode.ts#L90-L114) | Keep inside Agent Host adaptation; never expose through Gateway DTOs. |
| Extracted Bash/Sandbox ownership | [`boring-bash/package.json`](../../../packages/boring-bash/package.json#L15-L31), [`boring-sandbox/package.json`](../../../packages/boring-sandbox/package.json#L1-L52) | Consume qualified package surfaces; no provider redesign. |
| Remaining package cycle | Agent depends on Bash/Sandbox ([`agent/package.json`](../../../packages/agent/package.json#L83-L87)); Bash/Sandbox still peer-depend on Agent ([`boring-bash/package.json`](../../../packages/boring-bash/package.json#L41-L50), [`boring-sandbox/package.json`](../../../packages/boring-sandbox/package.json#L67-L75)) and import Agent shared types (for example [`remoteWorkerProtocolV1.ts`](../../../packages/boring-sandbox/src/shared/remoteWorkerProtocolV1.ts#L1-L7)). | #861 is a real prerequisite, not optional cleanup. |
| Current remote-worker residue | [`Agent remote-worker mode`](../../../packages/agent/src/server/runtime/modes/remote-worker.ts#L1-L47), canonical provider docs ([`providers/README.md`](../../../packages/boring-sandbox/src/providers/README.md#L7-L17)) | Compatibility only; owning provider lane controls retirement. |
| Current file placement/cutover risk | Core resolves per-Workspace roots ([`createCoreWorkspaceAgentServer.ts`](../../../packages/core/src/app/server/createCoreWorkspaceAgentServer.ts#L790-L804)); Vercel mode stores actual files under provider `/workspace`, not the host anchor ([`full-app README`](../../../apps/full-app/README.md#L138-L152)); remote-worker launch guidance requires quiesced copy and reverse-copy/read-only rollback ([`REMOTE_BWRAP_WORKER_LAUNCH_PLAN.md`](../../../apps/full-app/docs/REMOTE_BWRAP_WORKER_LAUNCH_PLAN.md#L289-L308)). | Hosted cutover must migrate/rebind Environment state as well as Pi transcripts; config rollback alone is unsafe. |
| Current CLI coupling | [`modeApps.ts`](../../../packages/cli/src/server/modeApps.ts#L128-L154), [`modeApps.ts`](../../../packages/cli/src/server/modeApps.ts#L471-L481) | Replace implicit cross-package construction with explicit embedded composition. |

## Status and authority

This plan does not authorize implementation.

- #391 remains product/release authority.
- #805 and Decision 28 remain implementation authority until atomically amended.
- PR #904 is reviewed input but encodes the superseded Workspace-owned
  Environment/session direction; it must be reconciled rather than silently
  merged as authority for this plan.
- #807 keeps broader channel/A2A ownership; #905 consumes only the remote Agent
  durable-stream spine.
- #808 and the Bash/Sandbox lanes retain provider and remote-worker ownership;
  #861 must remove the remaining Agent↔Bash/Sandbox package back-edges before
  the target graph can qualify.
- #820 retains credential-topology ownership.
- No implementation Beads are created before owner approval, the authority
  amendment, `br dep cycles`, and `bv --robot-insights`.

The amendment must update Decision 28, #391, #805's normative plan, the affected
issue #807/#808/#820/#861 references, standing coding/package invariants, the Workspace
contract, and every conflicting Bead in one reviewed change. It must not create
an independently dispatchable second DAG.

### Review status

Six earlier reviews converged on the superseded rewrite plan; the owner grill
invalidated their ownership premise, so they do not count as approval here. This
from-scratch Host/Gateway plan then completed eight fresh code-ground rounds:

| Round | Reviewer | Result | Material disposition |
| --- | --- | --- | --- |
| HG-R1 | Claude Opus high | NOT READY | Added bounded file/UI surfaces, Workspace affinity/shared-backend rule, stable Host identity, signed scope-grant model, and L0→A0 ordering. |
| HG-R2 | Codex xhigh | NOT READY | Made public Gateway host-neutral with post-route grants/list aggregation; added remote model access/#820 gate, remote plugin parity, #861 prerequisite, and Pi/stream reconciliation decision. |
| HG-R3 | Claude Opus high | **READY** | Verified prior corrections and all source citations; no P0/P1. |
| HG-R4 | Codex xhigh | NOT READY | Added bounded delegation egress, durable UI receipt authority, corrected file grant order, total pagination order, and explicit H0/ready-for-human gate. |
| HG-R5 | Claude Opus high | **READY** | Verified all HG-R4 corrections; no P0/P1. |
| HG-R6 | Codex xhigh | NOT READY | Added canonical Environment/file placement migration and reverse rollback beside transcript cutover. |
| HG-R7 | Claude Opus high | **READY** | Verified unified transcript+Environment fenced cohort and source grounding; no P0/P1. |
| HG-R8 | Codex xhigh | **READY** | Final independent steady-state pass; no P0/P1. |

The plan is at two consecutive independent READY rounds with no remaining P0/P1
against the owner-approved architecture. Raw local outputs are retained under
`/tmp/905-host-gateway-review-r*-*.md` for this planning session; accepted
architecture and dispositions are durable in this file.

## Why this is a boundary extraction, not a rewrite

### Evidence that remains material

- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` directly
  imports Agent creation/provisioning and Sandbox adapters, making Workspace the
  topology owner.
- `apps/agent-playground/src/server/index.ts` imports Workspace runtime adapters,
  creating the reverse dependency.
- Agent construction is split across `createAgentApp`, `registerAgentRoutes`,
  `createAgent`, `HarnessPiChatService`, the Pi harness, and runtime modes.
- Agent currently has competing replay/session/lifecycle layers. A remote Host
  cannot expose two authoritative streams or two terminal owners.
- No multi-Agent Host protocol or location-transparent Gateway exists.
- Core and CLI still share accidental source/build/composition assumptions.

### Evidence that rejects a rewrite

- Agent already owns Pi sessions, transcripts, model loops, runtime modes, and
  plugin tool composition—the desired ownership.
- Workspace already owns the workbench, editors, file tree, viewers, layout, and
  artifact surface—the desired ownership.
- `WorkspaceAgentFront` already composes Agent chat components into Workspace.
- Existing internal/external plugin structure and trust behavior are retained.
- Pi JSONL compatibility, chat reducers, reconnect behavior, lifecycle tests,
  WorkspaceBridge security, plugin capture, file OCC/watch behavior, and all UI
  leaves are valuable production assets.
- The previously proposed Workspace fleet/default/session/governance/
  Environment bounded context is no longer the destination.

### Updated disposition

| Area | Retain | Change |
| --- | --- | --- |
| Agent package | Pi, sessions, plugins, tools, Environment modes, front, protocols | Add Host/Gateway; consolidate only conflicting replay/lifecycle authority |
| Workspace package | Workbench, plugins, bridge, file UX, Agent-front composition | Receive an injected Gateway; stop constructing Agent/Sandbox topology |
| Seneca | Core/Workspace product composition | Add managed pool/router and remote Host deployment entrypoint |
| CLI | Local Workspace and current runtime behavior | Compose embedded Host/Gateway without Core/Seneca |
| Bash/Sandbox | Extracted operations/providers, remote-worker | Consume qualified exports; no redesign in #905 |

## Canonical model

### Product/package ownership

| Owner | Owns | Must not own |
| --- | --- | --- |
| Seneca/app | SaaS domains/products, trusted Agent catalog, pool/router, deployment topology, concrete Gateway/provider/model configuration | generic Core identity internals, Workspace UI internals, Agent/Pi implementation |
| Core | identity, authentication, membership/account boundary | Agent pool, Agent selection, sessions, Pi, providers |
| Workspace | global workbench, Workspace/project context, authorization adapters, Agent/session navigation, inter-Agent orchestration, Gateway consumption | canonical Agent session/transcript, Pi/model loop, Bash/Sandbox/provider selection |
| Agent | Host/Gateway contract and generic adapters, Agent catalog/runtime, Pi sessions/status/events, plugin runtime contributions, Environment mechanics | Core membership decisions, Seneca domain/product policy, Workspace UI implementation |
| boring-bash | filesystem/shell bindings, routes, operations | identity, Agent pool, Workspace UI |
| boring-sandbox | provider/isolation lifecycle including canonical remote-worker provider | Pi sessions, Agent pool, Workspace UI |
| CLI | trusted-local all-in-one composition | Core/Seneca emulation or a second Agent implementation |

## Agent composition and plugins

Issue #905 preserves the current model. The authored materializer explicitly states
that definitions carry identity/instructions while trusted host/plugins select
executable behavior ([source](../../../packages/agent/src/server/agentDefinition/materializeAgentDirectory.ts#L59-L61)); the current server plugin shape already carries the executable contribution fields ([source](../../../packages/workspace/src/server/plugins/defineServerPlugin.ts#L28-L52)).

```text
Agent
├─ AuthoredAgentSourceV1 identity/instructions
├─ trusted host/plugin selection
├─ tools, skills, Pi extensions, MCP resources
├─ current Workspace front/server plugin contributions
└─ current Environment mode and provisioning
```

The current declarative authored definition remains intentionally safe and
minimal. Trusted host/plugin policy continues to select executable behavior.
Issue #905 does not add `toolRefs`, arbitrary executable paths, raw URLs, secrets, or a
new `AgentRelease` schema.

Internal/host-trusted plugins may continue contributing native front/server/
Runtime behavior. External/runtime plugins keep their existing sandbox and
route restrictions. When Seneca separates the Agent Host, app composition may
select the runtime-relevant fields from the current plugin object while keeping
front/backend fields in the control application; this is composition, not a
plugin-schema migration.

No arbitrary plugin, browser, tenant, or model input may register a Host endpoint
or expand the trusted Agent catalog.

### Boundary-required remote plugin composition

Remote hosting cannot assume that Workspace and Agent Host share local plugin
paths. Current discovery stores local `frontPath`/`serverPath` and rescans local
roots ([`manager.ts`](../../../packages/workspace/src/server/agentPlugins/manager.ts#L222-L244)); the browser transform resolves local roots or captured snapshot bytes
([`pluginFrontRuntime.ts`](../../../packages/cli/src/server/pluginFrontRuntime.ts#L1513-L1531)). The target preserves behavior without sending executable functions over the Gateway:

- Seneca derives one app-owned `AgentCompositionDeclaration` from the **current**
  plugin objects: exact plugin ID/version/integrity plus selected Agent type. It
  is deployment configuration, not a new author-facing manifest.
- App/internal package plugins are installed in both artifacts where needed.
  Workspace/control loads their existing front/server fields; Agent Host resolves
  their existing Runtime/tool/Pi fields locally from the same pinned package.
  Host handshake reports a composition digest and admission fails on app/Host
  mismatch. Function code is never serialized across the wire.
- Generated/runtime plugin Pi/tool resources remain Environment/Host-side. Host
  captures an immutable revision/digest and exposes only a bounded read-only
  plugin-asset sub-gateway (manifest plus captured front bytes). The existing
  control-plane transform/validation pipeline consumes those bytes without
  requiring the Host's local root.
- `/reload` produces one Host snapshot revision; Workspace commits the matching
  front revision only after validation. Failed Host/front refresh keeps the
  previous coherent revision and reports drift.
- Normative generated plugins remain route-free as documented
  ([`PLUGIN_STRUCTURE.md`](../../../packages/workspace/docs/PLUGIN_STRUCTURE.md#L8-L28)). Current code can dynamically import an external `serverPath`
  ([`runtimeBackendRegistry.ts`](../../../packages/workspace/src/server/runtimeBackend/runtimeBackendRegistry.ts#L226-L263)); L0 must inventory real consumers. A remote cutover with such a consumer stops and requires promotion to an app/internal trusted plugin or a separate owner-approved contract. #905 does not smuggle arbitrary backend routes through the Agent Host protocol.

This is a deployment/parity adapter around the current model, not a plugin schema
migration. It is required before claiming that current plugin behavior survives
a remote Host.

## Workbench and frontend

Retain today's high-level composition. `WorkspaceAgentFront` already imports
`PiChatPanel`/session hooks from Agent while mounting Workspace layout/surfaces
([source](../../../packages/workspace/src/app/front/WorkspaceAgentFront.tsx#L1-L40)); Agent tool paths already call a host-provided artifact opener
([source](../../../packages/agent/src/front/toolRenderers.tsx#L75-L108)).

```tsx
<WorkspaceWorkbench>
  <WorkspaceFileTree />
  <AgentChat />
  <WorkspaceArtifactSurface />
</WorkspaceWorkbench>
```

- `@hachej/boring-agent/front` keeps chat, transcript, session status/actions,
  tool cards, and artifact-open intent.
- `@hachej/boring-workspace` keeps workbench/layout/panes, file tree, editors,
  viewers, generic artifact surfaces, and project-wide navigation.
- Workspace renders local published components; it never loads arbitrary remote
  Host HTML/JavaScript.
- Existing artifact path/tool behavior remains compatible. Canonical artifact
  provenance/blob redesign stays with #806 or a later issue.

`WorkspaceAgentFront.tsx` may be decomposed only where required to inject the
Gateway/session source. General visual/layout refactoring is out of scope.

## Gateway ownership

Ownership is intentionally split by layer:

1. **Agent owns the service contract and generic adapters.** Canonical DTOs,
   `AgentHostProtocol`, `AgentGateway`, embedded adapter, remote client, and Host
   server live in `@hachej/boring-agent`.
2. **Workspace owns only its consumer adapter/use cases.** It accepts an injected
   structural/type-only Gateway and projects sessions/status into the workbench.
   It does not implement routing or import Agent server values.
3. **Seneca owns pool composition.** `SenecaPoolAgentGateway` maps trusted Agent
   types/session refs to managed or dedicated Hosts and implements the canonical
   Agent-owned contract.

This avoids both provider-driven Workspace policy and a Workspace-defined remote
Agent wire.

### Canonical contracts

```ts
interface AgentGateway {
  describe(): Promise<AgentGatewayDescription>
  listAgents(input: AuthorizedAgentScope): Promise<AgentSummary[]>
  listSessions(input: AuthorizedAgentSessionQuery): Promise<AgentSessionPage>
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef>
  connectSession(input: ConnectAgentSessionInput): Promise<AgentSessionConnection>
  renameSession(input: RenameAgentSessionInput): Promise<AgentSessionSummary>
  deleteSession(input: DeleteAgentSessionInput): Promise<void>
  readonly files: AgentWorkspaceFilesGateway
  readonly pluginAssets: AgentPluginAssetGateway
  close(): Promise<void>
}

interface AgentPluginAssetGateway {
  getSnapshot(input: AuthorizedPluginSnapshotRead): Promise<PluginSnapshot>
  readAsset(input: AuthorizedPluginAssetRead): Promise<PluginAssetBytes>
}

interface AgentWorkspaceFilesGateway {
  list(input: AuthorizedScopedFileList): Promise<FileListResult>
  read(input: AuthorizedScopedFileRead): Promise<FileReadResult>
  readBinary(input: AuthorizedScopedBinaryRead): Promise<BinaryReadResult>
  stat(input: AuthorizedScopedFileStat): Promise<FileStatResult>
  write(input: AuthorizedIdempotentFileWrite): Promise<FileWriteResult>
  move(input: AuthorizedIdempotentFileMove): Promise<FileMoveResult>
  delete(input: AuthorizedIdempotentFileDelete): Promise<void>
  mkdir(input: AuthorizedIdempotentMkdir): Promise<void>
  search(input: AuthorizedScopedFileSearch): Promise<FileSearchResult>
  watch(input: AuthorizedScopedFileWatch): AsyncIterable<FileWatchEvent>
}

interface AgentSessionRef {
  readonly hostId: string // stable logical deployment/pool slot, never a URL/process id
  readonly agentTypeId: string
  readonly sessionId: string
}

interface AgentSessionConnection {
  readonly ref: AgentSessionRef
  readonly events: AsyncIterable<AgentSessionEvent>
  send(input: IdempotentAgentSend): Promise<void>
  interrupt(input: IdempotentAgentControl): Promise<void>
  stop(input: IdempotentAgentControl): Promise<void>
  acknowledgeUiCommand(input: IdempotentUiCommandReceipt): Promise<void>
  acknowledgeDelegation(input: IdempotentDelegationReceipt): Promise<void>
  close(): Promise<void> // unsubscribe, never implicit stop
}
```

`AuthorizedAgentScope` and the other public Gateway inputs are host-neutral,
non-serializable app-authorized values. They identify Workspace scope and the
permitted use case but contain no Host audience, endpoint, signing key, or wire
token. The Seneca pool selects/fans out to Hosts first; only then does its
injected `HostScopeGrantIssuer` mint one per-Host/per-command wire grant.

`listSessions` returns a stable page in the total order `updatedAt DESC,
hostId ASC, agentTypeId ASC, sessionId ASC` under a cursor snapshot watermark.
The merge cursor encodes that exact tuple. Sessions changing after the
watermark appear on the next refresh rather than moving across the active page.
Seneca's composite cursor carries that watermark, an opaque per-Host cursor map,
and catalog revision. It deduplicates by stable session ref and returns explicit
`partialFailures[{hostId, code}]`; it never silently presents a partial list as
complete. A catalog-revision mismatch restarts from a documented page boundary
rather than skipping rows.

The file sub-gateway is member-safe and bounded; it deliberately exposes no raw
root, provider, Sandbox, worker URL, arbitrary RPC, or member `exec`. Existing
Bash route/path/OCC semantics remain the implementation and conformance oracle.
It makes a Host-local direct/bwrap Environment reachable to the control-plane
workbench through the same embedded/remote abstraction.

The Host's only reverse control surface is a bounded egress handler:

```ts
interface AgentHostEgressHandler {
  requestUiCommand(input: AgentUiCommandRequest): Promise<UiCommandReceipt>
  requestDelegation(input: AgentDelegationRequest): Promise<DelegationReceipt>
}
```

Agent session events carry durable egress requests with request/command ID,
request digest, Workspace scope, active origin session/Agent/turn, bounded
payload, and deadline. Workspace re-authorizes every request. Hosts never call
the Seneca pool, Core, arbitrary Workspace/plugin routes, or another Host
directly. The existing `WorkspaceAgentDispatcher` only binds send/control to one
Agent ([shared contract](../../../packages/agent/src/shared/workspaceAgentDispatcher.ts#L1-L14), [server adapter](../../../packages/agent/src/server/workspaceAgentDispatcher.ts#L32-L47)); it is evidence, not the missing cross-Agent egress.

For delegation, Workspace verifies the live source, target allowlist, lineage,
depth/cycle/fan-out/timeout/cancellation and Environment attenuation, persists an
idempotent delegation admission, then invokes its injected host-neutral
`AgentGateway` to create/run the child. The target Host owns the child session;
Workspace owns only orchestration/receipt state. Lost receipts retry the same
request ID/digest and cannot create a second child.

For UI commands, the Workspace consumer adapter owns focused
`WorkspaceUiCommandReceiptStore` and `WorkspaceDelegationReceiptStore` ports;
Seneca supplies durable adapters and CLI supplies local adapters. UI admission
for `(workspaceScope, commandId, requestDigest)` is persisted **before** the
single existing `UiBridge.postCommand` call. Same-digest retry returns the stored
receipt, a conflicting digest fails, and a crash after dispatch but before
completion records `UI_COMMAND_OUTCOME_UNKNOWN` and never redispatches silently.
This wrapper is required because current `UiCommand` has no command ID and the
in-memory bridge allocates a fresh sequence for every call
([contract](../../../packages/workspace/src/shared/ui-bridge.ts#L3-L34), [implementation](../../../packages/workspace/src/server/bridge/createInMemoryBridge.ts#L25-L33)). The protocol cannot invoke arbitrary Workspace/plugin routes.

### Workspace scope grants

A remote `WorkspaceScopeGrant` is minted only **after** the Gateway/pool chooses a
Host. The Seneca control-plane issuer (or an app-injected issuer for a direct
`RemoteAgentGateway`) owns minting; grants are never accepted from browser/
tenant/plugin input. It binds:

```ts
interface WorkspaceScopeGrantClaims {
  readonly issuer: string
  readonly audienceHostId: string
  readonly workspaceScopeId: string
  readonly allowedAgentTypeIds: readonly string[]
  readonly allowedOperations: readonly AgentGatewayOperation[]
  readonly commandId?: string
  readonly requestDigest?: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly nonce: string
  readonly signingKeyId: string
}
```

Remote transport authentication (mTLS or equivalent service identity) and the
signed grant are both required. Every discrete send/control/file mutation gets
a fresh grant after routing. Event and file-watch subscriptions use an
admission grant to create a bounded stream lease; the remote adapter renews the
lease with a freshly minted grant before expiry, and expiry/failed renewal closes
the stream so reconnect must re-authorize. Mutating grants bind command ID + canonical
request digest; Host admission persists the nonce/command receipt before effect.
Same-digest retry returns the recorded/in-flight outcome, conflicting digest
fails, and unknown effect outcome is never silently repeated. Grants are
short-lived, audience-bound, redacted from logs/transcripts, and verified against
a rotating Host key set with an explicit overlap/revocation window. Stable errors
include `AGENT_SCOPE_INVALID`, `AGENT_SCOPE_EXPIRED`, `AGENT_SCOPE_REPLAY`, and
`AGENT_SCOPE_OPERATION_DENIED`. Embedded CLI uses a non-serializable trusted-local
grant adapter with the same operation/scope semantics.

The Host does not evaluate Core membership; it verifies the control-plane grant
and then compares the stored Workspace scope for every existing-session/file
operation. Host endpoints/trust material never come from a browser payload.

`createSession` uses a caller-generated request ID bound into the grant. Lost
acknowledgement returns the same native session and cannot create a second
transcript/model call.

### Stable Host routing

`hostId` is a stable logical deployment/pool-slot ID across process and revision
replacement. `hostInstanceId` is ephemeral and appears only in health,
diagnostics, fencing, and drain receipts. Seneca resolves the current live
connector from `hostId` on every connect; it never treats a stale process URL as
the session route. A remount/rolling replacement preserves `hostId`. Moving a
session to a different logical Host requires an explicit fenced migration and
atomic pool alias/routing update, not silent ref rewriting.

### Remote model access

Current #820 is explicitly an in-process host credential seam and forbids an
AgentHost ([current design](../820/plan.md#L25-L40), [stop condition](../820/plan.md#L102-L105)). A0 must amend it before remote Host dispatch.

For Seneca BYOK, the control plane retains raw-key custody. It issues a
`ModelAccessGrant` bound to `hostId`, Workspace scope, `agentTypeId`, session,
invocation, provider/model allowlist, token/cost limits, expiry, nonce, and key
ID. The remote Host's injected `ModelClient` uses authenticated service transport
plus this grant against a bounded Seneca model proxy; raw BYOK never enters the
Agent Host, Gateway DTOs, event stream, transcript, Environment, tool process, or
logs. Every provider call has a durable model-call ID/digest/receipt so lost
acknowledgement cannot bill twice. Rotation/revocation affects the next call and
two Workspace canaries cannot cross.

Seneca's explicit instance-key fallback may be injected into its managed Host at
process creation under Decision 27; CLI embedded mode keeps its local resolver;
an explicitly self-hosted Host may use operator-owned credentials. None of those
paths gives Workspace package code credential custody.

### Gateway implementations

| Implementation | Owner | Purpose |
| --- | --- | --- |
| `EmbeddedAgentGateway` | Agent package | Direct calls to an in-process Host for CLI/playground/tests |
| `RemoteAgentGateway` | Agent package | Authenticated protocol client for one remote Host |
| `SenecaPoolAgentGateway` | Seneca | Trusted router/aggregator over managed/dedicated Hosts |
| Workspace projection adapter | Workspace | Converts Gateway DTO/events into current UI/session props |

## Agent Host

Permanent new boundary. It wraps the existing Agent roots—core bridge
([source](../../../packages/agent/src/core/createAgent.ts#L71)), server bridge
([source](../../../packages/agent/src/server/createAgent.ts#L49)), app factory
([source](../../../packages/agent/src/server/createAgentApp.ts#L160)), and route
factory ([source](../../../packages/agent/src/server/registerAgentRoutes.ts#L454))—rather than copying them into a new semantic core.

```text
packages/agent/src/server/agent-host/
  AgentHost.ts
  AgentCatalog.ts
  AgentSessionService.ts
  EmbeddedAgentGateway.ts
  protocol/
  streaming/
  testing/
```

The Host is an adapter around proven Agent/Pi/runtime behavior, not a second
model loop or wholesale core replacement.

```ts
interface AgentHost {
  readonly hostId: string
  readonly hostInstanceId: string
  describe(): Promise<AgentHostDescription>
  listAgents(scope: VerifiedWorkspaceScope): Promise<AgentSummary[]>
  listSessions(scope: VerifiedWorkspaceScope): Promise<AgentSessionPage>
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef>
  connectSession(input: ConnectAgentSessionInput): Promise<AgentSessionConnection>
  renameSession(input: RenameAgentSessionInput): Promise<AgentSessionSummary>
  deleteSession(input: DeleteAgentSessionInput): Promise<void>
  readonly files: AgentWorkspaceFilesGateway
  readonly pluginAssets: AgentPluginAssetGateway
  drain(): Promise<void>
  close(): Promise<void>
}
```

One Host may load multiple trusted Agent definitions/plugin compositions. Agent
instances are actor-neutral; user/workspace/model/session state enters per
operation and is never captured from the first caller.

## Session ownership

Agent Host is the sole canonical session authority. This follows the current
`PiSessionStore` and Pi-session map ownership
([store](../../../packages/agent/src/server/harness/pi-coding-agent/sessions.ts#L110), [map](../../../packages/agent/src/server/harness/pi-coding-agent/createHarness.ts#L473-L480)); browser active-session persistence remains only a preference
([source](../../../packages/agent/src/front/chat/session/activeSessionStorage.ts#L16-L42)).

It owns:

- native session allocation and stable ID;
- Workspace-scope metadata stored beside/with the session;
- Pi JSONL, replay, compaction, title, rename, and delete;
- running/idle/completed/failed/needs-input status;
- follow-up, interrupt, stop, model loop, and terminal event;
- durable event offsets and session artifact/tool-output feed.

Workspace owns no second session record. It may cache non-authoritative list
rows/status/cursors for UI responsiveness. A Host outage may show cached
`unavailable`, but Workspace cannot invent transcript/status changes.

Every operation checks the requested Workspace scope against the Host's stored
opaque scope. Cross-Workspace session lookup fails closed. Browser-only draft and
active-tab preference remain browser UI state, not session authority.

## Durable session events

Remote hosting requires one durable replay authority. Agent Host owns it. The
current transactional/idempotent `EventStreamStore` is adaptation evidence
([contract](../../../packages/agent/src/server/events/eventStreamStore.ts#L25-L34), [SQLite implementation](../../../packages/agent/src/server/events/eventStreamStore.ts#L88-L143)); `AgentLiveEventBuffer`, `PiChatReplayBuffer`, and service channels prove why the new Host path cannot leave several canonical replay owners
([core buffer](../../../packages/agent/src/core/createAgent.ts#L519-L520), [Pi buffer](../../../packages/agent/src/server/pi-chat/piChatReplayBuffer.ts#L29), [channels](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts#L77-L92)).

- depend on `@durable-streams/client` for offset/catch-up/live-tail semantics;
- choose a production server/store adapter by evidence and conformance;
- do not depend on `@flue/runtime`;
- do not use the development/prototype `@durable-streams/server` directly as the
  production authority without a separate qualification decision;
- append events/status/terminal idempotently with monotonic offsets;
- preserve existing Pi/chat event schemas through an anti-corruption mapper;
- browser/Workspace disconnect only unsubscribes;
- reconnect catches up then tails live;
- Agent Host alone emits the terminal session event after its tool/Environment
  cleanup;
- Workspace never writes a second event journal or finalizes the Agent session.

### Transcript, command-receipt, and event consistency

Current Pi events are appended to the event store after native session activity
([publish path](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts#L575-L609)), while restart sequence is read from the event-store tail
([channel recovery](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts#L752-L760)); SQLite transactions cover only event tables. DS1 must therefore select and prove one explicit cross-store strategy before DS2:

1. an atomic/write-ahead outbox integrated at a supported Pi persistence seam; or
2. deterministic Pi-transcript-to-stream reconciliation at stable native
   turn/message checkpoints.

Whichever strategy wins must satisfy:

- durable command admission/receipt precedes model effect and unknown outcome is
  never automatically re-dispatched;
- each native turn/message checkpoint maps to an idempotent stream key;
- token deltas may be replay-only/transient, but `turn-committed` and successful
  terminal events are appended only after the matching transcript checkpoint is
  durably readable;
- startup compares command receipts, Pi transcript checkpoints, and stream tail,
  appends any missing stable projection exactly once, and emits an explicit
  interrupted/unknown terminal when safe reconciliation is impossible;
- a stream event ahead of a durable transcript checkpoint can never masquerade
  as committed transcript state;
- fault injection covers death before/after command receipt, Pi mutation,
  transcript flush, event append, terminal append, and acknowledgement.

Boundary-required consolidation means the new Host path chooses one of the
current replay paths as source and adapts the other as compatibility input. It
does not launch a general cleanup of every Agent cache/lifecycle object.

Broader channel ingress, Slack, public A2A, webhook, and marketplace work remain
in #807/#809.

## Environment execution

Agent execution composes existing primitives. The current Agent
`RuntimeModeAdapter` already returns the Workspace/Sandbox/file-search strategy
bundle ([source](../../../packages/agent/src/server/runtime/mode.ts#L44-L58), [bundle](../../../packages/agent/src/server/runtime/mode.ts#L90-L114)). The provider package explicitly documents direct, local/bwrap, Vercel, and remote-worker modes
([source](../../../packages/boring-sandbox/src/providers/README.md#L7-L17)).

```text
Agent Runtime/tool
  → boring-bash operation
  → boring-sandbox provider
  → direct | bwrap | Vercel Sandbox | remote-worker
```

Workspace does not import these provider values. Application/Agent Host
composition selects the mode and injects it into existing runtime construction.

The two independent axes are:

| Agent Host placement | Environment placement | Workbench reachability |
| --- | --- | --- |
| embedded | direct/local/bwrap/Vercel/remote-worker | `EmbeddedAgentGateway.files` calls the same bound operations directly |
| remote Host | direct/local/bwrap/Vercel/remote-worker | `RemoteAgentGateway.files` carries bounded member file operations over the authenticated Host protocol |

Orthogonal means every cell has one semantic Gateway contract; it does **not**
mean two Host-local Environments on different machines magically share bytes.

The canonical remote-worker provider is
`@hachej/boring-sandbox/providers/remote-worker`. `boring-bash` provides the
file/shell operation layer. Existing Agent-local remote-worker code remains only
as a compatibility adapter until its owning Bash/Sandbox migration lane and H2c
approve contraction.

Workspace file-tree/editor requests continue through existing high-level routes
adapted to `AgentGateway.files`. Embedded composition calls the current Bash
operations directly; remote composition transports the bounded DTOs to the Host
that owns the Environment placement. Workspace never receives raw roots,
`Sandbox`, provider handles, worker URLs, or reusable worker credentials.

### Environment placement and Workspace affinity

Seneca's pool records one opaque Environment placement per Workspace scope; it
does not expose the provider to Workspace:

- **Host-local modes** (`direct`/local/bwrap with local bytes): all sessions and
  delegated Agent types for that Workspace are pinned to one stable `hostId`.
  The default managed Host loads all managed Agent types, so inter-Agent work
  stays on the same canonical bytes.
- **Network/shared modes** (remote-worker, Vercel/shared provider, or a qualified
  shared mount): sessions may run on different Hosts only when every Host resolves
  the same canonical Environment placement/binding.
- A dedicated/customer Host may join a shared-Workspace delegation only through
  a qualified shared/network backend. Otherwise admission fails with
  `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE`; copying files is not a fallback.
- File Gateway routing follows the Environment placement, while session Gateway
  routing follows the stable session `hostId`. Both are server-trusted mappings.

Workspace chooses neither provider nor physical Host. It supplies authorized
scope and orchestration intent; Seneca/app pool policy and Agent Host execution
resolve the placement.

## Deployment topologies

### Workspace playground reference

```text
one process
├─ Workspace server/workbench
├─ EmbeddedAgentGateway
├─ AgentHost with one or more Agents
└─ direct/local Environment mode
```

`workspace-playground` proves the default package-consumer experience. It is not
required to run local microservices. Its current app already mounts
`WorkspaceAgentFront` and Workspace file components from package exports
([source](../../../apps/workspace-playground/src/front/App.tsx#L1-L6)); the new proof changes composition, not product UI.

### CLI

```text
one CLI process
├─ trusted-local Workspace adapter
├─ EmbeddedAgentGateway
├─ AgentHost
└─ direct or bwrap Environment mode
```

CLI does not import/emulate Core or Seneca. An explicit remote Gateway may be
added later/configured, but embedded is the default. Current dynamic imports of
both Agent and Workspace composition plus Workspace-owned Sandbox adapter
selection show the boundary to replace
([source](../../../packages/cli/src/server/modeApps.ts#L128-L154), [source](../../../packages/cli/src/server/modeApps.ts#L471-L481)).

### Seneca SaaS

```text
Seneca control deployment
├─ Core
├─ Workspace
└─ SenecaPoolAgentGateway
       │ authenticated AgentHostProtocol
       ▼
managed Agent Host deployment
├─ multiple Agent types
├─ many Workspace-scoped sessions
├─ Pi/session durable storage
└─ selected Environment mode
```

The first release must prove the real Seneca control application against a
separate managed Host; a synthetic server alone is insufficient. This is an
application-level proof because the current repository has no production
multi-Agent Host/Gateway symbol; the existing Workspace factory instead creates
one Agent app directly ([source](../../../packages/workspace/src/app/server/createWorkspaceAgentServer.ts#L879-L896)). The managed
Host is same-region/private-network by default. Dedicated/customer Hosts remain
optional trusted pool entries.

Seneca owns pool membership, Agent-to-Host routing, revision rollout, and model
credential composition. Workspace sees one Gateway and no endpoint registry.

## Multi-Agent orchestration

Workspace owns the product-level orchestration use case; Seneca's Gateway owns
Host routing; Agent Hosts own each session.

1. Workspace authorizes the source user/Workspace and target Agent intent.
2. Workspace applies bounded delegation policy (target allowlist, cycle/depth/
   fan-out/timeout/cancel rules).
3. The injected Gateway applies the Workspace-affinity rule: host-local
   Environments route the target Agent to the same stable Host; cross-Host
   routing requires a qualified shared/network Environment.
4. The selected Host creates/uses a target Agent-owned session under the same
   opaque Workspace scope.
5. Both Agents use authorized views of the same canonical Environment placement;
   admission fails rather than copying or silently forking files.
6. Each Host emits its own session status/events. Typed UI-command requests are
   re-authorized and dispatched through Workspace's sole `UiBridge.postCommand`.
7. Workspace projects lineage and orchestrates cancellation without owning
   either transcript or Environment provider.

Issue #905 reuses the existing managed-delegation behavior/tests and avoids creating a
second dispatcher/model loop.

## Package/import boundary

```text
Seneca executable roots
  → Core + Workspace + Agent Gateway clients + Seneca pool composition

CLI/workspace-playground executable roots
  → Workspace + Agent Embedded Gateway + selected Agent Environment mode

Workspace package
  → type-only/narrow AgentGateway consumer contract
  → no boring-bash/boring-sandbox/provider values

Agent server
  → Agent Host + Pi + current plugins + boring-bash + boring-sandbox

boring-bash
  → operation/binding contracts

boring-sandbox
  → provider/isolation implementations
```

Rules:

- Workspace base front/shared keeps zero value imports from Agent.
- Workspace app/server no longer selects Sandbox providers or constructs Agent
  internals in the target path.
- Agent shared/Gateway DTOs contain no Fastify, Pi SDK, React, Node path, root,
  provider, or reusable credential values.
- Only executable composition roots choose embedded/remote Host placement and
  Environment providers.
- Agent application/Pi code never evaluates Core membership or Seneca domains.
- Stable errors exist for every protocol rejection.

## End-to-end flows

### Embedded create/send

1. CLI/playground constructs one AgentHost from current Agent definitions/plugins
   and the selected Environment mode.
2. App injects `EmbeddedAgentGateway` into Workspace composition.
3. Workspace authorizes a Workspace scope and asks Gateway to create a session.
4. Host idempotently creates one native Pi session and stores scope metadata.
5. Workspace connects; Agent front consumes the current session/event model.
6. Host runs model/tools, owns terminal status, and persists the transcript.

### Remote create/send

1. Core authenticates; Workspace authorizes the operation.
2. Seneca pool Gateway selects a trusted stable `hostId` for `agentTypeId` and
   the Workspace Environment-affinity rule.
3. Control-plane issuer signs a short-lived Host-audience/operation/command/
   digest-bound Workspace scope grant; remote client sends it with the
   idempotent create/send command over authenticated service transport.
4. Host verifies protocol/revision/service identity/grant/nonce, creates or reuses the native session,
   and returns an opaque `AgentSessionRef`.
5. Host appends durable events; Workspace/browser catches up and tails.
6. Tool calls use Host-selected Bash/Sandbox mode, including remote-worker if
   configured.
7. Disconnect unsubscribes only. Interrupt/stop requires an explicit idempotent
   control command.

### Workspace file operation

1. File tree/editor calls the existing high-level member file API.
2. App composition authorizes Workspace membership and creates only a
   host-neutral `AuthorizedScopedFile*` value—no Host audience/wire token.
3. The route adapter calls `AgentGateway.files`; Seneca pool resolves the
   server-trusted Environment-owning Host/placement.
4. Only after routing, the pool issuer mints the audience/operation/command/
   digest-bound Host-wire grant; embedded calls the verified operation directly
   and remote sends the bounded operation plus grant to that Host.
5. Agent/Bash adapter validates the relative operation and idempotency/OCC at
   the existing path boundary; selected Sandbox provider executes locally or
   through remote-worker.
6. Existing binary, watch/invalidation, stable-error, and cancellation behavior
   returns through the same Gateway contract.

## Behavior/conformance ledger

### Retain as executable specification

- authored Agent compiler/materializer trust tests;
- current internal/external plugin and reload tests;
- Pi native/wrapper/legacy JSONL readability;
- one session/channel under concurrent cold callers;
- prompt/follow-up/interrupt/stop and queue semantics;
- model selection, metering, resource reload, and credential redaction;
- chat reducer, sequence-gap, replay/reconnect, optimistic follow-up, and unload;
- runtime binding drain/socket/provider disposal races;
- WorkspaceBridge auth/schema/size/idempotency/redaction;
- file confinement, binary/OCC/move/watch/invalidation behavior;
- workbench pane/session-view distinction and current visual flows;
- direct/local/Vercel/remote-worker provider qualification.

### Change only where boundary requires

- provide one Host catalog over multiple current Agent compositions;
- make native session scope/status authoritative at Host API;
- choose one durable event/replay source for the Host protocol;
- inject Gateway into Workspace instead of constructing Agent/Sandbox there;
- move concrete Seneca/CLI/playground topology into their executable roots;
- replace the Agent-playground backward Workspace adapter import;
- add remote auth/version/idempotency/reconnect/drain behavior;
- migrate current hosted transcripts without dual-write.

### Explicitly leave alone

- general decomposition of giant front/editor/layout files;
- plugin schema/authoring redesign;
- artifact provenance/blob model;
- generic governance/action broker;
- unrelated route/channel/editor features;
- Bash/Sandbox provider implementation.

## Migration and rollout

### Expand

1. Add Agent-owned Host/Gateway contracts and in-memory conformance fixtures.
2. Wrap current Agent/Pi/session/plugin composition in `AgentHost` without moving
   ownership or changing user-visible behavior.
3. Add `EmbeddedAgentGateway`; prove current Agent and Workspace playground tests.
4. Add Workspace injection seam while retaining a compatibility all-in-one
   wrapper for existing consumers.
5. Add durable Host stream and remote protocol/client.
6. Add Seneca managed Host/pool composition.

### Migrate

1. Cut `workspace-playground` to explicit embedded composition.
2. Cut CLI to one-process embedded composition with no Core dependency.
3. Cut Seneca control plane to the pool Gateway and deploy its managed Host.
4. Preserve current plugin front/server/runtime contribution behavior.
5. Inventory every Pi session root/namespace and every Workspace Environment
   placement/byte location/provider binding; migrate or rebind both under one
   fenced cohort plan.

### Pi transcript cutover

Preferred transcript migration is a remount/shared durable store with unchanged
namespace and stable logical `hostId`; a new process gets a new
`hostInstanceId`. If physical copy is required: drain old writers, fence
admission, copy/checksum/readability-verify, atomically update the pool's live
connector mapping, start destination, and never allow two transcript writers. A
browser holding the pre-rollout session ref must reconnect through the stable
logical Host route. No production dual-write or shadow model execution is
allowed.

### Environment/file-state cutover

L0 inventories every Workspace's active mode, canonical byte location, provider
binding/handle, watcher, and rollback source. Current storage is mode-dependent:
host roots may hold bytes in direct/local mode, while Vercel mode's actual files
live under provider `/workspace` ([evidence](../../../apps/full-app/README.md#L138-L152)). A Gateway/Host switch is not a file migration by itself.

For each Workspace cohort:

1. block new Agent turns and member writes/exec; drain active operations and
   watchers;
2. advance/persist the `EnvironmentPlacementEpoch` so an old adapter/Host rejects
   every later mutation; where the current provider cannot check an epoch, stop
   the old writer process and retain maintenance/read-only mode as the physical
   fence;
3. for direct/local bytes, remount the same durable volume when possible;
   otherwise quiesced-copy canonical roots while preserving IDs, permissions,
   symlinks, mtimes, binary bytes, and confinement, then checksum/tree-compare;
4. for remote-worker/Vercel/shared providers, preserve or explicitly rebind the
   provider identity/handle to the same canonical bytes. If that provider cannot
   preserve/rebind, execute its qualified snapshot/export/import procedure under
   the same writer fence; never substitute an empty host anchor;
5. prove destination reads through both `AgentGateway.files`/Agent tools and the
   Workspace workbench before atomically switching the server-trusted placement
   mapping and enabling writes;
6. record the source placement and reverse procedure. After any destination
   write, rollback requires quiesced reverse copy/rebind plus verification, or an
   explicit degraded read-only rollback; changing an env var/endpoint alone is
   forbidden.

Forward and reverse fault injection covers process death before/after epoch,
copy/rebind, placement switch, first destination write, and acknowledgement. No
old/new file or exec writers overlap, and post-cutover files cannot disappear on
rollback. Existing remote-worker guidance already documents the required
quiesced-copy and reverse-copy/read-only principle
([source](../../../apps/full-app/docs/REMOTE_BWRAP_WORKER_LAUNCH_PLAN.md#L293-L308)).

### Contract

After a fixed observation window and exact H2c approval:

- make old Workspace-created Agent/Sandbox composition unreachable;
- retire duplicate Agent replay/lifecycle paths only when the Host path proves
  sole ownership;
- remove old Agent-local remote-worker code only under its owning migration lane;
- remove compatibility exports/routes only after packed consumer scans pass.

Rollback uses a pinned compatible app/Host/storage cohort. Rollback never points
an old writer at transcripts advanced incompatibly by a newer Host.

## Candidate authority-amendment and implementation slices

These are planning slices, not Beads. Exact Beads are created only after the
atomic authority amendment is approved.

### L0 — consumer and state-authority ledger

**Delivers:** all Agent/Workspace exports/consumers, current session/replay/
lifecycle owners, plugin composition paths, session roots, file/UI routes,
Bash/Sandbox provider edges, conflicting authority/Beads, and Seneca/CLI/
playground composition points.

**Proof:** machine-readable ledger checked against source/build/package exports
and used as the amendment input.

### H0 — Human Intention: approve plan and amendment packet

**Delivers:** explicit owner approval of this Host/Gateway model, the exact L0
authority/Bead replacement set, managed transcript-retention policy, and
permission to execute A0. It creates no implementation Beads and changes no
runtime authority.

**Blocked by:** L0 and fresh steady-state plan review.

### A0 — atomic authority amendment

**Delivers:** Decision 28/#391/#805/affected #807/#808/#820/#861/invariants/Workspace
contract/Bead changes ratifying Agent-owned sessions/Environment mechanics,
Agent-owned Gateway/file/UI-command surfaces, stable Host identity, Seneca-owned
pool/placement policy, embedded-vs-remote topology, and no core rewrite.

**Blocked by:** H0 approval.

**Proof:** every L0 conflict has one retained/replaced/deferred disposition;
stale-authority scan, issue/Bead mapping, DAG replay, owner approval.

### G1 — Agent-owned Gateway contract and conformance

**Delivers:** bounded session/control/event DTOs, focused member file sub-gateway,
typed UI-command request/receipt, stable logical Host/session refs, idempotent
mutations, Workspace scope-grant claims/errors, and embedded/remote semantic
fixture.

**Blocked by:** A0.

### H1 — multi-Agent Host over current implementation

**Delivers:** catalog of multiple current Agent compositions, Agent-owned session
list/status, actor-neutral construction, drain/close, no new model loop.

**Blocked by:** G1.

### PL1 — current plugin composition parity over remote Host

**Delivers:** one app-owned current-plugin declaration/digest; app/internal
front+server versus Host runtime-field resolution; immutable generated-plugin
front asset snapshot sub-gateway; reload revision parity; L0 disposition for
actual external `serverPath` consumers with no generic backend-route tunnel.
No author-facing manifest/schema changes.

**Blocked by:** L0, G1, H1.

**Proof:** current app/internal and generated plugin fixtures in embedded/remote
modes; digest mismatch and unavailable local-root failures; previous coherent
revision survives failed reload.

### S1 — sole Host session/event authority

**Delivers:** native session idempotency/scope metadata, one replay/terminal
source, Pi compatibility, durable root injection, stable `hostId` versus
`hostInstanceId`, reconnect across revision/remount, and writer fencing for
rolling revisions.

**Blocked by:** H1.

### DS1 — production Durable Streams adapter decision

**Delivers:** evidence ADR comparing implement/adapt options, license/maintenance,
auth/tenancy, transactional idempotent append, offsets, backup/restore, and an
atomic outbox versus deterministic Pi reconciliation decision. It specifies
command-receipt/transcript/event checkpoints and crash outcomes. No production
implementation before this decision.

**Blocked by:** G1.

### DS2 — Host durable session stream

**Delivers:** selected store/adapter and cross-store strategy, Agent sole
producer, cursor catch-up/live tail, status/attention/tool/terminal events,
command receipt recovery, and fault-injected reconciliation at every Pi/event
boundary.

**Blocked by:** S1, DS1.

### E1 — Environment-mode boundary preservation

**Delivers:** Agent Host composes current Bash/Sandbox modes; Gateway file
sub-surface preserves routes/OCC/watch for embedded and remote Hosts; host-local
Workspace affinity and shared/network cross-Host admission are explicit;
Workspace target path has no provider values; canonical Sandbox remote-worker
provider is used where qualified; legacy Agent copy remains compatibility-only.

**Blocked by:** H1 and qualified #808/provider plus #861 package-cycle outputs.

### W1 — Workspace Gateway injection

**Delivers:** Workspace server/front session source and commands use injected
Gateway; workbench/plugin/file behavior unchanged; no new Workspace session
store or bounded-context rewrite.

**Blocked by:** G1, H1.

### W2 — bounded Host egress, delegation, and UI receipts

**Delivers:** `AgentHostEgressHandler`; durable Workspace UI/delegation receipt
ports; source-session/lineage/guard/attenuation authorization; embedded/remote
request/receipt adapters; sole `UiBridge.postCommand` wrapper; no Host-direct pool
routing or arbitrary Workspace/plugin RPC.

**Blocked by:** W1, H1.

**Proof:** duplicate/conflicting/lost-ack delegation creates one child; cycle/
depth/fan-out/cancel rules; UI process death before/after admission/post/receipt
never silently repeats an effect; current dispatcher compatibility.

### P1 — all-in-one reference compositions

**Delivers:** workspace-playground and CLI one-process embedded compositions;
Agent playground no backward Workspace runtime-adapter dependency or implicit
`cwd` authority.

**Blocked by:** E1, W1.

### R1 — remote Host protocol/server/client

**Delivers:** version/auth/revision handshake; service identity plus short-lived
audience/operation/command/digest-bound Workspace scope grants; signer custody,
rotation/revocation overlap and replay receipts; bounded session/file/UI-command
planes; durable event subscription, cancellation/drain, stable errors, hostile
transport tests.

**Blocked by:** DS2, E1, PL1, W2.

### K1 — qualified remote model-access capability (#820)

**Delivers:** amended #820 implementation for Host-audience/Workspace/session/
invocation/provider/model-bound `ModelAccessGrant`, bounded Seneca model proxy,
durable model-call idempotency/usage receipt, key rotation/revocation, explicit
instance fallback, CLI/self-host adapters, and no raw-key leakage.

**Blocked by:** A0, G1.

**Proof:** two concurrent Workspace canaries cannot cross; lost acknowledgement
does not double-bill; rotation/clear affects next call; keys absent from Gateway,
events, transcript, Environment/tool env, logs, and packed artifacts.

### C1 — Seneca pool and real remote consumer

**Delivers:** Seneca-owned static trusted pool/router, one managed Host serving at
least two Agent types, Core identity adapter, same-region deployment, model-key
composition through #820, health/latency/status.

**Blocked by:** R1, W1, K1.

### M1 — hosted transcript and Environment-placement cutover

**Delivers:** per-Workspace transcript root plus Environment mode/byte-location/
provider-binding inventory; transcript remount/copy; direct/local file remount or
quiesced copy; remote-worker/Vercel preserve/rebind or qualified transfer;
`EnvironmentPlacementEpoch`/physical writer fencing; atomic session+placement
routing switch; workbench+Agent forward/reverse verification.

**Blocked by:** C1, S1, E1.

### F1 — integrated qualification

**Delivers:** two Agents/multiple sessions on one Host, Workspace-scoped listing,
host-local same-Host delegation, qualified shared-backend cross-Host delegation
and unqualified rejection, embedded CLI/playground, real Seneca remote path,
Environment direct+remote-worker file/workbench proof, hostile create-scope grant
tests, browser reconnect across Host revision/remount, transcript plus
Environment placement forward/reverse cutover with post-cutover writes,
restart/rollback, packed consumers.

**Blocked by:** P1, C1, M1.

### H2c — Human Intention: compatibility contraction

**Delivers:** owner decision on exact unreachable files/exports/routes, consumer
scan, restoration artifact, and observation-window evidence. Performs no
deletion.

**Blocked by:** F1.

### C2 — approved contraction and release

**Delivers:** only H2c-approved small removals, packed release candidate,
publication through the existing H8 gate, and post-publication Seneca/CLI smokes.

**Blocked by:** H2c approval.

## Acceptance

### Architecture

- [ ] Agent package owns Host protocol, Gateway contract, embedded/remote generic adapters, sessions, Pi, status/events, and Environment mechanics.
- [ ] Seneca owns managed pool/router/deployment topology.
- [ ] Workspace receives one Gateway and owns no Host registry, canonical session store, Pi transcript, or provider selection.
- [ ] One Host serves at least two Agent types and concurrent sessions without actor/session capture.
- [ ] Stable logical `hostId` survives process/revision/remount; ephemeral `hostInstanceId` never becomes a durable route.
- [ ] Agent placement and Environment mode are tested as orthogonal choices through the same session and file Gateway contracts.

### Existing product behavior

- [ ] Current Agent definition and plugin model remain compatible.
- [ ] Internal/external plugin trust and sandbox behavior remain.
- [ ] App/internal plugin composition digest matches the Host runtime selection; generated front assets load from immutable Host snapshots without shared local roots.
- [ ] Active external `serverPath` consumers are inventoried and block remote cutover unless promoted or separately approved; no generic backend-route tunnel is added.
- [ ] Agent chat/session frontend and Workspace workbench/file/editor/viewer ownership remain.
- [ ] Remote Host file tree/edit/write/watch works through the bounded file sub-gateway; Agent UI commands reach only re-authorized `UiBridge.postCommand` through a durable admission/receipt store.
- [ ] Host→Workspace delegation is one bounded request/receipt port; Workspace validates lineage/guards/attenuation and Hosts never route the pool directly.
- [ ] UI/delegation duplicate, conflict, acknowledgement-loss, and process-death tests prove no silent repeated effect/child session.
- [ ] Existing artifact-open/path behavior remains; #905 adds no artifact blob/provenance system.
- [ ] Existing file binary/OCC/watch/invalidation and WorkspaceBridge security pass unchanged conformance.

### Sessions and streaming

- [ ] Agent Host is canonical for native session ID, transcript, status, title, rename/delete, follow-up, interrupt/stop, and terminal event.
- [ ] Every session is Workspace-scoped and cross-scope lookup fails closed.
- [ ] Workspace list/status caches are explicitly non-authoritative.
- [ ] Public Gateway requests are Host-neutral; Seneca routes first and mints per-Host wire grants internally.
- [ ] Multi-Host session listing has deterministic pagination/deduplication and explicit partial-failure reporting.
- [ ] Control-plane-signed Workspace scope grants are audience/operation/command/digest/expiry/nonce-bound, rotated/revoked, redacted, and hostile create-time cross-scope attempts fail closed.
- [ ] Lost create/send acknowledgement cannot create a duplicate transcript/model call.
- [ ] Agent Host is sole durable stream producer; Workspace writes no replay journal.
- [ ] Disconnect unsubscribes without stopping the session; reconnect catches up then tails.
- [ ] Transcript, command-receipt, and stream consistency uses one DS1-selected outbox/reconciliation strategy and passes fault injection at every cross-store boundary.

### Model credentials

- [ ] Seneca BYOK remains in control-plane custody and remote Hosts use bounded invocation-specific `ModelAccessGrant` proxy calls without raw keys.
- [ ] Model grants are Host/Workspace/session/invocation/provider/model/limit/expiry/nonce-bound and revocable.
- [ ] Lost model-call acknowledgement returns one recorded outcome/usage receipt and never silently bills twice.
- [ ] CLI embedded, Seneca instance fallback, and explicit self-host credential paths remain separate and tested.

### Environment boundary

- [ ] Workspace target source has no value imports from boring-bash/boring-sandbox/provider implementations.
- [ ] Agent Host composes direct/local/Vercel/remote-worker modes through qualified package contracts.
- [ ] Packed manifests/import scans prove boring-bash and boring-sandbox shared/provider surfaces no longer depend on Agent, satisfying #861 before F1.
- [ ] Canonical remote-worker provider comes from boring-sandbox; old Agent copy is not new authority.
- [ ] Remote worker receives no Pi transcript/model-loop authority and is never described as an Agent Host.
- [ ] Host-local Environments pin all same-Workspace Agents to one Host; cross-Host delegation requires one qualified shared/network placement and otherwise fails without copying.

### Consumer topologies

- [ ] Workspace playground and CLI run Workspace + embedded AgentHost in one process.
- [ ] CLI passes with Core/Seneca and monorepo sibling-source fallbacks absent.
- [ ] Seneca production proves a separate managed Host with at least two Agent types.
- [ ] Browser/tenant/plugin input cannot register Host endpoints.
- [ ] Packed Agent/Workspace/Core/CLI/Seneca consumers pass without source aliases.

### Migration

- [ ] Existing Pi transcripts remain readable and stable IDs survive cutover.
- [ ] Every Workspace Environment mode/byte location/provider binding is inventoried; direct/local bytes are remounted or quiesced-copied, and remote-worker/Vercel identities are preserved/rebound or transferred through a qualified procedure.
- [ ] `EnvironmentPlacementEpoch` or physical process fencing prevents overlapping old/new file and exec writers.
- [ ] Destination files are verified through both Agent operations and Workspace workbench before placement switch.
- [ ] Source writer stops before destination admission; no production transcript/file dual-write or shadow model execution.
- [ ] Rollback cohort/storage compatibility includes post-cutover transcript and file mutations; config-only rollback is forbidden when bytes moved.
- [ ] No deletion occurs before exact H2c/H8 approval.

## Backlog integration audit

Snapshot: 2026-07-22 at repository `origin/main` `d3a1bd3931a0f12841a073c13cbc418d12db94d4`. The audit used machine-readable `gh issue list --state open --limit 1000 --json ...` and `gh project item-list 7 --owner hachej --limit 1000 --format json`. It covered all 40 pre-existing open repository issues, this issue, and all 57 non-Done items in the private **Boring Roadmap** project, including #905 after it was added. Closed-but-active dependency lanes #808 and #820 are recorded separately above. `ABSORB` means an exact foundation behavior enters this plan; it does not automatically become a cutover gate, close, or silently supersede the original item. Existing items remain independently tracked until their own acceptance is proven and the owner confirms disposition.

Classification vocabulary:

- **AUTHORITY/PREREQUISITE** — must resolve before dispatch.
- **DEPENDENCY** — another active lane owns the required implementation; #905 consumes its qualified contract.
- **ABSORB** — implement/prove the listed foundation behavior in this boundary extraction, without automatically making unrelated UI completion a cutover gate.
- **CONFORMANCE** — preserve/prove behavior; separate item may still own its user-facing fix.
- **FUTURE SEAM** — keep a narrow extension point; do not implement the feature here.
- **RECAST** — old architecture conflicts with Decision 28; preserve intent through the new boundary.
- **OUT** — unrelated to these two cores.

### Open repository issues

| Issue | Class | #905 disposition |
| --- | --- | --- |
| #109 Re-resolve panes after plugin reload | OUT | Plugin/front pane lifecycle stays separate. |
| #174 Clickable slash-command mentions | OUT | Chat rendering feature; PR #186 remains its lane. |
| #371 Codex context overflow | CONFORMANCE | Runtime Pi adapter preserves stable error/recovery seams; the user-facing fix remains #371 and is not a cutover blocker. |
| #391 Domain-routed/multi-agent epic | AUTHORITY | Product/release authority; #905 cannot redefine it. |
| #421 Public Markdown share | OUT | Share surface and public capability design stay separate. |
| #579 Dictation | OUT | Composer/browser feature. |
| #601 Provisioning disables remote sessions | ABSORB | Separate provisioning capability from session transport; reject invalid composition. |
| #737 flaky Stop locator | PREREQUISITE | Fix the proof locator before relying on that E2E as a boundary gate; no architecture scope. |
| #768 D1 signal race | OUT | Deployment/D1 test. |
| #775 Native Pi session creation/rename | ABSORB | One native session, lazy materialization, Pi title authority, no new wrapper. |
| #778 external chat session list | ABSORB | Authorized external adoption and immediate canonical list update. |
| #781 session status refresh | ABSORB | Attributed status events update active/background sessions without refresh. |
| #784 skill/question/focus regressions | CONFORMANCE | Absorb session-owned attention/no-focus-steal; skill-location fix remains separate. |
| #785 isolated D1 authority | OUT | Deployment proof seam. |
| #786 sessionless Task Inbox | CONFORMANCE | Preserve current sessionless Inbox behavior; #905 does not create an artifact-review store or force a chat session. |
| #788 binary Download corruption | OUT | Existing raw-byte route semantics remain regression evidence; viewer fix is separate. |
| #790 session-associated layout | FUTURE SEAM | Stable session attribution and session-scoped UI-state key; layout UX stays separate. |
| #805 Agent authoring/runtime child | AUTHORITY | Atomically amend Decision 28, contracts, F0b–F3+, and Beads before dispatch; retain authored-source, plugin, Pi-session, and Agent-owned Environment-mode behavior. |
| #806 MCP ingress/artifacts | FUTURE SEAM | Preserve current artifact-open behavior. Generic provenance, review storage, MCP ingress, and sharing remain #806. |
| #807 durable multi-channel transport | ABSORB | Map only T1's Durable Streams session spine into Agent Host as sole replay authority; broader public/channel transports remain #807. |
| #809 marketplace/billing/channels | FUTURE SEAM | Stable identities, attribution, metering hook only. |
| #819 observability/metering | CONFORMANCE | Preserve usage accounting and emit workspace/agent/session/invocation attribution; operator UI remains separate. |
| #829 automated UI review | OUT | Review infrastructure. |
| #848 merge plugin resources into plugin CLI | CONFORMANCE | Pi resource discovery stays adapter-owned and pack-compatible; package retirement is separate. |
| #851 deployment ownership removal | OUT | Repository/hosting cleanup. |
| #856 clean-checkout playground build | CONFORMANCE | New exports must build with generated types from clean checkout. Separate script fix may land first. |
| #857 concurrent dev build races | CONFORMANCE | No #905 step may depend on concurrent destructive dist cleans; separate build orchestration fix remains. |
| #861 Agent↔Sandbox/Bash cycle | DEPENDENCY | #905 consumes qualified Bash/Sandbox contracts from Agent Host and removes Workspace provider selection; package-cycle/provider fixes stay in their owning lanes. |
| #863 server/front plugin drift | CONFORMANCE | Consumer composition derives both surfaces from one app-owned declaration or proves parity. |
| #871 automation UI review | OUT | Plugin UI review. |
| #872 automation list refresh | OUT | Automation plugin cache invalidation. |
| #873 CLI ask_user refresh | CONFORMANCE | Blocking intention remains tied to canonical session/invocation through reload; plugin UI fix remains. |
| #875 autoresearch pilot | OUT | Workflow/plugin quality loop. |
| #877 Fly/Neon decommission | OUT | Infrastructure decommission. |
| #882 tldraw | OUT | Diagram plugin. |
| #883 stale app-left indicator | OUT | Front memoization bug. |
| #895 per-session top-bar menu | OUT | Chat layout UX. |
| #896 hosted automation scheduler | OUT | Automation host lifecycle. |
| #900 full MCP catalogs/approval | FUTURE SEAM | Governance/approval adapter may consume compiled authority; MCP, credentials, SSRF, and catalog work remain #900. |
| #903 automation run leases | OUT | Automation-specific durable ownership. |
| #905 this boundary extraction | PLAN | Canonical plan and future implementation lane. |

### Active Boring Roadmap project items

| Project item | Class | #905 disposition |
| --- | --- | --- |
| Make slash commands mentioned in agent text clickable | OUT | Same as issue audit. |
| Re-resolve open file panes after workspace plugin reload | OUT | Same as issue audit. |
| #709 Private metadata index and native stream/scope migration | FUTURE SEAM | Pi compatibility adapter permits scoped metadata; no metadata store here. |
| #709 Native-session capability and direct-local admission | ABSORB | Materialized/renameable capability and Pi title authority. |
| #709 Direct-local native first-send without wrapper | ABSORB | One native JSONL, no wrapper, idempotent admission. |
| Published @hachej/boring-workspace lacks standalone build scripts (factory consuming-repo gap) | CONFORMANCE | Packed consumers can build/use new server exports without source/vendor fallbacks. |
| #709 Hosted metadata adapter, scoped migration, and legacy-wrapper retirement | FUTURE SEAM | Host-injected attribution/session store; no local store as hosted authority. |
| #709 Crash-safe local legacy wrapper migration and Pi CLI parity | CONFORMANCE | Legacy readers remain isolated; no destructive or implicit migration in #905. |
| #709 Native Pi list/search canonicalization and Boring ID consumer migration | ABSORB | Canonical native IDs propagate through streams, queues, tools, panes, attention, and task bindings. |
| Agent consumption contract & multi-agent consumption (Decision 22 implementation) | ABSORB | Implement package-internal runtime delegation, derived lineage, guards, attenuated Environments, and artifacts; generic public A2A/contracted mode remains later. |
| Plan Markdown embedded plugin nodes | OUT | Editor/plugin feature. |
| Add explicit Claude subscription auth for CLI mode | FUTURE SEAM | `ModelClientIssuer` supports provider-specific outer adapters; no auth in Agent application. |
| Office in-app agent surface: adopt pi-for-excel + boring connector, fork for PowerPoint (Word later) | FUTURE SEAM | Independent consumer can call authenticated Workspace APIs; no Office scope. |
| Add copy/open hover actions for URLs in chat | OUT | Chat UX. |
| Show file name tooltip on file-tree hover | OUT | File-tree UX. |
| Explore Claude Code CLI subscription-backed harness | FUTURE SEAM | Alternative `AgentSessionRuntime` adapter is possible without changing application/domain; no env-flag harness mode in the core. |
| Make app-left pane composable/editable for plugins and non-agent tools | OUT | Front contribution UX. |
| Plan Seneca task and background-agent control plane | FUTURE SEAM | Expose run/session lineage, status, interrupt/resume through ports; task/run store remains separate. |
| Chat scrolling optimization: reader-first streaming experience | CONFORMANCE | Stable monotonic stream and terminal events; scroll state machine remains front work. |
| Feedback: GTM plugin inspired by La Growth Machine | OUT | Product plugin. |
| Plan shared child-app platform | ABSORB | Seneca owns the static Agent pool/topology and product composition while Core stays identity-only. Billing remains separate. |
| Plan: TipTap-first agentic markdown collaboration | OUT | Editor authority design. |
| Epic: Multi-project left bar (layout modes + Projects nav) | ABSORB | Read-only workspace/session catalog must not boot Agent, Pi model loop, or Environment. UI remains separate. |
| State of work: remote-sandbox-safe hosted external plugins | CONFORMANCE | Preserve the current internal/generated trust split and sandbox restrictions; #905 does not redesign plugin manifests or public routes. |
| Add Remotion Studio embed plugin | OUT | Trusted plugin/process feature. |
| Plan: evaluate Pierre Trees replacement for workspace file tree | OUT | File-tree renderer. |
| Add pane context menu action to open in standalone browser tab | OUT | Front routing feature. |
| Perf: workbench visible in <1s warm — stop booting the whole chat/editor world upfront | ABSORB | Headless metadata/default/session reads are lazy/no-boot; front bundle splitting remains separate. |
| Specify optional trusted browser-use plugin | FUTURE SEAM | Optional trusted tool enters compiled governance and named Environment access; not default core weight. |
| Add browser-native screenshot copy to HTML viewer | OUT | Viewer feature. |
| Add Skill & Plugin edition pane | FUTURE SEAM | Read-only fleet/contribution metadata may be projected later; no editor UI here. |
| refactor(cli): decompose pluginFrontRuntime.ts (1946 lines) | CONFORMANCE | Composition swap must not add responsibility to that file; decomposition remains separate. |
| Deep-linkable chat sessions: put the active session id in the URL (workspace mode) | FUTURE SEAM | Stable Agent-owned session refs remain Workspace-scoped and fail closed across Workspaces. |
| Post-#241 simplification backlog: agent package lean-down follow-ups | ABSORB | Replace duplicate app assemblers/replay/session maps; retain front-only cleanup as separate. |
| Dedupe theme palette onto ui-kit tokens.css (workspace import + agent drift guard) | OUT | Styling/build concern. |
| Implement native Pi TUI slash commands in boring-ui | FUTURE SEAM | Pi adapter may expose tested capabilities; no front-synthesized commands in application core. |
| Integrate Tiptap collaboration for workspace editors | OUT | Editor collaboration. |
| Add /reload result to LLM context | FUTURE SEAM | Session runtime supports explicit operational entries; reload orchestration remains outside Agent application. |
| Add drag-and-drop file upload to workspace | FUTURE SEAM | Uses Environment file operations with adapter-owned path validation; UI feature remains separate. |
| Add right-click file download action | FUTURE SEAM | Raw-byte Environment/file route with canonical relative path; UI feature remains separate. |
| Add clickable workspace links to open specific session history | FUTURE SEAM | Stable scoped IDs and authorized no-boot history lookup; UX remains separate. |
| Show current Git branch for Git-backed workspaces | FUTURE SEAM | Optional Environment metadata operation; no host-path assumption. |
| Add agent completion and attention notifications | ABSORB | Agent Host emits attributed completion/attention session events with severity-capable metadata; notification UI remains separate. |
| Add session status visibility to session list | ABSORB | Stable running/completed/failed/needs-input projection; visual design remains separate. |
| Add workspace secret management for runtime plugins | FUTURE SEAM | Agent Host receives only scoped credential capabilities/clients; raw secrets never enter browser, transcript, logs, tools, or Gateway DTOs. |
| Plan: credit-based / token-usage billing (Stripe) in core | FUTURE SEAM | Attributed usage sink and pre-call authorization hook; Stripe/ledger/enforcement remain Core work. |
| New slash command: /feedback — auto-create GitHub issue with session transcript + session ID | FUTURE SEAM | Authorized transcript reference and redacted export adapter; no GitHub mutation here. |
| Track auto-creation of reusable base runtime after first fallback provisioning | FUTURE SEAM | Outer Environment provider lifecycle only; never snapshot interactive user authority. |
| Add doc annotation feature for review workflows | OUT | Review/editor feature. |
| Add shortcuts for model picker and model selection | OUT | Front input UX. |
| Future: add workspace provisioning lease for multi-user/cloud concurrency | FUTURE SEAM | If real concurrency requires it, extend the Agent Environment provider's focused placement fencing; do not add a generic Workspace/Agent lease now. |
| Onboarding plugin: zero-friction LLM auth across CLI, full-app, and child apps | FUTURE SEAM | Model auth/storage stays behind app issuer and Agent Host model adapter; no process-global auth discovery in Gateway/session code. |
| Refactor PostgresWorkspaceStore into focused store modules | CONFORMANCE | Any Gateway projection/receipt adapters added to the app remain focused ports and do not enlarge the existing monolith. |
| Extract core-neutral workspace catalog routes for CLI/local reuse | ABSORB | Shared Workspace catalog use cases plus separate Core/CLI auth adapters; no Core-auth assumptions in Workspace or Agent Gateway contracts. |
| Add Bedrock Agent sandbox compatibility | RECAST | Bash/Sandbox lanes may implement a provider consumed by Agent Host. No provider checks enter Core or Workspace. |
| Explore a unified Boring Action primitive | FUTURE SEAM | Future actions project into one governance/invocation boundary; do not create the abstraction without a real plugin consumer. |
| Plan isolated Agent application-core and Workspace bounded-context rewrite (stale project snapshot title; #905 is now “Extract multi-Agent Host and Gateway boundary”) | PLAN | This #905 plan replaces the rejected rewrite with Agent Host/Gateway boundary extraction. |

## Proof

### Planning-time proof for this plan PR

- eight fresh code-ground Host/Gateway reviews; HG-R7 Claude Opus and HG-R8
  Codex are consecutive **READY** with no P0/P1;
- 41/41 current open issues and 57/57 non-Done Roadmap items represented;
- all local source/document links resolve; cited line ranges were independently
  checked in review;
- glossary, Markdown-fence/frontmatter, stale-architecture, and secret-pattern
  scans pass;
- `git diff --check` passes;
- `pnpm check:golden-path` passes all reported invariants;
- `node scripts/audit-publish-manifests.mjs` was previously attempted in this
  dependency-less worktree; `pnpm pack` reports
  `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL` because workspace dependencies are
  not installed. This docs-only plan changes no manifest; GitHub CI and future
  implementation qualification must run installed package/manifest gates.

### Implementation qualification

Implementation qualification additionally requires:

- AgentHost/Gateway contract tests for embedded and remote adapters;
- two Agent types and multiple Workspace-scoped sessions on one Host;
- current Pi/session/plugin/workbench/file regression suites;
- durable stream reconnect/restart/idempotency/fencing tests;
- direct and remote-worker Environment conformance;
- real Seneca remote Host proof and measured same-region overhead;
- CLI/workspace-playground one-process smokes;
- transcript plus Environment placement remount/copy/rebind, writer-fence, workbench/Agent verification, and reverse rollback rehearsal;
- packed consumer/import/manifest/invariant gates.

## Out of scope

- full Agent or Workspace package rewrite;
- mandatory `packages/agent/src/application/` or
  `packages/workspace/src/server/workspace/` greenfield cores;
- one deployment per Agent or one service per plugin;
- AgentDefinition v2/full-surface declarative migration;
- plugin system redesign, marketplace, billing, or new trust classes;
- workbench/editor/file-tree/layout redesign;
- canonical artifact blob/provenance redesign;
- moving Bash/Sandbox into Workspace;
- redesigning remote-worker or provider implementations;
- Core-owned Agent/domain/provider behavior;
- generic governance/action broker;
- public A2A/Slack/webhook/channel product beyond the Host stream;
- broad giant-file/cache/lifecycle cleanup unrelated to Host correctness;
- destructive compatibility cleanup without H2c/H8.

## Remaining owner intentions

The architecture is decided. Before implementation dispatch, the owner still
needs to choose:

1. transcript retention/deletion policy for managed Agent Hosts;
2. the observation window required before H2c contraction;
3. for each first Seneca cohort, whether transcripts and direct/local Environment
   bytes are remounted, quiesced-copied, or provider-rebound, based on the L0/M1
   deployment/storage evidence.

These choices do not reopen Agent/Workspace/Host/Gateway ownership.

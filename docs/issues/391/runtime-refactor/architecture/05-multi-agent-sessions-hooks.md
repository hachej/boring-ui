> **Scope status (2026-07-17): retained architecture; non-dispatchable.**
> Decision 26 supersedes conflicting sequencing, AgentHost/D1/controller/CAS,
> compiled-deployment authority, and same-workspace-first v0 assumptions. Any
> implementation requires a current consumer-backed plan and recut Bead graph.

# 05 — Multi-agent workspaces, sessions, and hooks

> **Framing note (2026-07-11):** internal agent-to-agent consumption is now
> framed by [DECISIONS.md #22](../../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges)
> — one consumption contract, many bindings (UI / MCP external / native
> internal / A2A future external). This file is not rewritten; read it through
> that frame.

> **Workspace-first v1 supersession (2026-07-10).** V1 supports only the
> workspace's routed `default` agent. P6-D defines minimal behavior-only
> `AgentDefinition` and identity-only `AgentDeployment` schemas/digests plus
> immutable definition lookup. P6-R is a stateless function over those verified
> values, the existing authorized workspace composition manifest/digest, and
> narrow runtime facts. It creates no E1 catalog, `WorkspaceAgentsDeclaration`,
> resolved registry, generation store, active pointer, lease, GC, or session-
> pinning platform. D1 alone stores complete redacted deployment snapshots for
> apply/rollback. The multi-agent and generation material below is post-v1 and
> non-dispatchable until a named consumer re-specifies it.

## Goal

Allow one deployed app/workspace to compose multiple agents with different tools, files, shell access, channels, and durability behavior.

This is the platform layer needed for child apps like Macro and for multiple agent roles in the same full-app deployment.

## Agent concepts

| Concept | Environment | Use case |
| --- | --- | --- |
| `AgentProfile` | same parent bash environment, maybe narrower cwd/view | cheap delegated tasks, same trust boundary |
| `AgentNode` | own config, tools, channels, sandbox policy, durability | specialist agents with different tools/provider/mount/network policy |

Defaults:

- declared child agents inherit nothing unless explicit;
- copy/current-agent delegation may share sandbox state only when explicit;
- narrower views are okay;
- wider views require owner/workspace policy approval;
- delegation depth is capped;
- shared-sandbox write access needs stale-write or non-overlapping write scopes.

## Historical definition/deployment registry design — post-v1

Reusable behavior is not a tenant deployment. The v1 contracts are separate:

```ts
interface AgentDefinition {
  schemaVersion: 1
  definitionId: string
  version: string
  label?: string
  instructionsRef: string
  capabilityRequirements?: string[]
  toolRefs?: string[]
  skillRefs?: string[]
  mcpServerRefs?: string[]
}

interface CompiledAgentBundle {
  definition: AgentDefinition
  definitionDigest: `sha256:${string}`
  assets: Array<{
    path: string
    digest: `sha256:${string}`
    content: string
  }>
}

interface AgentDeployment {
  deploymentId: string
  version: string
  agentId: string
  definition: {
    definitionId: string
    version: string
    digest: `sha256:${string}`
  }
  environmentAttachmentRefs?: string[]
  runtimeProfileRef?: string
  modelPolicyRef?: string
  sandboxPolicyRef?: string
  governancePolicyRef?: string
}

interface WorkspaceAgentsDeclaration {
  bundles: CompiledAgentBundle[]
  agents: AgentDeployment[]
  defaultAgentId: string
}
```

`AgentDefinition` contains versioned behavior and requirements only. A1 emits a
`CompiledAgentBundle`: the validated definition plus sorted, path-contained,
UTF-8 assets. `instructionsRef` names an asset path inside that bundle, not a
source-machine path. `definitionDigest` covers canonical definition data and
the ordered asset path/digest/content tuples. This small content-addressed
artifact is the unit used by local dev, P6-R, and D1; v1 does not require an
artifact service. The P6-D in-process registry stores the whole verified bundle
by `(definitionId, version)`, not a definition stripped from its assets.

`instructionsRef` is the only agent-authored prompt reference in schema v1.
Environment and workspace-plugin prompt fragments are not definition assets:
they remain attached to the resolved contribution that supplies the matching
capability. The sole v1 `default` agent receives the workspace-enabled plugin
contributions atomically; installation alone does not append a fragment, and a
fragment cannot remain when its host-configured contribution is disabled or
fails activation. A later schema
adds `pluginRefs` only together with per-agent contribution resolution. Do not
add a generic prompt-fragment reference list as a shortcut.

P6-D deliberately knows no E1 types. `environmentAttachmentRefs` is a sorted,
duplicate-free list of validated opaque ids included in `deploymentDigest`.
P6-R runs after E1 and resolves each id through the host-owned attachment
catalog to an E1 `EnvironmentAttachment`; unknown or unauthorized refs fail
closed. The resolved attachment policy/facts then contribute to
`resolvedSnapshotDigest`. P6-D must not invent a second attachment shape or
import boring-bash.
The concrete environment pool/catalog is a separate host input introduced by
E1 and consumed by P6-R; it is not a `WorkspaceAgentsDeclaration` field in
P6-D. P6-R may expose a host-only resolved wrapper joining the P6-D declaration
to that catalog without moving E1 types into agent shared.

Pricing, public-demo exposure, tenant roots, runtime selection, and seed sources
are deployment/factory inputs. D1's exact hostname and bounded landing config
live in a separate host-owned `DedicatedSiteSpec`; they are neither reusable
agent behavior nor an `AgentDefinition` field. `AgentDeployment` is itself versioned.
Its canonical `deploymentDigest` covers deployment id/version, agent id,
definition reference, opaque attachment refs, and every runtime/model/sandbox/governance
policy reference, but never a raw secret. The host resolves the verified bundle
and deployment to an immutable `ResolvedAgent`. Its
`resolvedSnapshotDigest` covers both input digests plus the redacted resolved
authority snapshot: pinned image/model, provider and environment facts,
authenticated grant identities/status, final tool/skill/plugin catalogs, the
P3 `ActivatedWorkspacePluginSnapshot` digest, and `staticPromptDigest` over the
source-labeled `ResolvedStaticPromptPlan` from architecture 01. That plan
retains base prompt version/content, instructions asset, resolved capability/
plugin fragments, generated v1 skill index, and static `systemPromptAppend`.
Explicit per-turn `systemPromptDynamic` output is the sole prompt input outside
static identity and cannot grant authority. The plugin snapshot binds the
immutable host-app artifact and the ordered activated plugin contributions;
changing plugin enablement, order, source, manifest, canonical redacted
activation input, prompt, or front/server contribution therefore creates a
different resolved generation.

Every new session stores definition id/version/digest, deployment
id/version/digest, and resolved-snapshot digest. Manifests/status retain the
redacted snapshot used to compute that digest. P6-R stages immutable generations
but never publishes one as live. `ResolvedAgentRegistry` is a read view over a
host-supplied `ActiveResolvedGenerationPointer`, not an independently mutable
current map. D1 supplies its durable `currentCompleteGeneration` record
containing `agentId` and `resolvedSnapshotDigest`; A1 dev publishes a local
pointer only after resolution/readiness succeeds. An immutable,
durable `ResolvedAgentGenerationStore` is keyed by resolved-snapshot digest and
stores the self-contained verified bundle, immutable deployment snapshot, and
the complete redacted resolution inputs/catalog versions needed to reconstruct
the executable composition, including the activated-plugin snapshot and
immutable artifact references it names, plus the source-labeled static prompt
plan. References alone are insufficient: before staging succeeds, the host's
content-addressed artifact store durably and atomically pins the complete host-
app/plugin artifact set under `resolvedSnapshotDigest`. The artifact pin lives
until the corresponding generation is actually GC'd; staging, active-pointer,
session, and rollback generation roots therefore retain both metadata and
content. Crash reconciliation repairs an acquired-pin/no-generation window,
and generation GC releases the pin only after the generation record is durably
removed. It stores no live provider/attachment handles and no raw secrets.

Session creation pins atomically with respect to pointer publication and GC.
`pinCurrentForSession(agentId, admissionId)` atomically reads the active pointer
and creates a durable temporary generation lease before returning the digest;
session creation persists that lease/digest, then `commitSessionPin` transfers
it to a session retention reference. Pointer swaps/pruning cannot delete the
leased generation. Crash recovery reconciles lease↔session by admission id;
failed creation releases it, and session deletion releases the session ref.

Follow-up turns and restart recovery load the session's pinned generation,
reprepare its host resources, re-resolve it, and require the same digest. If the
generation is absent or no longer reproducible they fail with stable
`RESOLVED_GENERATION_UNAVAILABLE`; they never substitute the current agent
pointer. Current grants are reauthenticated and intersected with the session's
pinned active-authority ceiling, so they may narrow or fail the turn but can
never widen the pinned generation. Host pointer publication changes new
sessions only; a staged/incomplete generation is never routable.

A generation remains retained by any durable staging/in-flight lease, active
host pointer, retained session, or D1 completion eligible for rollback.
Publication/completion atomically transfers the staging reference to the active/
rollback reference before releasing it. An abandoned in-flight lease releases
only after the apply is fenced, durably terminal, and cannot resume. GC is legal
only when every root is absent. Unknown references or an input/snapshot digest
mismatch fail closed.

V1 reserves no `pluginRefs` field: A1/P6 validators reject it with stable
`AGENT_DEFINITION_UNSUPPORTED_FIELD`. BBP6-010 introduces per-agent plugin refs
only with an additive schema-version bump and the resolver that gives the field
behavior. Host-default plugins may still appear in the v1 resolved catalog;
they are not definition requests. Workspace-scoped UI/routes wait for P7
trusted `agentId` routing. Duplicate names fail closed unless a separately
validated explicit override contract is introduced.

## Route/session namespace

Required scoping:

- routes: the canonical `/api/v1/agents/:agentId/...` path-prefix family (locked at pass 3; no header/request-scope alternative);
- add `agentId` to the real per-workspace runtime binding/scope used by `registerAgentRoutes` and core workspace server caches; do not assume a preexisting single composite key has every field;
- `sessionNamespace` includes `agentId` **for non-default agents only**; the **default agent keeps the pre-P7 `sessionNamespace` unchanged** (no `:agent:` suffix) as an explicit on-disk JSONL-compatibility exception, so existing default-agent sessions keep loading byte-identically (per `../work/P7-multi-agent-inspection/TODO.md` BBP7-003 — note the route/runtime `RuntimeScope.key` still carries `agentId` for *all* agents incl. the default; only the *sessionNamespace* is left untouched for the default); legacy fields such as root/template/pi/session namespace must remain isolated where they currently exist;
- session root layout preserves AGENTS.md rule: transcripts live under host durable `BORING_AGENT_SESSION_ROOT`, not workspace/container home;
- tool catalog is per agent;
- provisioning is per `(workspaceId, agentId, bashPlanFingerprint)`;
- UI commands include `agentId` for attribution where useful, while workspace UI state remains shared.

Isolation test: two agents in one workspace do not share bindings, tool catalogs, transcripts, approvals, or provisioning readiness incorrectly. Public APIs retain the runtime-owned `sessionId`, but internal storage and cache boundaries use a validated structured `SessionKey` containing the trusted tenant/workspace scope, `agentId`, and `sessionId`. UUID uniqueness is not the authorization boundary; imported/restored sessions with duplicate public ids cannot collide or cross scope.

## Session history search (#379)

Add a session index/search API independent of boring-bash.

Scope:

- `workspaceId`;
- `agentId`;
- `sessionId`;
- title/name;
- messages/content;
- operational events;
- links/deep-link metadata.

Requirements:

- Pi-native content search parity;
- no filesystem requirement;
- redaction for private/tool outputs;
- URL/deep-link compatibility;
- multi-project browse support without loading every workspace.

## Deep links and session links (#243, #211)

The multi-agent route model must support:

- opening a specific session history;
- preserving focused session in URL;
- resolving inaccessible/deleted sessions gracefully;
- not overwriting active work without user intent;
- later multi-pane layout encoding.

## External harness review/question hooks (#380)

External systems can create review/question/approval hooks against a workspace/agent/session. The authoritative request/callback/redaction contract lands in Phase 7, [`../work/P7-multi-agent-inspection/TODO.md`](../../../805/runtime-refactor/work/P7-multi-agent-inspection/TODO.md) BBP7-006; [`01-agent-core-runtime-free.md`](01-agent-core-runtime-free.md) only records that P1 defers hooks. This file defines the multi-agent routing requirements that contract must satisfy.

Requirements:

- authenticate caller;
- validate target workspace/agent/session;
- redact before writing to history;
- route to correct UI/HITL channel;
- audit attribution;
- no boring-bash dependency.

## User as principal

Do not model human user as a model-callable max-power agent.

Model user as:

- principal;
- supervisor;
- approval channel;
- grant source;
- audit actor.

Agents request grants; users approve/reject through UI/HITL channels. Privileged host actions stay in trusted app tools.

## Concurrency

Shared environment risks:

- simultaneous writes;
- one agent invalidating another agent’s read stamps;
- session transcript confusion;
- tool readiness bleed;
- child agent widening access.

Required safeguards:

- write scopes;
- stale-write stamps;
- merge/patch artifacts for isolated agents;
- per-agent tool catalog;
- per-agent readiness;
- explicit delegation depth cap.

## Tests

- resolved child-app/default agent set can seed the agent registry before plugin/runtime policy uses it;
- two agents same workspace/session id do not collide;
- session namespace includes agent id for non-default agents; the default agent's session namespace is byte-identical to pre-P7 (JSONL-compat exception);
- binding cache includes agent id (for all agents, including the default);
- per-agent tool catalog differs as expected;
- reviewer has readonly fs/no exec while coding agent has bash;
- pure concierge has no boring-bash;
- session search scoped by workspace+agent;
- deep links open target session safely;
- external hooks authenticate/redact/route;
- delegation depth cap works;
- shared-sandbox stale-write protection works.

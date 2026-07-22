# #391 plan ownership map

Issue #391 owns the Decision 28 product roadmap in [`plan.md`](plan.md): one
static application fleet, Workspace-persisted default Agent, signup-domain
initialization, independent Core/web and CLI consumers, service-shaped in-process
Agent applications, and one governed `boring-bash` Environment API over neutral
`boring-sandbox` backends.

GitHub owns broad issue/PR state. Beads own approved granular implementation
dependencies. Retained work-package files are research until their canonical
owner recuts them under Decision 28.

## Layer ownership

| Layer | Owns | Must not own |
| --- | --- | --- |
| Core/web consumer | web auth, current-app Workspace membership, Core DB persistence adapter, trusted signup request facts, web routes | fleet validation, Agent composition, domain/type portfolio, Environment provider policy, CLI lifecycle |
| CLI consumer | trusted fleet YAML edge, local Workspace registry/root policy, CLI UX/lifecycle | Core auth, hosted identity emulation, second fleet validator/composer |
| Workspace | normalized fleet/default, session authority and acting-Agent attribution, governance compilation of named Environment access, Agent lifecycle/orchestration, owner-only Environment open/close | Pi transcript/replay/queue implementation, Core/CLI identity, file/bash/provider mechanics, domain as ongoing authority |
| Agent | one streaming/control `AgentApplication`: model loop and trusted behavior composition; consumes named Environments, opaque model client, Pi session runtime | Workspace authorization/orchestration, governance evaluation, Environment service/lifecycle, HTTP deployment |
| `boring-bash` | native named Environment operations, logical source/subset resolution, current invalidation watch, file/bash coherence, local open/close service | membership, fleet/default selection, governance policy decisions, provider identity in Agent-facing types |
| `boring-sandbox` | Agent/Workspace-neutral backend providers, confinement, physical filesystems/mounts/network/process lifecycle | Agent/Workspace/Core identities, governance evaluation, UI/tool semantics |
| Host composition roots | construct frozen fleet, trusted plugins, signup mapping, Environment service/provider, application pins/rollback | client-controlled executable selection, dynamic registry/controller |

## GitHub owners

| Owner | Scope | Canonical folders | Current ruling |
| --- | --- | --- | --- |
| [#391](https://github.com/hachej/boring-ui/issues/391) | product authority, signup/default flow, corrections, release/Seneca gates | `docs/issues/391/` | Decision 28 fleet plan active |
| [#805](https://github.com/hachej/boring-ui/issues/805) | AgentApplication, Workspace orchestration, Environment/Bash/Sandbox package seams, CLI consumer, authoring | `docs/issues/805/runtime-refactor/work/` | fleet package plan active; old A1 R1–R6 snapshot historical |
| [#806](https://github.com/hachej/boring-ui/issues/806) | MCP ingress and artifacts | `docs/issues/806/runtime-refactor/work/` | recut after F8b |
| [#807](https://github.com/hachej/boring-ui/issues/807) | durable events/tasks and channels | `docs/issues/807/runtime-refactor/work/` | later durable expansion |
| [#808](https://github.com/hachej/boring-ui/issues/808) | Sandbox providers, remote execution, mounts | `docs/issues/808/runtime-refactor/work/` | must consume neutral backend/Environment contracts; independent gates remain |
| [#809](https://github.com/hachej/boring-ui/issues/809) | external/contracted consumption, identity, billing, marketplace | `docs/issues/809/runtime-refactor/` | later by named trigger |

## Retained evidence

- R0 publication/consumer audit remains evidence and must be refreshed in F0b.
- R4 declarative authored-source correction remains closed and authoritative.
- Historical architecture files remain research only where explicitly adopted.
- PR #844 is landed compatibility/migration input; F4 owns correction.
- PR #845 is unmerged and superseded in current shape; F5a/F5b own selective
  recreation and closure.

## Explicitly retired

- domain → `workspaceTypeId` → type-filtered Workspace portfolio;
- per-Workspace-type `defaultAgentTypeId + allowedAgentTypeIds` policy;
- product membership;
- combined Core/CLI `WorkspaceAgentHost` shell;
- exact shared WorkspaceRuntime/Sandbox object identity as the Agent-composition
  boundary;
- AgentHost/controller/reconciler/deployment-publication content store;
- mutable fleet/runtime registry;
- authored executable catalogs and second Agent composers;
- copied/synchronized same-Workspace or delegated-subset trees;
- permanent `RuntimeBundle`, `WorkspaceSandboxPairV1`, named-filesystem adapters,
  and local/remote branches in Agent code;
- generic Environment lease/view/token/broker/reuse machinery;
- Workspace-owned replacement of Pi transcript/replay/follow-up-queue mechanics.

## Independent-consumer rule

Core/web and CLI share Workspace semantic contracts and conformance fixtures,
not host lifecycle or identity machinery. Web adapters issue authorization after
membership. CLI adapters issue trusted-local authorization after registry/root
validation. Every Workspace operation consumes the corresponding operation-
scoped context; Workspace does not synthesize either identity model.

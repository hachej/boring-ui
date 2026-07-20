# #391 plan ownership map

Issue #391 owns the phased product roadmap in [`plan.md`](plan.md): Step 1A
domain-routed default-agent Workspace products over a multi-agent-ready backend,
Step 1B external MCP, Step 2 Workspace-local collaboration, Step 3 durable and
external expansion, and later contracted agents.

GitHub owns broad issue/PR state. Beads own approved granular implementation
dependencies. Retained work-package files are research until their canonical
owner recuts them under Decision 26.

## Layer ownership

| Layer | Owns | Must not own |
| --- | --- | --- |
| Core | auth, membership, Workspace persistence, `workspaceTypeId`, typed list/select/create | authored source loading, agent/plugin behavior, harnesses, agent sessions |
| Workspace | static default/allowed-agent policy, plugin views, one WorkspaceRuntime, provisioning union, typed singleton map, orchestration | domain as authority, second ACL system, per-agent isolation claims |
| Agent | loading/executing one requested type against a supplied runtime | Workspace policy, Core auth, second Workspace/Sandbox |
| Host app | domain/type declarations, global agent definitions, installed trusted plugins, pins/rollback | client-controlled executable selection |
| Pi follow-up | optional Boring package/extension adapter and compatible subagent executor | Core auth, server routes, Workspace lifecycle/policy |

## GitHub owners

| Owner | Scope | Canonical folders | Current ruling |
| --- | --- | --- | --- |
| [#391](https://github.com/hachej/boring-ui/issues/391) | phased product authority; domain/type/auth/create; release and Seneca product gates | `docs/issues/391/` | active Step 1A roadmap |
| [#805](https://github.com/hachej/boring-ui/issues/805) | A1 source/dev plus WorkspaceRuntime/typed AgentBinding foundation; later runtime packages/environments | `docs/issues/805/runtime-refactor/work/` | A1 plan active; other packages trigger-gated |
| [#806](https://github.com/hachej/boring-ui/issues/806) | MCP ingress and artifacts | `docs/issues/806/runtime-refactor/work/` | Step 1B/3 recut required |
| [#807](https://github.com/hachej/boring-ui/issues/807) | durable events and multi-channel transport | `docs/issues/807/runtime-refactor/work/` | Step 3 |
| [#808](https://github.com/hachej/boring-ui/issues/808) | sandbox provider extraction and mounts | `docs/issues/808/runtime-refactor/work/` | Step 3/later |
| [#809](https://github.com/hachej/boring-ui/issues/809) | agent consumption, identity, contracting, billing, catalog, channels, marketplace | `docs/issues/809/runtime-refactor/` | Step 2/3/later by trigger |

## Retained shared architecture

These #391 files remain shared reasoning, not independent dispatch authority:

- `architecture/00-global-isa.md`
- `architecture/01-agent-core-runtime-free.md`
- `architecture/02-boring-bash-environment.md`
- `architecture/03-policy-provisioning-readiness.md`
- `architecture/04-plugin-child-app-runtime.md`
- `architecture/05-multi-agent-sessions-hooks.md`
- `architecture/07-tests-review-acceptance.md`
- `architecture/08-pluggable-agent-surfaces.md`
- `architecture/09-environments-attachable.md`
- `architecture/10-sandbox-deployment-eu.md`

Decision 26 supersedes conflicting AgentHost/controller/deployment-publication
content-addressed-store ordering, singular
Step 1A agent policy, Core behavior composition, authored executable catalogs,
and same-workspace-first product sequencing.

## Historical classes

- D1 AgentHost execution and D2 mesh work are retired/non-dispatchable.
- Dated snapshots and proof remain evidence only.
- Retained child work packages regain authority only after their owner plan and
  dependency graph are recut.
- The old `wt-391-forward-c0u` graph remains historical until PR #846 merges and
  R0 installs the replacement graph.

## Physical move record

The 2026-07-17 reset moved canonical work-package documents from #391 to
#805–#809 while leaving redirect stubs. That path migration changed no runtime
behavior. Child plans at `docs/issues/805/plan.md` through
`docs/issues/809/plan.md` remain canonical entry points for their programmes.

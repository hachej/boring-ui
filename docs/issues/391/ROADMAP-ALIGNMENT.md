# #391 prebuilt work-package alignment

> [`plan.md`](plan.md) is dispatch authority. This matrix preserves useful prior
> work without allowing retired AgentHost, authored-catalog, Core-composer, or
> same-workspace-first graphs to resume.

## Status vocabulary

- **Step 1A:** required for the default-agent domain product or its multi-agent-
  ready Workspace backend.
- **Step 1B:** authenticated MCP follow-up.
- **Step 2:** activate Workspace-local agent collaboration.
- **Step 3:** durable runtime/transport/external protocol expansion.
- **Later:** demand-gated; no implementation authority.
- **Retired:** never dispatch.

Canonical child plans remain under their GitHub owner and must be recut before
dispatch.

## #391 active work

| Work | Alignment | Ruling |
| --- | --- | --- |
| Persisted `workspaceTypeId` / #844 | Step 1A complete input | Keep as Core-owned Workspace metadata. |
| PR #846 authority/A1 recut | Step 1A authority, merged | Replacement graph `wt-391-forward-step1a-current-xn9` merged via #864; R0 audit is current dispatch input. |
| Former S1–S5/R1/N1 graph | Superseded | Do not dispatch. Backend multi-agent substrate now lands under #805 before product collaboration is activated. |
| Shared architecture principles | Retained | Keep package layering, Workspace authority, paired lifecycle, session compatibility, thin surfaces, and EU-self-hostable defaults. |
| AgentHost/D1/D2/controller/deployment-publication content store | Retired | Historical evidence only. |

## #805 runtime packages and environments

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| A1 agent authoring | Step 1A active | Declarative identity/metadata/instructions only; trusted host plugins own behavior; `agent dev` launches regular server. Migrate the published `0.1.90` catalog contract only after R4.0 approval. |
| Workspace ↔ Agent binding | Step 1A active | Split shared WorkspaceRuntime from lazy typed AgentBindings; Core hands authorized context only. Prove two agent types share one Workspace + Sandbox. |
| P5 provisioning/secrets | Step 1A input / later | Reuse explicit provisioning/redaction. Provision the effective Workspace plugin union once; no D1 reconciler. |
| P6 plugin/child app | Step 1A input | Reuse trusted plugin composition and regular server. Reject separate authored-agent dev app and Core behavior resolver. |
| P7 multi-agent inspection | Step 2 product activation | Backend singleton/session identity lands in Step 1A; selectors/delegation/inspection UX wait for Step 2. |
| P8 verification | Step 1A proof | Recut around domain/type/auth, shared-runtime two-agent conformance, full-app compatibility, and Seneca proof. |
| P1 headless core | Step 3/later | Layering input only; no public runtime-none mode in Step 1A. |
| P3 routes/tools | Step 3 | Consumer-backed extraction only after Steps 1–2. |
| P4 file UI | Step 3/later | Preserve behavior; extraction requires a consumer. |
| E1 environments | Later | Generic attachments/foreign environments do not gate typed Workspaces. |

## A1 corrective PR status

| PR | Status | Ruling |
| --- | --- | --- |
| #813 source | merged | Preserve useful declarative validation. |
| #814 authored catalog | merged and published in `0.1.90` | Corrective input; R4.0 owns the explicit version/migration decision before removal. |
| #815 validate CLI | merged | Preserve/simplify declarative validation command. |
| #816 dev app | open | Do not merge; replace with regular server. |
| #817 dev CLI | open | Do not merge; replace from current `main`. |
| #821 conformance | feature-branch-only merge | Evidence only. |
| Seneca #16 | open | Replace from current Seneca `main`. |

## #806 MCP and artifacts

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| M1 managed MCP | Step 1B | Authenticated principal → persisted typed Workspace → server-selected default agent. Remove AgentHost/registry assumptions. |
| M2 MCP agent surface | Step 1B/3 | Thin default-agent binding first; multi-turn/durable expansion waits for Step 3. |
| AR1 artifacts | Step 3/later | Reuse bounded immutable artifacts for durable/external work; not required for Step 1A chat. |
| E2 MCP projection | Later contracted-agent input | Reuse readonly governed projection; never live cross-Workspace grants. |

## #807 durable transport

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| T1 durable events | Step 3 | Retain receipts/events/replay/approvals/recovery and trusted session scope; remove D1 assumptions. |
| T2 transport | Step 3 | Thin SSE/poll/channel adapters over T1. |
| Slack Chat SDK reference | Step 3/later | Channel input only after durable contract; never owns model loop. |

## #808 sandbox and mounts

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| P2 sandbox providers | Step 3 | Extract after demonstrated consumers. Preserve one Workspace + Sandbox lifecycle. |
| X1 S3/FUSE mounts | Later | Requires named native-mount consumer and security proof. |

## #809 identity, consumption, marketplace, channels

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| AC1 consumption contract | Step 2/3/later | Workspace-local native collaboration in Step 2; external A2A in Step 3; contracted mode later. |
| Workspace-native `pi-subagents` backend | Step 2 | New follow-up: current child-process executor does not share WorkspaceRuntime. |
| Boring Pi package/extension seam | Independent deferred follow-up | Not a Step 2 gate. Design independently; Pi package cannot own auth, policy, server, or WorkspaceRuntime lifecycle. |
| ID1 identity | Step 1B/3 by exposure | Existing app auth covers Step 1A. Public self-service MCP/A2A activates ID1. |
| BL1 billing | Later | Contracted/service trigger only. |
| MK1 catalog | Later | Static host declarations are not marketplace publication. |
| CH1 channels | Step 3/later | Thin adapters after durable transport. |
| S3 control-plane UX | Later | No mutable registry/control plane in Steps 1–3 without named need. |
| S4 onboarding | Later | Static config and explicit Workspace creation are sufficient initially. |

## Step 1A ownership map

| Requirement | Owner |
| --- | --- |
| Auth, membership, durable `workspaceTypeId`, typed list/select/create | Core / #391 |
| Static default/allowed policy, shared runtime, typed singleton map | Workspace / #805 A1 plan R1–R3 |
| Load/execute one typed agent | Agent / #805 A1 plan R1–R4 |
| Declarative source and validate CLI | Agent + CLI / #805 R4 |
| Regular `agent dev` | Workspace + CLI / #805 R5 |
| Full-app compatibility | Boring host / #805 R1–R5 |
| Two real domain products | Seneca / #805 R6 + #391 product gates |

## Explicitly removed from active work

- AgentHost/controller/reconciler/revisions/deployment-publication content-addressed storage.
- Authored tool/plugin/package/MCP executable references.
- Core-owned agent behavior loading/resolution.
- Separate materialized-agent dev app or second composer.
- Singular workspace-type → agent mapping; use default + allowed set now.
- Public selector/direct non-default chat in Step 1A.
- Multiple Workspace/Sandbox instances for agents in one Workspace.
- Internal MCP/A2A loopback.
- Claim that current `pi-subagents` shares Boring's runtime.
- Dynamic policy registry, runtime upload/watcher, marketplace control plane.
- Generic runtime-none, environments, mounts, billing, or channels as Step 1A
  prerequisites.

## Recut triggers

| Trigger | Plan to recut |
| --- | --- |
| Step 1A production proof | #806 M1/M2 for Step 1B MCP. |
| Product needs agent-to-agent collaboration | Step 2 plus Workspace-native `pi-subagents` backend. |
| Product needs human selector/switch/fork | Separate Step 2 UX plan; backend alone does not authorize it. |
| Any Pi agent must become Boring-aware | Boring Pi package/extension decision and conformance. |
| Multi-turn external work must survive restart | #807 T1/T2 + #809 external A2A. |
| Repeated runtime/provider duplication appears | #805 P1/P3 + #808 P2. |
| Third party contracts an agent | #809 contracted mode, ID1, billing, projection, artifact hygiene. |
| Native mount consumer appears | #808 X1. |

A trigger authorizes planning, not implementation.

# #391 prebuilt work-package alignment

> [`plan.md`](plan.md) is the dispatch authority. This matrix preserves useful
> prior planning without allowing an old dependency graph to override the
> owner-approved sequence.

## Status vocabulary

- **Step 1A input:** requirements may be reused now after being recut into the active slices.
- **Step 1B:** authenticated MCP follow-on after Seneca's Step 1A proof.
- **Step 2:** multiple agents in one workspace and native delegation.
- **Step 3:** durable runtime/transport/external protocol expansion.
- **Later:** demand-gated; no implementation authorization.
- **Retired:** AgentHost/D1/controller/CAS topology; never dispatch.

Every canonical child plan remains under its GitHub owner. Existing detailed plans are research inputs until their owner plan is recut against Decision 26.

## #391 active work

| Work | Alignment | Ruling |
| --- | --- | --- |
| Former S1–S5/R1/N1 same-workspace-first graph | Superseded | Replace with 1A.0–1A.7. Do not dispatch old Beads. |
| Shared architecture 00/01/03/04/05/07/08/10 | Retained principles | Keep package layering, workspace authority, lifecycle, session compatibility, thin surfaces, tests, and EU-self-hostable defaults. Conflicting ordering loses to Decision 26. |
| Historical D1/D2/AgentHost work | Retired | Evidence only. No controller, publication, revision, CAS, or exact-host authority restoration. |

## #805 runtime packages and environments

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| A1 agent authoring | Step 1A input | Reuse behavior-only directory validation and explicit tool references. Remove deployable-bundle/digest/runtime-resolution authority. Seneca binds authored content directly to trusted host behavior. |
| P5 provisioning/secrets | Step 1A input, mostly later | Reuse explicit provisioning, redaction, secrets-not-in-DTO rules. Do not restore D1 reconciliation/readiness engines. Typed login/list never provisions; explicit create uses existing path. |
| P6 plugin/child app | Step 1A input / Step 2 | Reuse host composition and server-owned executable authority. No `AgentDeployment` or workspace-default resolver in Step 1A. Per-agent plugin variation waits for a consumer. |
| P7 multi-agent inspection | Step 2 | Reuse trusted agent identity/session attribution later. Registry/catalog/selector and multiple agents are not Step 1A. |
| P8 verification | Step 1A proof input | Recut around domain/type/auth/full-app/Seneca proof. Delete D1 apply/publication/default-resolution gates from active use. |
| P1 headless core | Step 3/later | Layering input only; no public no-environment product mode or broad extraction in Step 1A. |
| P3 routes/tools | Step 3 | Consumer-backed `boring-bash` extraction after Steps 1–2. |
| P4 file UI | Step 3/later | Preserve current behavior; extraction only with package consumer. |
| E1 environment attachments | Later | Generic attachment and foreign environment work does not gate typed workspaces. |

## #806 MCP and artifacts

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| M1 managed MCP | Step 1B | Recut to authenticated principal -> persisted typed workspace -> sole static agent. Remove AgentHost/deployed-default/registry dependencies. Start private/pre-provisioned if owner chooses; baseline auth/limits/stable errors are mandatory. |
| AR1 shareable artifacts | Step 3/later | Reuse bounded immutable artifact semantics for durable/external tasks. Not required for Step 1A web flow. |
| M2 MCP agent surface | Step 1B/Step 3 | Begin as a thin binding to Step 1A's sole agent. Public/multi-turn/durable expansion waits for Step 3. |
| E2 MCP projection | Later contractor input | Reuse readonly governed projection ideas for contracted agents; never add live cross-workspace grants. |

## #807 durable transport

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| T1 durable events | Step 3 | Recut away from D1/P1 assumptions. Retain admission receipts, transactional events, replay offsets, approvals, recovery, and trusted session scope. |
| T2 transport | Step 3 | Thin SSE/poll/channel adapters over T1. Preserve session-ID-only public addressing only after trusted workspace/agent binding is durable. |
| Slack Chat SDK reference | Step 3/later | Channel input after the durable contract; never own the model loop. |

## #808 sandbox and mounts

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| P2 sandbox providers | Step 3 | Extract only after demonstrated consumers. Preserve Workspace+Sandbox paired lifecycle and EU provider policy. |
| X1 S3/FUSE mounts | Later | Requires a named native-mount consumer and security proof; not a typed workspace dependency. |

## #809 identity, consumption, marketplace, and channels

| Work package | Roadmap phase | Reuse / recut |
| --- | --- | --- |
| AC1 consumption contract | Step 2/3/later | Split by [`AGENT-CONSUMPTION-MODES.md`](AGENT-CONSUMPTION-MODES.md): workspace-local native delegation in Step 2; external A2A in Step 3; contractor mode later. Do not require the full dispatcher in Step 1A. |
| ID1 identity | Step 1B/3 depending exposure | Existing app auth is enough for Step 1A. Public/open self-service MCP/A2A must activate ID1 (or a new owner-approved superseding identity decision); private pre-provisioned access need not. |
| BL1 billing | Later | Contracted/service agent trigger only. |
| MK1 catalog | Later | Static host declarations are not marketplace publication. |
| CH1 channels | Step 3/later | Thin adapters after durable transport. |
| S3 control-plane UX | Later | No mutable registry/control plane in Steps 1–3 unless a named operator need emerges. |
| S4 onboarding | Later | Static deployment configuration and explicit workspace creation are enough for Step 1A. |
| Marketplace/GTM plans | Later | Product strategy reference; no implementation authority. |

## Step 1A execution ownership for absorbed requirements

| Prior input | Executing Step 1A slice |
| --- | --- |
| A1 authored directory validation and explicit tool references | 1A.6b behavior materializer; 1A.10a/b Seneca proof |
| P5 explicit provisioning/redaction constraints | 1A.4a/b typed creation/provisioning |
| P6 host/server behavior authority | 1A.2a server-only declarations; 1A.6a composition |
| P8 verification principles | 1A.8a/b conformance/rollback floor; 1A.10b production proof |

The canonical source plans stay under #805, but #391 owns only these narrow
requirements during Step 1A. Their old dependency graphs are not imported.

## Features deliberately removed from the active path

- AgentHost/D1 controller, desired state, reconciler, revisions, publication journal, active pointers, or apply journal.
- CAS/content-addressed rollout and compiled deployment resolution.
- Runtime upload, watcher, mutable registry, install/update API, or marketplace registry.
- Exact hostname as authorization or hostname-to-workspace-ID authority.
- `AgentDeployment`/`definitionRef`/`deploymentRef` as Step 1A runtime requirements.
- Same-workspace multi-agent selector before domain-routed single-agent products work.
- Per-agent sandbox inside one workspace.
- Internal MCP/A2A loopback or a new task broker for existing subagents.
- Generic runtime-none, environment attachments, FUSE/S3, billing, or fleet UX as Step 1A prerequisites.

## Recut triggers

| Trigger | Plan to recut |
| --- | --- |
| Step 1A Seneca proof complete | #806 M1/M2 for Step 1B external MCP |
| Real workspace needs two selectable agents | #391 Step 2 plus #805 P7 and #809 AC1 local mode |
| Multi-turn external work must survive restart | #807 T1/T2 plus #809 AC1 external A2A mode |
| Repeated provider/runtime duplication appears | #805 P1/P3 and #808 P2 |
| Third party contracts an agent | #809 AC1 contracted mode, ID1, billing, governance projection, artifact hygiene |
| Native mount consumer appears | #808 X1 |

A trigger authorizes planning, not implementation. Each child issue must update its canonical `plan.md`, proof, dependencies, and labels before dispatch.

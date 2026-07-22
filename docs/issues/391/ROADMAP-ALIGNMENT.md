# #391 work-package alignment under Decision 28

> [`plan.md`](plan.md) owns product/release gates; the [#805 fleet plan](../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md)
> solely owns implementation dispatch/order/contracts/acceptance. This matrix preserves useful work
> without allowing Decision 26's typed-product graph, old AgentHost machinery,
> or dormant work packages to resume.

## Active foundation

| Work | Alignment | Ruling |
| --- | --- | --- |
| Decision 28 / F0 | active authority reset | One app fleet; Workspace persisted default; independent Core/CLI consumers; AgentApplication; Environment service. |
| PR #844 `workspaceTypeId` | corrective input | Historical migration remains; field is compatibility-only and behaviorally inert. F4a audits/demotes it and adds hosted default-Agent persistence. |
| PR #845 | unmerged corrective input | Do not merge typed-product graph. F5 recreates exact-host/shared-auth security only and closes/supersedes it. |
| R0 audit / PR #869 | retained evidence | Refresh publication, consumer, raw-path, provider, session, and package inventories in F0b. |
| R4 authoring / PR #885 | complete | Keep declarative identity/metadata/instructions and validate CLI. Do not reopen catalog/composer work. |
| Old active R1–R6 graph | superseded | Replace with F0a–F8b Beads; preserve closed R0/R4 history. |

## #805 package work

| Work package | Decision 28 alignment |
| --- | --- |
| Agent authoring | closed R4 remains valid; fleet references trusted sources/plugins. |
| AgentApplication | dedicated streaming/control entrypoint; consumes readonly named Environment map, opaque model client, Pi-backed session runtime; initially in process. |
| Workspace orchestration | fleet/default/session authority, named-Environment governance, Agent lifecycle, owner-only open/close; independent consumer API, no god runtime. |
| `boring-bash` | owns native named Environment service/operations, logical source/subset resolution, and coherence; base read/write/edit/find/grep/ls/bash select one Environment directly; every other file/exec tool gets explicit disposition and the same binding. |
| `boring-sandbox` | owns neutral backend/provider mechanics and physical enforcement. |
| Provisioning/secrets | preserve current command-credential behavior; model and provider credentials stay separate; no new broker/token machinery. |
| Plugin composition | deterministic roles: Agent behavior, Workspace-global services, and governance compilers producing per-Agent/per-task named Environment source/subset/operation/network access. |
| CLI/dev | independent Workspace consumer using fleet YAML/local registry plus trusted-local per-invocation model-client issuer. |
| Verification | Core-only and CLI-only packed fixtures, per-provider coherence/security, Seneca product proof. |

Retained P1/P3/P5/P7 research may inform F0b/F1–F7 only when explicitly adopted
by the active fleet plan. It has no independent dispatch authority.

## #806 MCP and artifacts

| Work | Roadmap phase |
| --- | --- |
| Authenticated MCP | after F8b: principal → authorized Workspace → persisted default Agent. |
| Artifacts | later durable/external/contracted work. |
| Readonly projections | later contracted Agent input; explicit distinct filesystem, never a fake live copy. |

## #807 durability and channels

Durable tasks/events/replay/approvals/recovery and transport/channel adapters
remain later work. The in-process AgentApplication contract must preserve
cancellation/result semantics but does not freeze a wire protocol.

## #808 Sandbox and environments

| Work | Alignment |
| --- | --- |
| Current direct/bwrap/Vercel providers | F2 migration input; preserve behavior, publish enforcement/source-of-truth facts, run per-provider conformance. |
| Remote worker / own cloud | consumes the neutral backend/Environment service only after its independent authority/security gates. |
| Named filesystem bindings | migrate into named Environment access: logical source + exact subset + operations/network; physical roots remain service/backend-only. |
| Delegated subset Environment | F7 proves an Agent/task-specific physically enforced view over canonical source data with no copy and one-Environment-only exec. |
| General attachments/mounts | later unless expressed as another governance-approved named Environment required by F7. |

## #809 consumption

| Work | Roadmap phase |
| --- | --- |
| Workspace-local collaboration | F7 internal proof passes a delegated Agent only its task-approved named Environment subset; product selector/delegation UX later. |
| Remote Agent adapter | later named consumer of AgentApplication semantics. |
| External A2A | after durable task/event work. |
| Contracted Agents | separate Workspace/Environment plus governed projections/artifacts. |
| Identity/billing/catalog/channels | demand-gated later work. |

## Step ownership

| Requirement | Owner |
| --- | --- |
| Authenticated web Workspace context | Core/web adapter |
| Trusted-local CLI Workspace context | CLI adapter |
| Static fleet, persisted default, session authority/attribution, Environment governance, orchestration | Workspace |
| Transcript/replay/follow-up queue/model-loop session mechanics | existing Pi harness behind Workspace-authorized runtime |
| Agent model application | Agent |
| Environment operation/coherence service | `boring-bash` |
| Confinement/provider backend | `boring-sandbox` |
| Exact signup-domain mapping | web host composition |
| Fleet YAML syntax | CLI edge; compiles to Workspace fleet semantics |
| Shared sibling authentication | Core auth configuration; independent from Agent routing |
| Package cohort / Seneca proof | #391 F8a/H8/F8b + #805 package proof |

## Explicitly removed from active work

- domain-selected Workspace type or membership portfolio;
- product memberships;
- Workspace-type Agent policy and per-Workspace allowed sets;
- Core Agent behavior/default composition;
- CLI-through-Core runtime;
- a universal host shell shared by Core and CLI;
- public Agent/default selector in initial delivery;
- remote protocol before a remote consumer;
- copied same-Workspace or delegated-subset Environments;
- Agent-evaluated governance, direct EnvironmentService access, or self-opened/
  widened Environment names;
- permanent RuntimeBundle/named-filesystem adapters/local-remote Agent branches;
- generic lease/view/token/refcount/secret-broker machinery;
- AgentHost/controller/publication CAS/mutable registry.

## Recut triggers

| Trigger | Follow-up |
| --- | --- |
| F8b production proof | authenticated MCP recut. |
| Product needs human Agent/default selection | separate Workspace UX + authorization decision. |
| Product needs public/native Agent delegation | promote the F3b-ii internal seam only with explicit product authorization/UX/durability plan. |
| Named remote Agent consumer | AgentApplication remote adapter and durable transport decision. |
| Named remote Environment consumer | Environment wire/capability protocol with F1/F2 conformance. |
| Third-party contracted Agent | separate Workspace/projection/artifact/data-hygiene/billing plan. |
| Need to remove `workspaceTypeId` | published-consumer + persisted-data migration approval. |

A trigger authorizes planning, not implementation.

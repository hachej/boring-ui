# INDEX — ordering authority (#391 runtime refactor v2)

**THE single source of truth for phase ordering, dependencies, dispatch, and binding policies.** The vision is in [`VISION.md`](VISION.md); the binding architecture in [`architecture/`](architecture/); the per-phase deliverables/exit detail in each [`work/<pkg>/PLAN.md`](work/); the stacked-PR execution plan in [`PR-PLAN.md`](PR-PLAN.md). Where any file disagrees with this INDEX on ordering or policy, this file wins.

Each `work/<pkg>/` holds three files: **TODO.md** (the self-contained work order for one autonomous agent), **PLAN.md** (that phase's deliverables + exit criteria + governing architecture links), **HANDOFF.md** (the tickable closeout checklist). The legacy `todos/TODO-00..07` are **non-canonical** wherever they conflict with this pack — consult only for v1 bead intent the v2 files reference.

## Execution operating mode — outreach weeks

The running app is the owner's sales demo. Every PR is **behavior-frozen for the live app** unless its work order explicitly changes a documented invariant: existing e2e stays green, risky cutovers land dark/additive, and defaults flip only after conformance proves parity. Merge continuously as small independently-safe PRs; never hold the risk for an end-loaded mega-merge. Every PR description must include a review-time estimate and review-focus notes for the owner's 1-2h/day review budget. Stacked PRs carry labels or title notes that make merge order unambiguous.

## Phase table

**Amendment (2026-07-08):** add D2 as the shared subdomain factory sidecar
lane and relocate S1/S2 out of #391 active scope (S1 -> Slack via flue
channels; S2 -> pi-for-excel issue #551).

| Phase | Work package | Depends on | Status | Exit gist |
|---|---|---|---|---|
| Phase 0 — ADR | [P0-adr](work/P0-adr/) | — | pending | ADR accepted; plan pack thermo-reviewed; #391 points to the v2 pack |
| Phase 1 — Headless core | [P1-headless-core](work/P1-headless-core/) | P0 | pending | pure agent starts via `createAgent()` in plain Node with no environment attachment; minimal capability facts report `environments: []` plus actual registered tools; existing modes + all HTTP consumers unchanged |
| Phase M1 — Managed agent via MCP | [M1-mcp-managed-agent](work/M1-mcp-managed-agent/) | P1 pr2 façade merged | pending | stock MCP client delegates a brief to one configured vertical agent, receives progress, and gets final text + artifact refs; public share URL is BBM1-004 gated on #424/public-share API |
| Phase M2 — MCP agent surface | [M2-mcp-agent-surface](work/M2-mcp-agent-surface/) | P7, T2 | pending | per-agent MCP endpoint mounts from the canonical agent definition registry with bearer/public-demo auth, demo policy, exposure id, result/share URL shape, and conformance proof |
| Phase T1 — Durable events + approvals | [T1-durable-events](work/T1-durable-events/) | P1 | pending | SSE drop + reconnect replays losslessly; approval issued in one client answered from another; pending request + `waiting` survive restart via a new seeded turn |
| Phase T2 — Transport adapters | [T2-transport](work/T2-transport/) | T1 | pending | workspace UI runs unmodified against the refit; a headless Node consumer drives the same session interleaved with the UI |
| Phase 2 — boring-sandbox + providers | [P2-sandbox-providers](work/P2-sandbox-providers/) | P1 | partial (#416 skeleton) | package builds; no import cycle; apps compile after same-PR importer migration; landed #416 contracts unchanged |
| Phase 3 — Routes + tools move | [P3-routes-tools](work/P3-routes-tools/) | P2 | partial (#429/#454) | file tree/editor open; read/write/edit/find/grep/ls/bash work when boring-bash enabled; pure mode has none; company_context no-leak green |
| Phase 4 — File UI plugin move | [P4-file-ui](work/P4-file-ui/) | P3 | pending | `exec_ui openFile` opens files; tree data flows through one internal function; provider boundary deferred to #295 |
| Phase E1 — Environment attachments | [E1-environment-attachments](work/E1-environment-attachments/) | P2, P3 | pending | workspace + company_context unchanged; a scoped view is physically jailed; an agent holds two environments with distinct `filesystem` identities |
| Phase E2 — MCP env projection | [E2-mcp-projection](work/E2-mcp-projection/) | E1 | pending | external MCP client sees exactly an in-process readonly attachment; denied files absent; no broker secret reachable |
| Phase 5 — Provisioning / secrets | [P5-provisioning-secrets](work/P5-provisioning-secrets/) | P3 (+P2 matrix) | pending | no test reads a brokered secret from inside the sandbox; no brokered secret reachable from any sandboxed environment |
| Phase X1 — S3/FUSE mounts | [X1-s3-fuse-mounts](work/X1-s3-fuse-mounts/) | P2, P5, E1 | pending | readonly S3 mount passes no-leak; bash-visible == file-route-visible over the mount; no cred readable inside the sandbox; EU-endpoint matrix green |
| Phase D1 — Tenant provisioning | [D1-tenant-provisioning](work/D1-tenant-provisioning/) | P5, P6a, M2 | pending | one command creates tenant/workspace, runtime config, DB/storage/session roots, secrets, demo endpoint config, and a deployment manifest for the chosen EU host |
| Phase D2 — Shared subdomain tenancy | [D2-shared-tenant-mesh](work/D2-shared-tenant-mesh/) | P6a, P1, P5, P7, T1, M2 | pending | one shared EU deployment hot-registers subdomain tenants from `WorkspaceAgentsDeclaration`; unknown hosts fail closed; cross-tenant isolation conformance proves no sessions/files/pending-inputs/search/artifacts/governance leakage |
| Phase 6a — Plugin core | [P6-plugin-child-app](work/P6-plugin-child-app/) | P5 | pending | import-free manifest validation; hosted-plugin fail-closed; managed-service lifecycle; `AgentRegistry`/`AgentDefinitionDeclaration` seeded; per-agent plugin composition |
| Phase 6b — Child-app scoping | [P6-plugin-child-app](work/P6-plugin-child-app/) | P6a + #376 | **BLOCKED** (#376) | child-app requirement narrowing; Macro requirements don't leak into a generic workspace — tracked follow-up **outside the epic exit** |
| Phase 7 — Multi-agent + inspection | [P7-multi-agent-inspection](work/P7-multi-agent-inspection/) | P6a, E1, T2 | pending | agentId-scoped routes/session/search + `GET /api/v1/agents` + `GET /api/v1/agents/:agentId/info`; two surfaces bound to two agents in one workspace don't collide |
| Phase 8 — Verification + cleanup | [P8-verification](work/P8-verification/) | runtime lanes except P6b, M1, M2, D1, D2, S4 | pending | zero `TODO(remove:*)` markers repo-wide; `@hachej/boring-agent` README documents the four-part surface contract |
| Phase S3 — Control-plane UX | [S3-control-plane-ux](work/S3-control-plane-ux/) | T2, P7 | pending | one workspace inspects 2 agents + observes/approves 2 surfaces via public contracts only |
| Phase S4 — Agent onboarding | [S4-agent-onboarding](work/S4-agent-onboarding/) | S3, D1, D2, M2 | pending | workspace shows definition readiness, demo URL status, dedicated/shared tenant provisioning status, and missing policy refs without becoming an authoring UI |

## Track / dependency graph

```txt
P0 ──► P1 ──┬──► M1                    (sidecar demo lane; v0 needs P1 pr2; share-link slice gated on #424)
            ├──► P2 ──► P3 ──┬──► P4
            │                ├──► E1 ──► E2                     (E1 needs P2 AND P3)
            │                └──► P5 ──► P6a ─┬─► P7 ──► P8
            │                     │           │    └──► M2 ──┬──► D1
            │                     │           │              └──► D2
            │                     │           └─► P6b (child-app scoping; HARD BLOCKED on #376)
            │                     └──► X1      (X1 needs P2 AND P5 AND E1)
            └──► T1 ──► T2 ──► S3
                  │
                  └──────────────► D2          (D2 also needs P1/P5/P6a/P7/M2)

M2 + D1 + D2 + S3 ──► S4      (S4 needs S3 AND M2 AND D1 AND D2)
```

Parallel lanes after P1: **M1 demo lane** (v0 after P1 pr2; share-link slice only after #424/public-share API, independent of every runtime lane), **bash lane** (P2→P3→P4), **environment lane** (E1→E2, needs P2+P3), **mount lane** (X1, needs P2+P5+E1 because its shipped environment-attachment/fact path consumes E1 `Environment`/`EnvironmentAttachment`), **provisioning→child-app→multi-agent lane** (P5→P6a→P7→P8, off P3), **MCP agent-surface lane** (M2 after P7+T2), **tenant factory lane** (D1 dedicated/sovereign after P5+P6a+M2; D2 shared subdomain after P1+P5+P6a+P7+T1+M2), **transport lane** (T1→T2→S3→S4). Cross-deps not drawable inline: **P7 needs P6a and E1 and T2** (the `AgentRegistry` from P6a — not P6b's child-app scoping — plus E1 environment attachments/facts and T2's `sessionId`-only transport + two-handles guard, which carries the T1 durable approvals/`resolveInput` the external-hook route and `/info` channel facts read). **Amendment (2026-07-08):** **S1 and S2 are relocated out of #391 active scope**: S1 becomes the separate "Slack via flue channels" story, and S2 belongs to pi-for-excel issue #551. **S4 needs S3, M2, D1, and D2.** **P8 gates on all runtime lanes EXCEPT P6b, M1, M2, D1, D2, and S4; M2 is a committed follow-up surface that may ship after P8 if the runtime exit is otherwise green.**

**P6b is a tracked follow-up, not an epic exit gate.** It is HARD BLOCKED on the shared child-app platform type (`ResolvedChildAppContext`, #376); the epic ships without it and P8 verifies the P6b follow-up plus M2/D1/D2/S4 follow-up or status tracking — P8 never waits on P6b/M1/D1/D2/S4 landing, and M2 may land after P8 as a committed follow-up. This is the anti-deadlock guarantee.

Rules baked into the ordering: dependency inversion (P1) happens **before** package extraction (P2) — otherwise an agent↔bash import cycle. Each phase preserves existing workspace behavior unless it explicitly changes a documented invariant. Work already landed via #416 (company-fs stack #437/#440/#429/#454) is marked landed and must not be redone.

## Dispatch protocol

1. **One TODO file = one agent assignment.** Do not hand two files to one agent run.
2. **Respect the dependency graph.** Parallel lanes are safe to dispatch concurrently.
3. **Every PR must cite** (implementation rule — do not implement from only one file): the TODO bead id; the global ISA + the relevant area subplan (`architecture/00`–`architecture/10`); the migration phase (this INDEX + the package's PLAN.md); and the acceptance/test section ([`architecture/07-tests-review-acceptance.md`](architecture/07-tests-review-acceptance.md)).
4. **Every PR description includes review budget metadata:** estimated review time, review-focus notes, and stacked merge order when applicable.
5. **Work happens on a dedicated branch per bead or per TODO** (small PRs preferred, branch naming per [`PR-PLAN.md`](PR-PLAN.md)). Never on main, never in a shared checkout.
6. **Behavior freeze** unless the bead explicitly changes a documented invariant. The landed #416 contracts (`packages/boring-bash/src/shared`) are load-bearing for the governance PR line — extending is fine, breaking is not.
7. **A bead is done when Verification commands AND Review gates pass**, not when code compiles. Each TODO ends with both; the package HANDOFF.md is the tickable closeout.

**Review rule (thermo, before coding each file).** A clean review means: no package import cycle; no duplicated provisioning/readiness system; no filesystem/bash split brain; no hidden cwd/filesystem leak in pure agent mode; no child-app or multi-agent scope leak; no claim that unrelated backlog issues are solved by this abstraction.

## Binding policies

### No-compat / simplicity (binding on every TODO)

All `@hachej/*` consumers live in this monorepo. There is **no external migration audience** — no deprecation windows, no deprecated aliases, no `/legacy` paths, no type-only re-export stubs that outlive their phase.

1. **Migrate every importer in the same PR** that moves or renames a thing. Grep is the migration tool, not a shim.
2. **Transitional code has a deadline.** If an old path must stay alive while the new one lands, it carries a `// TODO(remove:<bead-id>)` marker + a deletion bead. A phase is not done while any of its markers remain. **Cross-TODO cutover carve-out:** the deletion bead a marker names may live in a **later** TODO **as long as the marker explicitly names that owner** (canonical: the `?cursor=` NDJSON path kept alive across T1, deletion owned by `BBT2-006` in T2). Every marker names a real deletion bead; no marker outlives its named owner's phase. Phase 8 verifies zero markers remain repo-wide.
3. **No abstraction without two real consumers in the same phase** (or one named consumer in the immediately following phase). No speculative parameters/generics/registries/config indirection beyond the one typed config object.
4. **No parallel implementations past their cutover.** When the DS transport passes conformance, the bespoke replay dies in the same PR stack. When tools/routes move to boring-bash, the origin files are deleted, not stubbed.
5. **New options never grow env-var fallbacks.** Env/file parsing lives in host/CLI composition only (P1).
6. **If a bead seems to need a compat shim for anything outside this repo — stop and ask.**

The only legitimate compat surfaces (do NOT break): on-disk pi session JSONL (existing user sessions must load), the landed #416 shared contracts (`packages/boring-bash/src/shared`), and server↔front within one release train.

### Versioning & flagging (how cutovers ship)

No feature-flag framework. Version is carried where it already exists:

- **Wire:** `AgentEvent.v` is the protocol version (starts at 1); DS stream routes are **new paths** added in T1 alongside the old `?cursor=` route, so old front + new server coexist during development. That additive window *is* the flag — T2 flips the front, then deletes the old route in the same phase (rule 2).
- **Dark-launch seam:** the front transport is injectable (`usePiSessions({ createRemoteSession })`). T2 may land the DS transport dark behind that injection for at most one PR, then flip the default and delete the legacy path. No user-facing toggle.
- **Package:** bump `@hachej/boring-agent` minor at the T2 cutover (protocol change) and at P3 (tool/route relocation). Server and front ship together in the CLI package, so no long-lived skew exists.

### Global non-negotiables (apply to every TODO)

- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash` **or `@hachej/boring-sandbox`** (agent defines the contracts both consume and imports neither; enforced by `packages/boring-bash/scripts/check-invariants.mjs` + the boring-sandbox invariant scripts — extend, don't bypass). Acyclic layering: `boring-sandbox → agent(types)`; `boring-bash → boring-sandbox(values) + agent(types)`.
- Surfaces never own the loop; surface packages import only the public agent contract (+ their channel ingress package).
- **Two handles:** `sessionId` runtime-owned; platform addressing surface-owned; public agent APIs never accept platform addressing.
- **One approval channel:** HITL declared on the tool, travels as stream events.
- `filesystem + path + operation + actor` is the resource identity; path alone never selects a filesystem.
- Existing workspace behavior and company_context no-leak conformance stay green in every phase.
- **EU-sovereign defaults** (00 invariant 15): no bead may introduce a US-hosted service as a default or hard dependency; US-hosted providers are optional providers behind the capability matrix — never the default path.

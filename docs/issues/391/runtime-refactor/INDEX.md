# INDEX — ordering authority (#391 runtime refactor v2)

**THE single source of truth for phase ordering, dependencies, dispatch, and binding policies.** The vision is in [`VISION.md`](VISION.md); the binding architecture in [`architecture/`](architecture/); the per-phase deliverables/exit detail in each [`work/<pkg>/PLAN.md`](work/); the stacked-PR execution plan in [`PR-PLAN.md`](PR-PLAN.md). Where any file disagrees with this INDEX on ordering or policy, this file wins.

Each `work/<pkg>/` holds three files: **TODO.md** (the package coordinator containing multiple beads), **PLAN.md** (that phase's deliverables + exit criteria + governing architecture links), **HANDOFF.md** (the tickable closeout checklist). The autonomous assignment unit is **one bead/PR row**. Do not dispatch an entire multi-PR TODO as one task. The legacy `todos/TODO-00..07` are **non-canonical** wherever they conflict with this pack — consult only for historical bead intent the v2 files reference.

## Execution operating mode — outreach weeks

The running app is the owner's sales demo. Every PR is **behavior-frozen for the live app** unless its work order explicitly changes a documented invariant: existing e2e stays green, risky cutovers land dark/additive, and defaults flip only after conformance proves parity. Merge continuously as small independently-safe PRs; never hold the risk for an end-loaded mega-merge. Every PR description must include a review-time estimate and review-focus notes for the owner's 1-2h/day review budget. Stacked PRs carry labels or title notes that make merge order unambiguous.

## Binding delivery gates and live status

Status reflects `main` plus the workspace-first amendment, **Decision 21, accepted 2026-07-11** (landed via
[#617](https://github.com/hachej/boring-ui/pull/617)). Architecture may remain
documented before implementation; only rows marked **v1 gate** block v1.

**V1 product path:** exact hostname -> landing/auth -> authorized workspace ->
deployed agent selected as that workspace's `default`.

**Build order (owner priorities, 2026-07-11 — see "Owner priorities" below):**
#631 + P1 recut → P6-R → D1-reframed (+P5a) → M1 recuts (#549/#556) → ID1 →
AR1 → M2/E2 → T1/T2 → P2/X1. M1 is on this path (after P6-R/D1-reframed,
before ID1/AR1), no longer a purely optional side tracer.

| Milestone | Work package | Depends on | Live status | Exit gist |
| --- | --- | --- | --- | --- |
| P0 — decisions | [P0](work/P0-adr/) | — | **base merged** (#521/#522); decision 21 **accepted** (#617) | existing v2 pack remains main authority; workspace-first amendment has landed |
| P1 — workspace-composed agent core | [P1](work/P1-headless-core/) | P0 | **core/local lifecycle landed through [#627](https://github.com/hachej/boring-ui/pull/627)** — boundary #616, workspace correction #622, `/core` relocation #626, and terminal local binding disposal #627 are verified on main | finish request-binding/service teardown lifecycle, then fail-closed readiness; no public pure mode or host-global disposal |
| R0 — managed MCP tracer | [M1](work/M1-mcp-managed-agent/) | P1 boundary + workspace binding | **optional/non-blocking; partial** — delegate server #538 is on main; old #549/#556 stacks require a current-main recut if outreach value justifies it | bearer-authenticated stock client addresses one workspace-backed configured agent with bounded self-contained output; no v1 dependency |
| P6-D — minimal definition | [P6](work/P6-plugin-child-app/) | Decision 21 (accepted) | **landed** — minimal identities/digests relanded via [#623](https://github.com/hachej/boring-ui/pull/623), verified on main | minimal `AgentDefinition` + `AgentDeployment` schemas/digests and verified bundle lookup |
| A1 — agent-directory authoring | [A1](work/A1-agent-authoring/) | P6-D for compile; P6-R for local run | **compiler landed** — deterministic directory compiler relanded via [#624](https://github.com/hachej/boring-ui/pull/624); workspace-backed validate/dev remains | `agents/<name>/` emits one content-addressed bundle; local dev creates/selects an explicit workspace and approved runtime |
| P2 — dedicated runtime minimum | [P2](work/P2-sandbox-providers/) | P1 | **structural preflight only** — [#628](https://github.com/hachej/boring-ui/pull/628) landed runsc config/preflight with `productionReady: false`; lifecycle, security policy, provider availability, and EU parity remain unproved | validate the D1-consumed runsc/systrap path on the intended EU host before D1 locks; no silent direct fallback |
| P5a — dedicated provisioning minimum | [P5](work/P5-provisioning-secrets/) | narrow P2 | **v1 gate; narrow/rework** | only D1-consumed orchestration, readiness, fingerprint, secret brokerage, and authenticated fail-closed runsc-worker facts |
| P6-R — workspace/deployment resolution | [P6](work/P6-plugin-child-app/) | P6-D, P1, narrow P5a | **v1 gate; narrow/rework** | host verifies bundle assets and resolves deployment, workspace-owned composition, approved runtime, and `default` binding to one immutable digest |
| D1 — dedicated EU site delivery | [D1](work/D1-tenant-provisioning/) | A1, P2 runsc, P5a, P6-R | **v1 gate; pending** | exact hostname -> bounded landing -> auth -> authorized workspace -> deployed `default` agent, plus idempotent apply/rollback; no M2 dependency |
| P8 — v1 proof/cleanup | [P8](work/P8-verification/) | all reduced v1 gates above | **pending** | measured workspace-backed golden path, residual pure-mode grep, rollback, and zero v1-owned removal markers; 15 minutes remains a target until baselined |
| ID1 — agent-driven identity | [ID1](work/ID1-agent-identity/) | M1 (MCP surface) + existing membership/auth model | **spec settled — not started; gates AR1/priority 2** (owner decision 2026-07-11) | MCP OAuth 2.1 + PKCE (RFC 9728/8707; CIMD primary, RFC 7591 fallback); auto-provisioned account + personal workspace on first token exchange; EU-sovereign auth server |
| AR1 — shareable artifacts | [AR1](work/AR1-shareable-artifacts/) | ID1 + M1 (MCP surface) + workspace contract | **spec settled 2026-07-11 (owner-grilled) — small; depends on ID1** | workspace-as-is deep links: share entry (stable ID → workspace + path + provenance), live reference semantics, tombstone for broken refs, membership-only auth, MCP resource for machine access |

**Footnote:** Status entries above must cite merge-commit-ancestry-verified state (`git merge-base --is-ancestor <sha> origin/main`), not GitHub MERGED labels — see the stacked-PR trap note in [`REVIEW-2026-07-11-unknowns.md`](REVIEW-2026-07-11-unknowns.md).

## Owner priorities (2026-07-11)

Explicit product priorities set by the owner; ordering below refines the v1
path without changing decision 21's workspace-first acceptance.

1. **Multi-agent prod hosting** — run MANY distinct agents in ONE prod
   deployment, each mapped to workspaces. (P1 + A1 + P6-R + D1-reframed; see
   the D1 reframing note in
   [`work/D1-tenant-provisioning/PLAN.md`](work/D1-tenant-provisioning/PLAN.md).)
2. **External agent consumption via MCP + shareable artifacts** — a consumer
   agent receives an artifact link, opens it, lands in its workspace.
   (M1 → M2/E2 promoted from post-v1; NEW workpackages
   [ID1](work/ID1-agent-identity/PLAN.md) agent-driven identity (spec settled,
   gates this priority) and [AR1](work/AR1-shareable-artifacts/PLAN.md)
   shareable artifact links — spec settled 2026-07-11, owner-grilled.)
3. **Multi-channel consumption of the same agent.** (arch-08 surfaces + T1
   completion + T2; stays behind priorities 1–2.)
4. **Sandbox proper** — provider extraction + S3/FUSE mounts. (P2 + X1; last —
   existing in-monolith sandboxing keeps working meanwhile.)

**Derived build order:** [#631](https://github.com/hachej/boring-ui/pull/631) +
P1 recut → P6-R → D1-reframed (+P5a) → M1 recuts
([#549](https://github.com/hachej/boring-ui/pull/549)/[#556](https://github.com/hachej/boring-ui/pull/556))
→ ID1 → AR1 → M2/E2 → T1/T2 → P2/X1.

Inter-agent abstraction settled: one consumption contract (A2A-shaped
semantics), bindings = UI / MCP (external) / native internal / A2A (future
external). See [DECISIONS.md #22](../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges).

## Post-v1 increments

These plans are retained, but they do not block v1. R0 is itself an optional
leaf and does not define release ordering.

| Increment | Work package | Earliest dependency | Reason deferred |
| --- | --- | --- | --- |
| T1/T2 durability and transport replacement | [T1](work/T1-durable-events/), [T2](work/T2-transport/) | workspace-first v1 proof or a named reliability consumer | existing workspace transport is sufficient for the dedicated v1 path; durable admission/request idempotency belongs here |
| P3 full route/tool extraction | [P3](work/P3-routes-tools/) | narrow P2 plus a second package consumer | v1 reuses current boring-bash/workspace composition; broad relocation adds cutover risk without changing the dedicated journey |
| E1 generic environment attachments | [E1](work/E1-environment-attachments/) | P3 plus a second attachment consumer | v1 has one authorized workspace/runtime composition; generic N-environment lifetime machinery is not required |
| True no-environment execution | [P1 historical pure beads](work/P1-headless-core/TODO.md) | named non-workspace consumer + new decision | no public/product consumer in v1; may return only as explicit composition, never a `runtimeMode` fork |
| P4 presentation extraction | [P4](work/P4-file-ui/) | P3 | moving workspace editors into a runtime package is disproportionate; capability-gate the existing plugin first |
| E2 foreign-agent environment projection | [E2](work/E2-mcp-projection/) | E1, P6-R | consumes injected deployment attachment lookup; second environment consumer after v1 |
| X1 S3/FUSE | [X1](work/X1-s3-fuse-mounts/) | P2, P5a, E1 | no current native-mount consumer; performance and operations risk |
| P5b advanced provisioning | [P5](work/P5-provisioning-secrets/) | P5a | SDK archives, managed services, and remote-worker generality need real consumers |
| P6 plugin/child-app expansion | [P6](work/P6-plugin-child-app/) | P6-R, P7 where agent routing is required | per-agent plugin routes/UI require `agentId`; child apps remain blocked on #376 |
| P7 multi-agent/control APIs | [P7](work/P7-multi-agent-inspection/) | P6-R, E1, T2 | agent routing/info first; search, hooks, and subagent grants split into later beads |
| M2 canonical MCP surface | [M2](work/M2-mcp-agent-surface/) | P7, T2 | R0 proves MCP delivery without making exposure policy part of the definition |
| D2 shared tenancy | [D2](work/D2-shared-tenant-mesh/) | dedicated D1 repeated and trusted tenant context designed | v1 deliberately avoids a shared multi-tenant control plane |
| S3/S4 control plane/onboarding | [S3](work/S3-control-plane-ux/), [S4](work/S4-agent-onboarding/) | P7 and delivery status APIs | product UX after the kernel and dedicated path are proven |

## Dependency graph

```txt
Optional tracer:
P0 -> P1 boundary -> R0/M1 stock-client tracer (non-blocking)

Version 1:
P0/accepted decision 21 -> P6-D -> A1-compile -----------┐
P0 -> P1 boundary -> P2(runsc minimum) -> P5a(minimum) --┼-> P6-R -> A1-dev -> D1 -> P8
                                                          ┘

Post-v1:
T1/T2 | full P3 | E1 | no-environment | P4 | E2 | X1 | P5b |
P6 plugin/child-app | P7 | M2 | D2 | S3/S4
```

P1 precedes runtime resolution and delivery because it establishes workspace composition, lifecycle,
attribution where required, deterministic tool merge, and the real dependency
boundary. Durable admission and caller request idempotency are T1-owned unless
a current v1 consumer proves a smaller requirement. P6-D did not depend on
the P1 production correction: decision 21 fixed its behavior-only schema, so it
and A1 compile landed independently of P1. Those branches join before P6-R and A1
local dev. Plugin/runtime resolution stays later in P6-R. D1 adds one exact-host landing/auth binding over the existing
HTTP/workspace delivery surface and therefore does not wait for M2 or D2's
shared-host router. Work already landed via #416 is reused and must not be
redone.

## Parallel and background tracks

Parallel work is allowed only when ownership and merge gates stay explicit.
"Background" never means "merge without its prerequisites" or "invent a
temporary version of a frozen contract."

| Track | Can run in parallel | Frozen boundary | Merge/integration gate | Action now |
| --- | --- | --- | --- | --- |
| R0/M1 tracer | after the P1 workspace/Fastify boundary; beside every v1 lane | additive workspace-backed bearer sidecar only; no durable admission/idempotency gate | stock-client smoke, bounded output, no v1 dependency | optional outreach leaf only |
| P6-D -> A1 compile | landed through #623/#624 | minimal definition/deployment identities and deterministic compiler only; no generic environment or tenant lifecycle | verified main ancestry | consume from P6-R/A1 dev without widening |
| P1 -> P2 -> P5a -> P6-R | P1 core/local lifecycle and P2 structural preflight have landed; remaining slices stay ordered | only dedicated runsc, existing workspace composition, readiness, and secret brokerage consumed by D1 | real EU runsc validation spike + stateless resolved/default binding | lifecycle/teardown, readiness, EU spike, then narrow P5a/P6-R |
| T1/T2, full P3, E1 | post-v1 only | retain documented contracts; do not merge current downstream stacks into v1 | named consumer + revalidated bases | freeze |
| X1 S3/FUSE | draft/background worktree only until P2 + P5a + E1 + a named native-mount consumer exist | package-local `boring-sandbox/mounts`, MinIO proof, and benchmark only; no D1 storage, E1/P5 contract, agent/workspace API, or `company_context` change | full E1 integration, bash/file visibility parity, credential canary, EU MinIO matrix, corrected benchmark before thresholds lock | keep #581 draft/deferred; never gate v1 |
| E2 environment MCP | after E1 + P6-R; beside later D1/P7 follow-up | reuse attachment/projection authority; no new environment owner | MCP no-leak, identity, and exec gating | later clean leaf |
| M2 agent MCP | after P7 + T2 | thin surface adapter only; no runtime ownership | exposure/auth/result conformance | later clean leaf |

P4, P5b, P6 expansion/P7, D2, and S3/S4 are not safe background work today:
they either overlap live v1 ownership seams, lack a real consumer, or depend on
the dedicated path being proven first. Keep them documented and undispatched.

## Dispatch protocol

1. **One bead/PR = one agent assignment.** A package TODO coordinates multiple
   assignments; never dispatch the entire multi-PR TODO as one run.
2. **Respect the dependency graph.** Parallel lanes are safe to dispatch concurrently.
3. **Every PR must cite** (implementation rule — do not implement from only one file): the TODO bead id; the global ISA + the relevant area subplan (`architecture/00`–`architecture/10`); the migration phase (this INDEX + the package's PLAN.md); and the acceptance/test section ([`architecture/07-tests-review-acceptance.md`](architecture/07-tests-review-acceptance.md)).
4. **Every PR description includes review budget metadata:** estimated review time, review-focus notes, and stacked merge order when applicable.
5. **Work happens on a dedicated branch per bead/PR.** Never on main or in a shared checkout.
6. **Behavior freeze** unless the bead explicitly changes a documented invariant. The landed #416 contracts (`packages/boring-bash/src/shared`) are load-bearing for the governance PR line — extending is fine, breaking is not.
   **Amendment (2026-07-06):** since #552, `@hachej/boring-bash` and `@hachej/boring-governance` are published to npm (cohort-versioned) with an external consumer (Constellation). The frozen surface is therefore not only `packages/boring-bash/src/shared` but every `@hachej/boring-bash/server` export that `@hachej/boring-governance` imports (`COMPANY_CONTEXT_FILESYSTEM_ID`, `ScopedFilesystemRuntimeBindingManager`, `createReadonlyProjectionOperations`, the projection error codes/types). In-repo same-PR importer migration remains the rule, but changes to these exports must keep the bash+governance pair compatible at equal cohort versions; a breaking change requires a coordinated cohort bump with both packages migrated in the same PR.
7. **A bead is done when Verification commands AND Review gates pass**, not when code compiles. Each TODO ends with both; the package HANDOFF.md is the tickable closeout.

**Plan-write rule.** `INDEX.md` has one writer: the owner/orchestrator. Other
agents may propose changes, but must update scoped work-package docs or append
dated review notes until the orchestrator reconciles ordering and live status
here.

**Review rule (thermo, before coding each file).** A clean review means: no package import cycle; no duplicated provisioning/readiness system; no filesystem/bash split brain; no workspace/runtime authorization bypass; no public `runtime: 'none'` or mode-label fork; no child-app or multi-agent scope leak; no claim that unrelated backlog issues are solved by this abstraction.

## Binding policies

### No-compat / simplicity (binding on every TODO)

Unpublished internal paths have no external migration audience: migrate their
in-repo consumers atomically with no deprecated aliases or legacy stubs.
Published `@hachej/boring-bash`/governance exports do have an external audience;
they require coordinated cohort/semver policy and rollback as described above.

1. **Migrate every importer in the same PR** that moves or renames a thing. Grep is the migration tool, not a shim.
2. **Transitional code has a deadline.** If an old path must stay alive while the new one lands, it carries a `// TODO(remove:<bead-id>)` marker + a deletion bead. A phase is not done while any of its markers remain. **Cross-TODO cutover carve-out:** the deletion bead a marker names may live in a **later** TODO **as long as the marker explicitly names that owner** (canonical: the `?cursor=` NDJSON path kept alive across T1, deletion owned by `BBT2-006` in T2). Every marker names a real deletion bead; no marker outlives its named owner's phase. Phase 8 verifies zero markers remain repo-wide.
3. **No abstraction without two real consumers in the same phase** (or one named consumer in the immediately following phase). No speculative parameters/generics/registries/config indirection beyond the one typed config object.
4. **No parallel implementations past their cutover.** When the DS transport passes conformance, the bespoke replay dies in the same PR stack. When tools/routes move to boring-bash, the origin files are deleted, not stubbed.
5. **New options never grow env-var fallbacks.** Env/file parsing lives in host/CLI composition only (P1).
6. **If a bead seems to need a compat shim for anything outside this repo — stop and ask.**

The only legitimate compat surfaces (do NOT break): on-disk pi session JSONL (existing user sessions must load), the landed #416 shared contracts (`packages/boring-bash/src/shared`), server↔front within one release train, and — **Amendment (2026-07-06), since #552** — the `@hachej/boring-bash/server` exports consumed by the npm-published `@hachej/boring-governance` (the pair must stay compatible at equal cohort versions; see rule 6).

### Versioning & flagging (how cutovers ship)

No feature-flag framework. Version is carried where it already exists:

T1/T2 and the full P3 cutover are post-v1 under decision 21. The bullets below
remain their future cutover rules, not v1 gates.

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

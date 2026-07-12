# INDEX — ordering authority (#391 runtime refactor v2)

**THE single source of truth for phase ordering, dependencies, dispatch, and binding policies.** The vision is in [`VISION.md`](VISION.md); the binding architecture in [`architecture/`](architecture/); the per-phase deliverables/exit detail in each [`work/<pkg>/PLAN.md`](work/); the stacked-PR execution plan in [`PR-PLAN.md`](PR-PLAN.md). Where any file disagrees with this INDEX on ordering or policy, this file wins.

Each `work/<pkg>/` holds three files: **TODO.md** (the package coordinator containing multiple beads), **PLAN.md** (that phase's deliverables + exit criteria + governing architecture links), **HANDOFF.md** (the tickable closeout checklist). The autonomous assignment unit is **one bead/PR row**. Do not dispatch an entire multi-PR TODO as one task. The legacy `todos/TODO-00..07` are **non-canonical** wherever they conflict with this pack — consult only for historical bead intent the v2 files reference.

## Execution operating mode — outreach weeks

The running app is the owner's sales demo. Every PR is **behavior-frozen for the live app** unless its work order explicitly changes a documented invariant: existing e2e stays green, risky cutovers land dark/additive, and defaults flip only after conformance proves parity. Merge continuously as small independently-safe PRs; never hold the risk for an end-loaded mega-merge. Every PR description must include a review-time estimate and review-focus notes for the owner's 1-2h/day review budget. Stacked PRs carry labels or title notes that make merge order unambiguous.

## Binding delivery gates and live status

Status reflects `main` plus the workspace-first amendment, **Decision 21, accepted 2026-07-11** (landed via
[#617](https://github.com/hachej/boring-ui/pull/617)), plus **Decisions 22 and 23 (Accepted)** (landed via
[#632](https://github.com/hachej/boring-ui/pull/632) and the reconciled pack; 23 accepted 2026-07-12).
**Decision 24** (identity server selection) is **Proposed**, pending merge. Architecture may remain
documented before implementation; only rows marked **v1 gate** block v1.

**V1 product path:** one Docker host carries N site/workspace/deployment
bindings; each exact hostname -> landing/auth -> authorized workspace ->
deployed agent selected as that workspace's `default`.

**Build order (owner priorities, 2026-07-11 — see "Owner priorities" below):**
#631 + P1 recut (landed #642) → P6-R (landed #647) → D1-reframed (+conditional P5a) → M1 recuts
(landed #650) → AR1 → M2/E2 → T1/T2 → P2/X1. M1 is
on this path (after P6-R/D1-reframed and before AR1), no longer a purely
optional side tracer. ID1 remains in the later public self-service/marketplace lane.

| Milestone | Work package | Depends on | Live status | Exit gist |
| --- | --- | --- | --- | --- |
| P0 — decisions | [P0](work/P0-adr/) | — | decisions 21, 22, and 23 Accepted via #617/#632 (23 accepted 2026-07-12); Decision 24 (identity server) Proposed, pending merge | workspace authority, one consumption contract, and multi-agent Docker-first topology are explicit |
| P1 — workspace-composed agent core | [P1](work/P1-headless-core/) | P0 | **landed** — request-binding lifecycle through [#631](https://github.com/hachej/boring-ui/pull/631); fail-closed readiness recut landed via [#642](https://github.com/hachej/boring-ui/pull/642) | land readiness only; no replay of superseded pure mode, capability snapshot, input-asset registry, or lifecycle stacks |
| P6-D — minimal definition | [P6](work/P6-plugin-child-app/) | Decision 21 (accepted) | **landed** — minimal identities/digests relanded via [#623](https://github.com/hachej/boring-ui/pull/623), verified on main | minimal `AgentDefinition` + `AgentDeployment` schemas/digests; A1 compiler supplies the verified bundle directly to P6-R |
| A1 — agent-directory authoring | [A1](work/A1-agent-authoring/) | P6-D for compile; P6-R + D1-R0 composition producer for local run | **compiler landed** via [#624](https://github.com/hachej/boring-ui/pull/624); local dev needs a current-main recut after the producer lands and gates P8, not D1 | `agents/<name>/` emits one content-addressed bundle; local dev reuses the host's authorized binding/composition identity with no second composer |
| P6-R — workspace/deployment resolution | [P6](work/P6-plugin-child-app/) | P6-D, P1 | **landed** — stateless deployment resolver via [#647](https://github.com/hachej/boring-ui/pull/647) | one pure call resolves one already-authorized deployment + workspace-composition + workspace-`default` binding; D1 obtains N bindings through N calls; no batch owner or P2/P5a dependency |
| P5a — Docker-host provisioning minimum | [P5](work/P5-provisioning-secrets/) | demonstrated D1 gap | **conditional priority-1 support** | after the D1 tracer, add only a missing secret-ref or host-readiness seam; D1 owns desired digest/apply/rollback and no sandbox-provider abstraction is added |
| D1 — multi-agent Docker delivery | [D1](work/D1-tenant-provisioning/) | A1 compiler, P6-R; conditional P5a alongside | **priority-1/v1 gate; D1-R0-SPEC.md merged ([#649](https://github.com/hachej/boring-ui/pull/649)); D1-001…003 LANDED (ancestry-verified: [#652](https://github.com/hachej/boring-ui/pull/652), [#653](https://github.com/hachej/boring-ui/pull/653), [#654](https://github.com/hachej/boring-ui/pull/654), [#660](https://github.com/hachej/boring-ui/pull/660), [#662](https://github.com/hachej/boring-ui/pull/662), [#665](https://github.com/hachej/boring-ui/pull/665), [#667](https://github.com/hachej/boring-ui/pull/667)); D1-004…006 remaining** | one Docker deployment hosts N deployed agents mapped through authorized workspaces; each exact hostname lands in a workspace whose deployed agent is `default`; dedicated VM is variant 2 |
| P8 — v1 proof/cleanup | [P8](work/P8-verification/) | D1 priority-1 path | **pull-forward slice landed** — golden-path script+json+CI gates via [#664](https://github.com/hachej/boring-ui/pull/664) | measured multi-agent Docker golden path, residual pure-mode grep, rollback, and zero v1-owned removal markers; 15 minutes remains a target until baselined |
| M1 — managed MCP ingress | [M1](work/M1-mcp-managed-agent/) | P1 workspace/Fastify boundary (+P6-R) | **landed** — recut #650 MERGED (delivery v0 + composition + stock-client smoke; acceptance passed) | bearer-authenticated stock client resolves an authorized workspace/default agent and receives bounded self-contained output |
| AR1 — shareable artifacts | [AR1](work/AR1-shareable-artifacts/) | M1 + workspace contract | **priority-2 spec package; AR1-001 drafted ([#656](https://github.com/hachej/boring-ui/pull/656)), amended+owner-ratified ([#668](https://github.com/hachej/boring-ui/pull/668)) — READY FOR DISPATCH (Lane W)** | canonical pinned handle materializes an immutable copy in the authorized destination workspace, then returns a destination-local deep link; no arbitrary URL/path fetch |
| M2/E2 — canonical MCP + consumer intake | [M2](work/M2-mcp-agent-surface/), [E2](work/E2-mcp-projection/) | M1, AR1, P6-R | **priority-2; recut required** | graduate the tracer and artifact intake without waiting for P7, T2, or generic E1 attachments |
| T1/T2 — durable multi-channel transport | [T1](work/T1-durable-events/), [T2](work/T2-transport/) | priority-2 MCP/artifact proof | **priority-3; recut required** | consume the same workspace-backed agent from multiple channels with one durable event/approval contract |
| AC1 — agent consumption contract | [AC1](work/AC1-agent-consumption-contract/) | P1/P6-R behavior; ID1 for public contracted mode | **marketplace roadmap; decision settled ([#22](../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges)), tracked in [#636](https://github.com/hachej/boring-ui/issues/636)** | one A2A-shaped contract; native internal binding; subagent/contracted modes; does not widen P6-R or v1 `AgentDefinition` |
| ID1 — agent-driven identity | [ID1](work/ID1-agent-identity/) | M1 + existing membership/auth model | **marketplace self-service; spec settled, not a cold-start or AR1 tracer gate; identity server selection is [Decision 24](../../../DECISIONS.md#24-identity-server-ory-hydra--boring-owned-adapter-layer) (Proposed)** | MCP OAuth 2.1 + PKCE; auto-provisioned account + personal workspace; EU-sovereign auth server |
| BL1 — engagement billing | [BL1](work/BL1-engagement-billing/) | AC1 contracted mode; ID1 | **gap identified — marketplace path, phase 4/5** | price contracted agents, invoice engagements/tasks, and account for creator payouts by decorating boring-governance's metering seam |
| MK1 — agent catalog | [MK1](work/MK1-agent-catalog/) | P6-R; AC1 | **gap identified — marketplace path, phase 4/5** | public profiles, browse/search, and "contract this agent" entry; v1 profiles derive from `AgentDefinition` metadata |
| CH1 — consumer channels | [CH1](work/CH1-consumer-channels/) | T1/T2; arch-08 surfaces | **gap identified — marketplace path, phase 4/5** | Telegram first, WhatsApp Business second; bind the same task/contextId/input-required contract; Slack stays outside #391 |
| P2/X1 — sandbox providers and S3/FUSE | [P2](work/P2-sandbox-providers/), [X1](work/X1-s3-fuse-mounts/) | priorities 1-3 | **priority-4/last; isolated Sol P2 recut in progress** | extract providers, prove isolation/EU facts, then add mounts; neither gates P6-R or D1 |

**Footnote:** Status entries above must cite merge-commit-ancestry-verified state (`git merge-base --is-ancestor <sha> origin/main`), not GitHub MERGED labels — see the stacked-PR trap note in [`REVIEW-2026-07-11-unknowns.md`](REVIEW-2026-07-11-unknowns.md).

**Reconciliation note (fresh-eyes round 1):** the M2/E2-before-T1/T2 ordering above is the owner-ruled priority and stands as-is; PR-PLAN.md's M2 section carried a stale "after P7 + T2" precondition that created an apparent ordering cycle against this INDEX — that file, not this one, has been corrected to match this table.

## Owner priorities (2026-07-11)

Explicit product priorities set by the owner; ordering below refines the v1
path without changing decision 21's workspace-first acceptance.

1. **Multi-agent prod hosting** — run MANY distinct agents in ONE prod
   deployment, each mapped to workspaces. (P1 + A1 + P6-R + D1-reframed; see
   the D1 reframing note in
   [`work/D1-tenant-provisioning/PLAN.md`](work/D1-tenant-provisioning/PLAN.md).)
2. **External agent consumption via MCP + shareable artifacts** — a consumer
   agent receives an artifact link, opens it, lands in its workspace.
   (M1 → AR1 → M2/E2 promoted from post-v1. M1's authenticated
   subject/workspace seam is sufficient for the tracer; marketplace self-service
   identity in [ID1](work/ID1-agent-identity/PLAN.md) remains a later layer.)
3. **Multi-channel consumption of the same agent.** (arch-08 surfaces + T1
   completion + T2; stays behind priorities 1–2.)
4. **Sandbox proper** — provider extraction + S3/FUSE mounts. (P2 + X1; last —
   existing in-monolith sandboxing keeps working meanwhile.)

**Derived build order:** [#631](https://github.com/hachej/boring-ui/pull/631) +
P1 recut (landed [#642](https://github.com/hachej/boring-ui/pull/642)) → P6-R (landed [#647](https://github.com/hachej/boring-ui/pull/647)) → D1-reframed (+conditional P5a) → M1 recuts
(landed [#650](https://github.com/hachej/boring-ui/pull/650))
→ AR1 → M2/E2 → T1/T2 → P2/X1.

Inter-agent abstraction settled: one consumption contract (A2A-shaped
semantics), bindings = UI / MCP (external) / HTTP API / CLI / native internal /
A2A (future external); internal modes = subagent (caller workspace) |
contracted (own workspace, governed-projection briefs). See
[DECISIONS.md #22](../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges).

**Marketplace path (owner-approved 2026-07-11):** the five-phase roadmap from
here to the contracting-platform vision — including BL1/MK1/CH1 above — is
[`MARKETPLACE-PATH.md`](MARKETPLACE-PATH.md).

## Later increments and deferred infrastructure

These plans are retained, but they do not override the owner-priority rows
above. M1, AR1, M2/E2, and T1/T2 are ordered product increments; P2/X1 is the
last infrastructure increment.

| Increment | Work package | Earliest dependency | Reason deferred |
| --- | --- | --- | --- |
| P3 full route/tool extraction | [P3](work/P3-routes-tools/) | second package consumer | current hosting reuses existing boring-bash/workspace composition; broad relocation adds cutover risk without advancing an owner priority |
| E1 generic environment attachments | [E1](work/E1-environment-attachments/) | P3 plus a second attachment consumer | v1 has one authorized workspace/runtime composition; generic N-environment lifetime machinery is not required |
| True no-environment execution | [P1 historical pure beads](work/P1-headless-core/TODO.md) | named non-workspace consumer + new decision | no public/product consumer in v1; may return only as explicit composition, never a `runtimeMode` fork |
| P4 presentation extraction | [P4](work/P4-file-ui/) | P3 | moving workspace editors into a runtime package is disproportionate; capability-gate the existing plugin first |
| X1 S3/FUSE | [X1](work/X1-s3-fuse-mounts/) | P2 plus a named native-mount consumer | priority 4; performance, isolation, and operations risk stay out of earlier product delivery |
| P5b advanced provisioning | [P5](work/P5-provisioning-secrets/) | P5a | SDK archives, managed services, and remote-worker generality need real consumers |
| P6 plugin/child-app expansion | [P6](work/P6-plugin-child-app/) | P6-R, P7 where agent routing is required | per-agent plugin routes/UI require `agentId`; child apps remain blocked on #376 |
| P7 multi-agent/control APIs | [P7](work/P7-multi-agent-inspection/) | P6-R, E1, T2 | agent routing/info first; search, hooks, and subagent grants split into later beads |
| D2 shared tenant control plane | [D2](work/D2-shared-tenant-mesh/) | repeated D1 multi-agent hosts plus a named control-plane need | D1 shares one deployment across authorized workspaces, but does not build wildcard tenant administration or cross-tenant routing |
| S3/S4 control plane/onboarding | [S3](work/S3-control-plane-ux/), [S4](work/S4-agent-onboarding/) | P7 and delivery status APIs | product UX after the priority-1 host path is proven |

## Dependency graph

```txt
Priority 1 / v1:
P0 -> P1 ----------------------┐
P0 -> P6-D --------------------┼-> P6-R -> D1-R0 ----------------┐
          \-> A1-compile ----------------------┬-> D1 beads(+P5a) ┼-> P8
                                               \-> producer -> A1-dev

Priority 2:
M1 (landed #650) -> AR1 -> M2/E2 recuts

Priority 3:
M2/E2 -> T1 -> T2

Priority 4 / last:
T2 -> P2 provider extraction -> X1 mounts

Deferred leaves:
full P3 | generic E1 | no-environment | P4 | P5b |
P6 expansion | P7 | D2 | S3/S4
```

P1 precedes runtime resolution and delivery because it establishes workspace composition, lifecycle,
attribution where required, deterministic tool merge, and the real dependency
boundary. Durable admission and caller request idempotency are T1-owned unless
the M1/AR1 tracer proves a smaller requirement. P6-D did not depend on
the P1 production correction: decision 21 fixed its behavior-only schema, so it
and A1 compile landed independently of P1. Those branches join before P6-R.
D1-R0 then identifies the composition-identity producer used by D1 and the
later A1 local-dev recut; local dev gates P8, not D1 dispatch. P6-R resolves one binding per pure call and owns no host-wide map,
router, or authorization decision; D1 iterates the N-binding collection. P6-R
and D1 use the existing runtime composition; they do not
wait for P2 provider extraction. D1 adds N exact-host landing/auth/workspace-
default bindings inside one Docker host and therefore does not wait for M2 or
D2's control plane. Work already landed via #416 is reused and must not be
redone.

## Parallel and background tracks

Parallel work is allowed only when ownership and merge gates stay explicit.
"Background" never means "merge without its prerequisites" or "invent a
temporary version of a frozen contract."

| Track | Can run in parallel | Frozen boundary | Merge/integration gate | Action now |
| --- | --- | --- | --- | --- |
| M1 tracer/recuts | landed via [#650](https://github.com/hachej/boring-ui/pull/650), before D1 implementation | additive workspace-backed bearer ingress only; no parallel runtime owner | stock-client smoke, bounded output, authorized workspace/default resolution | landed; AR1 is next in the priority-2 lane |
| P6-D -> A1 compile | landed through #623/#624 | minimal definition/deployment identities and deterministic compiler only; no generic environment or tenant lifecycle | verified main ancestry | consume from P6-R/A1 dev without widening |
| P1 -> P6-R -> D1(+P5a) | P6-D/A1 compile and #631 lifecycle landed; readiness closes P1 | host-attested workspace composition plus stateless N-binding resolution; D1-R0 specifies the missing canonical digest producer; no provider extraction | N agents/workspaces in one Docker host, exact-host auth/default binding, rollback | readiness recut, P6-R, then D1-reframed |
| AR1 -> M2/E2 | spec can run after M1 shape stabilizes | links address immutable artifact/version/capability; intake authorizes destination workspace; no generic E1 registry | link auth/revocation, no-leak, copy/reference decision, stock-client proof | dispatch after M1 recuts |
| T1/T2 | design review may run beside priority 2; merge after M2/E2 proof | one event/approval contract; surfaces own ingress only | multi-channel same-agent conformance and reconnect proof | priority 3 |
| P2/X1 | Sol P2 recut and X1 research may remain isolated until priorities 1-3 land | `boring-sandbox` package-local providers/mounts; no D1, agent, workspace, or `company_context` API change | provider conformance, EU facts, credential canary, corrected mount benchmark | priority 4; merge last |

P4, P5b, P6 expansion/P7, D2, and S3/S4 are not safe background work today:
they either overlap live v1 ownership seams, lack a real consumer, or depend on
the priority-1 host path being proven first. Keep them documented and
undispatched.

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

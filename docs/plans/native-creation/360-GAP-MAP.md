# 360 gap map — native creation vs the whole spec (2026-09-07, evening)

> **Historical pre-re-cut audit snapshot — do not dispatch or infer unresolved
> decisions from this file.** The owner subsequently dispositioned these findings
> in the [2026-09-07 DIRECTION amendment](../../direction/DIRECTION.md#second-re-cut--360-sweep-owner-2026-09-07-night):
> six gap beads were added, premise edges became machine-checkable, and the six
> questions in §E received defaults. In particular, bwrap/runsc is accepted only
> for the first proof; a hardware microVM is required before shared-tenant Seneca
> deployment. The tables below preserve what the sweep found before that re-cut.

Six parallel read-only sweeps (kernel nouns · shell/premises · security/authority ·
data/knowledge/packages · tenant/factory ops · prior plans/contradictions) of the
ratified pack, plans, issues, beads, PRs and code against the twelve `nc-*` beads.
The pre-re-cut verdict was: **the spine is right and the graph is a kernel-only
slice.** The journey also needed data, authority substrate, evidence, a surface
and reconciliation, with several existing designs not yet cited by the bead map.
Full tables live in the session transcript; this file keeps the load-bearing
historical rows.

## A. Holes with no bead at all

| Gap | Why it blocks | Existing material to reuse |
|---|---|---|
| **Learner/customer data store + schema** | `grade_step` has nowhere durable to write; "second learner completes a job" cannot be proven | `plugins/data-catalog` (adapter-based); SemanticDataMount deferred |
| **Tutor agent as a package** (persona + skills + `knowledge/`) | nc-6/nc-7 build a UI + an operation, never the tutor *agent*; the mechanism exists (#1107/#1202, `packages/agent/docs/AGENT_PACKAGES.md`) but is boot-time/restart-based, unreconciled with product activation | #1107 slice 3 "install agents without redeploy" (queued, uncited) |
| **Evaluation/Outcome record bound to `releaseDigest`** | `evidenceRefs` has no producer; nc-7's receipt is free text; "a fork cannot inherit an inapplicable claim" has no mechanism | `packages/agent/src/eval/` suite runner (prompt-only today) |
| **Shared `ExecutionContext` / `Authority` type + `Capability<I,O>` effect classes** | nc-3/nc-4a invent `DeclaredOperation` beside the ratified Capability; "actor ∩ installation ∩ job ∩ policy" has no substrate | V2-PORT-HANDBOOK Supporting types; `AuthorizedAgentScope` |
| **Reconciliation stage** (compat check, three-way conflict, quarantine of a digest, undo as explicit path) | Last journey stage has zero coverage; nc-7's "one upstream update" is folded ad hoc | LIFECYCLE §"Comparison, upgrades"; ARCH-PLAN D-d dual-write pattern |
| **Standing authorization** (change class + budget) | Ruled in §13d; a field on nc-2, no bridge op, no enforcement | — |
| **Model credentials for builder/product runtime** (A7 ModelCapabilityIssuer, BYOK #1145) | Builder runs through the verified BYOK bypass; a second learner needs funded model access independent of the builder | vault backend merged; #1145 open |
| **Membership model for "a separate consumer"** | Invites/membership are per-workspace; nothing says whether learner B is a member with a personal install, a second workspace, or a new grant | D32 additive Seat enrollment |
| **Usage/cost facts per installation** | nc-7 receipt requires "cost"; #819 is workspace/session-scoped and gated | #819 plan |
| **Starter catalog for product components/operations** | The obligation's own bar ("new component and new operation, not a panel hiding a host endpoint") has no line to draw | #1202 authored catalog (agent personas only) |
| **Shell placement surface** | `workspace-shell` layout variant, Library page, Thread page do not exist; nc-l has nowhere to land; L4 thread-view is still premise-gated and nc-l risks backdooring it | shell-ngfs.6 (Library L3b), .7 (L4), [shell-layout] |
| **Approval / durable pause (C5)** | §13d's preview/Keep default and standing opt-in are approval-shaped; nothing to build on; #1348 open | P1-A4/A5 |
| **Non-chat status/decision projection** | Learner must see results/decisions outside chat | ask-user inbox plumbing (session-shaped) |
| **Env scrubbing (A4), revocation epochs (A8), bridge tokens to the product runtime process** | nc-4a/4b's "runtime cannot read host env" and §11c revocation promises depend on unbuilt Wave A items | ARCH-PLAN Track A |
| **`local` mode isolation floor** | D31's hardware-virtualization floor vs §13c allowing bwrap/runsc for a second consumer on shared hardware — unresolved tension | D31, #1081 evidence (unmerged spike branch) |

## B. Prior work the beads must cite or absorb

| Item | Relationship | Action |
|---|---|---|
| `docs/plans/archive/runtime-plugin-trust-modes-plan.md` + `runtime-plugin-agent-generation-plan.md` | Already design the front `native/iframe/disabled`, server, and tool runtime modes that nc-0/4a/4b/5 re-derive | cite in nc-0, nc-4a, nc-4b, nc-5 |
| PR #1499 RuntimeWebView (closed, branch `feat/1498-runtime-web-view`), PR #1493 (open, hosted sandbox previews), `boring-browser-plugin-plan.md` | The iframe projection seam nc-5 needs | nc-5 resurrects #1499 or records why not; builds on #1493 |
| #1355 persistent Console (`ConsoleThreadRefV1`, 20 open beads, blocked on shape spike) | Second Thread-addressing scheme beside nc-t/nc-l | reconcile explicitly in nc-t |
| durable-streams P1-A1 session identity (`9p50.1`) | Converges on the same id grammar as nc-t | one owner of the id space before nc-t lands |
| `wt-391-forward-oueu` PiPlatform seam | Same seam class as `ProductRuntimeHost` | decide: build on it or beside it |
| step1a `xn9` F8 immutable publication cohort | Existing immutable-publication mechanics for platform packages | share CAS/publication mechanics with nc-1 |
| #900 / PR #1415 MCP ingress | Parallel external-operation surface to nc-3 | cross-reference |
| Lane 2 `rc-lane2-kernel-port` K1–K7 beads | Still open; contradict §13f's demotion of R-a | mark dormant / re-gate |
| Lane 3 `rc-lane3-steering .1/.2` P0 owner beads | Unresolved; Wave A stability assumed | rule or defer explicitly |
| PR #1548 | Still open on GitHub | close on merge of #1561 |
| `plugin-contribution-model.md`, `AGENT-CONSUMPTION-MODES.md`, fleet-and-environments README | Vocabulary collisions ("modes", "native", "product") | disambiguation note; cite Environment-lease vocabulary in nc-4b |

## C. Bead-graph defects

- No machine-checkable edges from any `nc-*` bead to its premises (`9p50.2`, `shell-ngfs.6/.7/.14.1`, `oueu`, #1107). Sequencing lives in prose only.
- `nc-t` and `nc-l` are the collision points with `#1355`, `9p50.1` and `shell-ngfs.7`.
- Builder tool restriction is enforced by omission, not by an authority boundary.

## D. Ops reality for tonight

- Seneca is a separate tenant repo; no defined path for a release to reach its deployment. No provisioner; migrations are manual.
- Beadle does not exist; factory host tools are playground-scoped; class A/B predicate not migrated → every PR is an owner merge. STATE.md is 12 days stale.
- CI: bwrap present; e2e conditional (needs path or `ci:e2e` label); UI Review gate hits nc-v/nc-l/nc-5; gate 2 needs a Vercel snapshot.

## E. Owner decisions surfaced

1. "Separate consumer" = a workspace member with a personal-scope install (recommended), a second workspace, or a new grant?
2. Is the tutor persona allowed to ride the restart-based agent-package path for the first proof, or must agent packages also activate through the product path?
3. `local` mode for a second consumer on shared hardware: accept the bwrap/runsc floor for the first proof, hardware microVM required before Seneca live?
4. Who owns the identity id space: nc-t or durable-streams A1?
5. Cross-repo release path to Seneca: tenant pulls a release by digest from this repo's registry, or Seneca vendors the product?
6. Lane 2 K-beads dormant; lane 3 P0 rulings answered or deferred.

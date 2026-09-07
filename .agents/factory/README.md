# Boring Factory — structure and stage contract

This file binds the factory together: which stage runs which skill, under which
procedure, with which tools, and what gate lets work move on. It adds no new
process — Risk-Based Delivery (`docs/procedures/boring-loop.md`) and the
procedures under `docs/procedures/` remain authoritative. When this file and a
procedure disagree, the procedure wins and this file is fixed.

**Owner amendment, 2026-09-07:** human-review boundaries and the >500 package
production-line trigger are defined in `boring-loop.md`. Every code PR needs an
independent cross-package abstraction PASS; plugin UI needs before/after
Playwright video but does not wait for owner viewing on the automatic path.
This document describes the adopted stage policy, not deployed enforcement.
The legacy `policy.yaml` predicate and host/skill gates still need migration;
preserve their stricter restrictions and every pending owner decision until the
rollout in `boring-loop.md` is implemented and verified. Never infer approval or
bypass existing gates from this amendment.

Why the factory exists and which decisions are ratified: `docs/factory/VISION.md`.
Build order: `docs/factory/TODO.md`.

## Structure

| Path | Holds | Consumed by |
| --- | --- | --- |
| `.agents/factory/README.md` | stage contract (this file) | every seat, at session start |
| `.agents/factory/tools.md` | tool contract per stage | every seat |
| `.agents/factory/policy.yaml` | tunables: thresholds, lanes, trust ladder, tiers | Beadle automation, merge gate |
| `.agents/personas/<seat>/` | identity + instructions only, no authority | AgentHost fleet loader |
| `.agents/skills/<name>/` | executable procedures | skill invocation |
| `docs/procedures/` | the loop and its procedures | all of the above |
| `docs/factory/` | vision, ratified decisions, build order | humans |

## Stages

One line per stage. The gate column is what must be true before work leaves it.

**Seat column vs. the booted roster.** The booted fleet
(`.agents/factory/fleet.yaml`) is three seats — `triage`, `orchestrator`,
`worker` — owner-ratified 2026-08-10 (gh-1187 S0). The stage names below are
still the pre-migration five: `concierge` and `steward` stages are held by
`orchestrator`, and `reviewer` is not a seat at all — review is a rule, run as
fresh-context subagents the worker spawns at gate time. This table is rewritten
per activity in gh-1187 S8, once the workspace path has done each job for real;
until then nothing is retired.

| Stage | Seat | Skill | Procedure | In → Out | Gate |
| --- | --- | --- | --- | --- | --- |
| intake | — | `feedback` | boring-loop | raw report → canonical GH issue | deduplicated, redacted |
| refine | concierge | `ask-boring` routing | boring-loop | idea/issue → agreed epic scope | owner says go (conversational) |
| triage | triage | `triage` | boring-loop | GH issue → category, state, first blocker, route | exactly one state, one next action |
| plan | steward | `plan` | `issue-plans.md` | epic → bead graph + proof path | clear intent/proof; **human gate 1** when a protected-boundary plan decision is needed (retain current host gates during rollout) |
| dispatch | worker (pull) + beadle (supervisor) | — | `worktree-agent.md` | ready beads → claimed bead + worker session | pull-based: worker runs `br ready`, leases one bead, stamps its session id on the bead at claim; Beadle only spawns workers while ready > active (cap and lease rules in policy.yaml) — it never picks beads |
| exec | worker | `exec` | `worktree-agent.md`, `proof-of-work.md` | one bead → commits + proof + handoff | focused proof green; handoff written |
| review | reviewer | `fresh-eyes`, code review | `coding-invariants.md`, `proof-of-work.md` | exact SHA → dispositions | no blocker/major open; explicit independent abstraction PASS for code; current UI-video/scenario proof when applicable |
| merge | owner, or automatic when eligible and enforced | — | `boring-loop.md`; `rolling-small-fixes.md` (bug lane exception) | reviewed PR → main | current-main integration proof; **human gate 2** for protected boundaries, otherwise enforced automatic admission; retain current gates during rollout |

Owner attention is reserved for protected-boundary decisions at plan/merge time
and genuine exhausted recovery paths, through an inbox Human Intention via
`ask_user` (GitHub comment fallback). Routine work receives a proof/merge receipt,
not a new approval request once automatic admission is enabled. Plan approval is
not merge approval. Escalations from any stage use the same decision surface.

## Lanes

**Epic lane** — one epic = one GH issue = one shared `.worktrees/` worktree =
one PR. Every issue/Bead/Inbox/PR/commit/session title in the epic follows
`docs/procedures/naming-conventions.md`. Workers pull beads, edit that shared worktree, stage only intended
changes, and commit frequently to the epic branch; beads need not predeclare
file scope. Conflicts are handled in place without reverting peer work. Remote
sandboxes test or serve exact committed SHAs and never become editing
workspaces. Start without Agent Mail or file reservations; add them only if
observed collisions justify the machinery. Commit/branch mechanics are owned
by `docs/procedures/worktree-agent.md`. The Beadle rebases the epic branch on
`main` at the thresholds in policy.yaml; unresolved conflicts become blocking
beads, never side quests inside a feature bead.

**Bugfix lane** — the standing rolling branch, governed by
`docs/procedures/rolling-small-fixes.md` including its admission bar,
ledger, and stop conditions. Factory specifics: one fix = one bead = one commit
= one inbox intention reviewed individually; approved fixes flush to `main` on
owner review (cherry-pick when the batch is mixed). Never auto-merge while
`bugfix_lane.merge` is `owner-flush`.

## Dynamics

The rules for when work does not flow. Owner attention is the scarcest
resource: it is spent on protected-boundary decisions and genuine dead ends,
not ordinary failed checks or routine implementation iterations.

**Claim order** — workers claim by bead priority (set by the Steward at plan
time), then age. `bugfix_reserved_slots` in policy.yaml may reserve a worker
slot for the bugfix lane.

**Bounce rules**

| Failure | Rule | Owner sees it? |
| --- | --- | --- |
| worker fails a bead `worker_attempts_per_bead` times | back to Steward as a spec defect — never another attempt | no |
| review loops `review_rounds_max` rounds | escalation intention | yes — dead end |
| bead missing ready fields (`bead-ready.md`) | counts as plan defect, back to Steward | no |
| plan rejected at gate 1 | Steward reworks, `plan_resubmissions_max` re-submission then conversation, not another intention | yes — gate |
| stale lease | Beadle breaks it per session rules | no |

**Learning loop (retro pass)** — every bead handoff/closure carries a one-line
`friction` note (empty allowed). At epic close the Steward reads them and emits
corrective beads: spec-template fix, AGENTS.md line, or skill edit. Classify each
by `boring-loop.md`; docs/skills location is not an exemption. Changes to safety,
authority, approval requirements or the automation's own rules require owner
review, not self-approved promotion.

**Implementation gaps** (not enabled by the docs amendment): broader automatic
admission and host post-merge supervision. Existing main CI remains required;
release/publish permissions remain separate from merge. Token budgets and
per-bead spend caps are unchanged (the worker cap bounds total concurrency).

## Session rules

These rules apply to every seat including the Concierge — its durable state
lives in beads/notes, never in accumulated session context.

- One bead = one durable session. Identity lives in the seat, not the session.
- The **worker writes the binding at claim**: leasing a bead and stamping the
  session id on it are one atomic act (`br` lease + note). A session that
  cannot verify its lease and bound bead stops rather than improvises.
  Planners never touch sessions; their contract ends at ready beads.
- **Liveness**: the lease is the heartbeat. A working session refreshes its
  lease at least every `beadle.lease_heartbeat_minutes` (any `br` touch of the
  bead counts). Idle for any reason — compaction, crash, a wait that never
  wakes — looks identical from outside: no heartbeat. After
  `beadle.stale_lease_minutes` the Beadle breaks the lease and the bead
  returns to ready; the next worker re-primes from the bead + handoff
  artifact. Handoff-before-compaction makes this loss-free for the planned
  case; for crashes, the last commit + bead notes are the floor. Never wait on
  a fire-and-forget monitor to wake you — poll synchronously so the heartbeat
  keeps beating.
- The handoff ritual (`.agents/skills/handoff/`, procedure
  `docs/procedures/session-handoff.md`) runs **before** compaction at
  the policy threshold. Convention: commit work in progress, persist the full
  contract via the task/session **artifact transport** (reference + revision +
  SHA-256 digest + read-back receipt), and link it to the current bead — the
  bead carries the pointer, the artifact carries the contract. Repo files and
  OS-temp files are drafts, never resumable handoffs. After compaction,
  re-prime by reading `AGENTS.md`, this file, and the bead.
- A worker never closes its own bead on its own authority: closure follows the
  review and merge gates. The Beadle flags beads closed without linked proof.
- Stale leases are broken only by the Beadle, and only when handoff notes exist
  or the session is provably dead.

# Boring Factory — structure and stage contract

This file binds the factory together: which stage runs which skill, under which
procedure, with which tools, and what gate lets work move on. It adds no new
process — Boring Loop v2 (`docs/kanzen/boring-loop.md`) and the procedures under
`docs/kanzen/procedures/` remain authoritative. When this file and a procedure
disagree, the procedure wins and this file is fixed.

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
| `docs/kanzen/` | the loop and its procedures | all of the above |
| `docs/factory/` | vision, ratified decisions, build order | humans |

## Stages

One line per stage. The gate column is what must be true before work leaves it.

| Stage | Seat | Skill | Procedure | In → Out | Gate |
| --- | --- | --- | --- | --- | --- |
| intake | — | `feedback` | boring-loop | raw report → canonical GH issue | deduplicated, redacted |
| refine | concierge | `ask-boring` routing | boring-loop | idea/issue → agreed epic scope | owner says go (conversational) |
| triage | triage | `triage` | boring-loop | GH issue → category, state, first blocker, route | exactly one state, one next action |
| plan | steward | `plan` | `issue-plans.md` | epic → bead graph + proof path | **human gate 1**: plan-approval intention |
| dispatch | beadle (automation) | — | `worktree-agent.md` | ready beads → claimed bead + worker session | worker cap and lease rules in policy.yaml |
| exec | worker | `exec` | `worktree-agent.md`, `proof-of-work.md` | one bead → commits + proof + handoff | focused proof green; handoff written |
| review | reviewer | `fresh-eyes`, code review | `owner-review-card.md` | exact SHA → dispositions | no blocker/major open at that SHA |
| merge | owner, or automatic for class A | — | `rolling-small-fixes.md` (bug lane) | reviewed PR → main | **human gate 2**: trust ladder in policy.yaml |

Human attention exists at exactly two gates (plan approval, merge approval) and
always as an inbox Human Intention via `ask_user` — never as out-of-band chat.
Escalations from any stage use the same surface.

## Lanes

**Epic lane** — one epic = one GH issue = one `.worktrees/` worktree = one PR.
Commit/branch mechanics are owned by
`docs/kanzen/procedures/worktree-agent.md`. Factory specifics: the Beadle
rebases the epic branch on `main` at the thresholds in policy.yaml; conflicts
become blocking beads, never side quests inside a feature bead.

**Bugfix lane** — the standing rolling branch, governed by
`docs/kanzen/procedures/rolling-small-fixes.md` including its admission bar,
ledger, and stop conditions. Factory specifics: one fix = one bead = one commit
= one inbox intention reviewed individually; approved fixes flush to `main` on
owner review (cherry-pick when the batch is mixed). Never auto-merge while
`bugfix_lane.merge` is `owner-flush`.

## Dynamics

The rules for when work does not flow. Owner attention is the scarcest
resource: it is spent at the two gates and at genuine dead ends, nowhere else.

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
corrective beads: spec-template fix, AGENTS.md line, or skill edit. Corrective
beads are docs/skills work — class A — so the factory improves itself without
owner attention.

**Out of scope for now** (revisit after the graduation run): post-merge/release
automation (releases stay a manual owner action; nothing watches main), token
budgets and per-bead spend caps (the worker cap bounds total concurrency).

## Session rules

These rules apply to every seat including the Concierge — its durable state
lives in beads/notes, never in accumulated session context.

- One bead = one durable session. Identity lives in the seat, not the session.
- The handoff ritual (`.agents/skills/handoff/`, procedure
  `docs/kanzen/procedures/session-handoff.md`) runs **before** compaction at
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

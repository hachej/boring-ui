---
name: exec
description: Drive one ready artifact through implementation, proof, review, and owner handoff.
disable-model-invocation: true
---

# Exec

Drive one executable TODO, plan, Beads epic, or validated UI packet to
`ready-for-human`; never merge.

Read the artifact, `docs/procedures/boring-loop.md`, and
`docs/procedures/MODEL-CARD.md`. Load only the needed procedure:

- worktrees/delegation: `docs/procedures/worktree-agent.md`
- proof: `docs/procedures/proof-of-work.md`
- UI packets: `docs/procedures/visual-review.md`
- handoff: `docs/procedures/owner-review-card.md`
- provider method: `../../skill-references/exec/index.md`

Require clear scope, acceptance, proof, dependencies, and risk; repair planning
gaps through `/skill:plan` and stop on unresolved human intent. Workers pull
their own work — never wait to be assigned a specific bead: discover with
`br ready --label epic:<key> --unassigned` (or `br ready --json` outside an
epic), claim exactly one with `br update <id> --claim --actor <own session id>`
(the host states your session id in the dispatch brief) — never work
unclaimed. You work in the shared epic worktree; if it already holds
uncommitted edits from a dead peer, inspect them, adopt what is correct, and
say so in the handoff rather than reverting. Stage only the files your bead
intends to touch. Refresh the lease as you work (any `br` touch counts;
cadence key `beadle.lease_heartbeat_minutes`); poll long waits synchronously
so the heartbeat keeps beating. Never end a turn waiting for an event you did
not schedule a wake-up for. Never delegate work that carries a stop-and-ask
gate to a sub-agent — the sub-agent inherits the gate but cannot verify who
satisfies it (escalate gates up, never down). Syntax that bites: `br comments
add <id> -m "..."` (plural, id first) and `--assignee` (no `-a` on update); a
failed comment is a lost heartbeat — check exit status.

**Owner demo/retest gate:** before inviting the owner to test (or RE-test) a
live surface, the exact reported action must pass in that exact environment —
same origin, same click path — proven by an automated run (Playwright/curl)
with a screenshot. Fixes that live on other branches get cherry-picked into
the demo environment first. "Should work now" is never grounds for an invite;
a wasted owner test is a factory defect.

Implement the smallest bounded slice with behavior tests, record current proof,
apply the Model Card review ladder and mandatory code-thermo gate, and integrate
or disposition every material finding. Re-prove and re-review non-trivial fixes.
Commit with subject `[Feature Name] <imperative summary> (br-<id>)` per
`docs/procedures/naming-conventions.md`, and push the epic branch immediately
after each commit and before creating a sandbox — remote sandboxes test the
pushed SHA, never uncommitted state. Fix forward only: never rewrite history on the epic branch — no `git reset`, no `--amend` or rebase of a commit that has been pushed, no force push; a mistake gets a new commit, and a handoff names only SHAs that exist on origin. Run tests/builds in the dedicated
exact-SHA sandbox (`sandbox` + `sandbox_bash`), verifying the sandbox actually
holds your SHA (`.factory-sha` or `git rev-parse HEAD`) before trusting its
result. Obtain an adversarial `fresh_review` bound to that exact SHA and
record its provenance (session, model, brief digest).

Your handoff is a Bead comment, not a PR: `[Feature Name] handoff · <bead id> ·
<short sha>` naming the SHA, your proof, the sandbox release, the
`fresh_review` provenance, and any residuals. You never open a PR, never run
`ask_user`, never raise an owner card, and never close or merge your own
bead — the epic PR, the owner demo, and both gates belong to the Orchestrator
at Gate 2 (`/skill:owner-gate`), not to you. Keep the lease heartbeat sentence
above in force until the handoff comment lands. Follow
`.agents/skills/handoff/SKILL.md`'s show-me rule: a multi-file Bead's handoff
comment carries one diff-shaped show-me view of what changed.

For a UI packet, validate it first and follow the complete round, stop, baseline,
and Inbox rules in `visual-review.md`; the packet grants no edit or merge
authority.

Before compaction, perform the handoff ritual in `.agents/factory/README.md`
Session rules and link the artifact from the bead. At handoff/closure, write a
one-line `friction` note on the bead. Never close your own bead.

Exit only with green proof or an explicit waiver/residual risk, current required
reviews, a human-runnable validation path, and a clear next action.

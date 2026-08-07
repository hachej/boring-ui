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
gaps through `/skill:plan` and stop on unresolved human intent. For Beads work,
pull your work: `br ready --json`, lease exactly one bead, and stamp your
session id on it in the same act — never work unclaimed. Refresh the lease as
you work (any `br` touch counts; cadence key `beadle.lease_heartbeat_minutes`);
poll long waits synchronously so the heartbeat keeps beating. Never end a turn
waiting for an event you did not schedule a wake-up for. Never delegate work
that carries a stop-and-ask gate to a sub-agent — the sub-agent inherits the
gate but cannot verify who satisfies it (escalate gates up, never down).
Syntax that bites: `br comments add <id> -m "..."` (plural, id first) and
`--assignee` (no `-a` on update); a failed comment is a lost heartbeat — check
exit status.

**Owner demo/retest gate:** before inviting the owner to test (or RE-test) a
live surface, the exact reported action must pass in that exact environment —
same origin, same click path — proven by an automated run (Playwright/curl)
with a screenshot. Fixes that live on other branches get cherry-picked into
the demo environment first. "Should work now" is never grounds for an invite;
a wasted owner test is a factory defect.

Implement the smallest bounded slice with behavior tests, record current proof,
apply the Model Card review ladder and mandatory code-thermo gate, and integrate
or disposition every material finding. Re-prove and re-review non-trivial fixes.
Then open/update the PR and send the owner card through `ask_user` (PR comment
fallback), attaching the best runnable UI or file/proof artifact. Use commit
subjects `[br-###] description` and push after every commit.

For a UI packet, validate it first and follow the complete round, stop, baseline,
and Inbox rules in `visual-review.md`; the packet grants no edit or merge
authority.

Before compaction, perform the handoff ritual in `.agents/factory/README.md`
Session rules and link the artifact from the bead. At handoff/closure, write a
one-line `friction` note on the bead. Never close your own bead.

Exit only with green proof or an explicit waiver/residual risk, current required
reviews, a human-runnable validation path, and a clear next action.

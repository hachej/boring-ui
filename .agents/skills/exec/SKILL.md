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
lease exactly one ready bead with `br` before working; never work unclaimed.
If dispatched by the Beadle, verify the bound bead id and lease first; if the
session has no bound bead id, stop and flag it — do not pick one yourself.

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

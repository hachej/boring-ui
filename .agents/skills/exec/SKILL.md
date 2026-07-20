---
name: exec
description: Drive one ready artifact through implementation, proof, review, and owner handoff.
disable-model-invocation: true
---

# Exec

Drive one executable TODO, plan, Beads epic, or validated UI packet to
`ready-for-human`; never merge.

Read the artifact, `docs/kanzen/boring-loop.md`, and
`docs/kanzen/MODEL-CARD.md`. Load only the needed procedure:

- worktrees/delegation: `docs/kanzen/procedures/worktree-agent.md`
- proof: `docs/kanzen/procedures/proof-of-work.md`
- UI packets: `docs/kanzen/procedures/visual-review.md`
- handoff: `docs/kanzen/procedures/owner-review-card.md`
- provider method: `../../skill-references/exec/index.md`

Require clear scope, acceptance, proof, dependencies, and risk; repair planning
gaps through `/skill:plan` and stop on unresolved human intent.

Implement the smallest bounded slice with behavior tests, record current proof,
apply the Model Card review ladder and mandatory code-thermo gate, and integrate
or disposition every material finding. Re-prove and re-review non-trivial fixes.
Then open/update the PR and send the owner card through `ask_user` (PR comment
fallback), attaching the best runnable UI or file/proof artifact.

For a UI packet, validate it first and follow the complete round, stop, baseline,
and Inbox rules in `visual-review.md`; the packet grants no edit or merge
authority.

Exit only with green proof or an explicit waiver/residual risk, current required
reviews, a human-runnable validation path, and a clear next action.

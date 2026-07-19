---
name: exec
description: Orchestrate one executable TODO, small plan, or Beads epic through implementation, proof, review, and human-ready PR handoff.
disable-model-invocation: true
---

# Exec

Drive one executable artifact to `ready-for-human`; never merge.

Read the artifact, `docs/kanzen/boring-loop.md`, and
`docs/kanzen/MODEL-CARD.md`. Load these only when needed:

- worktrees/delegation: `docs/kanzen/procedures/worktree-agent.md`
- proof: `docs/kanzen/procedures/proof-of-work.md`
- handoff: `docs/kanzen/procedures/owner-review-card.md`
- provider method: `../../../.agent/skills/exec/references/index.md`

## Readiness

Require clear scope, acceptance, proof, dependencies, and risk. Repair mechanical
gaps through `/skill:plan`; use its `grill-me` method when human intent/risk is
missing. Do not execute unresolved ambiguity.

## Loop

1. Choose worker, topology, and PR granularity using the Model Card and worktree
   procedure.
2. Implement the bounded work with behavior tests at the best public seam.
3. Record proof; apply the Model Card review ladder and mandatory code-thermo gate.
4. Integrate accepted findings, then re-prove/re-review until clean or every
   material finding has an explicit disposition.
5. Open/update the PR; store concise review evidence beside the task when useful.
6. For UI, keep a demo running with exact test steps. Otherwise attach the best
   file/proof artifact and validation steps.
7. Send the owner-review card through `ask_user` (GitHub comment fallback).
   Request-changes resumes this task/PR loop.

For a `ui-improvement-execution-packet`, first run
`pnpm --filter workspace-playground ui:improve:validate -- <run-directory>`;
reject stale or altered evidence. `/exec` alone
owns changes and at most two rounds. Apply at most the packet's three
confidence-qualified fixes per
round. After changes call only `ui review command-palette`, passing the prior run
as `--baseline-dir`; never call `ui improve` recursively. Stop when hard gates
are green and no material high-confidence fix remains, score/delta stalls,
remaining work is subjective/out of scope, two rounds complete, or review budget
is exceeded. The packet itself grants no edit/merge authority. Final handoff
opens its `report.html` through `workspace.open.path` and sends the packet's exact
spot-check playbook through the existing Inbox/`ask_user` flow.

The orchestrator retains judgment over models and parallelism within packet
bounds. Respect `Fable: off | manual-gate` exactly as defined in the Model Card.

Exit only when proof is green or explicitly waived with residual risk, required
reviews are current with material findings dispositioned, the PR/local-only
artifact is ready, and the human can validate without reconstructing the work.

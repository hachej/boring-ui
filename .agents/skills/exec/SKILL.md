---
name: exec
description: Orchestrate one executable TODO, small plan, or Beads epic through implementation, proof, review, and a human-ready PR handoff.
disable-model-invocation: true
---

# Exec

`/exec` is the Boring execution orchestrator. It starts from a tracked TODO,
small plan, or Beads epic and drives it to a reviewed, proven, testable PR. It
does not merge.

## First read

1. The supplied work artifact and linked issue/comments.
2. `docs/kanzen/boring-loop.md`.
3. `docs/kanzen/MODEL-CARD.md`.
4. `docs/kanzen/procedures/worktree-agent.md`.
5. `docs/kanzen/procedures/proof-of-work.md`.
6. [references/index.md](../../../.agent/skills/exec/references/index.md) when a
   provider implementation method is useful.

## Readiness

Confirm the input has enough scope, acceptance, proof, dependencies, and risk
context for safe execution.

- Repair mechanical planning gaps using the canonical `/plan` workflow.
- If product intent or a risk decision is missing, use the planning `grill-me`
  reference one decision at a time, then repair the artifact.
- Do not execute unresolved ambiguity.

Read optional `Fable: off | manual-gate` from the request; default to `off`.

## Orchestration loop

1. Choose the implementation worker and worktree topology using the Model Card
   and worktree-agent procedure.
2. Implement the bounded work; add behavior tests at the highest useful seam.
3. Run and record exact proof.
4. Run independent tier-1 review (use `/skill:fresh-eyes` for convergence) and integrate accepted findings. For small code, include the mandatory thermo lens in this pass.
5. For complex/structural/risky code, run thermo at tier 2. Docs/config-only work does not need thermo.
6. Run tier-2 review for canonical plans, medium/hard or risky work, unresolved
   tier-1 uncertainty, or before tier 3. One tier-2 pass may satisfy both the
   general and thermo gates. Integrate findings and re-prove.
7. If `Fable: manual-gate` and tier 3 is worthwhile:
   - prepare a compact self-contained packet with a cheaper context-packager;
   - request Inbox approval for the Fable spend;
   - after approval, invoke Claude Code CLI non-interactively with `--model fable`;
   - ask Fable to falsify the work, not rewrite it; it may use a cheaper Sonnet
     subagent for targeted missing context;
   - have a non-Fable worker/integrator apply accepted findings;
   - re-run the ordinary proof/review loop until converged.
8. Open/update the PR and store concise review records beside the task/plan when
   practical.
9. Start the relevant playground/demo and prepare the human test playbook.
10. Send the final Inbox validation request. Request-changes feedback resumes
    this same task and PR loop.

The orchestrator owns model choice, iteration count, PR granularity, packet
shape, and escalation judgment within the Model Card defaults.

## Human-ready exit

Stop at `ready-for-human` only when:

- the PR is open and current, unless the user explicitly requested local-only work;
- planned proof is green and recorded, or explicitly waived with residual risk;
- required review tiers are clean or findings have explicit dispositions;
- code changes have a thermo disposition;
- UI/visual work has a running playground/demo plus exact test steps;
- other work attaches the most useful file/proof artifact and validation steps;
- the Inbox request includes the PR, artifact, test playbook, and
  approve/request-changes form.

Do not merge without explicit human approval.

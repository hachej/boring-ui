---
name: boring-loop-plan
description: "Use for /loop-plan: turn a Kanzen issue or PR that is too risky, unclear, large, or multi-slice for direct implementation into an issue-linked plan with acceptance, flag path, proof, review budget, and next slice."
---

# Boring Loop Plan

Create the smallest useful plan for one GitHub issue.

Canonical model: `../../../../../docs/kanzen/boring-loop.md`.
Plan file rules: `../../../../../docs/kanzen/procedures/issue-plans.md`.
Trunk/flag/review budget: `../../../../../docs/kanzen/procedures/trunk-flags-review-budget.md`.

## Steps

1. Read the issue, related PRs, newest owner comments, existing plan files, and
   relevant code/docs.
2. Decide whether inline issue planning is enough or a plan file is required.
3. If a plan file is required, create or update
   `docs/issues/<issue-number>/plan.md` or `plan-<slice>.md`.
4. Include: decision, flag/abstraction path, acceptance, slices, proof, open
   blockers.
5. Keep slices near the review budget; propose stacked PRs only when needed.
6. Run thermo review on risky, broad, or multi-PR plans.
7. Comment the next action and session id on GitHub.
8. Update labels to the first unmet next gate.

## Exit

- Clear enough for code: `state:active phase:implement track:owner`.
- Still blocked: `state:blocked phase:grill track:owner`.
- Plan-only done and waiting for owner: `state:ready phase:merge track:owner`.

Return a short card with URL, primary issue, plan file, flag, proof path,
review budget, blockers, and exact next action.

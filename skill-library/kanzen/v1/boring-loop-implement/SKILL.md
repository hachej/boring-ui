---
name: boring-loop-implement
description: "Use for /loop-implement: implement one Kanzen issue or approved plan, open/update the PR, run review/fix/re-review, gather proof, and prepare owner or fast-track merge handoff."
---

# Boring Loop Implement

Implement one issue or one approved plan slice.

Canonical model: `../../../docs/kanzen/boring-loop.md`.
Coding rules: `../../../docs/kanzen/procedures/coding-rules.md`.
Trunk/flag/review budget: `../../../docs/kanzen/procedures/trunk-flags-review-budget.md`.
Visual review: `../../../docs/kanzen/procedures/visual-review.md`.
Proof comments: `../../../docs/kanzen/procedures/proof-of-work.md`.

## Steps

1. Read the issue, plan, acceptance, flag/abstraction path, proof requirement,
   related PRs, newest owner comments, and repo invariants.
2. Use the smallest lane that works: local trunk when allowed, otherwise a
   short-lived branch/worktree.
3. Code only the accepted slice. Keep production-code additions near the review
   budget or split before coding.
4. Run focused checks and demo workspace proof when UI/workspace behavior
   changes.
5. Open or update a PR that links the primary issue and names proof.
6. Run review, fix every accepted finding, and re-review until clean or blocked.
   Use thermo-nuclear review for non-trivial code.
7. Ensure proof, review, thermo, and CI match the current head SHA.
8. Land the plane: prepare a review card with PR URL, issue URL, summary, proof,
   demo URL or waiver, known gaps, and exact owner decision needed.

## Exit

- Not clear: `state:blocked phase:grill track:owner`.
- Needs plan/split: `state:active phase:plan track:owner`.
- Needs fixes/proof: `state:active phase:review track:owner`.
- Ready for owner: `state:ready phase:merge track:owner`.
- Fast-track only when every checklist item in `boring-loop.md` passes.

Workers may use subagents for slices or review, but the parent lane owns the
issue/PR and records the final state.

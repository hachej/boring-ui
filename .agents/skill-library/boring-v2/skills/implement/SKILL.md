---
name: implement
description: Implement one ready issue or slice safely, with proof, review, and PR handoff.
---

# Implement

Build one ready issue/slice. This is an implementation loop: implement → prove → review → fix → re-review as needed → hand off PR. Keep the diff small and reviewable.

## Non-negotiables

- Work on a branch/PR; never push directly to remote `main`.
- Do not force push, hard reset, clean, or delete files unless explicitly asked.
- Do not expose secrets in code, logs, commits, PRs, or comments.
- Prefer behavior tests at public seams.
- Proof is required before done.
- Review is required before done.

## Process

1. Read `docs/kanzen/MODEL-CARD.md` for proof, reviewer, and escalation policy when available.
2. Read the issue, plan/spec, comments, linked PRs, and relevant code/docs.
3. Confirm the target slice and proof expectation.
4. Implement one vertical slice.
5. Add/update tests or documented manual proof.
6. Run relevant checks.
7. Run review:
   - Standards review
   - Spec review
   - Thermo review for broad/risky/structural changes
8. Fix accepted findings and re-run relevant proof.
9. Re-review when fixes are non-trivial or the first review found structural issues.
10. Open/update PR.
11. Post proof and handoff card.
12. If owner review or a human decision is needed, use the `ask_user` tool when available so the request appears in the Boring UI inbox. If `ask_user` is unavailable, leave a clear GitHub/PR comment instead.

## Proof Requirements

Every implementation must record at least one proof path, preferring automated proof first:

- **Exact command:** the precise command run, with pass/fail result and relevant output summary.
- **Screenshot/demo:** required for visual/UI behavior when relevant; include URL/artifact and what to inspect.
- **Manual steps:** exact reproduction/verification steps when automation is not practical.
- **Waiver:** allowed only when proof is genuinely not possible or not worth the cost; explain why and name the residual risk.

Do not say “tested” without the command, screenshot/demo, manual steps, or waiver.

## Human Review Requests

When asking for owner review, visual review, merge approval, or a product decision, prefer `ask_user` if the tool is available. This creates a Boring UI inbox entry and keeps the workspace as the control plane.

Use a concise prompt with:

- PR/issue link
- decision needed
- proof summary
- concrete test steps
- risk/rollback notes

Fallback: if `ask_user` is unavailable, post the same request as a GitHub/PR comment.

## PR Handoff Card

```md
## Summary

## Issue / Slice

## What Changed

## Proof
- Exact command:
- Screenshot/demo:
- Manual steps:
- Waiver if proof is not possible:

## Review
- Standards:
- Spec:
- Thermo, if needed:
- Reviewed SHA:

## Risk / Rollback

## Next
- `ready-for-human` owner review, preferably via `ask_user`, or
- merge path if explicitly approved and safe.
```


## Loop Exit

Do not exit as done until:

- PR exists or the user explicitly asked for local-only work.
- Proof is recorded with exact command, screenshot/demo, manual steps, or waiver.
- Standards and Spec review are clean, or accepted residual risk is documented.
- Thermo review ran for risky/broad/structural changes.
- The next action is clear: owner review, merge path, or blocked reason.
- Human review/decision requests were sent through `ask_user` when available, or clearly posted as GitHub/PR comments otherwise.

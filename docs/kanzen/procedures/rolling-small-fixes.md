# Rolling Small-Fixes Batch

A rolling small-fixes batch is an owner-approved exception to the default
one-issue/one-PR execution loop. It trades repeated setup and review scheduling
for one branch, one worktree, and one final owner review while preserving an
independent review boundary for every fix.

Use this workflow only when the owner explicitly asks for a batch.

## Admission bar

A candidate must be:

- an open bug or minor enhancement with a clear expected behavior;
- small enough for one focused, independently revertible commit;
- low risk, with no migration, security, permissions, billing, secrets, release,
  public API, or architecture decision;
- testable through an exact command or a short concrete manual path; and
- independent of other batch items.

Do not admit broad refactors, ambiguous product or UI decisions, deletion-heavy
work, manual-only risky changes, or work already implemented by an active PR.
Adopt or review the existing PR instead of duplicating it.

## Branch and commit model

1. Create one branch and one `.worktrees/` worktree from current `origin/main`.
2. Open the rolling PR after its workflow document and initial candidate queue
   exist; do not wait for the whole batch.
3. Keep one primary GitHub issue per commit and use the required issue-prefixed
   commit subject.
4. Keep each commit independently reviewable and revertible. Do not hide shared
   refactors between fixes.
5. Update from `main` before entering a package or conflict cluster touched by
   active work. Remove stale candidates rather than coding against obsolete
   assumptions.

A rolling branch does not relax proof, review, or architectural invariants.
Every production fix still follows the `exec` loop and receives focused tests,
standards review, and spec review. Use thermo review when a change grows beyond
its admitted scope.

## PR review ledger

Maintain a table in the PR body with one row per candidate or included fix:

| Item | Status | Commit | Scope | Proof | Review | Risk / rollback |
| --- | --- | --- | --- | --- | --- | --- |
| `#123` | queued / included / dropped | SHA | one sentence | exact command or manual path | result and reviewed SHA | one sentence |

Also list relevant open PRs as **adopt/review**, **wait**, or **exclude**. The
ledger is the owner's final review list; issue closure alone is not evidence
that an item was reviewed.

## Stop conditions

Stop adding fixes and hand the batch to the owner when any of these is true:

- the owner asks to review;
- the diff approaches the normal review budget (about 1,500 added production
  lines, excluding tests and docs);
- fixes stop being independently understandable or revertible;
- a conflict requires cross-issue redesign;
- CI or focused proof is not green; or
- the batch has stayed open long enough that rebasing creates material review
  churn.

The PR remains `ready-for-human` until the owner reviews the ledger and approves
the batch. Never auto-merge a rolling batch.

## Final handoff

Before owner review:

1. update the branch from `main` without force-pushing;
2. run focused proof for each issue and the relevant changed-workspace gates;
3. run independent standards and spec review on the final SHA;
4. ensure the ledger matches the commits and links all proof;
5. summarize dropped candidates and active-PR dependencies; and
6. provide per-commit rollback guidance plus the whole-PR rollback path.

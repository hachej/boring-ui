# Rolling Small-Fixes Batch

The bugfix lane: a standing rolling branch that is the factory's alternative to
the default one-issue/one-PR loop for small fixes. It trades repeated setup and
review scheduling for one branch and one worktree, while keeping every fix its
own bead, its own commit, and its own reviewed decision — never a single batch
approval standing in for individual review.

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
3. One fix = one bead = one commit. Commit subject is `[br-###] description`
   (bead ID, per the factory's thread=bead correlation rule); reference the
   originating GitHub issue in the commit body when one exists.
4. Keep each commit independently reviewable and revertible. Do not hide shared
   refactors between fixes.
5. Update from `main` before entering a package or conflict cluster touched by
   active work. Remove stale candidates rather than coding against obsolete
   assumptions.

A rolling branch does not relax proof, review, or architectural invariants.
Every fix still follows the `exec` loop and receives focused tests, standards
review, and spec review. Use thermo review when a change grows beyond its
admitted scope.

## Per-fix intention and PR review ledger

Each completed fix gets its own inbox Human Intention (`ask_user`), subject
carrying the bead ID, per [`owner-review-card.md`](owner-review-card.md) — the
owner reviews and decides fixes individually, not as one batch verdict.

Maintain a table in the PR body with one row per candidate or included fix:

| Item (bead) | Status | Commit | Scope | Proof | Review | Intention | Risk / rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `br-123` | queued / included / dropped | SHA | one sentence | exact command or manual path | result and reviewed SHA | decision | one sentence |

Also list relevant open PRs as **adopt/review**, **wait**, or **exclude**. The
ledger is the owner's final review list; bead closure alone is not evidence
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

The PR remains `ready-for-human` until the owner flushes the ledger: reviews
each per-fix intention and approves. Never auto-merge a rolling batch — this
holds until this procedure itself is amended to say otherwise.

## Final handoff (owner flush)

Before the flush:

1. update the branch from `main` without force-pushing;
2. run focused proof for each fix and the relevant changed-workspace gates;
3. run independent standards and spec review on the final SHA;
4. ensure the ledger matches the commits, beads, and intentions, and links all
   proof;
5. summarize dropped candidates and active-PR dependencies; and
6. provide per-commit rollback guidance plus the whole-PR rollback path.

Merge on owner approval; cherry-pick when the batch is mixed (some fixes
approved, others not).

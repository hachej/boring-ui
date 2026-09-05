# [PR Review Batch] Review and gate eight independent fix PRs

Owner request (2026-09-05) for the Boring Factory. Feature name `PR Review Batch`, epic key `pr-review-batch`. An external agent opened eight independent fix PRs, each claiming regression coverage. The owner wants each one reviewed by a Factory Worker and gated in the Inbox, never merged by an agent.

## PRs

- #1542 [Handle Persistence] Prevent concurrent sandbox handle loss | epic/handle-persistence | +195 -37 4 files
- #1543 [Plugin Exports] Keep runtime singleton shims aligned with public APIs | epic/plugin-exports | +326 -157 5 files
- #1544 [Chat Event Ownership] Reject duplicate callbacks and stale session effects | epic/chat-event-ownership | +152 -15 5 files
- #1547 [Invite Idempotency] Isolate receipts and claim requests before side effects | epic/invite-idempotency | +539 -132 13 files
- #1545 [Gateway Retry] Recover safe admission failures without overlapping effects | epic/gateway-retry | +291 -29 11 files
- #1546 [Host Drain] Release every queued binding operation during shutdown | epic/host-drain | +78 -1 2 files
- #1540 [Package Cleanup] Remove unused private modules and obsolete tests | epic/package-cleanup | +66 -3786 48 files
- #1541 [Toast Delivery] Show errors from useToast in the mounted Toaster | epic/toast-delivery | +74 -1 2 files

## Shape of this epic

This epic ships no code of its own. Plan one Bead per PR, no dependencies between them, titled `[PR Review Batch] Review PR #<n>: <short title>`. Raise Gate 1 with the Bead list only (no plan document beyond this file and the show-me plan artifact).

Each Worker, for its Bead:
1. `git fetch origin pull/<n>/head:pr-<n>` in the epic worktree (never switch the epic worktree's branch; inspect with `git diff origin/main...pr-<n>` and `git log origin/main..pr-<n>`). Confirm the PR is mergeable against current `origin/main` (`gh pr view <n> --json mergeStateStatus`).
2. Prove at the exact PR head SHA in a dedicated sandbox: the focused tests the PR touches plus the packages it changes, typecheck, and `pnpm lint:invariants`. Record the exact-SHA proof receipt on the Bead.
3. Obtain a `fresh_review` adversarial verdict at that SHA (spec-fit: does the PR fix what its title claims; regression coverage real, not vacuous; no unrelated changes; no weakened tests; invariants).
4. Post the verdict on the PR as a comment (`gh pr comment <n>`) with proof summary and findings, prefixed `[PR Review Batch]`. Never merge, never close, never push to the PR branch.
5. Hand off on the Bead with: verdict (APPROVE / REQUEST CHANGES / REJECT), CI state, proof receipt, review receipt, and the one-line merge recommendation.

The Orchestrator raises one Inbox question per reviewed PR as it hands off (title `[PR Review Batch] Merge decision: PR #<n>`, fields: decision approve/changes/reject + notes, context = verdict, proof, CI, link), and a final Gate 2 that summarises all eight with the per-PR decisions received so far. No demo.

## Proof for Gate 2

Eight Beads handed off, eight PR comments, eight Inbox decisions requested.

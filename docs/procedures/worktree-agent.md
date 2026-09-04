# Worktree Agent Procedure

Use this when `/exec` delegates implementation.

## Rules

- Keep all project worktrees under `.worktrees/`.
- Never push directly to remote `main`.
- Inspect branch, dirty state, and existing ownership before editing.
- Do not overwrite another agent's work.
- One epic = one GH issue = one shared worktree = one PR. Workers claim beads
  and commit directly to the epic branch — no per-bead sub-branches or
  worktrees. Beads need not predict file scope. Workers see concurrent changes
  in the shared worktree, stage only their intended changes, commit frequently,
  and resolve conflicts in place without reverting or overwriting another
  Worker's work. Start without messaging or file reservations; add coordination
  machinery only when observed collisions justify it.
- The standing bugfix lane (`fix/rolling`) is the exception: see
  `rolling-small-fixes.md`.
- Outside the factory, the orchestrator chooses branch/worktree topology and PR
  granularity from task shape, dependencies, rollback, and review budget.
- Read-only research/review can run independently. Writers must not silently
  race on the same files.
- Stacked PRs use one branch per layer; each layer has its own proof and review.
- Stop before destructive git/filesystem operations, force pushes, releases,
  publishes, worktree cleanup, or file deletion unless explicitly authorized.

## Setup

Run setup from the canonical project checkout, not from inside another worktree.

```bash
mkdir -p .worktrees
git worktree add .worktrees/<lane> -b <branch> <base>
cd .worktrees/<lane>
git status --short --branch
```

If the target branch already exists, attach the worktree to that branch rather
than creating a second lane. Record the chosen topology in the execution handoff.

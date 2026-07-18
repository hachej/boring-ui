# Worktree Agent Procedure

Use this when `/exec` delegates implementation.

## Rules

- Keep all project worktrees under `.worktrees/`.
- Never push directly to remote `main`.
- Inspect branch, dirty state, and existing ownership before editing.
- Do not overwrite another agent's work.
- The orchestrator chooses the branch/worktree topology and PR granularity from
  the task or epic shape, dependencies, rollback, and review budget.
- One epic may use one shared worktree or isolated worker worktrees. When writers
  share a lane, coordinate ownership and conflicts explicitly. Agent Mail/file
  reservations may be used when available; they are not required.
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

# Worktree Agent Procedure

Use this when `/exec` delegates implementation.

## Rules

- Keep all project worktrees under `.worktrees/`.
- Never push directly to remote `main`.
- Inspect branch, dirty state, and existing ownership before editing.
- Do not overwrite another agent's work.
- One epic = one GH issue = one worktree = one PR. Workers claim beads and commit
  directly to the epic branch — no per-bead sub-branches. Coordinate ownership
  and conflicts through bead file scope (`bead-ready.md`): concurrent beads in
  one epic must not overlap files. No messaging or file-reservation system is
  used (see `.agents/factory/tools.md`, "Not in the factory").
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

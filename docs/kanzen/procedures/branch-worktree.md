# Branch and Worktree Procedure

Use this for any issue/PR implementation lane.

## Rules

- Never work directly on `main` unless explicitly authorized.
- One lane owns one GitHub issue/PR, one branch, and one checkout/worktree.
- Default branch: `issue-<number>-<slug>`; if no issue exists, use
  `<short-slug>`.
- Prefer a repo-local `.worktrees/<branch>` worktree when parallel work or
  another dirty checkout exists.
- Inspect dirty state before editing and do not overwrite another agent's work.
- Stacked PRs use one branch per layer; each layer has its own review and proof.

## Commands

In the current checkout:

```bash
git status --short --branch
git switch -c issue-123-short-slug
```

For an isolated worktree:

```bash
mkdir -p .worktrees
git worktree add .worktrees/issue-123-short-slug -b issue-123-short-slug main
cd .worktrees/issue-123-short-slug
git status --short --branch
```

Stop before destructive git operations, force pushes, releases, publishes, or
branch/worktree cleanup unless Julien explicitly asks.

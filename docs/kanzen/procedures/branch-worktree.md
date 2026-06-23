# Branch and Worktree Procedure

Use this for any issue/PR implementation lane.

## Rules

- Never work directly on `main` unless explicitly authorized.
- One lane owns one GitHub issue/PR, one branch, and one checkout/worktree.
- Default branch: `issue-<number>-<slug>`; if no issue exists, use
  `<short-slug>`.
- Prefer a sibling worktree when parallel work or another dirty checkout exists.
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
git worktree add ../boring-ui-v2-issue-123 -b issue-123-short-slug main
cd ../boring-ui-v2-issue-123
git status --short --branch
```

Stop before destructive git operations, force pushes, releases, publishes, or
branch/worktree cleanup unless Julien explicitly asks.

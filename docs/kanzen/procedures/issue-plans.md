# Issue Plans

Every plan belongs to a GitHub issue.

```text
docs/issues/
  123/
    plan.md
    plan-frontend-slice.md
    plan-stack-2.md
```

- Folder: `docs/issues/<issue-number>/`
- Main plan: `plan.md`
- Slices/stacks: `plan-<short-slice>.md`
- No issue: create or choose one first.
- PR: name primary issue; link folder.
- Commits: start with issue number.

```text
#123 docs(plan): add review handoff slice
```

- Multi-issue PR: split commits by primary issue; secondary links in body.
- Do not move plans by state.
- State lives in frontmatter:

```yaml
github: https://github.com/hachej/boring-ui/issues/123
issue: 123
state: active
phase: plan
track: owner
flag: not-needed
updated: 2026-06-25
```

- Plan-only edits: no branch/worktree needed.
- Code starts after: issue mapping, flag/abstraction, proof path, owner gate.

Body shape:

```markdown
# gh-123 short title

## Decision
What should happen and why this is worth doing.

## Flag
`not-needed`, `flag:<name>`, or `not-flaggable` with the abstraction path.

## Acceptance
Small bullets that can be tested or reviewed.

## Slices
Tiny PRs or implementation steps. Keep each slice near the review budget; say
when a stack is needed.

## Proof
Commands, CI, demo workspace, screenshots, or explicit waiver.

## Open Questions
Only questions that block safe implementation or merge.
```

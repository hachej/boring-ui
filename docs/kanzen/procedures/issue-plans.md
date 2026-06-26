# Issue Plans

Plan files are issue artifacts. Every plan must belong to a GitHub issue before
implementation starts, and the local folder mirrors that issue:

```text
docs/issues/
  123/
    plan.md
    plan-frontend-slice.md
    plan-stack-2.md
```

The folder is `docs/issues/<issue-number>/`. Use `plan.md` for the main plan and
`plan-<short-slice>.md` for additional slices or stacked PR layers. If no issue
exists yet, create or choose the issue first; do not start an implementation
plan against a floating local file. PRs should name their primary issue and link
back to the matching local issue folder.

All commits for the issue start with the issue number:

```text
#123 docs(plan): add review handoff slice
```

If one PR covers multiple issues, split the commits by primary issue and mention
secondary issue links in the commit body.

Do not move plans when Kanzen state changes. Keep state in frontmatter so issue
folders stay stable and searchable:

```yaml
github: https://github.com/hachej/boring-ui/issues/123
issue: 123
state: active
phase: plan
track: owner
flag: not-needed
updated: 2026-06-25
```

Plan-only edits do not need a branch/worktree. Code starts only after the plan
states the issue mapping, flag/abstraction strategy, proof path, and owner gate.

Use this body shape:

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

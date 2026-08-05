# Issue plans

Use when an issue needs a spec, design decision, proof path, or slices before implementation.

Every plan belongs to a GitHub issue (one epic = one issue). Write the narrative
plan below, then translate its slices into a Beads graph via `br` — one bead per
slice, each meeting the Definition of Ready (`bead-ready.md`: WHAT, proof path,
file scope, fits one session). The bead graph, not the markdown file, is what
the Beadle dispatches from. Plan approval (human gate 1) covers both.

```text
docs/issues/<issue-number>/plan.md
```

Plan-only edits can happen without a feature branch when the workspace is otherwise safe. Code starts only after the issue, proof path, next slice, and corresponding bead are clear.

## Frontmatter

```yaml
github: https://github.com/hachej/boring-ui/issues/123
issue: 123
state: ready-for-agent
updated: 2026-07-09
```

Optional fields:

```yaml
flag: not-needed | flag:<name> | not-flaggable
track: owner | fast
```

## Body

```md
# gh-123 short title

## Problem

## Solution

## Decisions

## Flag / Abstraction
- Needed?:
- Path:
- Rollback:

## Test Seams
- Highest public seam:
- Existing prior art:
- Avoid testing:

## Acceptance

## Proof
- Exact command:
- Screenshot/demo:
- Manual steps:
- Waiver if proof is not possible:

## Slices

### Slice: <name>
**Bead:** br-###
**Delivers:**
**Blocked by:** None / <slice or issue>
**Proof:**
**Review budget:** inside / exceeds / why

## Out of Scope

## Open Questions
```

Prefer one implementable slice. Split only when the work would exceed review budget or needs parallel/stacked work.

For wide mechanical refactors, use:

```text
expand -> migrate batches -> contract
```

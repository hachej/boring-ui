# Issue plans

Use when an issue needs a spec, design decision, proof path, or slices before implementation.

Every plan belongs to a GitHub issue (one epic = one issue). Write the narrative
plan below, then translate its slices into a Beads graph via `br` — one bead per
slice, each meeting the Definition of Ready (`bead-ready.md`: WHAT, proof path,
file scope, fits one session). The bead graph, not the markdown file, is what
the Beadle dispatches from. Under [risk-based delivery](boring-loop.md), obtain
owner plan decisions only for protected boundaries or unresolved intent; routine
work with clear scope/proof needs no new owner ceremony. Preserve existing
pending gates and stricter host requirements until the rollout is implemented.
Where human Gate 1 is required, approval covers both plan and graph, not the final
implementation. Its intention links a **plan review doc** — self-contained
visual HTML per [`visual-review-doc.md`](visual-review-doc.md).

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
- Protected boundaries / owner decisions needed:
- Expected package production additions + deletions (>500 needs owner review):

## Flag / Abstraction
- Needed?:
- Path:
- Rollback:

## Test Seams
- Highest public seam:
- Producer / consumer packages and semantic owners:
- Abstraction gate proof (imports, real callers, contract tests):
- Existing prior art:
- Avoid testing:

## Acceptance

## Proof
- Exact command:
- Playwright before/after video and scenario assertions (UI):
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

# Issue 1030 UI surface checklist

Tracking issue: https://github.com/hachej/boring-ui/issues/1030

This is the durable status board for recovering approved UI improvements from Claude Code session `41f9141f-ebae-4e10-9cfa-9adce4b02488`. Update it whenever a surface changes state.

## Status legend

- `queued` — inventoried but no isolated implementation yet
- `implementing` — isolated worktree has active changes
- `owner-review` — live playground is ready for visual feedback
- `approved` — owner approved; proof/PR remains
- `ci` — PR open or auto-merge waiting on gates
- `merged` — merged to `main`
- `rejected` — intentionally excluded

## Surfaces

| Surface | Issue / PR | Status | Owner decision / next action |
| --- | --- | --- | --- |
| App-wide palette and foundation | #1030 | **rejected** | Keep the original application palette. Do not port Claude’s global color redesign. |
| Chat transcript and tool transparency | #1030 / PR #1031 | **merged** | Accepted: transcript typography, read-only grouping, standalone edit/write/bash, open diffs, compact actions, discreet reasoning. |
| Chat composer | #1033 | **owner-review** | Empty state now uses title → centered composer → quick actions; keyboard hint removed; compact send restored. Agent/workspace parity verified for controls. Await owner decision. |
| Chat top bar / pane chrome | #1032 | **owner-review** | Workspace playground available. Owner needs to validate title fallback, action alignment, split/multi-pane behavior, and mobile header. |
| Chat terminal errors and recovery | #1036 | **owner-review** | Focused tests/typecheck/build pass; deterministic error URL is live. Await owner decision on copy, details, and reload action. |
| Navigation and session rail | TBD | **queued** | Inventory Claude changes after composer/top-bar decisions. Keep separate from pane top bar. |
| General loading, empty, and unavailable states | TBD | **queued** | Reassess after composer empty state and chat terminal errors merge; avoid duplicating those slices. |
| Inbox and Tasks | TBD | **queued** | Port as a dedicated plugin/workspace surface with original palette. |
| Data explorer and data catalog | TBD | **queued** | Isolate table/catalog improvements; do not carry BI capability hacks or broad foundation changes. |
| BI dashboards and charts | TBD | **queued** | Separate high-risk surface; verify legends, capability wiring, fallbacks, and error states end-to-end. |
| Shared primitives | TBD | **queued / as-needed** | Extract only primitives proven by approved surfaces; do not run a broad primitive redesign independently. |

## Current live review URLs

- Composer in agent playground: `http://100.68.199.114:5204/`
- Composer in workspace playground: `http://100.68.199.114:5206/?showcase=1`
- Chat top bar in workspace playground: `http://100.68.199.114:5205/?showcase=1`
- Chat terminal error fixture: `http://100.68.199.114:5207/?chatError=1`

## Immediate next steps

1. Collect owner approval/revision for composer, chat top bar, and chat terminal errors.
2. Apply requested revisions independently in each worktree.
3. Generate handoff evidence and open separate PRs for approved surfaces.
4. Start navigation/session rail inventory after one active owner-review slot closes.

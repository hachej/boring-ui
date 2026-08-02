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
| Chat composer | #1033 | **implementing** | Keyboard hint removed; original compact send button restored; empty state being changed to title → centered composer → quick actions. Validate agent and workspace hosts next. |
| Chat top bar / pane chrome | #1032 | **owner-review** | Workspace playground available. Owner needs to validate title fallback, action alignment, split/multi-pane behavior, and mobile header. |
| Chat terminal errors and recovery | #1036 | **implementing** | Port focused Claude error precedence and recovery. Run tests, then expose fixture/playground for owner review. |
| Navigation and session rail | TBD | **queued** | Inventory Claude changes after composer/top-bar decisions. Keep separate from pane top bar. |
| General loading, empty, and unavailable states | TBD | **queued** | Reassess after composer empty state and chat terminal errors merge; avoid duplicating those slices. |
| Inbox and Tasks | TBD | **queued** | Port as a dedicated plugin/workspace surface with original palette. |
| Data explorer and data catalog | TBD | **queued** | Isolate table/catalog improvements; do not carry BI capability hacks or broad foundation changes. |
| BI dashboards and charts | TBD | **queued** | Separate high-risk surface; verify legends, capability wiring, fallbacks, and error states end-to-end. |
| Shared primitives | TBD | **queued / as-needed** | Extract only primitives proven by approved surfaces; do not run a broad primitive redesign independently. |

## Current live review URLs

- Composer in agent playground: `http://100.68.199.114:5204/`
- Composer in workspace playground: temporarily blocked by `workspace/storage selector is not allowed`; fix before owner parity review.
- Chat top bar in workspace playground: `http://100.68.199.114:5205/?showcase=1`

## Immediate next steps

1. Validate and stabilize the composer empty-state restructure.
2. Fix the workspace-playground selector setup and compare composer rendering in agent vs workspace hosts.
3. Ask the owner to approve/revise the composer.
4. In parallel, collect owner feedback on the chat top bar.
5. Finish tests and a review fixture for chat terminal errors.
6. Open separate PRs only after each surface is individually approved.

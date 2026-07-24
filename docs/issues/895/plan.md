---
github: https://github.com/hachej/boring-ui/issues/895
issue: 895
state: ready-for-human
updated: 2026-07-22
flag: not-needed
track: fast
---

# gh-895 add chat pane split controls to each session top bar

## Problem

Users need a direct way to split an individual chat session pane vertically or horizontally from that pane's top bar. The existing split affordance relies on dragging Dockview headers and is not obvious enough.

Reference screenshot: `assets/images/issue-895-chat-session-menu-split.png`.

## Solution

Add two controls to every Dockview chat pane header:

- **Split chat vertically** — creates a new chat pane to the right of the current pane.
- **Split chat horizontally** — creates a new chat pane below the current pane.

The controls live in `ChatPaneHeader` next to the pane title/other header controls. They call a new `onSplitPane(id, direction)` contract, which flows through `ChatLayout` to `WorkspaceAgentFront`. `WorkspaceAgentFront` creates the new session and passes a one-shot pending placement back to `ChatPaneStageDock`, so Dockview opens the new pane at the requested split position.

Existing workspace-global `chatTopActions` still render in each header, but they are not the primary requested feature.

## Decisions

- Keep Dockview pane headers as the owner of split controls; do not add another top bar inside chat content.
- Vertical split means a vertical divider / side-by-side panes (`right`).
- Horizontal split means stacked panes (`below`).
- Controls are per-pane: clicking the control in pane A splits from pane A, clicking in pane B splits from pane B.
- Preserve drag safety: split buttons use `data-boring-workspace-part="chat-pane-control"` and stop native pointer/mouse propagation.
- Do not create Beads; this is one reviewable slice.

## Flag / Abstraction

- Needed?: No feature flag.
- Path: small prop/API addition around `ChatLayout` / `ChatPaneStage` / `ChatPaneStageDock` plus the session creation placement in `WorkspaceAgentFront`.
- Rollback: revert the split-control prop/API and header render changes.

## Test Seams

- Highest public seam: `ChatPaneStageDock` rendering contract tests in `packages/workspace/src/front/layout/__tests__/ChatPaneStageDock.test.tsx`.
- Existing prior art: `ChatPaneStageDock` already mocks `DockviewReact` and asserts stage-to-dock rendering props.
- Required harness improvement included: the Dockview mock now mounts `defaultTabComponent` headers for multiple pane ids, allowing header controls to be asserted.
- Avoid testing: Dockview drag/drop internals or pixel-perfect menu placement.

## Acceptance

- With one or more chat panes open, each pane top bar/header shows two split controls.
- The vertical split control creates a new chat pane to the right of that pane.
- The horizontal split control creates a new chat pane below that pane.
- Actions are scoped to the pane whose header button was clicked.
- Pane title, drag grip, close button, focus/active behavior, and layout persistence keep working.
- Keyboard/focus behavior remains accessible: buttons have useful aria labels and do not accidentally trigger pane drag/activation.

## Proof

- Exact command: `NODE_ENV=test pnpm --filter @hachej/boring-workspace exec vitest run src/front/layout/__tests__/ChatPaneStageDock.test.tsx`
- Result: passed — 1 file, 3 tests.
- Broader check attempted: `pnpm --filter @hachej/boring-workspace run typecheck`; failed on unrelated existing test/import errors.
- Screenshot/demo: not captured in this handoff; owner visual review requested.

## Slices

### Slice: Per-pane vertical/horizontal split controls

**Delivers:** Chat pane headers render two split controls, wire them to the pane id, and place newly-created sessions according to the selected split direction.

**Blocked by:** None.

**Proof:** Targeted unit/contract test command plus owner visual verification of two-pane layout.

**Review budget:** inside — localized UI contract change plus session creation placement.

## Out of Scope

- Redesigning the session browser/list.
- Adding true per-session menus beyond the split controls.
- Changing Dockview drag/drop behavior.
- Broad chat session routing/backend changes.

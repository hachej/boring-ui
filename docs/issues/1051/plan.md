---
github: https://github.com/hachej/boring-ui/issues/1051
issue: 1051
state: ready-for-agent
updated: 2026-08-06
flag: not-needed
---

# gh-1051 Chat pane: hide close action on the final session

## Problem

The workspace center requires at least one chat pane. Today the final
remaining chat pane still renders a close action; using it leaves an invalid
center state. Follow-up to #1032.

## Solution

In the chat pane header, render the close action only when more than one chat
pane exists. Split actions remain on the final pane. Multi-pane chats keep
close. Pure front-end conditional; no server involvement.

## Decisions

- Derive "is final pane" from the existing pane/layout model the header
  already receives — no new state, no new props threading beyond what the
  layout already knows.

## Flag / Abstraction
- Needed?: no — tiny, reversible UI conditional.
- Rollback: revert the PR.

## Test Seams
- Highest public seam: the chat pane header component with 1 vs 2+ panes.
- Existing prior art: pane header tests near the touched component.
- Avoid testing: layout engine internals.

## Acceptance

1. Final remaining chat pane: no close action; split actions present.
2. Two or more chat panes: every pane shows close.
3. Closing down to one pane removes the last close button reactively.
4. Desktop and mobile variants both covered.

## Proof
- Exact command: focused vitest run on the touched component's test file(s)
  in `packages/workspace`.
- Manual steps: workspace playground — open two chats, close one, observe the
  survivor loses its close button.

## Slices

### Slice: hide-close-on-final-pane
**Bead:** wt-391-forward-1051-final-pane-close-y8u
**Delivers:** conditional close action + regression tests (desktop/mobile)
**Blocked by:** None
**Proof:** focused vitest green + playground manual check
**Review budget:** inside

## Out of Scope

- Any change to split behavior, pane persistence, or session deletion.

## Open Questions

None.

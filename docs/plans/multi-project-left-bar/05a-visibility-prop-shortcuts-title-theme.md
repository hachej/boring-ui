# 05a — Visibility Signal + Shortcuts / Title / Theme Gating

## Purpose

Introduce the basic `visible` / active-workspace signal and gate the simplest global side effects.

Depends on:

- 03a persistent shell, or at least a content host that can pass `visible`.

## Review budget

Target non-test/non-doc added LOC: **< 1,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Add `visible?: boolean` (or equivalent context) to workspace content/provider path.
- Gate global keyboard shortcuts to visible workspace only.
- Gate document title updates to visible workspace only.
- Gate document theme mutation only if theme is workspace-owned; if theme is global user preference, document behavior and avoid duplicate writes.
- Ensure hidden workspace cannot retain focus.

## Code areas

- `WorkspaceProvider`
- `WorkspaceShortcuts`
- `useKeyboardShortcuts`
- document title/theme effects
- shell content host wrapper

## Tests / acceptance

With A visible and B hidden:

- shortcut affects A only;
- B does not update document title;
- Theme behavior is explicitly verified: if workspace-owned, hidden B does not mutate `data-theme`; if global, duplicate hidden writes are avoided/documented.
- B cannot retain focus after becoming hidden;
- switching visibility to B transfers shortcut/title ownership;
- single-project mode behaves unchanged.

## Non-scope

- UI command target schema (05b).
- Streams/ChatPanelHost (05c).
- Overlays/toasts/drag/drop (05d).

# 05d — Overlays, Toasts, Focus, and Drag/Drop Gating

## Purpose

Prevent hidden cached workspaces from showing UI or accepting interactions.

Depends on:

- 05a visibility signal;
- 05b UI command targeting for command-triggered overlays.

## Review budget

Target non-test/non-doc added LOC: **< 1,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Gate command palette ownership.
- Gate overlays and plugin/skills panels for hidden workspaces.
- Gate toasters/notifications.
- Disable hidden workspace drag/drop targets.
- Ensure focus moves out of workspace when it becomes hidden.

## Code areas

- `packages/workspace/src/front/provider/WorkspaceProvider.tsx` — mounts `CommandPalette` and `Toaster`.
- `packages/workspace/src/front/components/useCommandPaletteChrome.ts` — global command-palette open/shortcut behavior.
- `packages/workspace/src/front/layout/ChatPaneStageDock.tsx` — accepts dropped chat sessions.
- `packages/workspace/src/front/layout/plugin-tabs/AppLeftPaneSessionRow.tsx` — draggable/session row affordances.
- overlay state in `WorkspaceAgentFront` / plugin-tabs left overlay paths.

## Tests / acceptance

With A visible and B hidden:

- B command palette is not open/operable.
- B overlays/toasts do not render visible UI.
- B drag/drop targets do not accept drops.
- When B becomes hidden, focus moves out of B; focus is not restored into a hidden workspace on later visibility switches.
- Cross-project session rows do not expose drag/open-in-pane into A.
- When switching to B, B overlays/toasts/drag targets become eligible and A becomes inert.

## Risks

- Some notification/toast may be global account-level. If so, route it through the persistent shell, not hidden workspace providers.
- Do not break same-project drag-to-split behavior for visible workspace.

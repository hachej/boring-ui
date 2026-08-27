---
github: https://github.com/hachej/boring-ui/issues/790
issue: 790
state: ready-for-agent
updated: 2026-07-20
track: owner
---

# gh-790 Session review workspaces and right-to-left project exploration workspace

## Problem

Boring currently blurs two different workspace jobs into one global right workbench:

1. **Reviewing artifacts produced by a chat session** — the user clicks an artifact/link in the conversation and expects to see it immediately in that session's context.
2. **Exploring the project without a session** — the user opens Files/Search/plugins, browses, finds a file or tool, then opens it in project tabs.

When both jobs share the same global workbench, ownership is unclear with multiple sessions open. A chat artifact can feel like it hijacks a project workspace, while the project workspace can feel incorrectly owned by the active chat.

## Solution

Split the UX into two explicit workspace surfaces:

### 1. Session workspace: review-oriented

Each chat pane can open/collapse its own embedded workspace from the chat pane top bar.

```text
┌──────────────────────────────────────────────┐
│ Session A                         Workspace │
├───────────────────────┬──────────────────────┤
│ Chat transcript       │ Session workspace    │
│ Composer              │ Review artifact/file │
└───────────────────────┴──────────────────────┘
```

Rules:

- The chat top-bar **Workspace** button toggles this embedded workspace open/collapsed.
- Chat artifact links/cards open directly in the owning session workspace.
- It is optimized for immediate review: click artifact → see artifact.
- No session fullscreen/zoom/detached mode in this plan.
- No global context switch when merely focusing a different chat pane.

### 2. Project workspace: exploration-oriented

The generic/project workspace is a right-to-left exploration surface controlled by one always-visible rail on the far right.

Collapsed/default:

```text
┌───────────────────────────────┬──────┐
│ Sessions / chat area          │ Rail │
│                               │ 📁   │
│                               │ 🔎   │
│                               │ 🧩   │
└───────────────────────────────┴──────┘
```

Click a rail icon:

```text
┌──────────────────────┬────────────────┬──────┐
│ Sessions / chat area │ Source pane    │ Rail │
│                      │ file tree      │ 📁   │
│                      │ search/plugins │ 🔎   │
│                      │                │ 🧩   │
└──────────────────────┴────────────────┴──────┘
```

Click a file/item in the source pane:

```text
┌───────────────┬───────────────────┬────────────────┬──────┐
│ Sessions/chat │ Project tabs      │ Source pane    │ Rail │
│               │ file/editor/view  │ file tree      │ 📁   │
│               │ plugin tab        │ search/plugins │ 🔎   │
│               │                   │                │ 🧩   │
└───────────────┴───────────────────┴────────────────┴──────┘
```

Rules:

- The rail is always visible on the far right.
- There is exactly one project rail.
- The rail contains Files/Search/plugin/source icons.
- Clicking a rail icon opens the source pane to the **left** of the rail.
- Clicking a file/source item opens a project tab/editor to the **left** of the source pane.
- This mirrors today's workbench behavior, but oriented right-to-left.
- The old separate/global left source pane should be removed for this mode.
- The old floating workbench/fullscreen/top-right control bar should not appear.

## Decisions

- **Session workspace is review-oriented.** It is direct and contextual: artifact link → open in owning chat pane.
- **Project workspace is exploration-oriented.** It starts from the rail/source pane: rail → source pane → project tab.
- **One rail only.** The project workspace rail is the rail; do not add a second outer rail.
- **No chat fullscreen/zoom mode for now.** The session workspace only collapses/uncollapses inside the chat pane.
- **Passive chat focus does not move workspace state.** Workspace routing is explicit via chat artifact/link, chat Workspace toggle, or project rail action.
- **Artifact provenance matters.** Session-bound artifacts default to the session workspace even if the project workspace is open.
- **No implicit fallback from session artifact to project workspace.** Artifact click should open/initialize the owning session workspace; an explicit “Open in project workspace” action can be added later.
- **Prefer lazy mount, then preserve session workspace state.** The session workspace may mount only after first use, but after first open it should preserve open tabs/dirty editor state while collapsed until the chat pane closes.
- **Right-side project workspace may start as a compatibility shim.** A `sidebarSide`-style adapter is acceptable for first delivery; left-oriented workbench names should be cleaned up after UX acceptance.

## Flag / Abstraction

- Needed?: Yes, for rollout if implemented beyond spike.
- Path: Prefer a workspace layout setting/feature flag such as `workspaceLayout=session-review-project-explore` or an app shell capability.
- Rollback: Disable the layout mode and route all opens through the existing global SurfaceShell behavior.

## Test Seams

- Highest public seam: workspace shell/app front behavior through `WorkspaceAgentFront` / `ChatLayout` / `SurfaceShell`.
- Existing prior art:
  - `SurfaceShell` already supports a rail/source pane + tab area.
  - `WorkbenchLeftPane` already models Files/plugin source icons and opening source/panel entries.
  - `ChatPaneStageDock` already owns per-chat pane headers and mounted chat panes.
- Avoid testing:
  - Pixel-perfect layout values.
  - Internals of Dockview beyond visible pane/rail placement and command routing.

## Grill Review

Unknowns review recorded in:

```text
docs/issues/790/grill-review.md
```

Material defaults accepted by this plan unless overridden:

- Session artifact clicks initialize/open the owning session workspace, not the project workspace.
- Per-session workspace targets own their command queue and flush it when their `SurfaceShell` is ready.
- New workspace layout state uses layout-specific storage namespaces to avoid corrupting/overloading old global workbench keys.
- The first implementation can keep a right-side compatibility shim, but cleanup should rename left-oriented source-pane abstractions.

## Acceptance

- With project workspace collapsed, a single rail remains visible at the far right.
- Clicking Files/Search/plugin icons on that rail opens the corresponding source pane to the left of the rail.
- Clicking a file/source item opens a project tab area to the left of the source pane.
- The source/plugin rail appears on the far right of the source pane, not between project tabs and source content incorrectly.
- There is no separate old `workbench-left` sidebar in the main shell.
- Collapsing the project source pane collapses it back to the single far-right rail, not to an invisible/hidden project workspace.
- There is no floating fullscreen/maximize workbench bar in the top right.
- Each chat pane has a **Workspace** toggle in the top bar.
- Opening a chat artifact/link opens that item in the owning session workspace, not the project workspace.
- Multiple chat panes can have independent embedded workspaces without stealing each other's state.
- Collapsing/reopening a session workspace after first open preserves open tabs and dirty/transient editor state unless explicitly documented otherwise.
- Passive chat pane focus does not change either session workspace or project workspace state.
- Command routing is target-bound: chat artifact clicks use the clicked/owning session, and rail/source clicks use the project workspace; neither relies on the current active chat at dispatch time.

## Proof

- Exact commands:
  - `pnpm --filter @hachej/boring-workspace typecheck`
  - `pnpm --filter @hachej/boring-ui-cli build:full`
- Screenshot/demo:
  - Manual browser verification of:
    1. Collapsed project rail only.
    2. Rail icon opens source pane to left of rail.
    3. Source item opens project tab to left of source pane.
    4. Chat Workspace toggle opens/collapses per-session workspace.
    5. Chat artifact opens in session workspace.
- Manual steps:
  1. Start workspace app.
  2. Open two chat panes.
  3. Toggle Workspace in each chat pane and confirm independence.
  4. Click a mock artifact card/link in a chat and confirm it opens in that chat workspace.
  5. Collapse project workspace and confirm only one far-right rail remains.
  6. Click Files on the right rail and confirm file tree/source pane opens immediately left of rail.
  7. Click a file and confirm project editor tab opens left of the source pane.
- Waiver if proof is not possible: none expected for front behavior.

## Slices

### Slice: Session workspace review surface

**Delivers:**
- Chat pane top-bar Workspace toggle.
- Embedded per-session SurfaceShell/workspace area.
- Artifact/file opens from chat route to the owning session workspace.
- No zoom/fullscreen mode.

**Blocked by:** None.

**Proof:**
- Typecheck/build.
- Manual two-session test showing independent toggles and artifact opens.

**Review budget:** inside.

### Slice: Project workspace right-to-left rail/source/tabs

**Delivers:**
- Always-visible far-right project rail.
- Rail opens source/plugin pane to its left.
- Source item opens project tabs to the left of source pane.
- Existing global left workbench source pane removed/disabled in this layout.
- No extra outer rail or floating fullscreen bar.

**Blocked by:** None, but should be coordinated with Slice 1 routing rules.

**Proof:**
- Typecheck/build.
- Manual rail → source pane → file tab test.

**Review budget:** inside to moderate, depending on how much SurfaceShell must be generalized for right-side source panes.

### Slice: Source-pane abstraction cleanup

**Delivers:**
- Rename or wrap left-oriented concepts after the UX lands: `WorkbenchLeftPane` → source pane abstraction, `leftState` → source state, `defaultLeftTab` → default source tab, etc.
- Keep compatibility with old storage keys or provide a one-time migration/normalization.

**Blocked by:** Project workspace right-to-left slice.

**Proof:**
- Typecheck/build.
- Existing workbench/source pane tests updated for both left and right orientations.

**Review budget:** inside.

### Slice: Layout mode / rollout guard

**Delivers:**
- A feature flag or layout preference to enable the new model.
- Safe fallback to the current global workspace behavior.
- Copy/tooltips that distinguish “review workspace” vs “explore project”.

**Blocked by:** Slices 1 and 2.

**Proof:**
- Toggle/flag switches between old and new routing without data loss.

**Review budget:** inside.

## Out of Scope

- Persisting durable per-session workspace snapshots beyond the minimum needed for the UI mode; however, preserving open/dirty state across a simple collapse after first open is in scope.
- Backend/schema changes for artifact provenance.
- Task/Inbox-specific workspaces, except that the project workspace model should not block them later.
- Pixel-perfect final visual polish.
- Mobile-specific redesign beyond not breaking current mobile shell behavior. The new layout can initially be desktop-only behind the rollout guard.

## Open Questions

- Should the default layout be session-review/project-explore for all users, or only after multiple sessions are open?
- What exact persistence key should store per-session workspace tabs and source state? Recommended shape: `session-review-workspace:<workspaceId>:<sessionId>` and `project-explore-workspace:<workspaceId>`.
- Should project rail actions include Search/Git/Plugins from day one, or start with Files + existing registered workspace sources?
- Should “Open in project workspace” be available from session workspace as an explicit escape hatch?

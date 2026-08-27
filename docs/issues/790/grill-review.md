# gh-790 grill review — unknowns for session review workspace + project exploration workspace

Date: 2026-07-20
Plan under review: `docs/issues/790/plan.md`

## Restated plan

The UX separates two workspace jobs:

- **Session workspace / review surface:** each chat pane has a top-bar Workspace toggle; artifacts from that chat open directly in that pane's embedded workspace.
- **Project workspace / exploration surface:** a single always-visible far-right rail opens Files/Search/plugin source panes right-to-left; clicking source items opens project tabs to the left of the source pane.

The plan explicitly removes chat fullscreen/zoom mode, removes old floating workbench/fullscreen controls, and removes the separate old `workbench-left` main-shell sidebar.

## Stated assumptions

- `SurfaceShell` can be reused for both session-owned review workspaces and the project workspace.
- The current workbench source model (`WorkbenchLeftPane`) can be mirrored to the right.
- Chat artifact/file opens can be routed to the owning chat pane's `SurfaceShell` without backend changes for the first implementation.
- The project rail/source/tab flow should behave like today's workbench, only mirrored right-to-left.

## Evidence read

- Plan: `docs/issues/790/plan.md`
- Session workspace spike: `.worktrees/spike-session-artifact-cards/packages/workspace/src/front/layout/ChatPaneStageDock.tsx`
- Surface shell side/rail spike: `.worktrees/spike-session-artifact-cards/packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx`
- Workbench source rail/content ordering: `.worktrees/spike-session-artifact-cards/packages/workspace/src/front/chrome/workbench-left/WorkbenchLeftPane.tsx`

## Unknowns ledger

### Known-knowns

- Chat panes have a concrete place for a top-bar Workspace toggle: `ChatPaneHeader` renders pane controls in `ChatPaneStageDock.tsx`.
- Session workspace routing is feasible in front code: `ChatPanePanel` can override the pane params' `surfaceDispatch` with a per-pane `DispatchContext`.
- The project workbench already has source icons and source content in `WorkbenchLeftPane`; the spike can reverse content/rail order when `railSide === "right"`.
- `SurfaceShell` already exposes an imperative API used by `dispatchUiCommand`, which allows file opens to target a chosen shell.

### Known-unknowns

- The final feature flag/layout preference name and default.
- Durable persistence keys for per-session workspace tabs/source state.
- Which project rail entries are in the first production slice: Files only, Files+Search, or all registered workspace sources/plugins.
- Whether session workspace needs an explicit “Open in project workspace” escape hatch.

### Unknown-knowns

- The existing names (`WorkbenchLeftPane`, `leftState`, `defaultLeftTab`, `leftBlockCollapsed`) encode left-side assumptions even when rendering on the right. Engineers will know this is confusing once they implement it, but the plan should explicitly allow either a compatibility shim or a rename.
- Project workspace collapse has two meanings today: close the whole workbench vs collapse sources to rail. The new UX wants the project rail always visible, so “close workbench” must become “collapse project tabs/source to rail,” not hide the whole surface.
- Bridge command routing currently assumes one visible workbench context in several places. With session workspaces and project workspace both mounted, command routing must be explicit about the target.

### Unknown-unknown candidates

- Multiple mounted `SurfaceShell`s may duplicate Dockview instances, file resolver state, plugin panels, and localStorage writes. Ten open chat panes could become expensive or state-noisy.
- Unsaved editor state in a session workspace may be lost or hidden when the chat workspace collapses/unmounts, unless the implementation keeps the shell mounted or persists dirty buffers through existing editor infrastructure.
- Keyboard focus/accessibility can become confusing with rail on the far right but source pane opening to its left; tab order, tooltips, and resize keyboard arrows need mirrored behavior.
- Some plugins may assume workspace source pane is left-oriented through CSS, chrome action portals, or mental model, even if core `WorkbenchLeftPane` can reverse content/rail order.

## Seven blindspot lenses

### 1. Scale

Risk: each chat pane can mount a `SurfaceShell`/Dockview. With many sessions open, this can multiply Dockview, resolver, plugin and storage listeners.

Recommended default: keep the session workspace unmounted until opened, and consider lazy-mounting its `SurfaceShell` only after first artifact/toggle. Preserve state via per-session storage key after first mount.

### 2. Security

Risk: routing file opens from chat artifacts to a session workspace must not broaden filesystem access. The session workspace should use the same resolver/filesystem normalization as the project workspace.

Recommended default: session workspace uses the same `dispatchUiCommand` + `normalizeUiFilesystem` path, only swapping `DispatchContext` target.

### 3. Failure modes

Risk: a click can open the source pane/project tabs but fail to mount the target `SurfaceShell` in time. Existing `DispatchContext.enqueue` handles delayed workbench readiness; each session/project target needs an equivalent queue.

Recommended default: every workspace target must own a pending-operation queue and flush it on `SurfaceShell.onReady`.

### 4. Edge cases

Risk: old persisted `leftState`/`sourcePaneOpen` may place the source pane open or hidden in surprising ways after the right-to-left layout is enabled.

Recommended default: layout mode gets its own storage namespace/version. Do not reuse old global workbench width/source state without migration/normalization.

### 5. Concurrency

Risk: passive pane focus, artifact clicks, and rail clicks can race. A click in an inactive chat pane may first activate the pane, then route open commands. That is acceptable only if routing is bound to the clicked pane, not the active pane after state updates.

Recommended default: session artifact handlers close over the pane/session id and dispatch to that pane's workspace target directly; do not look up “current active session” at open time.

### 6. Migration

Risk: existing project workbench users expect left source pane. The right-to-left model should be a layout mode until proven.

Recommended default: ship behind a layout preference/flag and keep existing `SurfaceShell` behavior as fallback.

### 7. Rollback

Risk: if new per-session storage writes under generic keys, rollback can leave stale or conflicting workspace state.

Recommended default: prefix new storage keys with the layout mode and session id, e.g. `session-review-workspace:<workspaceId>:<sessionId>` and `project-explore-workspace:<workspaceId>`.

## Blocking questions

**Blocking question:** Should session workspace `SurfaceShell`s stay mounted after first open, or unmount on collapse?

**Why it matters:** Staying mounted preserves dirty editor/plugin state but costs memory for many sessions. Unmounting is cheaper but risks losing transient state unless everything is persisted.

**Evidence:** The spike conditionally renders the session `<SurfaceShell>` only when `sessionWorkspaceOpen` is true in `ChatPaneStageDock.tsx`; `SurfaceShell` owns Dockview and emits `onReady`/tabs state.

**Recommended answer:** Lazy-mount on first open, then keep mounted but visually collapsed for that pane until the pane closes. Add a review-budget escape hatch to revisit if perf is bad.

---

**Blocking question:** Should production rename/generalize left-oriented workbench concepts, or keep a compatibility shim?

**Why it matters:** Right-to-left implementation using `WorkbenchLeftPane`, `leftState`, `defaultLeftTab`, and `leftBlockCollapsed` will work short-term but creates future bugs and review confusion.

**Evidence:** `SurfaceShellProps` in the spike adds `sidebarSide`, while the source pane component and state are still named `WorkbenchLeftPane` / `leftState` in `SurfaceShell.tsx` and `WorkbenchLeftPane.tsx`.

**Recommended answer:** For the first slice, keep a compatibility shim (`sidebarSide`) to minimize risk. Add a follow-up cleanup slice to rename abstractions to `WorkbenchSourcePane`, `sourceState`, and `defaultSourceTab` once UX is accepted.

---

**Blocking question:** Should chat artifact opens ever fall back to the project workspace if the session workspace is closed?

**Why it matters:** Fallback would preserve old behavior but reintroduces ownership ambiguity. No fallback makes ownership crisp but requires opening/initializing the session workspace on artifact click.

**Evidence:** The plan states artifact links/cards open directly in the owning session workspace, while the project workspace is exploration-oriented.

**Recommended answer:** No fallback. Artifact click opens or initializes the owning session workspace. Provide a separate explicit “Open in project workspace” action later if needed.

## Plan changes recommended

1. Add persistence/storage namespace details to acceptance or decisions.
2. Add an acceptance check that session workspace collapse preserves dirty/open tab state after first open.
3. Add a compatibility-cleanup slice for renaming left-oriented workbench abstractions after the UX lands.
4. Add a command-routing acceptance check: active chat focus must not determine target; the clicked pane or rail must determine target.
5. Add mobile as an explicit deferred/guarded path: no worse than current mobile shell, but production may initially gate this layout to desktop.

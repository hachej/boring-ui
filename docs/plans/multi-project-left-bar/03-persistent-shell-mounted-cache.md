# 03 — Persistent Multi-Project Shell + Mounted Workspace Cache

## Purpose

Implement the core #377 UX: opening a session from another project must not blank/reload the page. The project/session navigation remains visible, the previous workspace remains visible while the target loads, and recently used workspace UIs can stay mounted in a bounded cache.

Depends on:

- 01 — no-boot session list + lazy fetch;
- 02 — provider-scoped workspace store.

## Current problem

`CoreWorkspaceAgentFront` currently renders a single routed `WorkspaceAgentFront` keyed by `workspaceId`. On cross-project navigation, route identity changes and the old workspace unmounts. While target route/workspace identity is pending, the route returns a loading fallback. That is a reload-feeling content takeover and violates #377.

## Desired behavior

When project A is visible and user opens session S in project B:

1. Target intent is accepted immediately.
2. URL changes to project B.
3. Project/session nav remains mounted and visible.
4. Workspace A content remains mounted and visible while B identity/session/UI is pending.
5. Workspace B content is mounted when route/auth checks pass.
6. When B chat UI is ready enough, B becomes visible.
7. A remains mounted in cache if within LRU cap.
8. If user returns to A soon, A can show without a full remount.

## Architecture decision

Do **not** model the project nav as a child of the single routed `WorkspaceAgentFront` in multi-project mode.

Instead, multi-project mode needs a persistent shell in core:

```txt
Core app providers
  MultiProjectWorkspaceShell
    AppLeftPane / project nav          // persistent
    WorkspaceContentCache              // owns mounted workspace contents
      WorkspaceContentHost(A) hidden/visible
      WorkspaceContentHost(B) hidden/visible
```

The route should provide the target route identity, but the shell owns mounted content hosts.

## Router shape

React Router's `<Routes>` produces one matched element. That element cannot itself be the only `WorkspaceAgentFront` if multiple workspaces need to stay mounted.

Implementation options:

1. Route element becomes a thin controller that reports `routeWorkspaceId` / route status to a persistent shell.
2. `CoreFront` app shell slot wraps routes and owns the mounted content cache.
3. Existing `WorkspaceRoute` is split: data/auth routing logic remains in core; content rendering is delegated to the persistent shell in multi-project mode.

The plan should choose the smallest version that keeps code understandable.

## Mounted cache model

```ts
const MAX_MOUNTED_WORKSPACES = 3

type MountedWorkspaceEntry = {
  workspaceId: string
  workspace: Workspace
  lastVisibleAt: number
  status: 'visible' | 'hidden' | 'opening' | 'error'
}
```

Rules:

- Cache entries are created only after successful route/auth match or explicit open intent that reaches auth success.
- Expanding a project in the nav does not create a cache entry.
- Active/visible workspace is never evicted.
- Evict least-recent hidden entries beyond max.
- On logout/auth loss/app switch, clear cache.
- Cache max defaults to 3.

## Visibility

Only one workspace content host is visible at a time.

Hidden entries:

- are DOM-hidden;
- should receive `visible={false}` / active signal;
- must not own focus or foreground side effects (finished in plan 05).

## Same-project split rule

A cached workspace does not mean cross-project split panes are allowed.

- Session row from project B while A visible switches/open B.
- It never opens B's chat inside A's split stage.
- Split/open-in-new-pane remains available only for sessions whose `projectId === visibleWorkspaceId`.

## Tests / acceptance

Core tests:

- Multi-project route starts at workspace A and renders A content + project nav.
- Simulate cross-project session open to B while route status is loading/pending:
  - A content remains rendered;
  - project nav remains rendered;
  - loading fallback does not replace the whole content;
  - URL/navigate intent points to B.
- When B route/auth resolves, B content mounts and becomes visible.
- A remains mounted but hidden.
- Switching back to A uses cached A entry and avoids remount (test with mount counter).
- Cache evicts least-recent hidden entry when adding fourth workspace.
- Single-project mode renders exactly one routed content host and does not create cache.

Workspace tests:

- Cross-project session rows do not expose split/open-in-new-pane.
- Active project rows still allow same-project split.

## Out of scope

- Store isolation implementation (plan 02), but this plan depends on it.
- Runtime preboot (plan 04).
- Full inactive side-effect audit (plan 05), though this plan must pass `visible` state down.
- Skills/plugins cross-project listing.

## Risks

- Keeping multiple `WorkspaceAgentFront`s mounted can multiply network/subscription effects. Do not enable cache without plan 05 gates or explicit visible signal plumbing.
- Router state and shell state can drift. Keep `routeWorkspaceId`, `visibleWorkspaceId`, and `openingWorkspaceId` explicit and tested.
- A cached workspace may have stale auth. Clear cache on auth loss and handle forbidden/not-found as content-pane errors while nav remains available.


## Thermo review fixes

### Route identity vs visible workspace identity

Do not use `useCurrentWorkspace()` as the single source for both route target and visible content in multi-project mode. During `URL=B while A remains visible`, these are intentionally different. The shell must own explicit state:

- `routeWorkspaceId` — URL/auth target;
- `openingWorkspaceId` — target being opened;
- `visibleWorkspaceId` — content currently visible;
- `activeWorkspaceId` — matched route workspace once auth/detail succeeds.

Nav active styling and split gating must use `visibleWorkspaceId` until the target is actually visible, not a pending route target.

### Visible prop prerequisite

`WorkspaceAgentFront` currently has no inactive/visible prop. This plan includes adding a `visible` (or equivalent active-workspace) prop and plumbing it down before enabling mounted cache. If side-effect gates from plan 05 are not ready, the cache must remain disabled.

### Drag-and-drop split gating

Same-project split is not only the visible "open in pane" button. Drag-and-drop must also be gated. Any reusable `SessionRow` / project session row must disable `draggable` or make drops ignored when `projectId !== visibleWorkspaceId`. Add a test that a cross-project row cannot be dragged into the visible workspace stage.

### Auth/error transitions

No-takeover acceptance must cover `not-found`, `forbidden`, and `switch-failed`, not only loading. While a cached workspace is visible and a target route fails, the nav remains mounted and an error is shown as a content-pane state/policy without blanking unrelated cached content. The active cache entry is not evicted just because a different target failed.

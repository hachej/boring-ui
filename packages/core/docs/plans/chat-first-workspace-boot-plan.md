# Chat-First Workspace Boot Plan

> **Superseded:** implement from the unified canonical plan instead:
> `packages/core/docs/plans/chat-first-auth-workspace-boot-plan.md`
>
> This file is retained for historical workspace-boot detail only. The unified plan is the source of truth for consistent chat-first auth, redirect-safe draft restoration, lean post-auth transition, and smart workspace loading.

**Status:** superseded draft plan
**Branch:** `main`
**Scope:** default core + workspace app composition (`CoreWorkspaceAgentFront`, `WorkspaceAgentFront`, workspace boot/preload helpers)
**Goal:** render the target workspace chat as soon as workspace identity is valid — for both initial load and workspace switch — while sandbox/files warm in the background. Keep a transition page only while identity is unresolved/mismatched.

---

## 1. Problem

Today the composed app blocks the entire workspace UI while `WorkspaceBootGate` preloads workspace data:

```txt
/workspace/:id route
  → wait for currentWorkspace to match route id
  → WorkspaceBootGate fetches /api/v1/tree and /api/v1/agent/sessions
  → only then render WorkspaceAgentFront / ChatPanel
```

Relevant files:

```txt
packages/core/src/app/front/CoreWorkspaceAgentFront.tsx
packages/workspace/src/app/front/WorkspaceBootGate.tsx
packages/workspace/src/app/front/WorkspaceAgentFront.tsx
```

The safety concern is real: we must not show stale panels/files from workspace A under workspace B. But the current implementation uses the full-page transition for too much. It waits for sandbox/tree/session preload, even though the chat shell could already render.

In Vercel sandbox mode, tree preload can wake a sandbox, so the user waits for sandbox boot before they can even start typing.

Desired behavior for **both initial load and workspace switch**:

```txt
Open /workspace/:id or switch A → B
  → block only until core confirms the target workspace identity is valid
  → remount target workspace shell with key={workspaceId}
  → render target workspace chat immediately
  → start workspace/sandbox/files/session preload in the background
  → show small in-workspace status while files/sandbox warm up
  → if the agent hits workspace-dependent tools too early, return a friendly retryable workspace_not_ready tool error
```

The transition page remains, but only for identity mismatch/unresolved state — not for sandbox/files/session preload.

---

## 2. Goals

1. **Chat renders early** on initial workspace load and workspace switch.
2. **Workspace/sandbox warms in background** after the target shell mounts.
3. **Workspace switch blocks only for identity safety**, not for sandbox/files/session preload.
4. **No stale workspace leakage.** Remount target shell by `workspaceId` and keep workspace-scoped headers/storage keys.
5. **Workspace-dependent tools fail gracefully while warming** with one stable retryable error.
6. **No big state machine.** Keep this simple: one route identity gate, one background preloader, one readiness/error adapter.
7. **No package boundary violations.** Workspace base/front stays package-neutral. Core app composition can wire core workspace identity to workspace app composition.
8. **Keep auth/landing policy out of this plan.** Child-app chat entry (`auth-first` vs `chat-first`) is covered separately in `child-app-chat-entry-auth-plan.md`.

---

## 3. Non-goals

- No new sandbox lifecycle API.
- No new DB schema.
- No full Suspense/router rewrite.
- No optimistic fake filesystem.
- No streaming workspace provisioning UI.
- No broad redesign of `WorkspaceProvider`, `ChatPanel`, or session storage.
- No auto-retry loop in the first pass. Tools return retryable errors; the model/user can retry.
- No child-app landing/auth funnel work in this plan; see `child-app-chat-entry-auth-plan.md`.

---

## 4. Current behavior

### 4.1 `CoreWorkspaceAgentFront`

`WorkspaceRoute` currently does three gates:

1. route has a workspace id
2. `useCurrentWorkspace()` has resolved and matches the route id
3. `WorkspaceBootGate` completes preloads

Only after all three does it render `WorkspaceAgentFront`.

```tsx
if (!workspaceId) return <>{loadingFallback}</>
if (currentWorkspace?.id !== workspaceId) return <>{loadingFallback}</>

return (
  <WorkspaceBootGate ... loadingFallback={loadingFallback}>
    <WorkspaceAgentFront ... />
  </WorkspaceBootGate>
)
```

### 4.2 `WorkspaceBootGate`

`WorkspaceBootGate` fetches default preload paths:

```ts
const DEFAULT_BOOT_PRELOAD_PATHS = [
  "/api/v1/tree?path=.",
  "/api/v1/agent/sessions",
]
```

It renders children only after all fetches succeed. It also seeds the tree preload cache when tree data arrives.

### 4.3 `WorkspaceAgentFront`

`WorkspaceAgentFront` can already render while sessions are loading. It has a fallback session id:

```ts
const chatSessionId = resolvedActiveId ?? resolvedSessions[0]?.id ?? "default"
```

So the main blocker is the outer boot gate, not the chat layout itself.

---

## 5. Target behavior

### 5.1 Initial load

When a user lands directly on `/workspace/:id`:

1. Core auth/config/current workspace resolves.
2. If route workspace id is valid and matches current workspace, render `WorkspaceAgentFront` immediately.
3. Inside the mounted workspace shell, run the existing preload paths in the background.
4. Show a small non-blocking status near the workspace/workbench area, not a full-page blocker.
5. Chat panel is usable while preload runs.

### 5.2 Workspace switch

When a user selects a different workspace from `WorkspaceSwitcher`:

1. Route changes to `/workspace/:nextId`.
2. While `useCurrentWorkspace()` has not caught up to the route id, show the current full-page `WorkspaceLoadingPage` transition.
3. Once identity matches, unmount/remount the target workspace shell using `key={workspaceId}`.
4. Render the new workspace chat immediately.
5. New workspace background preload starts inside the shell.

This preserves the important switch invariant: never show workspace A panels/files under workspace B route. It also gives the same chat-first behavior after identity is safe.

---

## 6. Proposed design

### 6.1 Split identity gating from boot preloading

Keep a blocking gate only for identity/switch safety:

```txt
RouteIdentityGate
  blocks when:
    - route id missing
    - currentWorkspace not loaded
    - currentWorkspace.id !== route id
  renders when:
    - route id exists
    - currentWorkspace.id === route id
```

Move sandbox/files/session preload out of this blocking gate.

### 6.2 Define a minimal readiness source

The plan needs one small readiness source so UI and tools agree on what is warming.

Do not invent a big lifecycle system. Track only what the current implementation can know:

```ts
type ToolReadinessRequirement = "workspace-fs" | "sandbox-exec" | "ui-bridge"

type WorkspaceReadinessSnapshot = {
  workspaceId: string
  ready: ToolReadinessRequirement[]
  pending: ToolReadinessRequirement[]
  failed?: { requirement: ToolReadinessRequirement; message: string }
}
```

Initial mapping:

- `workspace-fs` is ready after the tree/file preload succeeds or the runtime workspace binding is known ready.
- `sandbox-exec` is ready after the runtime binding can execute sandbox commands. If there is no cheap check yet, mark it pending only when a sandbox-exec operation is attempted and runtime binding is still creating.
- `ui-bridge` is ready after the workspace UI bridge/surface is mounted. Before that, UI command tools return retryable `workspace_not_ready`.

Route/runtime seam:

- agent embedded route code already creates per-workspace runtime bindings.
- wrap that map with a tiny state: `creating | ready | failed`.
- if a route/tool reaches an unready runtime, return stable `workspace_not_ready` / HTTP 503 instead of hanging forever or leaking provider text.
- tool wrappers still handle the later case where harness exists but a specific requirement is pending.

Identity errors are separate from readiness. Invalid/unauthorized workspace ids should not spin forever; they need terminal UI states (`not-found`, `forbidden`, `switch-failed`) with recovery actions.

### 6.3 Add a background preloader

Create a small component in workspace app front:

```txt
packages/workspace/src/app/front/WorkspaceBackgroundBoot.tsx
```

Responsibilities:

- run the same `preloadPaths` logic as `WorkspaceBootGate`
- seed `setPreloadedTreeEntries()` for tree responses
- expose status through a callback or tiny render prop
- never block children
- abort old fetches when `workspaceId` changes

Simple API:

```ts
export type ToolReadinessRequirement = "workspace-fs" | "sandbox-exec" | "ui-bridge"

export type WorkspaceBootStatus =
  | { state: "loading"; label: string; pendingRequirements: ToolReadinessRequirement[] }
  | { state: "ready"; pendingRequirements: [] }
  | { state: "error"; message: string; failedRequirement?: ToolReadinessRequirement }

export interface WorkspaceBackgroundBootProps {
  workspaceId: string
  requestHeaders?: Record<string, string>
  apiBaseUrl?: string | null
  preloadPaths?: string[]
  onStatusChange?: (status: WorkspaceBootStatus) => void
}
```

It returns `null`.

No context required for first pass.

### 6.4 Show a workbench-only loading overlay

Add loading UI only inside the **workspace/workbench area**, not in the full app shell and not over the chat composer.

While workbench readiness is pending, the workbench should show a full workbench-local overlay/placeholder instead of rendering file tree, editor panes, or plugin panes against an unready workspace.

```tsx
<WorkspaceBackgroundBoot
  workspaceId={workspaceId}
  requestHeaders={requestHeaders}
  apiBaseUrl={apiBaseUrl}
  preloadPaths={bootPreloadPaths}
  onStatusChange={setBootStatus}
/>

// Render inside workbench/artifact surface only, not globally:
{workbenchOpen && bootStatus.state !== "ready" ? (
  <WorkbenchWarmupOverlay status={bootStatus} />
) : (
  <ActualWorkbenchPanels />
)}
```

Example copy:

- `Preparing workspace files…`
- `Waking sandbox…`
- `Your chat is ready — files and tools are still loading.`

This overlay is local to the workbench region. It must not cover or disable the chat composer, and it must not appear as a full-app/global banner.

Implementation seam: `WorkspaceAgentFront` owns boot/readiness state, but `ChatLayout` owns the workbench `<aside>`. Add a small `surfaceOverlay?: ReactNode` or `surfaceBlocked?: ReactNode` prop to `ChatLayout` so the workbench region can render the overlay instead of `PanelSlot` while warmup is pending.

### 6.5 Keep `WorkspaceBootGate` for compatibility

Do not delete `WorkspaceBootGate` in the first pass. Other callers may want blocking behavior.

Options:

1. Keep it unchanged and introduce `WorkspaceBackgroundBoot` separately. **Recommended.**
2. Add `blocking={false}` to `WorkspaceBootGate`. More compact, but easier to make confusing.

Recommendation: separate component. Simpler mental model:

- `WorkspaceBootGate` = blocking gate
- `WorkspaceBackgroundBoot` = non-blocking preload

### 6.6 Update default composed app

In `CoreWorkspaceAgentFront`, remove `WorkspaceBootGate` from the default workspace route path.

Before:

```tsx
<WorkspaceBootGate loadingFallback={loadingFallback}>
  <WorkspaceAgentFront ... />
</WorkspaceBootGate>
```

After:

```tsx
<WorkspaceAgentFront
  key={workspaceId}
  workspaceId={workspaceId}
  bootPreloadPaths={bootPreloadPaths}
  showBackgroundBootStatus
  ...
/>
```

The existing `loadingFallback` remains only for missing/mismatched route identity.

### 6.7 Add props to `WorkspaceAgentFront`

Add small props:

```ts
bootPreloadPaths?: string[]
showBackgroundBootStatus?: boolean
backgroundBootStatusFallback?: ReactNode | ((status: WorkspaceBootStatus) => ReactNode)
```

Default behavior in composed app should enable background boot status. Lower-level callers can opt out.

---

## 7. UX details

### 7.1 Full-page transition remains only for identity mismatch

Keep current `WorkspaceLoadingPage` copy mostly as-is:

- title: `Switching workspace`
- description: `Restoring workspace identity.` or `Opening workspace.`

This page is correct while route/current workspace identity does not match yet. It should disappear as soon as identity matches; do not wait for sandbox/files/session preload.

Avoid infinite loading for bad routes. Route identity handling should distinguish:

- `loading` — show transition
- `matched` — render chat-first workspace shell
- `not-found` — show recovery (`Choose workspace` / `Go home`)
- `forbidden` — show auth/access recovery
- `switch-failed` — show retry/switcher recovery

### 7.2 Initial workspace warmup is in-shell

Once identity matches, the user sees the normal app shell:

- top bar
- session list/chat nav
- chat panel
- workbench/sidebar areas as configured

Warmup status appears only inside the workbench/artifact surface. No top-bar banner, no chat-input row, and no full-app status. Chat stays visually clean; the workbench explains its own readiness.

### 7.3 Error state is non-blocking

If background preload fails:

- do not replace the whole shell
- show a small retry-able status:
  - `Workspace warmup failed. Retry.`
- chat remains visible

Retry can simply re-run the background preload. No complex recovery.

### 7.4 In-workspace display during warmup

Define this explicitly so implementation does not drift into another full-page blocker.

#### Workbench-local overlay

Show a workbench-local loading overlay/placeholder while workspace/workbench readiness is pending. Do **not** show it below the app `TopBar` as a full-app banner.

The overlay fills the workbench/artifact surface region only. It replaces file tree/editor/plugin panes until the required readiness is satisfied.

Example copy by state:

| Requirement | Status copy |
|---|---|
| `workspace-fs` | `Preparing files…` |
| `sandbox-exec` | `Waking sandbox…` |
| `ui-bridge` | `Connecting workspace UI…` |
| multiple | `Preparing workspace…` |
| failed | `Workspace warmup hit a problem. Retry.` |

Rules:

- overlay fills only the workbench/artifact surface region
- no file tree/editor/plugin panes render beneath it while workspace fs/sandbox is unready
- no overlay over chat composer
- no disabled chat input
- no full-app/global banner
- include `role="status"` for loading text
- include retry button only on error
- hide automatically and mount real workbench panes when requirements are ready

#### Chat panel

Chat stays primary and interactive.

Display behavior:

- empty state and composer render normally
- if user sends a message before readiness, keep normal streaming UI
- if a tool returns `workspace_not_ready`, show it as a friendly tool/status card, not a red crash
- copy: `Workspace is still preparing. This action can be retried in a moment.`
- if requirement is known, add detail:
  - `Files are still loading.` for `workspace-fs`
  - `Sandbox is still waking.` for `sandbox-exec`
  - `Workspace UI is still connecting.` for `ui-bridge`

Do not expose raw provider errors or HTTP statuses in the chat transcript for warmup cases.

#### Workbench/file surfaces

Workbench chrome may reserve its area, but workspace-dependent panes should not render until their required readiness is satisfied. Use the workbench-local overlay instead of showing half-loaded file tree/editor/plugin panes.

Rules:

- while `workspace-fs` is pending, do not render FileTree or file-backed editor panes; show workbench overlay
- while `sandbox-exec` is pending, tools/terminal-like panes show workbench overlay or disabled local state
- panels must not show stale data from prior workspace; keyed remount + workspace-scoped caches/storage handle this
- opening a file/panel before readiness is allowed, but it queues/records intent and the workbench displays overlay until data is ready

#### Command palette and UI commands

Commands remain visible, but commands that require pending readiness should fail softly.

Display behavior:

- command palette itself opens normally
- command execution that requires pending `workspace-fs`, `sandbox-exec`, or `ui-bridge` shows toast/status copy instead of crashing
- copy: `Workspace is still preparing. Try again in a moment.`
- pure local UI commands remain available

#### Left nav/session list

Session list can render its own loading state. Do not block chat shell on session preload.

Rules:

- if sessions are loading, show session-list skeleton or existing loading state
- composer can still use fallback/new session behavior
- once sessions resolve, update active session normally

---

## 8. Edge cases

### 8.1 User sends chat before sandbox ready

Allowed. The chat request may itself create/wake the runtime. Do not add frontend blocking for this in first pass.

If the model calls a workspace-dependent tool before the workspace runtime is ready, the tool must return a stable retryable error instead of raw 404/503/500 text.

Stable error shape:

```ts
{
  code: "workspace_not_ready",
  message: "Workspace is still preparing. Try again in a moment.",
  retryable: true,
  requirement: "workspace-fs" | "sandbox-exec" | "ui-bridge",
}
```

Tools declare what they need with explicit readiness requirements:

```ts
type ToolReadinessRequirement = "workspace-fs" | "sandbox-exec" | "ui-bridge"

interface AgentTool {
  readinessRequirements?: ToolReadinessRequirement[]
}
```

Examples:

```ts
read/edit/write/find/grep/ls → ["workspace-fs"]
bash                         → ["sandbox-exec"]
exec_ui                      → ["ui-bridge"]
pure metadata/model tools    → []
plugin tools                 → ["workspace-fs"] by default unless explicitly []
```

The agent can then explain the wait cleanly instead of exposing infrastructure errors.

### 8.2 Workspace-dependent tools during warmup

Apply the same `workspace_not_ready` behavior to every tool or command that depends on workspace runtime/filesystem readiness:

- filesystem tools: `read`, `write`, `edit`, `find`, `grep`, `ls`
- shell/sandbox tool: `bash`
- upload/file-backed helper tools if they need workspace storage
- UI command tools that require a mounted workspace surface or bridge
- plugin-provided agent tools when they declare or imply workspace filesystem/sandbox dependency

Do not apply this to pure chat/model operations or package-neutral UI actions that do not touch workspace runtime state.

Implementation should centralize this in the route/runtime/tool adapter layer where possible, not copy/paste checks into every tool body.

Important current-code seam: Pi tool adaptation currently drops structured `ToolResult.details` when `isError` is true by throwing a plain `Error`. The implementation must preserve structured details (`code`, `retryable`, `requirement`) through the Pi adapter and stream projection so the frontend can render a friendly `workspace_not_ready` card.

### 8.3 Tree preloading fails but chat works

Allowed. File tree/workbench can show their own loading/error state. Background boot status reports the issue, but chat remains usable.

### 8.4 Workspace switch during preload

Abort background fetches via `AbortController`. Use `key={workspaceId}` so the previous workspace shell unmounts cleanly.

### 8.5 Current workspace still loading

Continue to show the full-page transition. We need workspace identity before rendering workspace-scoped headers and storage keys.

### 8.6 Session list still loading

Do not block shell. Existing session hook/loading behavior handles this. Chat uses the current fallback session id until sessions resolve.

---

## 9. Out of scope: child-app landing/auth behavior

Child-app entry funnels are intentionally split into a second plan:

```txt
packages/core/docs/plans/child-app-chat-entry-auth-plan.md
```

That plan owns:

- `auth-first` vs `chat-first`
- auth overlay triggers
- public chat shell before auth
- draft preservation through auth
- no-private-workspace-calls-before-auth tests

This workspace boot plan starts after the app has an authenticated workspace identity.

---

## 10. Implementation phases

### Phase 1 — background boot helper

Add `WorkspaceBackgroundBoot` by extracting shared preload helpers from `WorkspaceBootGate` where useful:

```txt
packages/workspace/src/app/front/WorkspaceBackgroundBoot.tsx
packages/workspace/src/app/front/WorkspaceBootGate.tsx
```

Acceptance:

- background component runs preloads and returns `null`
- aborts on unmount/workspace change
- seeds tree preload cache like `WorkspaceBootGate`
- reports loading/ready/error via `onStatusChange`

### Phase 2 — render workspace shell immediately with workbench protected

Update `CoreWorkspaceAgentFront`, `WorkspaceAgentFront`, and `ChatLayout`:

```txt
packages/core/src/app/front/CoreWorkspaceAgentFront.tsx
packages/workspace/src/app/front/WorkspaceAgentFront.tsx
packages/workspace/src/front/layout/ChatLayout.tsx
```

Acceptance:

- route identity mismatch still shows full-page transition
- terminal identity failures do not spin forever
- once identity matches, `WorkspaceAgentFront` renders without waiting on preload paths
- same chat-first behavior applies to initial load and workspace switch
- `WorkspaceAgentFront` remounts when `workspaceId` changes
- chat panel appears before `/api/v1/tree` resolves
- workbench region shows overlay instead of file/editor/plugin panes until readiness is satisfied

### Phase 3 — readiness source and workspace-not-ready tool errors

Add a centralized readiness/error adapter for workspace-dependent tool execution.

Likely files:

```txt
packages/agent/src/shared/error-codes.ts
packages/agent/src/server/registerAgentRoutes.ts
packages/agent/src/server/tools/**
packages/workspace/src/server/ui-control/tools/uiTools.ts
```

Acceptance:

- route/runtime binding exposes `creating | ready | failed` readiness state
- all workspace-dependent tools return stable `workspace_not_ready` when runtime/workspace is still preparing
- error is retryable, user-friendly, and includes requirement
- Pi tool adapter/stream projection preserves structured error details
- raw provider errors are not exposed to the model/user for this case
- non-workspace-dependent chat/model operations are not blocked
- tests cover read/search/bash/UI-command paths during unready runtime

### Phase 4 — friendly UI for warmup/tool-not-ready

Add small status UI, probably inside `WorkspaceAgentFront` below `TopBar`.

Acceptance:

- loading status appears while background boot runs
- ready status disappears or becomes non-visual
- error status is non-blocking and offers retry or reload copy
- chat composer remains usable

### Phase 5 — tests

Unit/integration tests:

```txt
packages/workspace/src/app/front/__tests__/WorkspaceBackgroundBoot.test.tsx
packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx
packages/core/src/app/front/__tests__/CoreWorkspaceAgentFront.test.tsx
packages/agent/src/server/**/__tests__/*workspace-not-ready*.test.ts
packages/workspace/src/server/**/__tests__/*workspace-not-ready*.test.ts
```

Acceptance:

- `WorkspaceBootGate` compatibility test proves blocking behavior still works for callers that want it
- background boot calls preload endpoints without blocking children
- aborts previous preload on workspace change
- direct initial workspace route renders chat before preload promise resolves
- workspace switch renders target chat before preload promise resolves after identity match
- identity mismatch still renders loading fallback
- tree preload cache still receives tree response
- workspace-dependent tools return `workspace_not_ready` while unready

---

## 11. Bead breakdown

Each bead should be self-contained enough to implement without rereading this plan. Keep the implementation simple: identity gate, background preload, workbench-local overlay, and readiness errors.

### Bead 1 — `workspace-background-boot-helper`

Goal: add a non-blocking background preload helper and shared readiness status types.

Files:

```txt
packages/workspace/src/app/front/WorkspaceBackgroundBoot.tsx
packages/workspace/src/app/front/WorkspaceBootGate.tsx
packages/workspace/src/app/front/index.ts
packages/workspace/src/app/front/__tests__/WorkspaceBackgroundBoot.test.tsx
packages/workspace/src/app/front/__tests__/WorkspaceBootGate.test.tsx
```

Acceptance:

- `WorkspaceBackgroundBoot` runs preloads in the background and returns `null`
- status includes `pendingRequirements` / `failedRequirement` using `workspace-fs | sandbox-exec | ui-bridge`
- abort behavior tested on unmount/workspace change
- tree preload cache seeding tested
- `WorkspaceBootGate` remains available and still blocks children for compatibility

Depends on: none.

### Bead 2 — `chat-first-composed-workspace-route`

Goal: stop using blocking boot gate in the default composed route after workspace identity is valid, while protecting against stale workspace UI.

Files:

```txt
packages/core/src/app/front/CoreWorkspaceAgentFront.tsx
packages/core/src/app/front/__tests__/CoreWorkspaceAgentFront.test.tsx
packages/workspace/src/app/front/WorkspaceAgentFront.tsx
packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx
```

Acceptance:

- loading fallback remains for missing/mismatched workspace identity only
- invalid/forbidden/switch-failed workspace ids show terminal recovery UI, not infinite transition
- `WorkspaceAgentFront` renders as soon as identity matches
- same behavior applies to direct initial load and workspace switch
- `key={workspaceId}` or equivalent remount safety is present
- chat renders before background preload resolves for tree and sessions
- no stale workspace A panels/files show under workspace B route

Depends on: Bead 1.

### Bead 3 — `workbench-local-warmup-overlay`

Goal: render a full workbench-local overlay instead of file/editor/plugin panes while workspace readiness is pending.

Files:

```txt
packages/workspace/src/front/layout/ChatLayout.tsx
packages/workspace/src/app/front/WorkspaceAgentFront.tsx
packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx
packages/workspace/src/front/layout/__tests__/*workbench-overlay*.test.tsx
```

Acceptance:

- `ChatLayout` exposes a minimal `surfaceOverlay`/`surfaceBlocked` seam for the workbench `<aside>`
- overlay fills only the workbench/artifact surface region
- overlay does not cover chat or disable composer
- FileTree/editor/plugin panes do not render beneath it while `workspace-fs`/`sandbox-exec` is unready
- overlay copy maps requirements to `Preparing files…`, `Waking sandbox…`, or `Preparing workspace…`
- error overlay is workbench-local and offers retry/reload copy

Depends on: Beads 1-2.

### Bead 4 — `workspace-readiness-state-source`

Goal: define the small server/runtime readiness source used by route handlers and tool wrappers.

Files:

```txt
packages/agent/src/shared/error-codes.ts
packages/agent/src/shared/tool.ts
packages/agent/src/server/registerAgentRoutes.ts
packages/agent/src/server/http/routes/**
packages/agent/src/server/__tests__/*workspace-readiness*.test.ts
```

Acceptance:

- `ToolReadinessRequirement = "workspace-fs" | "sandbox-exec" | "ui-bridge"` is defined in agent shared types
- `AgentTool.readinessRequirements?: ToolReadinessRequirement[]` exists; pure tools use `[]`; plugin tools default conservatively
- per-workspace runtime binding tracks `creating | ready | failed`
- route getters can return stable 503 `workspace_not_ready` for unready workspace runtime instead of hanging/leaking provider errors
- chat/model metadata routes that do not require workspace runtime remain available

Depends on: none.

### Bead 5 — `workspace-not-ready-tool-errors`

Goal: return one stable retryable error from every workspace-dependent tool while runtime/filesystem/sandbox/UI bridge is not ready, and preserve the structure through Pi.

Files:

```txt
packages/agent/src/server/tools/**
packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts
packages/agent/src/server/http/routes/chat.ts or stream projection files if needed
packages/workspace/src/server/ui-control/tools/uiTools.ts
packages/agent/src/server/**/__tests__/*workspace-not-ready*.test.ts
packages/workspace/src/server/**/__tests__/*workspace-not-ready*.test.ts
```

Acceptance:

- `workspace_not_ready` code is stable
- error message is friendly: `Workspace is still preparing. Try again in a moment.`
- error includes `retryable: true` and the blocked readiness requirement
- applies to `read`, `write`, `edit`, `find`, `grep`, `ls`, `bash`, upload/file helpers, UI command tools, and plugin tools that depend on workspace fs/sandbox/UI
- Pi adapter and stream output preserve structured details (`code`, `retryable`, `requirement`)
- pure chat/model/metadata tools are not blocked
- raw provider errors for warmup state are not exposed to model/user

Depends on: Bead 4.

### Bead 6 — `friendly-workspace-not-ready-rendering`

Goal: render `workspace_not_ready` as friendly chat/tool UI instead of a red crash or raw provider text.

Files:

```txt
packages/agent/src/front/**
packages/agent/src/front/__tests__/*workspace-not-ready*.test.tsx
packages/workspace/src/app/front/WorkspaceAgentFront.tsx
packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx
```

Acceptance:

- tool result with `code: "workspace_not_ready"` renders as friendly status/card
- requirement detail maps to `Files are still loading`, `Sandbox is still waking`, or `Workspace UI is still connecting`
- raw HTTP/provider text is not displayed for warmup errors
- chat composer remains available

Depends on: Beads 3 and 5.

### Bead 7 — `chat-first-workspace-boot-e2e`

Goal: add a focused regression/e2e fixture proving chat-first boot and switch behavior under delayed workspace endpoints.

Files:

```txt
packages/core/src/app/front/__tests__/*chat-first*.test.tsx
packages/workspace/src/app/front/__tests__/*chat-first*.test.tsx
apps/full-app/e2e/*chat-first*.spec.ts or workspace-playground e2e equivalent
```

Acceptance:

- direct initial workspace route renders chat before delayed `/api/v1/tree` resolves
- direct initial workspace route renders chat before delayed `/api/v1/agent/sessions` resolves
- workspace switch renders target chat after identity match and before target preloads resolve
- identity mismatch still shows transition fallback
- workbench overlay appears during delayed readiness and disappears when ready

Depends on: Beads 1-3.

### Bead 8 — `chat-first-boot-docs`

Goal: document the new boot model, readiness errors, and workbench overlay.

Files:

```txt
packages/core/docs/plans/chat-first-workspace-boot-plan.md
packages/workspace/docs/INTERFACES.md or app-front docs if they exist
packages/agent/docs/* if workspace_not_ready/tool readiness needs public API docs
```

Acceptance:

- docs explain transition only covers identity mismatch
- docs explain chat-first applies to initial load and workspace switch
- docs state chat is allowed before workspace preload completes
- docs list workspace-dependent tools covered by `workspace_not_ready`

Depends on: Beads 1-8.

---

## 12. Definition of done

- The default full app route shows a transition page only while workspace identity is missing/mismatched.
- Initial workspace load renders chat shell before sandbox/tree/session preloads finish.
- Workspace switch renders the target chat shell as soon as target identity matches, before target preloads finish.
- Workspace preloads still run automatically in the background.
- File tree cache preloading behavior is preserved.
- Preload errors do not hide chat.
- All workspace-dependent tools return stable `workspace_not_ready` while runtime/filesystem/sandbox is not ready.
- Tests prove chat-first render, switch fallback behavior, and workspace-not-ready tool handling.

---

## 13. Simple final shape

The mental model after implementation should be:

```txt
CoreWorkspaceAgentFront
  ├─ blocks only for auth/current-workspace identity
  └─ renders keyed WorkspaceAgentFront immediately once identity is valid

WorkspaceAgentFront
  ├─ renders chat/layout immediately
  ├─ starts WorkspaceBackgroundBoot inside the shell
  └─ passes background warmup state to a workbench-local overlay
       ├─ Chat stays visible and interactive
       ├─ FileTree/editor/plugin panes do not render while fs/sandbox is unready
       └─ Workbench overlay explains: Preparing files / Waking sandbox

Workspace-dependent tools
  ├─ run normally when workspace runtime is ready
  └─ return retryable workspace_not_ready while runtime/filesystem/sandbox is still preparing
```

That is enough. No larger boot state machine unless users hit more edge cases.

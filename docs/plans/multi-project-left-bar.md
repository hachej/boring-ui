# Multi-Project Left Bar — Plan

Status: proposed (rev 5 — mounted-workspace cache plan for #385)
Relationship to existing specs:
- Extends `docs/plans/plugin-tabs-workspace-layout/02-left-pane.md`, which deliberately shipped **no "Projects" primary item**. This plan adds multi-project navigation to that left pane.
- The **layout modes** here (`single-project` / `multi-project`) are a different axis from the **plugin display modes** (`09-two-plugin-display-modes.md`) and the **workspace layout host** (V2 review). See §3.1 — they never branch on each other.

---

## 0. Prerequisites (verified against code — these gate PR2/PR3)

Listing a workspace's sessions/skills from the nav must be **cheap and not boot the workspace runtime**. The current routes do NOT satisfy this:

- `GET /api/v1/agent/pi-chat/sessions` resolves its service via `getService` → `getBindingForRequest` → `getOrCreateRuntimeBinding` (`packages/agent/src/server/registerAgentRoutes.ts:966-978, 852-858`). That **provisions the full runtime binding** (and, with `hasRuntimeProvisioningInput`, the sandbox) for the target workspace. Expanding N projects would boot N runtimes — unacceptable.
- A genuinely no-boot path **already exists but is not wired to that route**: `getSessionStoreForRequest` builds a bare `PiSessionStore` over the host session dir and lists via `readdir` (`registerAgentRoutes.ts:860-871`; `sessions.ts` `list()` is a `readdir`). The skills route similarly boots when `hasRuntimeProvisioningInput` (`registerAgentRoutes.ts:996-1006`).

**P0 (blocks PR2 multi-project lazy expand):** add a read-only, no-boot **per-workspace session-list route** that resolves through `getSessionStoreForRequest` (not `getService`) and accepts offset pagination. The nav fetches only this route. Until P0 lands, multi-project lazy expansion is not safe to ship.

**P1 (blocks PR3 cross-project skills/plugins):** add an equivalent no-boot per-workspace skills/plugins listing route. Until P1, the skills/plugins page is **current-project + global only** (see §4).

There is no "expensive skills vs cheap sessions" asymmetry: **both** need a no-boot route. The plan no longer claims session listing is free today.

---

## 1. Problem & goals

Today the full-app switches workspaces via a **top-bar dropdown** (`WorkspaceSwitcher`); the current workspace's sessions live in a separate rail (`SessionBrowser`); account/credits sit top-right.

Goals: (1) move between projects and sessions from one persistent surface; (2) keep a focused **single-project** layout (today's dropdown) available; (3) make skills/plugins discoverable within the scope a user is allowed to see.

Non-goals: changing the agent runtime, the plugin loading model, or tenancy/authz.

---

## 2. Two layout modes

A deployment resolves ONE mode (§2.3). Both reuse the same per-workspace content (chat + workbench). In `single-project`, content behaves as today and remounts on workspace switch. In `multi-project`, content is still keyed by `workspaceId`, but recently used workspace contents may remain mounted in the bounded cache (§5.3) until LRU eviction.

### `single-project` (default)
Top-of-left-bar **dropdown** (today's `WorkspaceSwitcher`, unchanged). Left bar shows only the current project's sessions. No surface enumerates other projects.

### `multi-project`
Left bar lists **all accessible projects** as a tree (`WorkspaceProjectsNav`, §7); expand to lazily load a project's sessions **via the P0 route**. Account/credits move to a footer; the top-bar dropdown is removed.

```txt
single-project                    multi-project
┌───────────────────────┐        ┌───────────────────────┐
│ [App / Project ▾]      │ topbar │  Projects          +  │
├───────────────────────┤        │  ▾ seneca-ai       3   │
│ Sessions (current ws)  │        │      Fetch sales   2h  │
│   ◷ Build deck         │        │      Build deck    1d  │
│ [account top-right]    │        │  ▸ research-bot    5   │
│                        │        │  ── ◔ Julien      ⌄    │
└───────────────────────┘        └───────────────────────┘
```

### 2.1 This is layout, NOT access control
`single-project` hides other projects from the **UI**. It is **not** a security boundary: if `GET /api/v1/workspaces` returns N workspaces, that data is reachable by API regardless of layout. Bounded access for a regulated tenant is **tenancy/authz** — out of scope. Never describe `single-project` as "isolation" or "enterprise-safe" in user/sales copy.

### 2.2 Mode is named, not implied
`LayoutMode = 'single-project' | 'multi-project'`. No "isolated", no "enterprise". UI labels (if a toggle is exposed): "Focused" / "All projects".

### 2.3 Mode resolution — one selector, tested
```ts
type TenantLayoutPolicy =
  | { kind: 'force'; mode: LayoutMode }     // tenant pins it; user cannot widen
  | { kind: 'allow'; default: LayoutMode }  // user may choose; default applies

function resolveLayoutMode(policy: TenantLayoutPolicy, userPref?: LayoutMode): LayoutMode {
  if (policy.kind === 'force') return policy.mode
  return userPref ?? policy.default
}
```
Default policy: `{ kind: 'allow', default: 'single-project' }`. `policy` from server config (`ConfigProvider`); `userPref` from user settings. Consumed in ONE place (the shell). Unit-tested for all four combinations.

---

## 3. Architecture

### Persistent shell
- `CoreFront` gains an **opt-in `appShell` slot** rendered inside the providers, wrapping `<Routes>`. Default = identity ⇒ **zero blast radius**.
- The full-app passes `WorkspaceProjectsShell`, which renders the mode-appropriate nav beside routed `{children}` and decides visibility (signed-in + workspace-area routes).

```txt
CoreFront (providers)
  └─ appShell?(routedContent)            // opt-in; identity by default
       WorkspaceProjectsShell            // persistent, mode-aware
         ├─ single-project: render children as-is (dropdown in top bar)
         └─ multi-project:  <WorkspaceProjectsNav/> | {children}
```

### 3.1 Layering (these axes NEVER branch on each other)
```txt
LayoutMode (single/multi-project)   -> app shell / nav        (THIS plan)
WorkspaceLayoutHost (classic/tabs)  -> per-workspace content   (existing plan)
plugin display mode                 -> within a plugin pane    (doc 09)
```
Invariant: `WorkspaceProjectsShell` never reads `WorkspaceLayoutHost`/`pluginDisplayMode`, and vice-versa. A combined `if (layoutMode && pluginDisplayMode)` is rejected in review.

### Component map
| Concern | Component | Package | Status |
| --- | --- | --- | --- |
| Multi-project tree + nested sessions | `WorkspaceProjectsNav` | workspace (presentational) | **built + verified** |
| Single-project dropdown | `WorkspaceSwitcher` | core | exists today |
| Persistent shell / data adapter | `WorkspaceProjectsShell` | core | drafted; **WIP placeholders, see §7.4** |
| Shell seam | `CoreFront` `appShell` prop | core | PR1 |

`WorkspaceProjectsNav` is presentational/host-agnostic → workspace package stays free of core imports (invariant #7) and the CLI hub can reuse it.

---

## 4. Skills & plugins pages

Scope rules: skills are **project-specific or global** and the page **labels which**; **plugins are always project-specific**; **internal/built-in plugins are hidden**.

- **Until P1 lands, the page is current-project + global ONLY, in BOTH modes.** No project filter, no cross-project enumeration. This is a hard line — there is no no-boot way to enumerate another workspace's skills/plugins today (the skills route boots; §0).
- After P1: in `multi-project` a project filter appears, defaulting to the active project; in `single-project` the filter stays hidden (one project to show).
- Each skill row carries a scope chip: `project` | `global`.

---

## 5. Session open & background boot

### 5.1 Open-session contract
- The active-session key is accessed **only** via the exported helper `writeActiveSessionId(id, { storageScope })` (`packages/agent/src/front/chat/session/activeSessionStorage.ts`) — never a hand-built string. Documented contract + test.
- **Cross-project open:** `writeActiveSessionId` is a **synchronous** localStorage write; the shell writes it, THEN `navigate('/workspace/<id>')`. The target `WorkspaceAgentFront` mounts and reads `initialActiveSessionId ?? readActiveSessionId(...)` on first render — after the write — so there is **no race** and **no need for router nav-state**. (Nav-state was rejected: the workspace package has no `react-router` dependency and must not gain one — invariant #7-adjacent. Open Q removed.)
- **Mounted-target open** (same project or cached inactive project): handled by a **new typed event on the workspace bus**, a PR2/#385 deliverable. The shell still writes storage and navigates for cross-project opens; the event is the live handoff for any already-mounted target. Non-mounted targets ignore the event and read storage on first mount:

```ts
// PR2: add to packages/workspace/src/front/events (typed bus, not ad-hoc CustomEvent)
workspaceEvents.openSession: { workspaceId: string; sessionId: string | null }
```
Shell dispatches after the storage write. A **new** `WorkspaceAgentFront` subscriber switches the live session when its `workspaceId` matches the event. PR2/#385 acceptance gates on the event type, the consumer, and the cached-target case: workspace A visible, workspace B cached/inactive, click B/session-2 ⇒ B becomes visible with session-2 active without requiring a remount.

### 5.2 Background open — no route/content takeover
Opening a session in another project has two separate readiness tracks: **chat UI readiness** and **workspace runtime readiness**. Chat UI must win: the user should see the target session/app as soon as the workspace identity + transcript are ready. Runtime/sandbox prep should start in the background after explicit open intent, but it must not block rendering the chat. If the user sends the first command before tools/files/runtime are ready, that command waits inline in the chat/tool area. The product requirement from #377 is stricter than "use a smaller spinner": **opening a session from another project must not blank or replace the current workspace page while the target workspace loads.**

Hard contract for `multi-project`:

```txt
click session S in project X while project A is mounted:
  1. synchronously writeActiveSessionId(S, { storageScope: X })
  2. navigate('/workspace/X') so URL/auth checks start
  3. begin target workspace UI/session load in the background
  4. begin target runtime/sandbox preboot in the background (explicit user intent happened)
  5. keep the previously matched workspace shell/content mounted while X is pending
  6. show pending feedback in the nav/content chrome only (e.g. row spinner/banner), not a page takeover
  7. when X's app/chat is ready enough to render, swap to X's WorkspaceAgentFront; it reads S on first render
  8. if runtime preboot is still running, chat remains usable; the first tool/file/runtime command waits inline
  9. not-found/forbidden/switch-failed render as content-pane errors while the nav remains available
```

Chosen #385 architecture:

- Build the **persistent multi-project shell** now. The project nav lives outside the keyed per-workspace content, so the nav never remounts on workspace changes.
- Add a **bounded mounted-workspace cache** for routed workspace content. Multiple recently used `WorkspaceAgentFront` instances may stay mounted, but only under a strict inactive-workspace contract (§5.3).
- Distinguish identities explicitly:
  - `routeWorkspaceId` = URL target currently loading/checking.
  - `activeWorkspaceId` = matched workspace shown as active in the route/nav.
  - `mountedWorkspaceIds` = small LRU set of workspaces whose content remains mounted.
  - `visibleWorkspaceId` = workspace content currently visible; normally `activeWorkspaceId`, but remains the previous visible workspace while the route target is pending.
- On cross-project open, write the target active-session id, navigate, mark the target as `opening`, start target UI/session loading and runtime preboot concurrently, and keep the current visible workspace mounted/visible until the target chat UI is ready. If the target is already mounted, switch visibility immediately after the active-session handoff without a full remount.
- First-load/deep-link with no mounted workspace may show a minimal content-pane spinner because there is no old workspace to retain.

Rejected:

- Replacing the whole page with a full-screen or full-content spinner on cross-project session open. That is still a reload-feeling takeover and fails #377.
- Keeping every visited workspace mounted forever. The cache is bounded and evicts inactive entries.
- Letting inactive mounted workspaces continue foreground-only side effects (focus, global keybindings, visible overlays, active chat streaming) as if they were visible.
- Blocking target chat/session render on sandbox/runtime readiness. Runtime can warm in parallel; tool/file steps wait inline if needed.


### 5.3 Mounted-workspace cache contract

#385 may keep **multiple** workspace contents mounted to make project switching feel instant, but this is a controlled cache, not an unbounded tab graveyard.

Cache policy:

- Default max mounted workspaces: **3** (`current + two recent`). This can be a constant for #385; make it configurable only if a real host needs it.
- Eviction is LRU by successful visibility, never by mere session-list browsing. Expanding a project in the nav does **not** mount that workspace.
- The active/visible workspace is never evicted.
- A workspace becomes cache-eligible only after it has successfully matched auth/route checks and mounted once.
- On logout, tenant/app switch, or auth loss, clear the cache.

Store isolation prerequisite:

- Multiple mounted `WorkspaceAgentFront` / `WorkspaceProvider` instances require provider-scoped workspace stores. A module-singleton store ref is not multi-mount safe: the last provider to bind would win and hidden workspaces could mutate/read the wrong layout state.
- #385 must make workspace selectors/store access context-scoped or otherwise explicitly multi-provider-safe before enabling the cache.
- Acceptance test: mount two cached workspace providers at once; panel/layout/theme mutation in workspace A does not affect workspace B, and selectors read the provider-local store.

Visibility / active-workspace signal:

- Each mounted workspace receives an explicit `visible` (or `activeWorkspace`) signal. Hidden workspaces are not merely CSS-hidden; global side effects must gate/filter on visibility.
- Workspace-targeted events are preferred over singleton broadcast where possible. If a singleton bus remains, every subscriber must ignore events whose workspace target does not match its own visible workspace.

Inactive workspace contract:

- Inactive mounted workspaces are DOM-hidden (`hidden`/`display:none`) and cannot own focus.
- Inactive workspaces do not receive global keyboard shortcuts, visible overlays, toasts, command-palette ownership, or drag/drop targets.
- Hidden workspaces do not set document title/theme and do not own global UI-command handling.
- Chat split panes remain **within one workspace**. A session row from project B never joins project A's split stage; it switches visibility/project instead.
- Inactive workspaces may keep local React state/layout state so switching back is fast.
- Do not intentionally start runtime provisioning just because a workspace is cached or because a project was expanded for browsing. Cache retention is a UI state optimization, not a background boot-all mechanism.
- **Do** start runtime/sandbox preboot after explicit open intent (clicking a project/session), in parallel with UI/session loading. This is a best-effort warmup: chat rendering must not wait for it.
- If an inactive workspace has active network streams/subscriptions that are expensive or user-visible, pause or disconnect them unless they are explicitly required for correctness. Runtime preboot/warm state for recent workspaces may continue only under the cache cap and must be treated separately from foreground UI effects. #385 must audit known providers (`WorkspaceProvider`, chat/session hooks, plugin hot reload, file events, bridge client, command palette/toaster) and either gate them by visibility or document why they are safe.

Minimum implementation shape:

```ts
type MountedWorkspaceEntry = {
  workspaceId: string
  workspace: Workspace
  lastVisibleAt: number
}

const MAX_MOUNTED_WORKSPACES = 3
```

The persistent shell renders one content host per mounted entry, with only `visibleWorkspaceId` shown. Request/auth headers and storage scopes are computed from each entry's own `workspaceId`, never from the current route target by accident. Cached-target session opens use `workspaceEvents.openSession` to switch the already-mounted workspace live; non-mounted targets fall back to first-mount storage read.


### 5.4 Runtime preboot policy

Runtime/sandbox readiness is not the same as chat UI readiness. #385 should optimize both, but with the right ordering:

- **Browse/expand projects:** no runtime boot, no workspace UI mount, no sandbox work. Use only the P0 no-boot session-list route.
- **Explicit open intent** (click project/session, create chat in project, open cached workspace): start runtime/sandbox preboot ASAP in the background, because the user is likely to need tools/files soon.
- **Chat render path:** do not block on runtime readiness. Render the target session as soon as workspace identity/session transcript are ready enough.
- **First tool/file/runtime command:** if preboot is still pending, the command waits with an inline "Preparing workspace…"/tool-readiness state inside chat/workbench, not a page-level loader.
- **Cached recent workspaces:** may keep runtime warm within the same bounded policy if already started by explicit intent; do not start runtimes for merely listed projects.

Acceptance must measure/report these separately: no-boot session-list time, workspace detail time, session transcript load time, UI mount time, runtime preboot time, and first-tool wait time.

---

## 6. State model (no boolean soup)
One source per concern: `layoutMode` (derived once via `resolveLayoutMode`, read-only); nav open/collapsed (existing); expanded project set (owned by `WorkspaceProjectsNav`, persisted); active project (derived from the matched route/current workspace, never from a pending target); opening project id (transient pending feedback only); mounted workspace cache (LRU-capped, §5.3); per-project session cache (a keyed map in the shell, **LRU-capped to the last 12 expanded projects**, with a test, so a long session cannot accumulate unbounded rows). No `usePiSessions` in a loop for session-list snapshots.

---

## 7. What's already built, and its gaps

- `WorkspaceProjectsNav` (`packages/workspace/src/front/chrome/workspace-nav/WorkspaceProjectsNav.tsx`) — tree, nested sessions, lazy states, "Show more", single-workspace degrade, footer slot, `grid-template-rows` reveal, 1px tree-guide. Reuses exported `SessionRow`/`groupSessions`. Presentational, invariant-#7-clean. **Verified** in the playground (`?projects=1` / `?projects=single`) dark + light.

### 7.1 Status dot: dropped for v1
`Workspace` (types.ts) has no runtime state. v1 ships **no status dot**; active project shown by row treatment only. The shell passes `status: undefined`. Re-introduce only with a real per-workspace runtime-status source.

### 7.2 New project uses the existing Dialog
Multi-project "New project" reuses `WorkspaceSwitcher`'s create `Dialog`, extracted to a shared `CreateWorkspaceDialog`. **No `window.prompt`.** (PR2 deliverable; until extracted, the nav omits `onNewProject` rather than shipping a prompt.)

### 7.3 Single account menu — requires a CoreFront API change (PR2)
`CoreFront` hard-wires `<TopBarSlotProvider slot={<UserMenu/>}>` (`CoreFront.tsx:124`) and `CoreWorkspaceAgentFront` adds `UserMenu` via `topBarRight`/`DefaultTopBarRight`. To have exactly one account menu (footer) in multi-project, PR2 adds a `CoreFront` prop to suppress/override the top-bar account slot (e.g. `topBarAccountSlot?: ReactNode | null`, default `<UserMenu/>`) AND drops `UserMenu` from `CoreWorkspaceAgentFront`'s `topBarRight` in multi-project (keeping `CreditBalanceBadge`). This is a PR2 change; PR1's no-visible-change gate does not cover it.

### 7.4 The drafted shell is pre-contract — to be rebuilt in PR2
`WorkspaceProjectsShell` (core) compiles but is a sketch that predates the §5/§7 contracts. Before PR2 it must be brought in line: no `window.prompt`, `status: undefined`, no ad-hoc `CustomEvent` (use the typed `workspaceEvents.openSession`), and its session fetch points at the **P0** route. The draft is corrected to remove those anti-patterns now so the artifact does not contradict this plan; full wiring is PR2.

---

## 8. PR split

### PR 0 — No-boot listing routes (prerequisite)
- P0: read-only no-boot per-workspace session-list route (via `getSessionStoreForRequest`, offset pagination).
- (P1 — skills/plugins listing — deferred to just before PR3.)

### PR 1 — Mode seam, dropdown unchanged (no visible change)
- `LayoutMode` + `resolveLayoutMode` + tenant policy in config (default allow/single-project).
- Opt-in `appShell` slot on `CoreFront` (identity default).
- Full-app wraps with `WorkspaceProjectsShell`; `single-project` renders children **exactly as today**.
- **Enforced** by snapshot/e2e: dropdown renders, sessions rail unchanged, no projects nav mounts, `CoreFront` output identical when `appShell` not passed.

### PR 2 / #385 — Multi-project layout and mounted workspace cache (depends on PR0)
- `WorkspaceProjectsNav` in the persistent left bar; lazy per-project sessions via P0 (LRU-capped); §5.1 open-session (sync write+navigate cross-project, typed `openSession` event + new `WorkspaceAgentFront` consumer same-project); §5.2 background-open/no-takeover contract; §5.3 bounded mounted-workspace cache; §7.3 single-account-menu change; footer account row; dropdown removed; `status: undefined`; `CreateWorkspaceDialog` for new project. This is all in #385 rather than a follow-up split.

### PR 3 — Skills & plugins pages (depends on P1)
- Current-project + global with scope chips; hide internal plugins; project filter + cross-project enumeration only after P1.

---

## 9. Acceptance

PR0:
```txt
[ ] no-boot session-list route returns sessions WITHOUT provisioning the runtime (test asserts no binding/sandbox boot)
[ ] offset pagination works
[ ] route returns a bare array (matches the existing /pi-chat/sessions shape) so the nav fetch contract stays consistent
```
PR1:
```txt
[ ] resolveLayoutMode unit-tested (force/allow × pref)
[ ] CoreFront output identical when appShell not passed (test)
[ ] full-app dropdown + sessions rail unchanged (snapshot/e2e); no projects nav in single-project
```
PR2:
```txt
[ ] multi-project lazy-loads via P0 (LRU-capped, tested); no runtime boot on expand
[ ] cross-project session open keeps the previous workspace shell/content mounted while target app/chat loads; no full-page or full-content takeover
[ ] mounted workspace cache is bounded (default max 3), LRU-evicted, and never populated by mere project expansion/session-list browsing
[ ] workspace store/selectors are provider-scoped or otherwise multi-provider-safe; two mounted workspaces cannot share/corrupt layout state
[ ] inactive mounted workspaces are hidden/inert enough to avoid focus/global-shortcut/drag/drop/overlay/toast/title/theme/UI-command ownership; expensive streams are paused or explicitly justified
[ ] cross-project open = sync writeActiveSessionId + navigate + typed openSession event for already-mounted targets; non-mounted targets read the written active-session id on first mount
[ ] cached-target open works without remount: A visible, B cached/inactive, click B/session-2 => B visible with session-2 active
[ ] runtime/sandbox preboot starts after explicit open intent but does not block target chat render; first tool/file/runtime command waits inline if preboot is not done
[ ] measurements distinguish no-boot session list, workspace detail, session transcript, UI mount, runtime preboot, and first-tool wait
[ ] split/open-in-new-pane affordances remain same-project only; cross-project session rows switch projects instead of joining the current workspace's split stage
[ ] exactly one account menu; dropdown removed in multi-project; status: undefined (no dot)
[ ] new project via CreateWorkspaceDialog (no window.prompt)
[ ] single-project mode is unchanged and does not instantiate the multi-workspace cache
```

## 10. Open questions
1. Is a user-facing layout toggle exposed in v2, or tenant-config only? (selector supports both; product call)
2. P1 endpoint owner/scope — confirm before PR3.

---

## 11. Rail integration & track split (post-design-round decisions)

The left bar is the in-flight **`WorkspaceAppRail`** in `packages/workspace/src/app/front/WorkspaceAgentFront.tsx:1431-1599` (owned by a parallel effort). Top row, side menu (New chat / Search / Plugins / Skills / Automations), Pinned/Sessions body, Theme footer. Both modes reuse this rail.

### 11.1 Single-project PR (clean, ship first)
Surgical change to the rail **top row only** (`~1524-1552`):
- Keep the `WalletCards` collapse/expand toggle.
- **Drop** the experimental `‹ ›` back/forward and the top-row `Plug` workspace toggle. (`Plug`'s open action stays in the side menu; the only loss is the one-click *close* — accepted. Removing the button also frees the `onToggleWorkbench` prop — remove it from the rail props + call site to keep the diff clean.)
- The **workspace dropdown** rides the existing `topSlot` (`1551`; full-app already passes `topBarLeft = WorkspaceSwitcher`), placed next to the collapse toggle.
- Body (Pinned/Sessions), side menu, Theme: **unchanged**.

This is the *only* single-project change. No `WorkspaceProjectsNav`, no multi-project data. Because the rail is another session's file, this is applied by that author or in a coordinated worktree — not clobbered.

```txt
single-project top row:  [▭ collapse]  Seneca AI / ws ▾        (dropdown via topSlot)
```

### 11.2 Multi-project (dedicated branch + issue)
- **Top row:** collapse toggle **only** (no dropdown — projects are listed inline).
- **Body:** replaces Pinned/Sessions with: a **cross-project Pinned** section (pinned sessions from *any* project, each labelled with its project), then the **Projects tree** (`WorkspaceProjectsNav`, embedded/headerless since the rail owns the chrome). Side menu + Theme unchanged.
- **Cross-project pin:** pin/unpin on any session row; pinned sessions surface in the top Pinned section regardless of project. Needs cross-project pinned storage (ids + cached session metadata) + `onTogglePin(projectId, sessionId)` on the nav — a new capability on `WorkspaceProjectsNav` and the host.

```txt
multi-project body:
  Pinned                       (cross-project)
    📌 Fetch sales · seneca-ai   2h
    📌 Backfill events · data-lab 4d
  Projects
    ▾ seneca-ai          3
        Fetch sales      2h
    ▸ research-bot        5
```

### 11.3 The architecture decision the multi-project PR must make
`WorkspaceAppRail` was per-workspace in the early draft (inside `WorkspaceAgentFront`, `key={workspaceId}`), which caused flash/remount and made cross-workspace data awkward. #385 should take option **A**: persistent shell.

Final decision for #385:

- Lift the project nav / app-left shell to a persistent host in core.
- Feed it workspace list + per-project session snapshots via the P0 no-boot route.
- Render workspace content through the bounded mounted-workspace cache (§5.3).
- The old per-workspace rail path is not acceptable for multi-project unless it is only an internal content host behind the persistent shell.

Success means project/session browsing remains visible, recent workspace contents can remain mounted, and switching/opening sessions never feels like a page reload.

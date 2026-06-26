# Multi-Project Left Bar — Plan

Status: proposed (rev 3 — thermo round 1 blockers fixed)
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

A deployment resolves ONE mode (§2.3). Both reuse the same per-workspace content (chat + workbench), which stays `key={workspaceId}` and remounts on switch (correct — re-inits that project's plugins).

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
- **Same-project open** (workspace already mounted; `navigate` is a no-op): handled by a **new typed event on the workspace bus**, a PR2 deliverable — not yet present:

```ts
// PR2: add to packages/workspace/src/front/events (typed bus, not ad-hoc CustomEvent)
workspaceEvents.openSession: { workspaceId: string; sessionId: string | null }
```
Shell dispatches; a **new** `WorkspaceAgentFront` subscriber switches the live session. PR2 acceptance gates on both the event type and the consumer existing.

### 5.2 Background boot — content-pane contract
Sandbox provisioning is lazy (first agent use); a switch does not wait on a sandbox. The only gate is the workspace-detail fetch (an auth wall). Because the content **remounts on switch** (`key={workspaceId}`), the previous content cannot be "held" — it unmounts. So the honest contract for `multi-project`:

```txt
switching to project X (routeStatus.status !== 'matched'):
  nav:     persists; row X shown active (no runtime/'running' claim — §7.1)
  content: a MINIMAL content-pane loading state (slim centered spinner),
           NOT the full-page "Switching workspace / Restoring files…" card
  matched: swap in X's WorkspaceAgentFront
  not-found/forbidden/switch-failed: render the existing error page in the content pane
```
Mechanism: `CoreWorkspaceAgentFront` selects a **light `loadingFallback`** (content-pane scoped) when `layoutMode === 'multi-project'`, instead of the full-screen `WorkspaceLoadingPage`. (`routeStatus` values are the real enum: `idle|loading|matched|mismatched|not-found|forbidden|switch-failed` — no invented `switching`.) Specified in PR2 acceptance.

---

## 6. State model (no boolean soup)
One source per concern: `layoutMode` (derived once via `resolveLayoutMode`, read-only); nav open/collapsed (existing); expanded project set (owned by `WorkspaceProjectsNav`, persisted); active project (derived from `useCurrentWorkspace()`/route, never duplicated); per-project session cache (a keyed map in the shell, **LRU-capped to the last 12 expanded projects**, with a test, so a long session can't accumulate unbounded rows). No `usePiSessions` in a loop.

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

### PR 2 — Multi-project layout (opt-in; depends on PR0)
- `WorkspaceProjectsNav` in the persistent left bar; lazy per-project sessions via P0 (LRU-capped); §5.1 open-session (sync write+navigate cross-project, typed `openSession` event + new `WorkspaceAgentFront` consumer same-project); §5.2 content-pane loading contract; §7.3 single-account-menu change; footer account row; dropdown removed; `status: undefined`; `CreateWorkspaceDialog` for new project.

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
[ ] switch shows minimal content-pane loader, not the full-page takeover; nav persists
[ ] cross-project open = sync writeActiveSessionId + navigate; same-project = typed openSession event + consumer
[ ] exactly one account menu; dropdown removed in multi-project; status: undefined (no dot)
[ ] new project via CreateWorkspaceDialog (no window.prompt)
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
`WorkspaceAppRail` is **per-workspace** (inside `WorkspaceAgentFront`, `key={workspaceId}` → remounts on switch, knows only its own workspace). A multi-project tree + cross-project Pinned there will **flash on switch** and has **no cross-workspace data**. Two ways out — pick one in the multi-project PR:
- **(A) Persistent shell (recommended, §3):** lift the rail out of `WorkspaceAgentFront` into the `CoreFront` `appShell` so it mounts once; feed it the workspace list + per-project sessions (via the **P0** no-boot route) + cross-project pinned store. No flash. Bigger refactor.
- **(B) Feed the per-workspace rail:** pass the workspace list + a session fetcher + pinned store into `WorkspaceAppRail` as props; accept the remount/flash on switch. Smaller, but re-creates the "flash on switch" the design set out to avoid.

This is the load-bearing decision for the multi-project PR and must be resolved before coding it.

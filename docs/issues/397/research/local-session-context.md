# Local session/task primitives for Seneca background-agent supervision

Scope: repo inspection only. No files changed except this research note.

## Executive summary

The repo already has strong **Pi session persistence, session list, chat-pane/session-open, workspace panel, attention/blocker, UI bridge, and plugin extension** primitives. It does **not** yet have a first-class background-agent/task supervision model. Seneca should likely integrate by treating background agents as session-scoped or agent-scoped records that reuse:

- `SessionStore`/`PiSessionStore` for persisted transcripts and summaries.
- `/api/v1/agent/pi-chat/*` for chat state, streaming, prompt/follow-up/stop/interrupt, create/list/delete.
- `WorkspaceAgentFront` + `SessionBrowser`/`WorkspaceProjectsNav` for session list/open UI affordances.
- `WorkspaceAttentionProvider` for “needs human input”/blocking status.
- Workspace plugin front/server APIs for supervision panels, commands, surface resolvers, and trusted server routes/tools.
- `UiBridge.postCommand`/`openSurface` for agent-to-workspace UI actions.

Critical constraints from AGENTS/docs: persisted Pi chat/session history is **host app user data** and must live under durable host storage such as `BORING_AGENT_SESSION_ROOT=/data/pi-sessions`, not sandbox `/workspace`, workspace files, container home, or repo checkout. Workspace base front/shared code must not value-import `@hachej/boring-agent`; agent/workspace are composed only at app-shell seams.

## Session persistence and storage

### Shared session contract

`packages/agent/src/shared/session.ts:1-27`

```ts
export interface SessionStore {
  list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary>
  load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail>
  delete(ctx: SessionCtx, sessionId: string): Promise<void>
}

export interface SessionCtx { workspaceId: string; userId?: string }
export interface SessionListOptions { limit?: number; offset?: number; includeId?: string }
export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
}
export type SessionDetail = SessionSummary
```

Implication: current persisted session summaries are minimal. A supervision/task layer needs either a separate index/table/API or encoded Pi metadata; `SessionSummary` itself has no status, agent id, parent task, progress, or ownership fields.

### File-backed PiSessionStore

`packages/agent/src/server/harness/pi-coding-agent/sessions.ts:29-74, 82-114`

- Default root resolution:
  - explicit `sessionRoot` option wins.
  - else `BORING_AGENT_SESSION_ROOT`.
  - else `~/.pi/agent/sessions`.
- Default dir encodes storage cwd as `--<cwd-with-separators-replaced>--`.
- Optional `sessionNamespace` maps to `<sessionRoot>/<namespace>` and is validated by `/^[a-zA-Z0-9_-]+$/`.
- `list(ctx, { limit, offset, includeId })` returns sorted summaries and supports keeping an active session in the first page.

`packages/agent/src/server/harness/pi-coding-agent/sessions.ts:120-209`

- `create()` writes a Pi JSONL transcript header and optional `session_info` title.
- `load()` derives title, created/updated timestamps, and turn count from transcript files.
- `loadEntries()` exposes persisted Pi messages for cold-load chat reconstruction.

### Harness wiring

`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:346-370, 455-586`

- `createPiCodingAgentHarness` accepts `sessionNamespace`, `sessionRoot`, and test/host `sessionDir`.
- It constructs `new PiSessionStore(opts.runtimeCwd ?? opts.cwd, { sessionNamespace, sessionRoot, sessionDir, storageCwd: opts.cwd })`.
- The resulting harness exposes `sessions: sessionStore`.

### Core/full-app production storage

`AGENTS.md:19` hard rule:

> Session history is host app user data ... Store them on the host app's durable volume via `BORING_AGENT_SESSION_ROOT` (typically `/data/pi-sessions`), not in container home/root. If host-side `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`, keep the host session root as sibling `/data/pi-sessions` unless the user explicitly chooses another mounted volume.

`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:650-662`

- Core resolves `workspaceRoot` from options/env.
- Core resolves `sessionRoot` from `options.sessionRoot`, `BORING_AGENT_SESSION_ROOT`, or infers sibling `pi-sessions` when mode is `vercel-sandbox` and workspace root basename is `workspaces`.

`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:799-822`

- Core defaults session namespace to `ctx.workspaceId` unless overridden.
- It passes `sessionRoot` and `getSessionNamespace` into `registerAgentRoutes`.

`packages/cli/src/server/modeApps.ts:642-648`

- CLI intentionally returns `getSessionNamespace: async () => undefined` to share the exact Pi native `~/.pi/agent/sessions/--<workspace-root>--` directory with standalone `pi` for the same folder.
- Tradeoff documented in code: sessions are keyed by filesystem path; moving a workspace orphans old sessions.

## Session HTTP/API primitives

### Pi chat routes

`packages/agent/src/server/http/routes/piChat.ts:115-177`

- `GET /api/v1/agent/pi-chat/sessions` — list sessions, accepts pagination parsed by `sessionListOptions`.
- `POST /api/v1/agent/pi-chat/sessions` — create session `{ title? }`.
- `DELETE /api/v1/agent/pi-chat/sessions/:sessionId` — delete.
- `GET /api/v1/agent/pi-chat/:sessionId/state` — snapshot/messages.
- `GET /api/v1/agent/pi-chat/:sessionId/events?cursor=` — NDJSON live event stream.
- Additional prompt/follow-up/queue/interrupt/stop routes exist later in the same file.

`packages/agent/src/server/pi-chat/harnessPiChatService.ts:79-142`

- `listSessions/createSession/deleteSession` delegate to `SessionStore`.
- `deleteSession` aborts active Pi adapter work, waits for active run, unsubscribes, releases metering, clears metadata, then deletes the store record.
- `readState` uses live channel if present, otherwise `loadEntries()` to build a cold persisted snapshot.

### Runtime boot coupling warning

`packages/agent/src/server/registerAgentRoutes.ts:970-979`

- Current `/api/v1/agent/pi-chat/sessions` registration resolves `getService` via `getBindingForRequest(request)`, which can create/boot a runtime binding.

`packages/agent/src/server/registerAgentRoutes.ts:860-873`

- There is already an internal `getSessionStoreForRequest()` that resolves `RuntimeScope` and constructs/caches a `PiSessionStore` without building `HarnessPiChatService`. In the current tree it is not exposed as a no-boot route.

`packages/core/src/app/front/WorkspaceProjectsShell.tsx:68-80`

- The multi-project shell currently fetches `/api/v1/agent/pi-chat/sessions` for project session lists and has a WIP comment: this route currently boots the runtime binding; PR0 must add a no-boot session-list route via `getSessionStoreForRequest` before multi-project lazy expansion ships.

Implication for Seneca: background supervision list views should avoid accidentally booting each agent/runtime just to browse persisted sessions. Reuse or add a no-boot session-list endpoint backed by `getSessionStoreForRequest()`/`SessionStore.list(ctx, { limit, offset })`.

## Frontend session list/open primitives

### Agent package hook + component

`packages/agent/src/front/chat/session/usePiSessions.ts:6-59, 80-96`

- Default sessions API path is `/api/v1/agent/pi-chat/sessions`.
- Hook state includes `sessions`, `activeSessionId`, `activePiSession`, loading/error, pagination, CRUD actions.
- It supports `workspaceId`, `storageScope`, `requestHeaders`, custom `sessionsApiPath`, and retry behavior.

`packages/agent/src/front/chat/session/usePiSessions.ts:418-438`

- `fetchSessionList` expects an array response and maps to `SessionSummary`, defaulting missing fields (`title: Untitled`, timestamps now, `turnCount: 0`).

`packages/agent/src/front/chat/session/SessionList.tsx:9-21, 42-111`

- Agent-owned `SessionList` renders grouped session history, active row, create/delete/switch/load-more callbacks.
- Exports `SessionBrowser = SessionList`.

### Workspace session browser + panes

`packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx:12-39`

- `useWorkingSessionIds()` listens for `window` event `boring:chat-session-status` with `{ sessionId, working }` to show live working state without coupling to a chat implementation.

`packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx:41-58, 150-193`

- `SessionBrowserProps` supports `sessions`, `activeId`, `openIds`, `pinnedIds`, switch/open-as-tab/create/delete/load-more.
- Browser groups sections as Pinned > Active > History.
- It reads `WorkspaceAttentionProvider` blockers and marks sessions with `reason === "waiting_for_user_input"` as needing input.

`packages/workspace/src/front/chrome/session-list/definition.ts:6-44`

- Built-in panel id `session-list`, placement `left`, source `builtin`.
- It passes `sessions`, `activeId`, `openIds`, `pinnedIds`, `onOpenAsTab`, etc. into `SessionBrowser`.

`packages/workspace/src/app/front/WorkspaceAgentFront.tsx:520-572`

- Persists pinned sessions per workspace in localStorage.
- Uses default `usePiSessions` unless caller injects `useSessions`.
- Sets `connectActiveSession: false` in default hook, so listing does not directly open an active remote session; chat panes connect separately.

`packages/workspace/src/app/front/WorkspaceAgentFront.tsx:950-1018, 1030-1064, 1361-1384`

- Calculates `chatSessionId`, prunes/restores chat pane state only when session list is authoritative, and supports placeholder session while remote sessions load.
- `chatPanes` are generated from open session ids, with active pane bridge enabled only for the active chat pane.
- `ChatLayout` receives `nav="session-list"` with `sessions`, `activeId`, `openIds`, `pinnedIds`, `onOpenAsTab`, `onLoadMore`, `hasMore`, etc.

### Full-app multi-project nav shell

`packages/core/src/app/front/WorkspaceProjectsShell.tsx:15-31, 68-130, 171-193`

- Persistent left-bar shell lists workspaces as projects and lazily fetches sessions per project.
- `openSession(projectId, sessionId)` synchronously writes `writeActiveSessionId(..., { storageScope: projectId })`, then navigates to the project. Same-project open is currently a no-op pending a typed workspace event.
- `WorkspaceProjectsNav` is presentational and lives in workspace package; Core owns data/routing/auth.

Implication for Seneca: for “open output”/supervision UX, reuse `SessionBrowser`/`WorkspaceProjectsNav` patterns: one row can open/switch a session, open as another chat pane, pin, show working/needs-input. For same-workspace same-page session switching, beware current TODO: no typed workspace event yet in `WorkspaceProjectsShell`.

## Workspace panels, bridge, and attention primitives

`docs/WORKSPACE_CONTRACT.md:8-35`

- Agent and workspace are composed at app-shell level.
- Rules: workspace base front/shared must not value-import agent; agent must not import workspace; app shell wires `WorkspaceAgentFront`/`WorkspaceProvider` and agent components.

`packages/workspace/src/front/chrome/chat/types.ts:6-31`

- Workspace injects `WorkspaceChatPanelProps`: `sessionId`, `requestHeaders`, `onOpenArtifact`, `bridgeEndpoint`, `getSurface`, open/close workbench callbacks, `composerBlockers`, stop/blocker actions.

`packages/workspace/src/front/chrome/chat/ChatPanelHost.tsx:52-138`

- Host gets injected chat component via `useWorkspaceChatPanel()`.
- Filters attention blockers to current `sessionId` and passes them to chat implementation.
- Dispatches stop/blocker action events and forwards UI command bridge props.

`packages/workspace/src/front/attention/WorkspaceAttentionProvider.tsx:5-24, 38-51`

- In-memory blockers: `{ id, reason, label?, surfaceKind?, target?, sessionId?, actions? }`.
- Provides `addBlocker/removeBlocker`.
- This is useful for supervision statuses such as “waiting for user input,” but it is not persisted and is only in mounted workspace UI state.

`docs/WORKSPACE_CONTRACT.md:141+` and `packages/workspace/docs/README.md:18-25`

- `UiBridge.postCommand()` is the single authoritative agent-to-UI dispatch source.
- `openSurface` decouples agent requests from concrete panel ids; plugins register surface resolvers.

Implication for Seneca: a supervisor panel should be a workspace panel/plugin surface. Background agents should not drive UI by parsing chat display parts; use bridge commands/surface resolvers.

## Plugin extension points

`packages/workspace/docs/README.md:12-28, 36-59`

- Workspace plugin host populates panel, command, catalog, and surface-resolver registries via `WorkspaceProvider` bootstrap.
- Two tiers:
  - App/internal plugins: trusted, boot-time, can add routes/agent tools/Pi resources.
  - Runtime/generated `.pi/extensions`: hot-reloaded front/Pi resources, route-free, local/direct-style contexts only, not `vercel-sandbox`.

`packages/workspace/docs/PLUGIN_SYSTEM.md:30-61`

- App/internal plugin may export `boring.server`, routes, agent tools, providers, domain APIs.
- Runtime/generated plugin is workspace-local `.pi/extensions/<id>`, hot-loaded for front/Pi, **must not rely on dynamic backend routes**.
- Plugin tools execute in host Node and bypass sandbox by design; untrusted hosted marketplace plugins are not implemented.

`packages/workspace/docs/PLUGIN_SYSTEM.md:190-244`

- `definePlugin({ panels, commands, surfaceResolvers })` is the front authoring API.
- `defineServerPlugin({ systemPrompt, agentTools, routes })` is the trusted server authoring API.
- Hot reload covers Pi resources and front outputs; `boring.server` routes/tools are boot-time only and require restart.

`packages/workspace/docs/PLUGIN_STRUCTURE.md:8-44`

- Runtime plugin shape: `.pi/extensions/<name>/package.json`, `front/index.tsx`, no server by default.
- App/internal plugin shape: `plugins/<name>/src/front`, optional `src/server`, `src/shared`.

Implication for Seneca: supervision UI can be a front plugin/panel. Any durable task/session index API, background worker launch/supervision route, or agent tool should be a trusted app/internal server plugin or core/agent server feature, not a runtime generated plugin route.

## Task/background-agent primitives found or missing

Found:

- Session rows can display live-ish state using `boring:chat-session-status` (`working`) and `WorkspaceAttentionProvider` (`waiting_for_user_input`).
- Session list summaries have `turnCount`, `updatedAt`, and titles.
- `HarnessPiChatService` has stop/interrupt/delete hooks for active session lifecycle and metering release.
- Plugin/server APIs can add panels, commands, agent tools, routes, system prompt addenda, Pi skills/extensions.

Missing/gaps for Seneca:

- No durable `Task`/`BackgroundAgent` data model in current source. README only advertises future “tasks/workflows” ideas; current code is session-centric.
- `SessionSummary` cannot represent task state/progress/owner/parent-child relationships.
- `WorkspaceAttentionProvider` status is in-memory UI state, not a durable background task state bus.
- Current `/api/v1/agent/pi-chat/sessions` list can boot runtime; a no-boot list endpoint is only called out as WIP in `WorkspaceProjectsShell`.
- Multi-agent isolation is not implemented in current code. Existing plans mention adding `agentId` to binding scope key and `sessionNamespace`, but current `registerAgentRoutes` scope key is `[mode, workspaceId, root, templatePath, pi, sessionNamespace]` (see `registerAgentRoutes.ts:432-447`). Seneca must not assume per-agent isolation unless implemented.

## High-value integration points for Seneca

1. **Durable session/transcript storage**
   - Use `sessionRoot`/`BORING_AGENT_SESSION_ROOT` and `sessionNamespace` for any background-agent transcript grouping.
   - For multi-agent Seneca roles, extend namespace with a safe `agentId`/task id segment rather than sharing a workspace namespace.

2. **No-boot session/task listing**
   - Add/reuse a route backed by `getSessionStoreForRequest()` and `SessionStore.list(ctx, { limit, offset, includeId })` for browsing background sessions without creating runtime bindings.
   - Do not paginate by stuffing `limit/offset` into `SessionCtx`; options are the second arg.

3. **Supervision UI panel**
   - Implement as workspace front plugin panel/left-tab or app shell panel.
   - Use `SessionBrowser` affordances for active/open/pinned/working/needs-input, or compose a custom panel from the same primitives.

4. **Open session/output behavior**
   - For active workspace, route through `WorkspaceAgentFront` chat pane mechanics (`onOpenAsTab`, `chatPanes`, `activeChatPaneId`).
   - For cross-project open, existing pattern is `writeActiveSessionId(sessionId, { storageScope: projectId })` then navigate.
   - Same-project open from `WorkspaceProjectsShell` currently lacks a typed event; avoid ad-hoc CustomEvents unless a proper workspace event is introduced.

5. **Human supervision/approval**
   - Reuse `WorkspaceAttentionProvider` for mounted UI blockers (“waiting_for_user_input”) and composer blockers.
   - For durable background agents, add a persistent task/blocker source; don’t rely only on the in-memory provider.

6. **Server-side extensions**
   - Trusted supervision APIs/routes/tools belong in app/internal `defineServerPlugin` or core/agent server composition.
   - Runtime `.pi/extensions` can contribute front panels/Pi skills but not dynamic backend routes.

7. **UI bridge/surfaces**
   - Use `UiBridge.postCommand`/`openSurface` to open panels/artifacts from agents.
   - Register surface resolvers rather than hardcoding panel ids in agent outputs.

## Constraints and risks

- **Storage invariant:** transcripts/session lists are host-owned durable app data; never put them in sandbox `/workspace`, workspace root, repo checkout, or ephemeral container home for deployed core apps.
- **Import boundary:** workspace base front/shared cannot value-import `@hachej/boring-agent`; app/front and app/server composition seams may import both.
- **Runtime boot risk:** session browsing via current `/api/v1/agent/pi-chat/sessions` can provision runtime. Seneca list views should avoid this.
- **Namespace collision risk:** `PiSessionStore` namespace accepts only `[A-Za-z0-9_-]`; any `agentId`/task id must be normalized. Without agent id in namespace/scope key, sessions for multiple background agents in one workspace can cross-contaminate.
- **Plugin trust:** generated runtime plugins are local trusted front/Pi code only; no dynamic server routes/tools. Host-node plugin tools bypass sandbox.
- **Stable errors:** AGENTS/docs require stable error codes; new task/session APIs should use canonical error-code patterns rather than arbitrary envelopes.
- **UI state durability:** `pinnedIds`, chat pane layout, active session id are localStorage/browser state. Durable supervision needs backend state if it must survive browser/device changes.

## Suggested validation paths if implementing later

- Unit: `PiSessionStore` list pagination/includeId, namespace isolation, no workspace-root storage.
- Server: no-boot session-list route does not call `getOrCreateRuntimeBinding`; returns stable errors for unauthorized/unknown workspace.
- Front: `WorkspaceAgentFront` session open/pin/open-as-tab still works; same-workspace typed open event if added.
- Workspace: `SessionBrowser` displays working and needs-input badges from events/blockers.
- Plugin: front plugin panel registers without route assumptions; trusted server plugin route/tool only boot-wired.
- Invariants: run `pnpm lint:invariants` for import boundary/shared-node constraints.

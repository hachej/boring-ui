# Workspace Integration Contract

Defines the contracts between `@hachej/boring-agent` and `@hachej/boring-workspace`. Both packages are composed at the **app-shell level** -- neither imports from the other at runtime.

See also: [DECISIONS.md](./DECISIONS.md) (locked decisions), [REVIEW_DECISIONS.md](kanzen/REVIEW_DECISIONS.md) (adopted/deferred findings).

---

## Integration Pattern: App-Shell Composition

```
@hachej/boring-agent  @hachej/boring-workspace  App Shell
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ ChatPanel    │     │ WorkspaceProvider│     │ import { ChatPanel }│
│ usePiSessions│     │ IdeLayout        │     │   from agent        │
│ styles.css   │     │ PanelRegistry    │     │ import { Workspace  │
│              │     │ Zustand store    │     │   Provider } from   │
│              │     │                  │     │   workspace         │
└──────────────┘     └──────────────────┘     └─────────────────────┘
       │                      │                        │
       └──────────────────────┴────────────────────────┘
                    Wired together by app shell
```

**Rules:**
1. `@hachej/boring-workspace` **base** front/shared code has **zero value imports** from `@hachej/boring-agent`. The agent wiring lives only in the `app/*` composition layers (`app/front`, `app/server`) and a small set of server/plugin seams — that is the intended composition point, not a violation.
2. `@hachej/boring-agent` has **zero imports** from `@hachej/boring-workspace`.
3. The app shell imports from both and wires them via `createWorkspaceAgentServer` (server, from `@hachej/boring-workspace/app/server`) + `WorkspaceAgentFront` (from `@hachej/boring-workspace/app/front`) / `WorkspaceProvider` (frontend).
4. Shared types (`UiBridge`, `UiCommand`, `CommandResult`) live in `@hachej/boring-workspace/shared` and are re-exported from `@hachej/boring-workspace/server`.

**App-shell wiring example (plugin-based — recommended):**

```tsx
import { WorkspaceAgentFront } from '@hachej/boring-workspace/app/front'
import { myPlugin } from './plugins/myPlugin'

function App() {
  return (
    <WorkspaceAgentFront
      apiBaseUrl="http://localhost:5180"
      plugins={[myPlugin]}
    />
  )
}
```

**Low-level example (manual `WorkspaceProvider`):**

```tsx
import { ChatPanel } from '@hachej/boring-agent'
import { WorkspaceProvider, IdeLayout } from '@hachej/boring-workspace'

function App() {
  return (
    <WorkspaceProvider apiBaseUrl="http://localhost:5180">
      <IdeLayout />
    </WorkspaceProvider>
  )
}
```

---

## Contracts Agent Owes to Workspace

### 1. HTTP Routes

`@hachej/boring-agent` standalone owns agent/file/session endpoints. UI bridge endpoints are owned by the app-shell workspace server surface (typically via `createWorkspaceAgentApp`). Workspace frontend calls these via `fetch` / `EventSource`.

#### Files

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/files?path=<path>` | Read file content |
| POST | `/api/v1/files` | Write file `{ path, content }` |
| DELETE | `/api/v1/files` | Delete file `{ path }` |
| POST | `/api/v1/files/move` | Rename/move `{ oldPath, newPath }` |
| GET | `/api/v1/files/search?q=<query>` | Search files by name/content |
| POST | `/api/v1/dirs` | Create directory `{ path }` |
| GET | `/api/v1/tree` | Directory tree listing |
| GET | `/api/v1/stat?path=<path>` | File/dir metadata |

#### Agent / Chat

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/agent/chat` | Start chat turn (SSE stream response) |
| GET | `/api/v1/agent/chat/:sessionId/stream?cursor=<n>` | Resume stream from cursor position |
| GET | `/api/v1/agent/sessions` | List all sessions |
| POST | `/api/v1/agent/sessions` | Create session `{ title? }` |
| GET | `/api/v1/agent/sessions/:id` | Load session with messages |
| DELETE | `/api/v1/agent/sessions/:id` | Delete session |
| GET | `/api/v1/agent/sessions/:id/changes` | File changes for session |
| GET | `/api/v1/agent/catalog` | List available tools |

#### UI Bridge (workspace/app-shell hosted, not standalone agent)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/ui/state` | Get current UI state |
| PUT | `/api/v1/ui/state` | Set UI state `{ state, causedBy? }` |
| POST | `/api/v1/ui/commands` | Post command `{ kind, params }` |
| GET | `/api/v1/ui/commands/next` | SSE subscribe to commands |
| GET | `/api/v1/ui/commands/next?poll=true` | Poll fallback for restricted environments |

#### Infrastructure

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check `{ version }` |
| GET | `/ready` | Readiness check (503 during cold start) |

All routes use standard error codes: `validation_error`, `not_found`, `internal`, `range_not_satisfiable`.

### 2. Component Exports (for App Shell)

These are exported by `@hachej/boring-agent` (front entry) for the app shell to compose into `WorkspaceProvider`. Workspace does NOT import these directly. The surface evolves; the canonical list is `packages/agent/src/front/index.ts`.

| Export | Tier | Purpose |
|---|---|---|
| `ChatPanel` (alias of `PiChatPanel`) | Default | Drop-in chat experience. Pass via `panels` prop. |
| `SessionList` / `SessionBrowser` (`PiSessionList` / `PiSessionBrowser`) | Default | Session list/switch/create/delete UI. |
| `PromptInput*` (`PromptInputTextarea`, `PromptInputFooter`, `PromptInputSubmit`) | Primitive | Composer textarea + footer + submit. |
| `Message` / `MessageContent` / `MessageActions` | Primitive | Message container + content + actions. |
| `Conversation` / `ConversationContent` / `ConversationScrollButton` | Primitive | Scrollable conversation surface. |
| `ToolRenderer` / `ToolCallGroup` / `ToolPart` | Primitive | Tool call rendering. |
| `CodeBlock` | Primitive | Syntax-highlighted code block. |
| `Reasoning` / `ReasoningTrigger` / `ReasoningContent` | Primitive | Collapsible reasoning/thinking display. |
| `usePiSessions` | Hook | Headless session state + CRUD. |
| `useOpenArtifact` | Hook | Artifact open handling. |
| `@hachej/boring-agent/front/styles.css` | Style | CSS custom properties (`--boring-agent-*`) and component styles. |

### 3. Styling Contract

- All chat styles use `--boring-agent-*` CSS custom properties, shipped via `@hachej/boring-agent/front/styles.css` (the package's `globals.css`). There is no separate `theme.css` subpath.
- Tokens are scoped to `[data-boring-agent]` and consume the host's public `--boring-*` tokens (owned by `@hachej/boring-workspace`) with package-default fallbacks. See `docs/TAILWIND-V4-STYLE-ISOLATION.md`.
- Workspace can override at any scope via the `data-boring-agent` attribute on the panel container.
- The agent's shipped CSS contains no `@import "tailwindcss"`; it relies on the consumer's Tailwind setup.

### 4. UiBridge Semantics

- **Command dispatch**: single source via `UiBridge.postCommand()`. Agent tools call this; workspace receives via SSE through the workspace/app-shell hosted `/api/v1/ui/*` bridge.
- **State ownership**: workspace PUTs state after applying changes. Agent reads state via `get_ui_state` tool.
- **Seq numbering**: monotonically increasing per command. Same `seq` appears in SSE event and POST response.
- **Display parts**: `data-ui-command` message parts are display-only in the chat stream. Workspace must NOT dispatch from these; SSE is the authoritative dispatch channel.

### 5. CommandResult Shape

```typescript
interface CommandResult {
  seq: number
  status: 'ok' | 'error'
  error?: { code: string; message: string }
}
```

### 6. UiCommand Kinds

```typescript
type UiCommand =
  | { kind: 'openFile';               params: { path: string; mode?: 'view' | 'edit' | 'diff' } }
  | { kind: 'openPanel';              params: { id: string; component: string; title?: string; params?: Record<string, unknown> } }
  | { kind: 'openSurface';            params: { kind: string; target: string; meta?: Record<string, unknown> } }
  | { kind: 'closePanel';             params: { id: string } }
  | { kind: 'closeWorkbenchLeftPane'; params: Record<string, never> }
  | { kind: 'showNotification';       params: { msg: string; level?: 'info' | 'warn' | 'error' } }
  | { kind: 'navigateToLine';         params: { file: string; line: number } }
  | { kind: 'expandToFile';           params: { path: string } }
```

- `openSurface` routes through the workspace `SurfaceResolverRegistry` — plugins register resolvers that map a `kind`+`target` to a panel open call.
- `closeWorkbenchLeftPane` hides the workbench's left sources/files sidebar without closing the workbench itself.

Workspace may extend this union with workspace-specific kinds.

### 7. Ready-Status SSE

For cold-start UX (see `risk.vercel-cold-start-ux`):
- Agent reports readiness via `GET /ready` returning `{ sandboxReady, harnessReady }`.
- Frontend shows "preparing workspace..." until both are `true`.
- Polling interval: 1s until ready, then stop.

---

## Contracts Workspace Owes to Agent

### 1. State Updates with `causedBy`

Workspace must include `causedBy` when setting state:

```
PUT /api/v1/ui/state
{ "state": { ... }, "causedBy": "user" | "agent" | "restore" }
```

This prevents echo loops: agent-originated state changes are tagged `"agent"`, user-originated `"user"`, and hydration from persistence `"restore"`.

### 2. SSE Command Subscription

Workspace subscribes to `GET /api/v1/ui/commands/next` (SSE) as the primary command delivery channel. Falls back to `?poll=true` in restricted environments (e.g., corporate proxies that break SSE).

### 3. Display-Only Command Parts

`data-ui-command` parts in the chat message stream are for display only (showing "opened foo.md" in the conversation). Workspace must never dispatch actions from these parts -- the SSE subscription is the authoritative source.

### 4. Panel Registration

When the app shell wants chat, it passes a panel config:

```typescript
{
  id: 'agent',
  title: 'Chat',
  component: ChatPanel, // imported from @hachej/boring-agent
  essential: true,
  source: 'app',
}
```

Workspace's `PanelRegistry` handles lifecycle. The `source: 'app'` field distinguishes app-injected panels from workspace builtins.

### 5. UiCommand Implementation

Workspace implements handlers for commands it cares about:

| Kind | Workspace Action |
|---|---|
| `openFile` | Open file in editor pane |
| `openPanel` | Activate/create panel by id |
| `openSurface` | Resolve a domain target through registered surface resolvers, then open the resolved panel |
| `closePanel` | Remove panel |
| `showNotification` | Display toast/notification |
| `navigateToLine` | Scroll editor to file:line |
| `expandToFile` | Expand file tree to path |

Unknown kinds are silently ignored (forward-compatible).

---

## Import Convention

```
@hachej/boring-agent              → top-level, browser-safe (components + hooks)
@hachej/boring-agent/front/styles.css → CSS (tokens + component styles)
@hachej/boring-agent/server       → Node-only (Fastify app, harness, session store)
@hachej/boring-agent/shared       → type-only (interfaces, schemas)
```

Workspace imports **none** of these. The app shell imports from the top-level entry point.

---

## Verification

### Bundle Isolation

Workspace **base** front/shared bundle must contain zero value imports from `@hachej/boring-agent`; agent imports are confined to the `app/*` composition layers and a few server/plugin seams. The import-boundary audit enforces this:

```bash
pnpm audit:imports   # scripts/audit-imports.ts — fails on illegal cross-package imports
```

A manual spot check (note: `app/*` and `*/server` seams legitimately import agent):

```bash
grep -rn "from.*@hachej/boring-agent" packages/workspace/src/front/ packages/workspace/src/shared/
# Expected: no value imports (type-only imports are allowed)
```

### E2E Integration Test

Current coverage lives in package-local suites:

1. `packages/agent/e2e/*` validates standalone agent behavior (including that standalone `/api/v1/ui/*` is not exposed).
2. Workspace/app-shell integration coverage should validate bridge flow where the workspace server hosts `/api/v1/ui/*`.
3. `ChatPanel` rendering in `WorkspaceProvider` remains an app-shell composition check.

---

## Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-04-23 | Initial contract | v1 planning complete |

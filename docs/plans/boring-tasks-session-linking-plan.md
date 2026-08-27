# Boring Tasks Session Linking Plan

## Goal

Let a task in `plugins/tasks` remember which pi-chat session(s) worked on it, so a user can see whether a task already has a chat and reopen it instead of always starting a new one — in both CLI and hosted mode.

## Approach: explicit link store in the tasks plugin

Add a small plugin-owned store that records `{adapterId, taskId} -> sessionId` links, created at the moment `plugins/tasks` itself creates a pi-chat session on the user's behalf. No changes to `packages/agent` core.

This mirrors `plugins/boring-automation`'s already-reviewed pattern for the identical problem: `AutomationRun.sessionId` is a plain foreign-key field into the normal Pi session store, held in a per-workspace JSON file (`FileAutomationStore` → `.pi/automation/store.json`), with no referential integrity — the domain record just points at a session id and the UI resolves it through the normal session API. `plugins/tasks` gets its own analogous store rather than reusing automation's (different domain, different plugin — no cross-plugin coupling).

CLI vs. hosted needs no special handling: the store is a JSON file rooted at `<workspaceRoot>/.pi/tasks/`, the same directory tree the tasks plugin's GitHub adapters already resolve via `workspaceRoot` (`githubSource.ts`, `sourceRuntime.ts`), and the same durability story `.pi/automation/` already relies on.

**Rejected alternative: encode the link in the session id itself (hash prefix).** This was the first design explored. It technically works — verified against the installed `@earendil-works/pi-coding-agent` package that `SessionHeader.id` is a free-form string, `NewSessionOptions.id` and the CLI's `pi --session-id <id>` already support caller-chosen ids — but it turned out to have no real advantage once weighed against an explicit store:
- It still required a new field threaded through `packages/agent` core (`SessionStore.create`, `PiSessionCreateInit`, `PiSessionRepository.create`, `CreateSessionBodySchema`) — more invasive than keeping the change inside `plugins/tasks`.
- It didn't solve the "session created outside boring-ui" case any better. A bare `pi` CLI session started independently of boring-ui doesn't get a prefix either way, unless the user manually cooperates — and with an explicit store, that manual cooperation is "pick an existing session to link" (one API call), versus "type the exact hash-derived id by hand" (impractical).
- `SessionHeader` has no generic native metadata field to lean on instead (closed type: `type, version, id, timestamp, cwd, parentSession`); `boringSessionCtx` is boring's own bolt-on JSON key, not a pi concept, so there was no cleaner native hook to use in place of the prefix.

## Non-goals

- No change to chat transcript ownership or storage location.
- No cross-workspace task/session search.
- No automatic cleanup when a task is closed/deleted upstream or a session is deleted — links can dangle, same as automation's accepted `sessionId` precedent. The front end must handle "linked session no longer exists" gracefully (e.g. 404 on open → offer to unlink).
- No support (yet) for manually linking a session that was created outside boring-ui (e.g. bare `pi --session-id`). The store and routes make this easy to add later — a "link existing session" action is just another call to the same create-link endpoint — but it's not built in this pass.

## Data model

```ts
// plugins/tasks/src/shared/index.ts
export interface BoringTaskSessionLink {
  id: string
  /** Opaque, adapter-scoped — task.id means different things per adapter (see Risks). */
  adapterId: string
  taskId: string
  sessionId: string
  title?: string
  createdAt: string
}
```

## Store

```ts
// plugins/tasks/src/server/sessionLinkStore.ts
export interface TaskSessionLinkStore {
  listLinks(adapterId: string, taskId: string): Promise<BoringTaskSessionLink[]>
  createLink(input: { adapterId: string; taskId: string; sessionId: string; title?: string }): Promise<BoringTaskSessionLink>
  deleteLink(id: string): Promise<void>
}
```

- Concrete `FileTaskSessionLinkStore` at `.pi/tasks/session-links.json`, atomic write via temp-file + rename, same shape as `FileAutomationStore` (`plugins/boring-automation/src/server/fileStore.ts`).
- **Single-workspace by construction** — one store instance per `workspaceRoot`, no per-call `workspaceId`/`ctx` threaded into store methods. `createTasksServerPlugin` already receives `workspaceRoot`; instantiate the store there the same way `createDefaultStore(workspaceRoot)` does in `boring-automation/src/server/index.ts`. (This is the corrected shape automation itself is mid-migration toward per `docs/issues/590/todo.md` — no reason to introduce the same mistake here.)
- Append-only in practice: `createLink` / `deleteLink` only; no patch/update semantics needed.

## Routes

Follow the existing tasks-plugin convention of exact POST-body endpoints (`docs/plans/boring-tasks-generic-backend-move-plan.md`: "Use exact route paths because runtime plugin routes do not support path params"):

```txt
POST /api/boring-tasks/sessions/list   { adapterId, taskId } -> { ok: true, links: BoringTaskSessionLink[] }
POST /api/boring-tasks/sessions/link   { adapterId, taskId, sessionId, title? } -> { ok: true, link: BoringTaskSessionLink }
```

Registered in `plugins/tasks/src/server/index.ts` alongside the existing `/api/boring-tasks/sources/*` routes, same validation/error style (`TaskSourceServiceError` → `responseError`/`statusFor`).

## Front end: TaskCard

- `openTaskChat` (`plugins/tasks/src/front/TaskCard.tsx`) first calls `POST /api/boring-tasks/sessions/list { adapterId: task.adapterId, taskId: task.id }`.
- No links: create a session via the existing `POST /api/v1/agent/pi-chat/sessions` call (unchanged), then `POST /api/boring-tasks/sessions/link` to persist the mapping, then open it — same UX as today.
- One or more links: show a small popover — "Continue: `<title>` · `<relative time>`" plus "Start new chat" — instead of unconditionally creating a session on click. Picking "Continue" calls `shell.openDetachedChat(sessionId, ...)` directly, no new session created.
- Visual: a badge/count on the chat icon when links exist, so the card signals "already worked on" without opening the menu.

## Test seams

- `plugins/tasks/src/server/__tests__/sessionLinkStore.test.ts` — CRUD, atomic write survives concurrent calls, scoped correctly to `rootDir`.
- `plugins/tasks/src/server/__tests__/index.test.ts` (or equivalent) — route validation for `/sessions/list` and `/sessions/link` (missing fields → 400, unknown store errors → mapped status).
- `TaskCard` component test — renders the reopen affordance when a link exists, always-new-chat behavior when none exists, badge count reflects link count.

## Acceptance

- Clicking a task's chat button with no prior session creates one and records the link — same UX as today.
- Clicking it again on the same task offers to reopen the previous session instead of silently creating a duplicate.
- Works unmodified in hosted mode: the store is workspace-rooted JSON, same durability path as `.pi/automation/`; no hosted-specific code path is added.
- `packages/agent` is untouched.

## Proof

```bash
pnpm --filter @hachej/boring-tasks typecheck
pnpm --filter @hachej/boring-tasks test
pnpm --filter @hachej/boring-tasks build
```

Manual: open a task's chat, close it, reopen the task card, confirm the popover offers the prior session; confirm "start new chat" still works for a second, separate chat on the same task; confirm the badge count updates.

## Risks

- Task id meaning is adapter-inconsistent today (server GitHub adapter keys on issue *number*, the browser-only demo adapter keys on issue *id*). The link key is always `{adapterId, taskId}` together, so this can't cause cross-adapter collisions, but it does mean a link is only valid for the adapter that created it — switching a provider's id scheme would silently orphan existing links. Not addressed here; pre-existing inconsistency, out of scope to fix as part of this plan.
- No referential integrity: deleting/closing a task upstream, or deleting a session, leaves a dangling link. Same accepted shape as `boring-automation`'s `sessionId`.
- New plugin-owned storage means a new file to keep consistent (atomic write, orphan/missing-file recovery) — smaller in scope than `FileAutomationStore` (no prompt files, no run state machine, append/delete only) but still needs the same care around partial-write failure modes.

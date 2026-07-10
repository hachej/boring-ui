# #594 Spike — Project-wide Pi session inventory and status read model

## Question

Can Boring UI list every native Pi session in a project/workspace and track status for them independently of mounted chat panes, so task cards can show whether a linked session has an active agent working?

## Findings

### 1. Session inventory already exists at the right seam

`PiSessionStore.list(ctx, options)` enumerates JSONL files from the effective session directory and filters by `SessionCtx` (`workspaceId`, `userId`). This is the same path used by `GET /api/v1/agent/pi-chat/sessions` through `HarnessPiChatService.listSessions()`.

Local CLI mode intentionally returns `undefined` from `getSessionNamespace`, so the store falls back to the workspace-path-derived native Pi session directory. That means Boring UI and standalone Pi already share one project session inventory in CLI mode.

Hosted mode uses `BORING_AGENT_SESSION_ROOT` / namespace routing through core composition, so inventory remains scoped by workspace/user but does not share with a local standalone Pi process.

### 2. Browser session-status events are insufficient

The existing `boring:chat-session-status` browser event is emitted by mounted `PiChatPanel` instances and consumed by the workspace `SessionBrowser`. It is useful for immediate UI updates, but it cannot see:

- closed-pane sessions still running in the server runtime;
- sessions created by another browser tab unless a panel is mounted there and events are bridged;
- standalone Pi sessions outside Boring UI;
- idle persisted sessions that have no mounted panel.

Therefore task working indicators must not depend on that event as authority.

### 3. Server runtime can know working state for Boring-owned live sessions

`HarnessPiChatService` holds live channels in memory:

- `channels: Map<sessionKey, LiveSessionChannel>`;
- `activePromptRuns: Map<sessionKey, Promise<void>>`;
- channel snapshots expose `adapter.readSnapshot().isStreaming`, `isRetrying`, and queued follow-ups;
- `buildPiChatSnapshot()` maps `isStreaming` to `status: 'streaming'` and errors to `status: 'error'`.

This means a bulk status read can be implemented cheaply in-process for sessions currently known to the Boring runtime, including sessions whose chat pane is closed but whose run is still active.

Required addition: expose a service method such as:

```ts
listSessionActivity(ctx, sessionIds?: string[]): Promise<Array<{
  sessionId: string
  state: 'working' | 'queued' | 'idle' | 'error' | 'unknown'
  source: 'live-runtime' | 'persisted' | 'external'
  activeTurnId?: string
  updatedAt?: string
}>>
```

Do not call `readState()` per session for bulk status: cold `readState()` may create/adapt a Pi session, which is too expensive and can have side effects for an inventory endpoint.

### 4. Persisted-only sessions can only be idle/error-ish, not live-working

When a session is not live in `HarnessPiChatService`, current code falls back to `readPersistedState()` (via `loadEntries`) and returns `status: 'idle'`. The transcript can reconstruct messages, but it is not a reliable live-status source.

A durable `EventStreamStore` type exists and can record `agent-start`/`agent-end` events, but production route composition currently does not pass an event store into `createAgentRuntimeBridge()`. Even if wired, it would only describe Boring-originated runs whose events are appended by Boring. It would not reveal a standalone Pi process unless standalone Pi wrote compatible status events to the same store.

### 5. Standalone Pi live status is not knowable today

Standalone Pi shares session JSONL files in CLI mode, but the native session file is a transcript/session-info store, not a heartbeat or process-status store. The spike found no existing reliable native Pi lock/heartbeat/status file that Boring can read to determine whether a standalone Pi process is currently working on a session.

Therefore local standalone Pi sessions should be represented as:

- `idle` when they are persisted and no Boring-owned live runtime channel exists; or
- `unknown` if the product wants to distinguish "not tracked by Boring" from confirmed idle.

Recommendation: use `unknown` only when evidence suggests an external live process may exist. In the first implementation, persisted sessions without a Boring live channel should be `idle` with `source: 'persisted'`, and the UI copy should avoid claiming Boring can detect external Pi work.

### 6. Queued continuation semantics need a distinct state or folded working state

The current user requirement says a task is working when a linked session is executing, retrying, or processing a queued continuation.

Implementation detail:

- `isStreaming` / `isRetrying` means `working`.
- `followUpMessages.length > 0` means queued but not necessarily actively executing.
- During auto-post/queued continuation, the runtime will transition back to streaming while processing.

Recommendation: expose `queued` separately in the backend read model, but render it as a non-working `queued` badge unless/until the continuation is actually being consumed/streaming. If product wants queued to count as working, map `queued` to the task-level `working` rollup explicitly and document that behavior.

## Proposed implementation shape

### Backend

Add one bulk endpoint on the Pi chat/session surface:

```txt
POST /api/v1/agent/pi-chat/sessions/activity
{ sessionIds?: string[], limit?: number }
-> { ok: true, sessions: SessionActivity[] }
```

Rules:

- If `sessionIds` is provided, authorize every requested ID and omit or error unauthorized IDs consistently with existing session routes.
- If omitted, use `SessionStore.list(ctx, { limit })` and return status for the visible page.
- Never instantiate cold Pi sessions just to compute activity.
- Compute live state from `HarnessPiChatService` maps/adapters.
- Compute persisted state from `SessionStore.list/load` summaries only.
- Include `source` so consumers know whether status came from `live-runtime` or `persisted`.

### Frontend/session layer

- Extend `usePiSessions` or add a focused `usePiSessionActivity` hook.
- Use browser `boring:chat-session-status` events only as an optimistic overlay.
- Reconcile against the bulk endpoint on bounded polling while Tasks is visible.

### Tasks

- For each expanded task or visible task card with linked sessions, request bulk activity for the linked session IDs.
- Roll up states:
  - any `working` -> `working`;
  - else any `queued` -> `queued`;
  - else any `error` -> `error`/attention if desired;
  - else idle/unknown.
- Do not persist activity in `TaskSessionBindingStore`.

## Proof/evidence collected

Code seams inspected:

- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` — inventory/scoped native JSONL listing.
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts` — live channel and persisted-state logic.
- `packages/agent/src/server/pi-chat/piChatSnapshot.ts` — snapshot status derivation.
- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` — `hasPiSession()` in-memory live detection.
- `packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx` and `packages/agent/src/front/chat/PiChatPanel.tsx` — mounted browser status event.
- `packages/cli/src/server/modeApps.ts` — local CLI session namespace deliberately disabled to share native Pi session directory.

Existing tests that already pin pieces of the behavior:

- `harnessPiChatService.test.ts` covers live `/state` status during streaming and error states.
- `harnessPiChatService.eventStore.test.ts` covers cold persisted state sequence reconstruction.
- `piChatSnapshot.test.ts` covers active snapshot derivation from `isStreaming` and queued follow-ups.

No production code was changed for this spike.

## Result

A project-wide session inventory is feasible now. A project-wide status read model is feasible for Boring-owned live sessions and persisted idle sessions.

The important limitation: Boring UI cannot currently know that a standalone Pi process is actively working on a shared local session. It can list that session and link it to a task, but active work status for external Pi must be `idle`/`unknown` until a future native Pi heartbeat/status integration exists.

## Plan impact

- Keep the task working indicator, but define it as authoritative only for Boring-owned live runtime sessions.
- Add the bulk session-activity endpoint/read model before task working badges.
- Do not promise live-working detection for standalone Pi sessions in slice 3.
- Treat browser status events as an optimization, never source of truth.

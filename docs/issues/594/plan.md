# #594 — Unified session management and task bindings

## Problem Statement

Boring UI currently lacks a complete session-management surface: users cannot rename sessions from the left session list, and agents cannot search or deliberately manage their own sessions through a compact domain capability.

The Tasks plugin also creates new chats without remembering which sessions worked on a task. Users need to reopen prior task chats in both local CLI and hosted deployments. Local CLI sessions must remain the same native Pi sessions visible to a standalone `pi` process in the same workspace.

## Solution

Build two related but separate domain capabilities:

1. **Authoritative session management** in `@hachej/boring-agent`:
   - one shared session application service/store contract;
   - authenticated HTTP list/search, rename, and delete operations;
   - inline rename in the left session browser;
   - one compact `manage_sessions` agent tool whose actions call the same application service as HTTP routes;
   - native Pi JSONL persistence so local Boring UI and standalone Pi continue sharing sessions.

2. **Explicit task↔session bindings** in `@hachej/boring-tasks`:
   - a plugin-owned `TaskSessionBindingStore` abstraction;
   - file-backed CLI storage and an injected hosted durable adapter;
   - routes and UI to list, link, unlink, reopen, or start another chat;
   - a task-reference prefix in the session **title** as a human convention, never as the authoritative binding.

## User Stories / Scenarios

1. A user hovers a session in the left list, selects Rename, edits inline, and saves with Enter or cancels with Escape.
2. An agent calls `manage_sessions` to search its authorized session set, rename its current session, or delete a different session after explicit confirmation.
3. A user runs Boring UI locally and sees the same sessions and names as standalone Pi in the same workspace.
4. A user opens chat from a task for the first time. Tasks creates a normally shaped native Pi session, prefixes its display title with the task reference, records an explicit binding, and opens the chat.
5. A user returns to the task and sees linked sessions, can reopen one, or starts and links another.
6. While an agent is executing in any linked session, the task card visibly shows that an agent is working on the task, even when that chat pane is closed.
7. A user creates a session outside Boring UI with standalone Pi, then manually links that existing session to a task. No special session ID is required.
8. Hosted deployments persist bindings independently of an ephemeral sandbox lifecycle.

## Decisions

### Shared session mechanism

- Extend `SessionStore` with an authorized rename operation; preserve the existing scoped `SessionCtx` on every operation.
- Put validation, authorization, native persistence, and stable error mapping in one server-side session application service.
- HTTP routes and `manage_sessions` call that service directly. The tool must not make loopback HTTP requests.
- Browser code uses the HTTP transport. Agent code uses the same service in-process.
- `exec_ui` is not used for persistence; it remains a UI-effect capability.

### Agent tool

Expose one compact tool rather than three tools:

```ts
manage_sessions({ action: "search", query?: string, limit?: number })
manage_sessions({ action: "rename", sessionId?: string, title: string })
manage_sessions({ action: "delete", sessionId: string, confirm: true })
```

- Rename defaults to `ToolExecContext.sessionId` when `sessionId` is omitted.
- Search returns compact summaries only and is capped.
- Delete requires an explicit ID and confirmation.
- The currently executing session cannot delete itself; doing so would tear down the run executing the tool.
- Every explicit ID is authorized against `workspaceId` and `userId` before mutation.

### Native Pi sharing in local mode

- Keep CLI mode un-namespaced so Boring UI and standalone Pi use the exact same Pi directory derived from the workspace path.
- Persist rename as Pi's native latest `session_info` entry, not Boring-only metadata.
- If a Boring wrapper references a linked native Pi transcript, write the rename to the effective native transcript that Pi reads.
- Use append-only JSONL writes; never rewrite a live transcript for rename.
- Pi-originated `/name` changes become visible to Boring after list refresh/cache invalidation. Boring-originated names become visible to standalone Pi after it reloads/reopens the session.
- Existing delete behavior remains authoritative over the same effective transcript; tests must pin wrapper/link behavior.

### Task binding identity

The binding is explicit and authoritative:

```ts
interface TaskSessionBinding {
  id: string
  workspaceId: string
  adapterId: string
  taskId: string
  sessionId: string
  createdAt: string
  createdBy?: string
}
```

- Task identity is `(workspaceId, adapterId, taskId)`, because adapter task IDs are not globally consistent.
- A task may have multiple linked sessions.
- Session IDs remain ordinary Pi-native IDs. Do not encode task identity into a session ID and do not infer bindings by parsing IDs or titles.
- Display-title convention: newly task-created sessions start with a task display reference, for example `#594 · Unified session management`. The normalized task model must expose an optional `displayRef`; adapters set it from their native human key (`#<issue number>`, `TASK-123`, etc.). If absent, fall back to the adapter-scoped `taskId`. This improves search and standalone Pi readability but is not referential data.
- Existing standalone Pi sessions can be linked manually by selecting/searching their normal session ID.

### Task binding persistence

Define a store interface in the Tasks server package and inject the implementation:

```ts
interface TaskSessionBindingStore {
  list(ctx, key: { adapterId: string; taskId: string }): Promise<TaskSessionBinding[]>
  link(ctx, input: { adapterId: string; taskId: string; sessionId: string }): Promise<TaskSessionBinding>
  unlink(ctx, bindingId: string): Promise<void>
}
```

Binding invariants:

- `(workspaceId, adapterId, taskId, sessionId)` is unique.
- `link` is idempotent: linking an existing tuple returns the existing binding instead of creating a duplicate.
- File and Postgres adapters must serialize concurrent write operations so concurrent link/unlink calls cannot lose unrelated records. The file adapter should use an in-process per-store write queue plus atomic temp-file rename; Postgres should use a unique index and transaction/upsert semantics.
- The Tasks route/service must authorize the `sessionId` through the shared session service before persisting a binding. Unauthorized or missing session IDs use the same stable not-found/forbidden policy as session routes and must not create dangling bindings at link time.
- Store-conformance tests must cover idempotent link, unique count, concurrent links, concurrent link+unlink, and route-level authorization failure.

- **CLI adapter:** atomic JSON file under the local workspace app-data tree, initially `.pi/tasks/session-bindings.json`, following the proven first-party automation file-store pattern.
- **Hosted adapter:** a core-owned Postgres implementation injected by the hosted app composition. It is keyed by workspace and never stored only inside an ephemeral sandbox filesystem.
- The Tasks plugin remains DB-neutral and imports no core database implementation.
- Both adapters must pass one store-conformance suite.
- A missing/deleted session leaves a dangling binding initially; the UI marks it unavailable and offers Unlink. Cross-domain cascade deletion is out of scope for the first slice.

### Live task activity

Spike result: see [`session-status-spike.md`](./session-status-spike.md). Project-wide session inventory is feasible through the existing authorized native Pi session store. Project-wide status is feasible for Boring-owned live sessions and persisted idle sessions. Boring UI cannot currently know that a standalone Pi process is actively working on a shared local session; those sessions can be listed and linked, but their active status is `idle` with `source: 'persisted'` until a future native Pi heartbeat/status integration exists.

- Activity is derived from the authoritative project session runtime/read model; it is not persisted in `TaskSessionBindingStore`.
- Target behavior: Boring UI lists all authorized native Pi sessions for the project/workspace and exposes a status read model for those sessions, whether or not a chat pane is currently mounted.
- A task is `working` when at least one authorized linked **Boring-owned live runtime** session is executing, retrying, or actively consuming a queued continuation. Merely having an open chat pane does not make a task active.
- A queued follow-up that is waiting but not being consumed is `queued`, not `working`. The TaskCard may show a queued badge, but it must not roll queued into the working count until the runtime transitions to streaming/retrying for that continuation.
- Persisted sessions with no Boring live runtime channel are deterministically `idle` with `source: 'persisted'` and must not be shown as actively working solely because their transcript exists. Standalone Pi live-working detection is out of scope for the first implementation.
- Add a scoped bulk session-activity read seam so Tasks does not issue one state request per binding. The response maps requested session IDs to a small stable state such as `idle | queued | working | error`, includes a source such as `live-runtime | persisted`, and omits unauthorized sessions.
- Hosted multi-instance correctness requires the activity request to reach the runtime that owns the live session, or a later shared runtime-status registry. First implementation must either document/enforce session affinity for this endpoint or return persisted `idle` when the owning runtime is not local; do not silently claim cross-instance live status.
- The task panel may subscribe to the existing browser session-status signal for immediate updates from mounted chats, but that event is only an optimization. It is not the authoritative source because it misses unmounted project sessions.
- While the Tasks panel is open, refresh bulk activity on a bounded interval and immediately after binding/opening actions. Do not persist polling results.
- Task cards show a concise `working` badge/spinner. If multiple linked sessions are active, show the active count. Selecting the indicator opens the active linked chat when unambiguous or the linked-session chooser otherwise.

### Task-card session disclosure

Display associated sessions as an inline disclosure that expands directly below the task card's normal summary content. Do not use a detached popover as the primary interaction.

Collapsed card:

- Keep the existing task title/status content unchanged.
- Show a compact session control in the card footer: chat icon plus `1 session`, `2 sessions`, etc.
- When any linked session is active, replace or lead the count with a visible `working` badge and pulse; use `2 working` when multiple linked sessions are active.
- The control is a real button with `aria-expanded`; it must not trigger card drag/drop or task navigation.

Expanded card:

```txt
┌──────────────────────────────────────┐
│ #594  Unified session management     │
│ enhancement · ready-for-agent        │
├──────────────────────────────────────┤
│ Sessions                         2   │
│ ● Working  Session management    now │
│ ○ Idle     Initial investigation  2h │
│                                      │
│ + New chat          Link existing…   │
└──────────────────────────────────────┘
```

- Render active sessions first, then remaining sessions by most recently updated.
- Each row shows activity state, session title, and relative update time.
- Selecting a row opens that session through the existing detached-chat shell capability.
- Row actions available on hover/focus: Open and Unlink. Unlink removes only the task binding and never deletes the session.
- A missing/deleted target renders `Session unavailable` with an Unlink action.
- Footer actions:
  - `New chat` creates a normally shaped Pi session with the task-reference title prefix, records the binding, and opens it.
  - `Link existing…` opens a searchable session picker backed by the shared session search endpoint and records the selected binding.
- Show a short inline skeleton while bindings/activity load and an inline retry state on failure; do not blank or collapse the task itself.
- Expansion state is presentation-only and is not written to the binding store. Multiple cards may be expanded; avoid introducing global accordion state unless real usability proof requires it.
- In narrow Kanban columns, rows truncate titles while preserving status and actions. The disclosure grows the card vertically inside the existing column scroll region; it must not create a nested scroll area.

Keyboard/accessibility:

- Toggle with Enter/Space; Escape from within the disclosure returns focus to the toggle and collapses it.
- Session rows and actions are keyboard reachable with visible focus.
- Working state is conveyed by text as well as color/animation, and animation respects reduced-motion preferences.

### Task plugin routes

Use exact POST-body routes, matching runtime-plugin route constraints:

```txt
POST /api/boring-tasks/sessions/list
POST /api/boring-tasks/sessions/link
POST /api/boring-tasks/sessions/unlink
```

All requests derive workspace/user context from the authenticated host request. Caller-provided workspace identity is not trusted.

## Flag / Abstraction

- **Needed?:** Yes. Two abstractions are required: the existing `SessionStore`/session service seam, and `TaskSessionBindingStore` with CLI/hosted adapters.
- **Path:** additive interfaces and routes; no migration of session transcript ownership.
- **Rollback:** remove UI/tool exposure while retaining backward-compatible session JSONL and binding records. Binding storage can be left unread without affecting chat sessions or tasks.

## Test Seams

- **Highest public seam:** authenticated session HTTP routes, agent tool execution, Tasks plugin routes, and user-visible SessionBrowser/TaskCard interactions.
- **Existing prior art:** `PiSessionStore`, pi-chat route tests, `usePiSessions`, `SessionBrowser`, and `plugins/boring-automation` store conformance/file persistence.
- **Avoid testing:** private helper implementation details or exact JSON formatting beyond Pi-native entry compatibility.

Required coverage:

1. `PiSessionStore.rename`: authorization, direct transcript, linked transcript, latest-title semantics, concurrent append safety, cache refresh.
2. Session HTTP rename/search: validation, scoping, 404, stable error shape.
3. `usePiSessions.rename`: optimistic/confirmed state, rollback/refresh on error.
4. SessionBrowser inline rename: pointer and keyboard behavior, propagation, accessibility.
5. `manage_sessions`: compact search, current-session rename default, arbitrary-ID authorization, confirmed delete, self-delete rejection.
6. Binding store conformance shared by file and hosted adapters.
7. Tasks routes: body validation and authenticated workspace scoping.
8. Bulk session activity: authorization, working/idle transitions, closed-pane activity, compact bounded response.
9. Task UI: collapsed count/working control, accessible inline disclosure, first-chat create+link, reopen, multiple links ordered by activity/recency, manual link, dangling link/unlink, immediate and polled working indicators.
10. Local integration: a native Pi `session_info` written from either side is read by the other.

## Acceptance

- Users can rename sessions inline from the left session list.
- Agents receive one `manage_sessions` tool supporting search, rename, and guarded delete.
- UI and tool transports share validation, authorization, persistence, and error behavior through one service.
- Local Boring UI and standalone Pi continue to share session IDs, transcripts, titles, and deletion visibility.
- Tasks explicitly persist one-to-many task↔session bindings.
- A task card shows a compact session count/working control and expands downward into an accessible inline list of linked sessions with Open, Unlink, New chat, and Link existing actions.
- The card shows when one or more linked sessions have an agent actively working, including for closed chat panes; live activity is never persisted as binding state.
- New task chats use a task-reference title prefix without relying on it as identity.
- CLI bindings survive process restart.
- Hosted bindings survive host restart and sandbox replacement.
- Existing externally created Pi sessions can be manually linked.

## Proof

Exact commands per slice:

```bash
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-tasks typecheck
pnpm --filter @hachej/boring-tasks test
pnpm lint:invariants
```

Visual proof:

- Record inline rename in the left session list.
- Record a task reopening a linked chat and starting a second linked chat.

Manual local interoperability:

1. Open the same workspace in Boring UI and standalone Pi.
2. Rename in Boring UI; reload/reopen in Pi and verify the title.
3. Run Pi `/name`; refresh Boring and verify the title.
4. Create a standalone Pi session, manually link it from Tasks, and reopen it from the task card.

Hosted proof:

1. Create a task binding.
2. Restart the host and replace/reprovision the sandbox.
3. Verify the binding and linked session remain discoverable.

## Slices

### Spike: Project-wide Pi session inventory and status read model

**Delivers:** completed in [`session-status-spike.md`](./session-status-spike.md).

**Result:** Boring can list all authorized native Pi sessions via the existing session store. Bulk status should be implemented from the server runtime without cold-instantiating Pi sessions. Boring-owned live sessions can report `working`; persisted-only sessions can report `idle`/`unknown`; standalone Pi live work is not knowable today.

**Review budget:** complete; findings feed Slice 2 and Slice 3.

### Slice 1: Shared session rename

**Delivers:** native `SessionStore.rename`, shared service method, authenticated HTTP route, `usePiSessions.rename`, inline left-list rename.

**Blocked by:** None.

**Proof:** agent/workspace tests plus visual rename recording and local Pi interoperability.

**Review budget:** inside.

### Slice 2: Compact agent session management and activity read model

**Delivers:** shared service search semantics, one `manage_sessions` tool for search/rename/guarded delete, and a scoped bulk session-activity read seam informed by the project-wide session-status spike.

**Blocked by:** Slice 1 shared rename service.

**Proof:** tool contract/authorization tests and existing route tests.

**Review budget:** inside.

### Slice 3: Task binding contract and CLI vertical slice

**Delivers:** binding model/store contract, file adapter, routes, TaskCard create+link/reopen/multiple/unlink flow, task-reference title convention, manual link of an existing session, and live working indicators backed by immediate browser events plus the bulk activity read seam.

**Blocked by:** Slice 1 for title rename and Slice 2 for authoritative working indicators; binding CRUD can otherwise be developed independently.

**Proof:** store conformance, routes/UI tests, CLI restart and standalone-Pi manual-link recording.

**Review budget:** inside if kept separate from hosted persistence.

### Slice 4: Hosted Postgres binding adapter

**Delivers:** core-owned Postgres store implementation, hosted app composition injection, and hosted restart/sandbox-replacement proof.

**Blocked by:** Slice 3 contract.

**Proof:** adapter conformance plus hosted integration/restart evidence.

**Review budget:** inside after the persistence target is fixed.

## Published Implementation Tickets

Work the frontier: begin with #609. Each ticket is labelled `ready-for-agent`; dependencies are recorded in its body.

1. [#609 Shared native session rename](https://github.com/hachej/boring-ui/issues/609) — no blocker.
2. [#610 Agent session management](https://github.com/hachej/boring-ui/issues/610) — blocked by #609.
3. [#611 Project-wide session activity read model](https://github.com/hachej/boring-ui/issues/611) — blocked by #609.
4. [#612 CLI task session bindings and inline task-card sessions](https://github.com/hachej/boring-ui/issues/612) — blocked by #610.
5. [#613 Task active-agent indicators](https://github.com/hachej/boring-ui/issues/613) — blocked by #611 and #612.
6. [#614 Hosted Postgres task-session bindings](https://github.com/hachej/boring-ui/issues/614) — blocked by #612.

Ticket thermo review: [`tickets-thermo-review-terra.md`](./tickets-thermo-review-terra.md); green rerun: [`tickets-thermo-review-terra-rerun-1.md`](./tickets-thermo-review-terra-rerun-1.md).

## Out of Scope

- Encoding task identity into session IDs.
- Inferring authoritative bindings from title prefixes.
- Cross-workspace session search.
- Automatic binding cleanup when a task or session disappears.
- Renaming/deleting sessions through `exec_ui`.
- Moving session transcripts into the hosted relational database.

## Open Questions

None blocking. Slice 3 must add optional `displayRef` to the normalized task model and adapter fallbacks before using task-reference session titles.

## Plan State

`ready-for-agent`. Hosted bindings use Postgres. Agent deletion uses the compact `confirm: true` guard and rejects deletion of the currently executing session; no separate human-confirmation receipt is required. Sol final review findings were accepted and folded into this plan.

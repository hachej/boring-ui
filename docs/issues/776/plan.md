---
github: https://github.com/hachej/boring-ui/issues/776
issue: 776
state: ready-for-agent
updated: 2026-07-17
flag: not-needed
---

# gh-776 Task ↔ Native Pi Session Binding

## Problem

A task can launch multiple chats, but today it cannot reliably show or reopen the native Pi sessions that already performed work. That creates duplicate chats and hides provenance. Inbox questions and artifact reviews also need a deliberate route back to the producing session, without making chat the primary control surface.

## Solution

`plugins/tasks` owns an explicit, workspace-scoped one-to-many binding:

```ts
{ adapterId, taskId } -> nativePiSessionId[]
```

The binding is created only when the task UI successfully materializes a native Pi session. It is opaque: no title, hash, or session-id convention is used to infer a link.

Task rows render a collapsed session disclosure. An authorized linked session can be opened in the existing detached chat popover or the full chat surface, but neither action creates a session. The same popover opener becomes the shared consumer for Inbox/work-queue provenance: an Inbox item with an authorized producing `sessionId` may render an explicit **Open chat** action. Nothing auto-opens a pane.

## Decisions

- **Owner:** `plugins/tasks` owns task-session links at `.pi/tasks/session-links.json`; no core-agent metadata and no cross-plugin store.
- **Cardinality:** a task has many sessions; a session can be linked only by explicit task UI flow in this slice.
- **Creation:** `New chat` is browser memory only until the first successful native persistence. The returned native Pi id is idempotently linked before assistant success; an unsent closed chat creates neither session nor link.
- **Authorization:** link creation validates the native session through trusted workspace/principal context. Unlink validates the binding by trusted workspace/principal and binding id without loading the transcript, so a missing session can be removed without existence disclosure.
- **Availability:** missing/unauthorized linked sessions render unavailable + unlink; browser activity lookups omit denied ids and return bounded `omittedSessionIds`.
- **Chat is secondary:** task, Inbox, and artifact review remain control surfaces. The popover is an explicit provenance/debug/feedback route.
- **Artifacts:** task `artifactPathTemplate` remains configuration for the task folder. Multiple review artifacts, runs, and Inbox records belong to #786's work-queue model. `ask_user.artifact` remains one optional focused decision target, not an artifact collection.

## Dependencies

- **#775:** native Pi session materialization and rename must return the native session id at first persistence.
- **#782:** reuse its request-scoped first-party-plugin composition pattern once it is green/merged; do not depend on its currently failing branch.
- **#786:** consumes this explicit binding for work-run/artifact/Inbox provenance. It must not build another task-session store.

## Storage and API

```ts
type BoringTaskSessionLink = {
  id: string
  adapterId: string
  taskId: string
  sessionId: string
  createdAt: string
}
```

- `FileTaskSessionLinkStore` is rooted at `.pi/tasks/session-links.json` through the Workspace adapter.
- It serializes process-local read-modify-write and uses temp-file + atomic rename.
- Routes use exact POST bodies:
  - `sessions/list { adapterId, taskId }`
  - `sessions/link { adapterId, taskId, sessionId }`
  - `sessions/unlink { linkId }`
- Stable errors distinguish validation, forbidden, and missing states without disclosing unauthorized transcript existence.

## UI

- TaskCard displays a session count and disclosure sorted by native transcript latest-message time descending.
- Rows show relative time with accessible full local timestamp and status priority `Working > Queued > Error > Idle`.
- Actions: **Open popover**, **Open full chat**, **Unlink**.
- Task folder icon resolves the validated workspace-relative `plugins.tasks.artifactPathTemplate`. If missing, it asks for explicit confirmation before creating and opening the directory.
- Inbox/work-queue consumes the popover action only when it already carries an authorized `sessionId`; it does not create or infer a binding.

## Test Seams

- Store CRUD, atomic recovery, serialized concurrent writes, and adapter/task isolation.
- Route validation, authorization, missing-session unlink, and stable error codes.
- TaskCard: no-link creates/links one native session; existing links reopen without creation; ordering, status, unavailable, and unlink rendering.
- Session materialization handoff: link happens once at first persistence, not after an assistant reply.
- Inbox consumer: explicit Open chat opens the exact linked popover; absent/unauthorized ids do not render an opener or create a session.

## Acceptance

1. A task can retain and list multiple native Pi sessions.
2. Reopening an existing row opens the exact session in a popover; full-chat opens the same id.
3. Starting a task chat creates exactly one link at first native persistence; unsent chats create none.
4. Links never depend on session titles or generated id formats.
5. Missing/unauthorized sessions do not leak transcript existence and can be safely unlinked.
6. A linked Inbox/work-queue item offers explicit Open chat; it never auto-opens chat/Questions and never creates a session.
7. Task artifact folders and work-queue multi-artifact review stay separate from the binding store.

## Proof

- `pnpm --filter @hachej/boring-tasks typecheck`
- `pnpm --filter @hachej/boring-tasks test`
- `pnpm --filter @hachej/boring-tasks build`
- Focused integration test: native session creation → link → reopen popover → answer an Inbox item → explicit Open chat shows the same session.
- Manual: configure an artifact-path template; confirm missing-folder creation is explicit; verify folder opens after confirmation.

## Slices

### Slice 1 — Binding store, routes, and creation handoff
**Delivers:** opaque link contract/store/routes and idempotent link at first native persistence.
**Blocked by:** #775.
**Proof:** store/route tests plus creation-handoff integration test.
**Review budget:** inside.

### Slice 2 — TaskCard session disclosure
**Delivers:** list/order/status/popover/full-chat/unlink UI and artifact-folder affordance.
**Blocked by:** Slice 1.
**Proof:** component tests and manual task-card flow.
**Review budget:** inside.

### Slice 3 — Inbox/work-queue provenance consumer
**Delivers:** explicit, authorized Open chat action for records already carrying a session id.
**Blocked by:** Slice 2 and #786's record projection.
**Proof:** Inbox action test proves no auto-open/new session.
**Review budget:** inside.

## Out of Scope

Manual search/link-existing sessions, task activity rollups, board-wide polling, hosted Postgres storage, automatic artifact-folder creation, full artifact review workflow, and automatic GitHub/BR synchronization.

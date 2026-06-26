# 01 — No-Boot Session List + Lazy Project Fetch

## Purpose

Make project/session browsing cheap and bounded before any persistent shell or mounted workspace cache work.

This plan fixes the low-level data contract that multi-project navigation relies on:

- session list route must not provision a runtime/sandbox;
- route must support pagination;
- front-end must not fetch every workspace's sessions eagerly;
- expanding/browsing projects must not mount target workspace UI or boot runtime.

## Current problems

1. `/api/v1/agent/pi-chat/session-list` exists, but the current route does not parse `limit`/`offset` and just calls `store.list({ workspaceId })`.
2. The current `CoreWorkspaceAgentFront` multi-project code runs one `useQueries` entry per accessible workspace. This is no-boot, but still unbounded and not lazy.
3. The active workspace's no-boot list may be fetched redundantly even though active sessions are already live.
4. There is no happy-path test proving the no-boot route avoids runtime binding/provisioning.

## Desired behavior

### Backend route

`GET /api/v1/agent/pi-chat/session-list`

Query:

- `limit?: number` — clamp to a safe max, e.g. 50.
- `offset?: number` — default 0.

Behavior:

- Resolves session store via `getSessionStoreForRequest`.
- Does **not** call `getBindingForRequest`, `getOrCreateRuntimeBinding`, or any sandbox provisioning path.
- Returns the same bare array shape as existing Pi session list consumers expect.
- Preserves stable error envelope `{ error: { code, message } }` and status mapping already added in #385.

### Front-end project session fetching

- Maintain a per-project session snapshot cache keyed by `projectId`.
- Fetch sessions only when:
  - project is expanded, or
  - project has pinned rows that need metadata, if cross-project pinned sessions are in scope later.
- Do not fetch inactive project sessions on initial mount just because the workspace exists.
- Skip no-boot snapshot fetch for the active project when live active sessions are available.
- Cache at most the last 12 expanded projects' session snapshots.
- Implement `Show more` using `offset = currentRows.length` and `limit`.

## Suggested code locations

Backend:

- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/agent/src/server/__tests__/registerAgentRoutes.test.ts`

Frontend:

- `packages/core/src/app/front/CoreWorkspaceAgentFront.tsx`
- optionally extract helper/hook near core app front, e.g. `useProjectSessionSnapshots.ts`, if this keeps `CoreWorkspaceAgentFront` readable.
- `packages/workspace/src/front/layout/plugin-tabs/AppLeftPane.tsx` only if it needs to expose expanded project ids / show-more callbacks.
- `packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx`
- `packages/core/src/app/front/__tests__/CoreWorkspaceAgentFront.test.tsx`

## Implementation sketch

### Backend pagination

```ts
const rawLimit = Number((request.query as Record<string, unknown>).limit)
const rawOffset = Number((request.query as Record<string, unknown>).offset)
const limit = Number.isFinite(rawLimit) ? clamp(rawLimit, 1, 50) : 20
const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0
const sessions = await store.list({ workspaceId }, { limit, offset })
```

Use a small local clamp helper unless a canonical one already exists in the package.

### No-provision test

Create a request-scoped app where runtime provisioning would throw or increment a counter if called. Call `/api/v1/agent/pi-chat/session-list` and assert:

- response is 200 with expected sessions;
- runtime binding/provisioning counter is 0.

Prefer a test that uses a real temporary `PiSessionStore` if feasible; otherwise use a minimal host session root and known files.

### Lazy front-end fetch

The app-left project tree must notify core when a project expands:

```ts
type AppLeftPaneProjectExpandChange = {
  projectId: string
  expanded: boolean
}
```

Core can then maintain:

```ts
type ProjectSessionSnapshot = {
  rows: NoBootSessionSummary[]
  loading: boolean
  error?: string
  hasMore: boolean
}
```

Do not put `usePiSessions` in a loop. Use no-boot fetcher only.

## Tests / acceptance

- Backend:
  - no-boot session-list happy path returns sessions without provisioning runtime/sandbox;
  - `limit` and `offset` are passed to `PiSessionStore.list` / reflected in returned sessions;
  - invalid `limit`/`offset` clamp safely;
  - existing 403/stable error tests still pass.

- Frontend:
  - initial multi-project render does not fetch session snapshots for all projects;
  - expanding project B fetches only B's no-boot session list;
  - expanding more than 12 projects evicts oldest snapshot cache entries;
  - active project uses live session rows, not redundant no-boot fetch;
  - Show more calls route with expected offset;
  - expanding/browsing does not call `navigate`, does not mount target workspace content, and does not trigger runtime preboot.

## Out of scope

- Persistent shell / mounted workspace cache.
- Runtime preboot.
- Provider store isolation.
- Cross-project split behavior except ensuring browse does not open/mount.

## Risks

- Exposing expanded-project state from `AppLeftPane` can tangle UI and data fetching if done ad hoc. Keep a narrow callback (`onProjectExpandedChange`) and let core own the data cache.
- If session-list route returns a bare array, `hasMore` is inferred by `rows.length === limit`; that is acceptable for now but should be documented.


## Thermo review fixes

- `PiSessionStore.list` / `SessionStore.list` pagination is passed as the **second** argument, not mixed into the context object. The backend route must call:

```ts
store.list({ workspaceId }, { limit, offset })
```

- Tests should fail if pagination is silently ignored. Use a fixture with at least three sessions and assert `limit=1&offset=1` returns exactly the expected middle row.

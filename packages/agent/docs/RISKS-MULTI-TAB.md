# Multi-Tab Concurrency Risk

## Scope

This note documents current `@hachej/boring-agent` behavior when two browser tabs
point at the same workspace and edit the same file.

## Observed Behavior (v1)

- There is no workspace-level lock and no per-file lock.
- `POST /api/v1/files` performs an unconditional write.
- There is no optimistic concurrency precondition (no ETag/version check,
  no `If-Match` handling).
- Result: writes are silent last-write-wins. A stale tab can overwrite a newer
  edit without a conflict response.

This is visible in route code:
- [file.ts](../src/server/http/routes/file.ts) calls `workspace.writeFile(...)`
  directly.
- [createNodeWorkspace.ts](../../boring-sandbox/src/providers/node-workspace/createNodeWorkspace.ts)
  calls Node `writeFile(...)` without revision guards.

Behavior is exercised by:
- [file.test.ts](../src/server/http/routes/__tests__/file.test.ts)
  `multi-tab stale write overwrites newer content (last write wins)`.

## Session Semantics

- Tabs are not treated as exclusive owners of a workspace.
- Session identity is driven by `sessionId`; multiple tabs can operate against
  the same workspace concurrently.

## Known User Impact

- Lost-update risk for simultaneous edits on the same path.
- No explicit error or merge prompt when overwrite happens.

## Future Mitigation Seam

Introduce optimistic write preconditions:

1. `GET /api/v1/files` returns a version token (for example ETag/content hash +
   mtime).
2. `POST /api/v1/files` accepts `If-Match` and rejects mismatched versions with
   `409 Conflict`.
3. Frontend handles `409` with refresh/retry UX instead of silent overwrite.

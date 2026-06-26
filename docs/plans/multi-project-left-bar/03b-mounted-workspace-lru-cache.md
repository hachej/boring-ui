# 03b — Mounted Workspace LRU Cache

## Purpose

Extend the persistent shell from 03a so recently used workspace UIs can stay mounted and switching back is fast.

Depends on:

- 02 — provider-scoped workspace store;
- 03a — persistent shell/no-takeover seam;
- minimum visibility prop plumbing from 05a if multiple providers mount concurrently.

## Review budget

Target non-test/non-doc added LOC: **< 2,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Implement `MountedWorkspaceEntry` cache.
- Default max mounted workspaces: 3 (`current + two recent`).
- LRU eviction by successful visibility.
- Active/visible workspace never evicted.
- Expanding/browsing projects never creates a mounted entry.
- On logout/auth loss/app switch, clear cache.
- Cached workspace can become visible without full remount.

## Non-scope

- Runtime preboot (04c).
- UI command target schema (05b).
- Full stream/side-effect audit (05c/05d), except enough `visible` plumbing to prevent obvious duplicate foreground ownership.

## Data model

```ts
const MAX_MOUNTED_WORKSPACES = 3

type MountedWorkspaceEntry = {
  workspaceId: string
  workspace: Workspace
  lastVisibleAt: number
  status: 'visible' | 'hidden' | 'opening' | 'error'
}
```

## Tests / acceptance

- Mount A, open B, open C: cache has A/B/C.
- Open D: least-recent hidden entry evicted; visible entry retained.
- Switching back to cached A does not remount A (mount counter/probe).
- Expanding project B in nav does not add B to mounted cache.
- Single-project mode does not instantiate cache.
- Logout/auth loss clears all mounted entries.
- Tenant/app switch or session identity change clears all mounted entries.
- Hidden cached entries receive `visible={false}` and active entry receives `visible={true}`. If the visibility prop/gates are not available, cache must stay disabled behind an internal guard.
- Request/auth headers and storage scope for each mounted host use that entry's `workspaceId`, not the current route target by accident.

## Risks

- This PR must not silently multiply global side effects. If full gating is not landed, keep cache behind an internal guard or include minimal visible gating.
- Avoid making cache size configurable unless a host needs it. Constant is enough.

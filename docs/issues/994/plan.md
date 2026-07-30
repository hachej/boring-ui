---
github: https://github.com/hachej/boring-ui/issues/994
issue: 994
state: ready-for-agent
updated: 2026-07-30
flag: not-needed
track: fast
---

# gh-994 Show terminal Pi sessions in CLI workspaces mode

## Problem

CLI workspaces mode intentionally shares terminal Pi's cwd-derived session
directory:

```text
~/.pi/agent/sessions/--<workspace-path>--/
```

That physical sharing works, but Boring's session-context filter hides legacy
terminal Pi transcripts because their headers have no `boringSessionCtx`.
Partially scoped historical Boring sessions can also differ only by a missing
trusted-local user id.

On the affected host the shared directory still contains the transcripts; the
legacy and addressed APIs expose different subsets. No files were deleted.

## Solution

Keep CLI workspaces mode path-derived:

```ts
getSessionNamespace: async () => undefined
```

Treat the cwd-derived directory itself as the legacy ownership boundary:

- in a default path-derived `PiSessionStore`, allow unscoped terminal Pi
  transcripts for the selected workspace context;
- allow a same-workspace historical header when one side lacks the local user
  id;
- continue rejecting an explicitly different workspace id or explicitly
  different user id;
- keep explicit `sessionDir` and namespaced stores strict.

This preserves terminal Pi sharing and changes no transcript bytes.

## Decisions

1. **Compatibility is limited by storage layout.** Only stores whose directory
   is derived from the workspace cwd receive path-local legacy compatibility.
   Explicit/shared/namespaced stores retain exact context matching.
2. **No migration.** Do not copy, move, rewrite, delete, or relabel sessions.
3. **No namespace change.** Workspaces mode continues sharing with terminal Pi.
4. **Explicit mismatches remain denied.** Missing legacy metadata is accepted;
   contradictory metadata is not.
5. **Path relocation is separate.** If a deployment actually changes the
   workspace path, terminal Pi itself selects another cwd-derived directory.
   Preserving both automatic terminal-Pi sharing and old-path continuity then
   needs an explicit operator mapping or migration; that is not this quick fix.

## Flag / Abstraction

- **Needed?:** No.
- **Path:** `PiSessionStore` records whether it selected the default path-derived
  directory and applies the narrow compatibility rule only in that case.
- **Rollback:** Revert the compatibility rule. Session files are untouched.

## Test Seams

- `PiSessionStore` unit test with unscoped, workspace-only, exact local,
  other-workspace, and other-user headers.
- CLI workspaces-mode public test through both:
  - `/api/v1/agent/pi-chat/sessions`
  - `/api/v1/agents/default/sessions`
- Existing strict explicit-directory test proves no generic isolation widening.

## Acceptance

1. CLI workspaces mode lists an unscoped terminal Pi session from the selected
   workspace's cwd-derived directory.
2. CLI workspaces mode lists same-workspace historical sessions with either a
   missing user id or `userId: "local"`.
3. Legacy and addressed APIs expose the same compatible session ids.
4. Sessions explicitly scoped to another workspace or another user remain
   hidden.
5. Explicit `sessionDir` and namespaced stores retain exact context isolation.
6. No transcript file is modified by list/load compatibility.
7. Folder mode and terminal Pi continue using the same cwd-derived directory.

## Proof

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts
pnpm --filter @hachej/boring-ui-cli exec vitest run \
  src/server/__tests__/modeApps.agentHost.test.ts
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-ui-cli typecheck
pnpm lint:invariants
```

Manual affected-host proof after installing the candidate:

1. Record file hashes and visible session ids.
2. Restart the CLI hub.
3. Confirm both APIs expose the same expected root session ids.
4. Confirm all pre-existing file hashes remain unchanged.

## Slice

### Slice: CLI path-local legacy compatibility

**Delivers:** The narrow store rule, Agent unit coverage, CLI public-route
coverage, and affected-host verification.

**Blocked by:** None.

**Proof:** Exact commands and host hash/id comparison above.

**Review budget:** Inside; expected to remain a small one-PR fix.

## Out of Scope

- Stable continuity after an actual workspace path move.
- Registry-id namespaces.
- Transcript migration or metadata rewriting.
- Multi-root stores.
- Weakening session isolation for core/multi-user or namespaced hosts.

# Agent session identity decision

Bead: `boring-ui-v2-reorg-a3bo`
Date: 2026-05-24

## Current flow

- The visible Boring chat/session id is the canonical id for UI state, session switching, composer blockers, follow-up queues, pending questions, and tool `ToolExecContext.sessionId`.
- The pi-backed harness keeps an in-memory `Map<visibleSessionId, PiSessionHandle>`.
- On first use, the harness creates or opens a pi `SessionManager` and persists its native JSONL path as a `pi_session_file` entry in the Boring session JSONL.
- On restart, `PiSessionStore.loadPiSessionFileSync(visibleSessionId)` reads the Boring session file and re-opens the stored pi file. If the pi file is gone/corrupt, the harness creates a new pi native session and writes a fresh mapping.
- `SessionStore.list/load/saveMessages/delete` remain harness-neutral; non-pi harnesses can ignore the pi mapping entry entirely.

## Decision

Keep the Boring visible session id as the canonical public session id.

Rationale:

- Workspace/plugin/front code already scopes composer blockers and future pending-question state by visible `sessionId`.
- Non-pi harness support depends on the generic `SessionStore` contract, not on pi-specific ids.
- Pi's native session/file id is an implementation detail needed only to reopen pi's file-backed session manager.
- Exposing pi ids into workspace/plugin code would couple non-pi runtimes to pi and break the package boundary.

## Migration behavior

Existing session files are supported in both naming forms:

- Boring-created direct file: `<sessionId>.jsonl`.
- Pi-style/migrated file: `<timestamp>_<sessionId>.jsonl`.

Both can contain a `pi_session_file` entry. `PiSessionStore.loadPiSessionFileSync()` and `loadPiSessionFile()` resolve either naming form and return the latest pi file path.

## Impact on ask-user / composer blockers

- Ask-user and pending-question scopes should continue to use visible Boring `sessionId`.
- Composer blockers remain scoped to the visible chat panel session id.
- Runtime token `agentSessionId` may carry audit context, but it is not an auth boundary and must not replace visible session scoping.

## Evidence command

```bash
rg -n "sessionId|piSession|agentSession" packages/agent packages/workspace
```

The search shows pi-specific `piSession` references are contained in the pi harness/docs/tests, while workspace/front surfaces use generic `sessionId`.

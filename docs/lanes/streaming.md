# Lane brief — chat streaming durability

Tracking issue: #1009 (authoritative). This file is the working brief; keep it in sync as the lane executes.

## Today (verified against `origin/main`, 2026-07-31)
Streaming is in-memory and per-process, and it works correctly at Conformance Level B:
- `PiChatReplayBuffer` (`packages/agent/src/server/pi-chat/piChatReplayBuffer.ts`) — bounded ring, default 1000 events, monotonic `seq`, subscribe-before-replay so nothing is lost in the handoff.
- NDJSON (not SSE) on both wires: legacy `/api/v1/agent/pi-chat/:sessionId/events?cursor=` and addressed `/api/v1/agents/:agentTypeId/sessions/:sessionId/events?cursor=`.
- Client (`front/chat/pi/remotePiSession.ts`, `piChatStream.ts`) hydrates `/state`, tracks cursor continuity, reconnects with jittered backoff.
- Reload mid-stream degrades cleanly: `PI_CHAT_REPLAY_GAP` / `PI_CHAT_CURSOR_AHEAD` → full rehydrate. **Never a silent gap.**

## Dormant
`SqliteEventStreamStore` (`packages/agent/src/server/events/eventStreamStore.ts`) is fully written — schema, idempotent append, offsets, subscribe. The *consumer* is written too: `HarnessPiChatService` accepts an optional `eventStore`, appends durably, resumes `seq` across restarts, and has a poison-on-failed-append policy. **Zero production instantiation** — it appears only in tests. The single production caller, `buildAgentComposition.ts:218-226`, builds the service without `eventStore`.

## Delta to durable (Level D)
1. Wire a `SqlStorage`/`SqliteEventStreamStore` into `buildAgentComposition` → `bridgeOptions.service.eventStore`; add DB path config, lifecycle/close, retention/pruning.
2. **Read path** — the gap that isn't just wiring. Both routes read exclusively from the in-memory buffer, so an old cursor rehydrates even if durable rows exist. `HarnessPiChatService.subscribe` and `EmbeddedAgentGateway.connectSession` must fall back to the store on a buffer miss.
3. Cross-process fan-out: `EventStreamStore.subscribe` is in-process listeners only.
4. Level D conformance suite; `closeStream`/compaction have no production caller.

## Blocker to resolve first
Stream keying omits agent identity: buffer key is `[sessionId, workspaceId, userId]`, stream path is `sessions/<sessionId>`. `agentTypeId` is in the URL but in neither key. **Not a live defect** — session ids are minted unique and cross-agent addressing is rejected (`AGENT_SESSION_NOT_FOUND`, `sessionIsolation.test.ts`) — but durable keying would bake the omission into persisted rows. Decide keying before writing any durable schema.

## Bookkeeping correction
Bead `wt-391-forward-0jpy.15` ("contract duplicate AgentLiveEventBuffer") has a wrong premise. There is one `AgentLiveEventBuffer` (`core/createAgent.ts:519`) with no consumers outside the agent package. The real duplication is two *replay sources*: that buffer vs `PiChatReplayBuffer`, which is what the HTTP routes actually use. Rewrite the bead before working it.

Refs #807, #391

## Status

Not started. This branch is the lane seed — a draft PR so the lane has a visible home before work begins.

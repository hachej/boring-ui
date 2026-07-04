# T1-durable-events — Plan

> Phase: Phase T1 — Event envelope and replay (after Phase 1) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the event-stream contract, human-in-the-loop, two-handles, and conformance sections; the locked Durable Streams wire-protocol decision this phase implements.

## Design context
Phase T1 adds a durable, offset-addressed event stream and on-stream approvals, starting after Phase 1 and running parallel to Phases 2–4. The locked implementation choice: adopt the **Durable Streams** wire protocol by adapting Flue's ~1000-LOC framework-agnostic `EventStreamStore` + read handlers (fixing the non-transactional append), embedded in `@hachej/boring-agent` behind a Fastify bridge, with `@durable-streams/client` on browser/channel consumers — no bespoke replay protocol. The `AgentEvent` envelope (`v`/`eventIndex`/`timestamp`/`sessionId`/`chunk`) wraps the existing harness `PiChatEvent` unit; monotonic `eventIndex` **is** the SQLite `seq` (one counter). **Two authorities, separate:** the SQLite `EventStreamStore` is the replay authority; the pi session JSONL stays the conversation-state authority for harness rehydration, and pending approval requests live in the event-stream SQLite DB. `agent.stream(sessionId,{startIndex})` gains durable replay-from-offset behind DS-compliant `GET`/`HEAD` routes. Approvals ride the stream: `needsApproval` on `AgentTool`, durable pending request + `waiting` state, `resolveInput()` — same-process resume continues the live parked turn; after a restart it resumes via a **new seeded harness turn** (tool-result injection on JSONL rehydration), never a rehydrated in-memory turn, no `WaitingTurn` machine. ask-user + permission prompts collapse onto this single path. The bespoke `piChatReplayBuffer.ts` + `?cursor=` NDJSON route stay live until the T2 cutover.

## Deliverables
- `AgentEvent` envelope (`v`, `eventIndex`, `timestamp`, `sessionId`, `chunk`) around the existing harness stream unit (`PiChatEvent`); monotonic index persisted in the append-only SQLite `EventStreamStore` (DS `seq`/offset). Supersedes the bespoke `PiChatReplayBuffer` + `?cursor=` NDJSON replay (kept live until T2 cutover).
- **Two authorities, separate:** the SQLite `EventStreamStore` is the **replay authority**; the pi session JSONL remains the **conversation-state authority** for harness rehydration (unchanged). Pending approval requests live in the event-stream SQLite DB, not the JSONL/session store.
- `agent.stream(sessionId, { startIndex })` (replay-from-offset + live tail — the read primitive from 08); HTTP adapter = DS-compliant `GET`/`HEAD` stream routes (catch-up from offset, SSE + long-poll).
- Approvals/HITL on-stream: `needsApproval` on `AgentTool`; approval/input-request events; `resolveInput()`. **Durable = the pending request + `session.waiting` state (event-store SQLite), not an in-memory turn.** Same-process resume continues the live parked turn; after a process restart, `resolveInput` continues the session via a **new harness turn seeded with the approval outcome** (tool-result injection on pi JSONL rehydration). Migrate permission prompts + ask-user plugin onto this path (no second approval channel).
- Harness conformance suite additions: envelope ordering, replay-from-index, durable pending-request survival across restart, same-process approval park/resume (extends #12 conformance).

## Exit criteria
- SSE drop + reconnect replays losslessly in the workspace; an approval issued in one client can be answered from another client holding the same session; after a process restart the pending request + `waiting` state survive and `resolveInput` continues the session via a new seeded turn (a parked turn does not resume from restored in-memory state).

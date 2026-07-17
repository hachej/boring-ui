> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# TODO-T1 — Durable event stream + on-stream approvals

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` — "Event stream contract", "Human-in-the-loop", "Two handles", "Conformance". The locked decision: adopt the **Durable Streams** wire protocol (github.com/durable-streams/durable-streams, ElectricSQL, MIT) — monotonic offsets, catch-up reads from arbitrary offset, SSE + long-poll, ETag caching, `Stream-Next-Offset`/`Stream-Up-To-Date` headers. Do **not** invent a replay protocol.
- Plan: `docs/issues/807/plan.md` — "Phase T1 — Event envelope and replay (after Phase 1)". Track T starts after Phase 1 and runs parallel to Phases 2–4.
- Reference impl to adapt (Apache-2.0, framework-agnostic WHATWG `Request→Response`, ~1000 LOC): Flue (github.com/withastro/flue) `packages/runtime/src/runtime/event-stream-store.ts` (388 LOC) + `packages/runtime/src/runtime/handle-stream-routes.ts` (594 LOC). A shallow clone should exist at the scratchpad path in the session (`.../scratchpad/flue`); if absent, re-clone and read both files in full before touching beads BBT1-001/003. The node:sqlite ↔ `SqlStorage` adapter and the transaction wrapper to reuse are in `packages/runtime/src/node/agent-execution-store.ts` (`createNodeSqlStorage`, `createNodeTransactionSync`, `openDatabase`).
- Client (browser + channel consumers): `@durable-streams/client` (deps `@microsoft/fetch-event-source` + `fastq`) — gives reconnection, backoff, offset checkpointing. Wiring the front onto it is **T2**, not here; T1 only ships the server + the durable in-process `stream(sessionId, { startIndex })` + envelope + approvals.

### Preflight checks before coding any bead

Run these before BBT1-001. If any P1 seam is absent, STOP and report the missing P1 deliverable; do not create a parallel façade or route shim.

```bash
test -f packages/agent/src/server/createAgent.ts
test -f packages/agent/src/shared/events.ts
node -e "import('node:sqlite').then(() => console.log('node:sqlite ok'))"
node -e "const p=require('./packages/agent/package.json'); for (const s of ['test','typecheck','lint:invariants','check:isolation']) if (!p.scripts?.[s]) throw new Error('missing agent script '+s)"
node -e "const p=require('./plugins/ask-user/package.json'); if (p.name !== '@hachej/boring-ask-user' || !p.scripts?.test) throw new Error('ask-user package/script mismatch')"
```

### Current boring code this replaces/extends (verified paths)

- `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts` — the **existing bespoke replay protocol**: in-memory `PiChatReplayBuffer` (default 1000 events, monotonic `seq`, `replay_gap`/`cursor_ahead` range errors). T1 replaces this with a durable, offset-addressed store. Keep it during migration as the live fan-out fast-path if useful, but persistence + replay authority moves to the new store. Every retained legacy replay-buffer path must carry `TODO(remove:BBT2-006)`.
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts` — `HarnessPiChatService`. The single funnel where every event is published is `publishChannelEvent(sessionId, channel, event)` (~L398–413), ending in `channel.buffer.publish(event)`. Live events originate from `buildChannel` (~L502–525): `adapter.subscribe(event => { mapper.map → messageMetadata.enrichEvent → publishChannelEvent })`. **This is the tap point** for appending to the durable stream. `subscribe()` (~L163) and `readState()` (~L122) are the read paths. The adapter callback is synchronous today; T1 must serialize the new async append path per channel so event order and append-before-fanout are preserved.
- `packages/agent/src/server/http/routes/piChat.ts` — Fastify routes. `GET /api/v1/agent/pi-chat/:sessionId/events?cursor=N` streams NDJSON frames via `PassThrough`; `subscribe(ctx, sessionId, cursor, writeFrame)` drives it; 409 `sendReplayRangeError` on gap. This route is the thing a DS-compliant `GET`/`HEAD` handler sits beside (do not delete it in T1; add the DS route in parallel and cut the front over in T2).
- `packages/agent/src/shared/chat/piChatEvent.ts` — `PiChatEvent` union, each variant carries `seq: number`. **The boring stream unit is `PiChatEvent`, not a raw AI-SDK `UIMessageChunk`.** 08's envelope defines `AgentEvent.chunk: PiChatEvent` (the mapped/enriched event already emitted today) — keep it exactly that way; do not re-plumb to raw pi chunks in T1.
- `packages/agent/src/shared/harness.ts` — `AgentHarness`, `SendMessageInput`, `RunContext`. The header comment currently near L65 ("Resume is NOT a harness concern … The HTTP route owns cursor buffering + replay; harness stays reconnect-unaware") must be **updated**: T1 introduces `agent.stream()` (replay-from-offset + live tail) as the in-process read primitive per 08. Add `stream` to the façade, not to `AgentHarness` (the harness stays reconnect-unaware; the store + service own replay).
- `packages/agent/src/shared/tool.ts` — `AgentTool` (`name`, `parameters`, `execute`, `readinessRequirements`). T1 adds `needsApproval`.
- Approvals today (the "second channel" to be collapsed): `plugins/ask-user/` — `src/server/createAskUserTool.ts` (tool `ask_user`, `execute` blocks on `runtime.ask()`), `src/server/askUserServerPlugin.ts` (registers tool + `workspaceBridgeHandlers` + `AskUserStatePublisher` pushing to the Questions pane), `src/server/askUserRuntime.ts`, `src/server/askUserStore.ts` (`FileAskUserStore` → `.boring/ask-user.json`), `src/shared/types.ts`. Answers arrive over the **WorkspaceBridge** (`ask-user.v1.*` handlers), NOT the chat stream. There is no `canUseTool`/permission-prompt code in `packages/agent` — pi tools run without a boring-side gate today; `needsApproval` introduces one.
- Session store today exposes only CRUD. BBT1-004 keeps that contract and adds
  `agent.sessions.pendingInputs(ctx, opts?)` as a façade read over authoritative
  `agent.db` rows under explicit trusted scope.

## Goal / exit criteria

Match `INDEX.md` Phase T1 exit criteria:

1. `AgentEvent` envelope persisted per session; every chunk appended to a durable, offset-addressed SQLite stream at the `publishChannelEvent` tap.
2. `agent.stream(sessionId, { startIndex })` (in-process read primitive: replay + live tail) + DS-compliant `GET`/`HEAD` stream routes (catch-up from offset, SSE + long-poll) behind a Fastify↔WHATWG bridge.
3. SSE drop + reconnect replays losslessly (proven by conformance test; front cutover is T2).
4. `needsApproval` on `AgentTool`; request event + pending/waiting state commit together in `agent.db`; `resolveInput(sessionId, requestId, response)` in-process + HTTP route.
5. **Restart model:** same-process resolution may continue the admitted waiter. Across restart, the pending request remains visible but the waiting turn expires/cancels unless a durable continuation journal is implemented later. A seeded new turn is optional recovery and must never be described as transparent resume.
6. ask-user + any permission prompts ride the single approval path — no second channel.
7. Harness conformance additions pass: envelope ordering/replay, transactional approval state, explicit restart recovery, and JSONL-before-event-append fault injection.

## Non-negotiables

- Adapt Flue's two files; do not hand-roll DS semantics. Preserve DS header/field names verbatim (`Stream-Next-Offset`, `Stream-Up-To-Date`, `Stream-Closed`, `Stream-Cursor`; SSE fields `streamNextOffset`/`streamCursor`/`streamClosed`/`upToDate`).
- **Fix the known append bug**: Flue's `appendEvent` runs two non-transactional statements (`UPDATE … RETURNING next_offset` then a separate `INSERT`). Wrap both in one transaction (reuse `createNodeTransactionSync` = `BEGIN`/`COMMIT`/`ROLLBACK`). Same for `closeStream`+notify ordering if you touch it. Delete Flue's "safe for single-process" comment.
- Storage = `node:sqlite` (`DatabaseSync`, available: Node v22.22, `PRAGMA journal_mode=WAL` for file DBs). No new native dep.
- Envelope payload stays `PiChatEvent` (see Context). Do not change the AI-SDK part union in T1 (plan decision 1 in 08).
- `createAgent()`/façade must stay Fastify-free (Phase 1 invariant, [`../P1-headless-core/TODO.md`](../../../../805/runtime-refactor/work/P1-headless-core/TODO.md)). The DS store + `stream(sessionId, { startIndex })` live in agent server core; only the DS route file imports Fastify.
- Two-handles rule (08): the public API remains keyed by runtime-owned `sessionId`; surfaces never mint it. The adapter resolves trusted tenant/workspace/agent context and the store derives a validated structured `SessionKey`. UUID uniqueness is not authorization. Surface-native addressing never reaches core/store signatures.
- **Locked route family:** new routes live under
  `/api/v1/agents/:agentId/...`; v1 accepts only the validated literal
  `default`. A1 local dev and D1 v1 deployments must bind `agentId:'default'`;
  a non-default id fails with `AGENT_ROUTE_UNSUPPORTED` until post-v1 P7 resolves
  the registry. The adapter combines trusted tenant/workspace context, `agentId`,
  and runtime-owned `sessionId` into `SessionKey`; event, pending, idempotency,
  and cache keys derive from that tuple. Public paths and façade still expose
  `sessionId`, but a public id alone cannot select a row. P7 adds richer routing
  without a path migration. Legacy pi-chat routes remain until BBT2-006.
- Migrate ask-user in place: keep the `ask_user` tool name, its form schema (`AskUserFormSchema`), and the Questions pane UX. Only the transport (bridge → on-stream request/response) changes.
- **One SQLite authority:** `agent.db` contains append-only stream tables, authoritative pending/waiting rows, idempotency receipts, and derived indexes. Any logical transition touching events plus pending state uses one transaction. Pi JSONL remains the conversation-state compatibility authority and must keep loading. Do not call authoritative pending/addressing state rebuildable without an implemented event fold.

## Do NOT

- Do NOT delete `piChatReplayBuffer.ts` or the `?cursor=` NDJSON route in T1 (T2 owns the front cutover; keep both live until then). Every retained legacy `?cursor=` / `PiChatReplayBuffer` path must carry `TODO(remove:BBT2-006)` until T2 deletes it; BBT2-006 is the named deletion owner allowed by [`../../../plan.md`](../../../../391/runtime-refactor/INDEX.md)'s cross-TODO cutover carve-out.
- Do NOT add a second persistence format for approvals — persist authoritative pending requests in `agent.db`, not a second database, JSON file, memory-only map, or Pi JSONL.
- Do NOT introduce `@durable-streams/server` or the Caddy sidecar — embed the adapted store (plan 08: sidecar is an alternative, not T1).
- Do NOT wire the browser client (`@durable-streams/client`) here — that is BBT2-002.
- Do NOT read env vars or discover `.pi/*` inside the store/façade.

## Beads

### BBT1-001 — Vendor + fix EventStreamStore into the repo  · size M
- **Title**: Adapt Flue `EventStreamStore` (transactional append, node:sqlite) into `packages/agent/src/server/events/`.
- **Location decision (recommend + justify)**: put it at `packages/agent/src/server/events/` **inside `@hachej/boring-agent`**, not a new `packages/event-streams`. Justification (one line): the store is agent-server-core with zero external consumers in T1/T2 and must not add a cross-package import cycle before Phase 2 extraction; promote to its own package only if/when a surface package needs it standalone (Track S).
- **Files to create**:
  - `packages/agent/src/server/events/sessionKey.ts` — internal trusted key:
    ```ts
    interface SessionKey {
      storageScopeId: string // opaque host-composed tenant or pure-host scope
      workspaceId?: string
      subjectId: string // immutable authenticated session owner/service principal
      agentId: string
      sessionId: string
    }
    ```
    The host adapter creates it once at admission. Encode components with a
    canonical length-prefixed/structured encoder, not delimiter joining or
    `JSON.stringify`; validate each component. It is never a public request
    type, and `workspaceId`/Host headers alone cannot create it. An authorized
    collaborator loads the existing canonical key after ACL validation; their
    per-request identity does not rewrite the session owner key.
  - `packages/agent/src/server/events/eventStreamStore.ts` — port Flue `event-stream-store.ts`: `EventStreamStore` interface, `SqliteEventStreamStore`, `formatOffset`/`parseOffset`, `EventStreamReadResult`/`EventStreamMeta`. Keep the `<readSeq>_<seq>` 16-digit offset format.
  - `packages/agent/src/server/events/sqlStorage.ts` — port `createNodeSqlStorage` + transaction/open helpers (WAL). Export `runTransaction`. Event and state accessors share one `agent.db` connection/transaction authority.
  - `packages/agent/src/server/events/schemaVersion.ts` — port `migrateFlueSqlSchema` (or inline a minimal version stamp table). Rename `flue_*` tables to `boring_event_streams` / `boring_event_stream_entries` / `boring_event_stream_keys`.
  - Include the caller-write receipt authority in the same schema:
    `boring_request_receipts(scope_key, request_id, payload_hash, session_id,
    start_index, status, created_at, UNIQUE(scope_key, request_id))`. The
    `scope_key` includes the authenticated caller/service subject plus trusted
    host admission scope, so two principals cannot collide and a new-session
    request is durable before a `sessionId` exists.
- **Implementation notes (the fix)**: Flue's `appendEvent` today:
  ```ts
  const updated = this.sql.exec(`UPDATE ... SET next_offset = next_offset + 1 ... RETURNING next_offset`, path).toArray()
  // ... crash window here ...
  this.sql.exec(`INSERT INTO ..._entries (path, seq, data) VALUES (?,?,?)`, path, offset, data)
  ```
  Replace with a single transaction; take `runTransaction` in the constructor:
  ```ts
  constructor(private sql: SqlStorage, private runTransaction: <T>(fn: () => T) => T) { ... }
  async appendEvent(path, event) {
    const data = JSON.stringify(event)         // serialize before mutating (keep Flue's ordering)
    return this.runTransaction(() => {
      const updated = this.sql.exec(`UPDATE boring_event_streams SET next_offset = next_offset + 1 WHERE path = ? AND closed = 0 RETURNING next_offset`, path).toArray()
      if (updated.length === 0) { /* existing not-found/closed branch */ }
      const offset = (updated[0].next_offset as number) - 1
      this.sql.exec(`INSERT INTO boring_event_stream_entries (path, seq, data) VALUES (?,?,?)`, path, offset, data)
      return formatOffset(offset)
    }).then(off => { this.notifyListeners(path); return off })  // notify AFTER commit
  }
  ```
  Keep `appendEventOnce` (idempotency key) — it already inserts atomically via trigger, but move the trigger-driven insert under the same transaction guarantees or keep the trigger (verify the ported trigger fires under node:sqlite).
  - **`appendAgentEvent(sessionKey, chunk)`** allocates the stream seq and
    envelope inside one transaction. `sessionKey.sessionId` remains the public
    envelope field; the encoded structured key selects the database stream.
  ```ts
  // add on SqliteEventStreamStore — NOT a pre-serialize-then-append path
  async appendAgentEvent(sessionKey: SessionKey, chunk: PiChatEvent, opts?: { idempotencyKey?: string }): Promise<string> {
    const path = sessionStreamPath(sessionKey)
    return this.runTransaction(() => {
      // Idempotency FIRST, inside the SAME transaction: if this key already produced an offset
      // for this stream, return it and allocate NO new eventIndex / insert NO new entry.
      if (opts?.idempotencyKey !== undefined) {
        const existing = this.sql.exec(
          `SELECT seq FROM boring_event_stream_keys WHERE path = ? AND idempotency_key = ?`,
          path, opts.idempotencyKey,
        ).toArray()
        if (existing.length > 0) return formatOffset(existing[0].seq as number)  // re-tap: same offset, no new seq
      }
      const updated = this.sql.exec(`UPDATE boring_event_streams SET next_offset = next_offset + 1 WHERE path = ? AND closed = 0 RETURNING next_offset`, path).toArray()
      if (updated.length === 0) { /* existing not-found/closed branch */ }
      const seq = (updated[0].next_offset as number) - 1
      const envelope: AgentEvent = { v: 1, eventIndex: seq, timestamp: Date.now(), sessionId: sessionKey.sessionId, chunk }  // constructed AFTER seq is known
      this.sql.exec(`INSERT INTO boring_event_stream_entries (path, seq, data) VALUES (?,?,?)`, path, seq, JSON.stringify(envelope))
      if (opts?.idempotencyKey !== undefined) {
        // record key→seq in the SAME transaction; UNIQUE(path, idempotency_key) on
        // boring_event_stream_keys makes a concurrent duplicate fail closed (caught → re-read the
        // existing seq), so a key can never map to two eventIndexes.
        this.sql.exec(`INSERT INTO boring_event_stream_keys (path, idempotency_key, seq) VALUES (?,?,?)`, path, opts.idempotencyKey, seq)
      }
      return formatOffset(seq)
    }).then(off => { this.notifyListeners(path); return off })
  }
  ```
  No envelope is JSON-stringified before its `eventIndex` is assigned; there is exactly one monotonic counter per session (the SQLite stream `next_offset`), and it *is* `eventIndex`. **`opts.idempotencyKey` is honored INSIDE the same transaction** via the `boring_event_stream_keys` table (`UNIQUE(path, idempotency_key)`): a duplicate key returns the **existing** offset, allocates **no** new `eventIndex`, and inserts no new entry — this is exactly what makes the BBT1-002 **restart re-tap** (`{ idempotencyKey: String(event.seq) }` replaying the in-memory buffer after a service restart) produce **zero duplicates**. This reuses the same key-table mechanism as Flue's `appendEventOnce` — do not add a second idempotency path. The generic `appendEvent(path, event)` above stays only for already-formed opaque payloads (and `appendEventOnce`'s idempotency); the AgentEvent tap uses `appendAgentEvent`.
- **Tests**: `packages/agent/src/server/events/__tests__/eventStreamStore.conformance.test.ts` — a reusable contract suite exported as `runEventStreamStoreConformance(makeStore)`:
  - append→read monotonic offsets; `readEvents({offset})` returns strictly-after; `nextOffset`/`upToDate`/`closed` correct.
  - `createStream` idempotent; append to missing throws; append to closed throws.
  - `appendEventOnce` exact-retry returns original offset; key reuse with different payload rejects.
  - **`appendAgentEvent` append idempotency**: two `appendAgentEvent` calls with the same `opts.idempotencyKey` return the same offset, advance `next_offset` **only once**, and leave exactly **one** entry (no new `eventIndex`) — the restart re-tap dedupe; concurrent duplicate keys fail closed on `UNIQUE(path, idempotency_key)` and re-read the existing seq.
  - **transactional atomicity**: a thrown `JSON.stringify`/insert inside the tx leaves `next_offset` unadvanced and no orphan entry (assert no gap).
  - subscribe fires on append; unsubscribe stops delivery.
  - Run against `:memory:` and a temp file DB.
- **Acceptance**: `pnpm --filter @hachej/boring-agent test` green for the new suite; `node:sqlite` used; no gap possible after a mid-append throw.

### BBT1-002 — AgentEvent envelope + append at the harness tap  · size M
- **Title**: Define `AgentEvent` envelope and append every event to the session stream from `publishChannelEvent`.
- **Files to create/touch**:
  - `packages/agent/src/shared/events.ts` (**extend — the file is created in P1 BBP1-002; do NOT recreate it**): the public `AgentEvent` envelope type already lives here from P1 —
    ```ts
    // defined in P1 (BBP1-002) — T1 reuses it, does not redeclare:
    export interface AgentEvent {
      v: 1
      eventIndex: number   // monotonic per session (== stream seq)
      timestamp: number
      sessionId: string
      chunk: PiChatEvent   // boring stream unit (see 08 mapping note)
    }
    ```
    T1 adds no key encoder or storage-path helper to shared. Shared exports only
    the public event types and runtime-owned `sessionId`.
  - `packages/agent/src/server/events/sessionKey.ts` (touch): keep `SessionKey`,
    `encodeSessionKey`, and `sessionStreamPath` together under server. The helper
    accepts only the trusted adapter-created key; it is not exported from
    `@hachej/boring-agent/shared` and front code cannot construct it.
  - `packages/agent/src/server/pi-chat/harnessPiChatService.ts` (touch): inject a required `EventStreamStore` and a trusted session binding/resolver supplied by the host adapter. P1's explicit headless/dev composition may construct an in-memory store; a T1 HTTP route host must inject the file store from BBT1-009. Resolve one `SessionKey` at admission and retain it on the channel; never reconstruct it from event caller data. In `publishChannelEvent`, **durably append first, then fan out**: `await this.eventStore.appendAgentEvent(sessionKey, event, { idempotencyKey: String(event.seq) })` (no optional chaining) and only after that commits `channel.buffer.publish(event)` to the in-memory live subscribers. Ensure the stream is created lazily in `buildChannel` with the server-only `sessionStreamPath(sessionKey)`. Keep the in-memory live fan-out fast (the single awaited append is the only added latency).
  - The SQLite `EventStreamStore` seq is the **sole** `AgentEvent.eventIndex`, allocated and stamped into the envelope inside `appendAgentEvent`'s transaction; `PiChatEvent.seq` stays only inside `chunk` (internal to the payload, never surfaced as the index), used **only** as the `appendAgentEvent` idempotency key across a service restart replaying the buffer. There is exactly one counter; no envelope is serialized before its `eventIndex` is allocated.
- **Implementation notes**: `publishChannelEvent` is synchronous today; appends are async. Durability-before-delivery is **required, not optional**: make the funnel `async` and `await` the durable append **before** notifying any subscriber (in-memory or remote). Because `adapter.subscribe(...)` is synchronous today, add an explicit per-channel serialization mechanism (`channel.publishQueue: Promise<void>` or equivalent) and enqueue every mapped/enriched event through it. The queue body order is fixed: `(1) await eventStore.createStream(sessionStreamPath(sessionKey)) if needed, (2) await appendAgentEvent(sessionKey, event, { idempotencyKey: String(event.seq) }), (3) channel.buffer.publish(event), (4) metering/side effects that currently happen after publish`. The same structured key selects event, pending, waiting, receipt, and fanout state. No later event may overtake an earlier append, and no event may be delivered live before its SQLite transaction commits. If the durable append fails, reject the queue and surface the failure to the turn/stream; do not fan the event out and do not swallow/log-only. The store is the replay authority, so no event may ever be live-delivered but absent from the store.
- **Tests**: `harnessPiChatService.eventStore.test.ts` — drive a fake adapter emitting N events; assert the store contains N `AgentEvent`s in order with contiguous `eventIndex`, each wrapping the matching `PiChatEvent`.
- **Acceptance**: every event that reaches a live subscriber is also in the durable store with a monotonic `eventIndex`; restart + `appendAgentEvent` idempotency-key re-tap is idempotent (no dupes — the duplicate key returns the existing offset in-transaction, allocates no new `eventIndex`).

### BBT1-003 — DS-compliant GET/HEAD routes + `agent.stream()`  · size L
- **Title**: DS read handlers behind a Fastify↔WHATWG bridge; durable in-process `stream(sessionId, { startIndex })`.
- **Files to create/touch**:
  - `packages/agent/src/server/events/handleStreamRoutes.ts` (new): port Flue `handle-stream-routes.ts` — `handleStreamRead` (catch-up / `?live=long-poll` / `?live=sse`), `handleStreamHead`, cursor + ETag + `If-None-Match` (304) logic, heartbeats. Strip Flue-specific `assertProductEventV3`/`RunNotFoundError` branches; use boring error codes (`packages/agent/src/shared/error-codes.ts`). Keep offset validation (`-1` | `now` | `\d+_\d+`) and the `tail` param.
  - `eventStream.ts` derives `SessionKey` from trusted adapter context,
    validated `:agentId`, and public `:sessionId`, then calls the DS handlers
    with `sessionStreamPath(sessionKey)`. The wire path still exposes session id;
    the database stream id is the structured encoded key.
  - `agentSessions.ts` provides the canonical write routes. Every route resolves
    and authorizes the same `SessionKey` before start/follow-up/interrupt/stop;
    `default` is the validated agent component until P7 supplies the registry.
  - `packages/agent/src/server/createAgent.ts` (touch — the Phase 1 façade; if it does not yet exist, this bead depends on Phase 1's `createAgent()` and you add the method there): implement the durable `stream(sessionId, { startIndex }): AsyncIterable<AgentEvent>` (replacing P1's minimal live-tail stub) reading from the store via `readEvents({ offset: formatOffset(startIndex-1) })` paged to tail then live-tailing. `startIndex` is an `eventIndex` integer; translate to DS offset internally so callers never touch the wire format.
- **Implementation notes**: SSE mode must forward `AbortSignal` from `reply.raw` 'close' so the DS SSE loop tears down (Flue wires `request.signal`). Set `X-Accel-Buffering: no` (matches existing `piChat.ts`) alongside DS security headers.
- **Tests**:
  - `eventStream.route.test.ts` (inject fastify): catch-up `GET ?offset=-1` returns all events + `Stream-Next-Offset`; `?offset=<mid>` returns strictly-after; `HEAD` returns meta headers no body; `If-None-Match` → 304; `?live=sse` streams `event: data`/`event: control` frames and closes on abort.
  - `stream.test.ts`: `stream(sessionId,{startIndex:0})` yields the full log; `{startIndex:k}` yields the tail; empty/unknown session yields nothing (not a throw).
- **Acceptance**: DS conformance behaviors from Flue preserved; SSE drop mid-stream then re-`GET ?offset=<last>` returns exactly the missed events (lossless).

### BBT1-004 — `needsApproval` + transactional on-stream pending state · size L
- **Title**: Approval declared on the tool; request and pending state commit together; `resolveInput` is authorized and idempotent.
- **Files to touch/create**:
  - `packages/agent/src/shared/tool.ts` (touch): add `needsApproval?: boolean | ((params: Record<string, unknown>, ctx: ToolExecContext) => boolean | Promise<boolean>)`.
  - `packages/agent/src/shared/chat/piChatEvent.ts` (touch): add a `data-approval-request` part variant (id: `requestId`, `toolCallId`, `toolName`, `params`, optional `schema` for form-style requests) and a terminal `data-approval-resolved` marker — matching the plan's "`data-approval-request` part in v1" (08). Keep the AI-SDK `data-*` custom-part convention so the front renders it as a tool UI.
  - Add one transaction-owning `recordPendingInputRequest(sessionKey, request)`
    operation that allocates/stamps the request event, inserts the authoritative
    pending row, and updates waiting state in one `agent.db` transaction. Only
    after commit may it fan out the event and install/wait on the in-memory
    same-process waiter. Resolution similarly records the terminal transition
    before waking the waiter. Do not compose these steps through three separate
    service calls.
  - `packages/agent/src/server/events/pendingRequests.ts` (new): authoritative pending-request persistence in `agent.db`. Request-event append + row creation commit together; resolution-event append + terminal row transition commit together. Do not delete the only recovery record before the approved tool outcome is durably represented.
  - `packages/agent/src/shared/events.ts` (touch — the file created in P1 BBP1-002, extended in BBT1-002): **define the resolve-input response union once here** (the single canonical shape every surface/transport references):
    ```ts
    export type ResolveInputResponse =
      | { kind: 'approval'; decision: 'approve' | 'deny'; reason?: string }
      | { kind: 'input'; values: Record<string, unknown> }
    ```
    `'approval'` covers `needsApproval` gates (BBT1-004); `'input'` covers form/ask-user answers (BBT1-005, `values` maps to `AskUserAnswer.values`). TODO-T2 (transport contract) and TODO-S1 (Slack approvals) reference this type by name — do not redeclare it.
  - `packages/agent/src/server/createAgent.ts` (touch): `resolveInput(...)`. Same-process resolution wakes only the admitted waiter after the durable resolution transition. After restart, return a stable expired/cancelled outcome and require a new user turn unless a future durable `WaitingTurn` + tool idempotency journal exists. Do not seed a turn and label it resume.
  - `packages/agent/src/server/http/routes/eventStream.ts` or a sibling `input.ts` (new): `POST /api/v1/agents/:agentId/sessions/:sessionId/input` `{ requestId, response: ResolveInputResponse }` → `agent.resolveInput(...)` (locked route family; `:agentId` canonical `default` until P7).
  - **Pending-request read API:** keep `agent.sessions.pendingInputs(ctx, opts?)` on the nine-member façade. It reads redacted authoritative `agent.db` rows under trusted host scope. The adapter derives the structured session scope and validates `agentId`; caller-supplied `sessionId` never bypasses that scope.
- **Implementation notes**: reuse the existing tool-exec seam (`AgentTool.execute` receives `ToolExecContext` with `sessionId`, `toolCallId`, `abortSignal`). The park promise must reject on `abortSignal` (turn interrupted) → surface a cancel just like ask-user's `aborted` reason. Session `waiting` state should be reflected in `PiChatSnapshot.status` so `readState` shows a parked turn.
- **Tests**: request event/row creation and resolution event/row transition are each atomic; cross-client approval works; restart leaves a visible expired/pending record but never executes the tool implicitly; duplicate resolution is idempotent; cross-scope reads/resolution reject.
- **Acceptance**: [`../../../plan.md`](../../../../391/runtime-refactor/INDEX.md) Phase T1 exit — "an approval issued in one client can be answered from another client holding the same session." The named `agent.sessions.pendingInputs(ctx: SessionCtx, { sessionId? })` read API (+ its `GET` HTTP mirror) exists, takes explicit `SessionCtx` scoping, is redacted and durable, does not leak across tenants, and is the API S3's approval inbox and P7 consume.

### BBT1-005 — Migrate ask-user + permission prompts onto the single path  · size M
- **Title**: Collapse the ask-user WorkspaceBridge channel onto the on-stream approval/input protocol.
- **Investigate first (paths in Context, grep-verified in this worktree)**: `plugins/ask-user/src/server/createAskUserTool.ts` (`createAskUserTool`, `execute(toolCallId, params, signal, sessionId)`, local `formatAskUserResult`), `askUserServerPlugin.ts` (registers `createAskUserTool`, `createAskUserBridgeHandlers`, `FileAskUserStore`, `AskUserStatePublisher`; rejects the legacy `routes` option), `askUserRuntime.ts`, `askUserStore.ts` (`AskUserStore`, `FileAskUserStore`), `askUserBridgeHandlers.ts` (`ask-user.v1.request/answer/cancel/pending/transcript`), `questionsRoutes.ts` (`POST /api/v1/questions/commands`). Today: `ask_user.execute` → `runtime.ask(input, signal)` blocks; the answer arrives via `workspaceBridgeHandlers` (`ask-user.v1.*`) writing to `FileAskUserStore`; `AskUserStatePublisher` mirrors state into the Questions pane. This is a parallel channel independent of the chat stream.
- **Migration (precise)**:
  1. Reframe `ask_user` as a `needsApproval`-style **input request**: instead of `runtime.ask()` over the bridge, have `execute` emit a `data-approval-request` (subtype `input`/`form`, carrying `AskUserFormSchema`) via the same mechanism as BBT1-004 and await `resolveInput`. The tool keeps its name, parameters, and `promptSnippet` (`createAskUserTool.ts` parameters unchanged).
  2. Response shape: `resolveInput(sessionId, requestId, { kind: 'input', values })` (the `ResolveInputResponse` `'input'` variant defined in BBT1-004) maps to the existing `AskUserAnswer.values`; reuse `formatAskUserResult` so the model-visible text is unchanged.
  3. Front Questions pane subscribes to `data-approval-request` parts of subtype `form` for its inbox instead of the bridge state publisher; submit calls `POST …/input` instead of the `ask-user.v1.submit` bridge command. Keep `QuestionForm.tsx` rendering.
  4. Delete the second channel only after existing pending requests are imported or an explicit deployment drain proves none remain. The migration/drain rule and rollback are part of this PR; no request may disappear merely because the backing store changed.
  5. Permission prompts: there is **no** boring-side `canUseTool` today (pi runs tools ungated). "Migrating permission prompts" here means: when a future/opt-in policy marks a tool `needsApproval`, it uses this exact path — document that in the plugin README and add one example tool wired with `needsApproval` to prove the generic path (do not build a full policy engine; that is Phase 5 credential/policy work).
- **Tests**: adapt `plugins/ask-user/e2e/ask-user.spec.ts` expectations to the on-stream request; unit test that `ask_user.execute` parks on a `data-approval-request` and resolves via `resolveInput` with `values`.
- **Acceptance**: 08 "Existing permission prompts and the ask-user plugin migrate onto this path; no second approval channel." Questions pane still works end-to-end over the on-stream request/response path; the `ask-user.v1.*` bridge handlers, `AskUserStatePublisher`, `questionsRoutes`, and `FileAskUserStore` are **deleted in T1** (not shimmed, not deferred) — a grep for `ask-user.v1.` finds no live handler after this bead.

### BBT1-006 — Harness conformance additions · size M
- **Title**: Envelope/replay ordering, transactional approvals, and explicit restart expiry/recovery.
- **Files**: find the existing harness conformance suite (search `packages/agent/src/**/conformance*.ts` / `*conformance*.test.ts`, e.g. `server/harness/pi-coding-agent/__tests__/sessionMapping.conformance.test.ts`) and add cases, or add `packages/agent/src/server/events/__tests__/durableStream.conformance.test.ts` registered alongside it.
- **Cases**:
  - **Envelope ordering**: for a scripted turn, `eventIndex` is contiguous and strictly increasing; every live-delivered event equals the stored one at that index.
  - **Replay-from-index**: `stream(sessionId,{startIndex:k})` === events with `eventIndex >= k`; `startIndex:0` === full log; matches what a DS `GET ?offset=` returns.
  - **Restart behavior**: rebuild against the same `agent.db`; the request remains inspectable but the disposed waiter is expired/cancelled. Resolution cannot execute the approved tool without a new user turn.
- **Acceptance**: all three green under `pnpm --filter @hachej/boring-agent test`; suite is reusable (exported factory) so T2's transport suite can layer on it.

### BBT1-007 — Pi JSONL / event-log crash recovery · size M

- Fault-inject after Pi JSONL history commits and before `AgentEvent` append.
- On restart either reconcile missing transport events deterministically from
  trusted history/snapshot data or append an explicit terminal failure record.
- Never silently expose a transcript whose durable replay omits committed
  conversation content.
- Document which store is authoritative for conversation state and which is
  authoritative for transport replay, including backup/restore ordering.

### BBT1-008 — Durable caller request receipts · size M

- **Title:** Make P1 caller `requestId` idempotency survive process restart,
  including new-session admission before `sessionId` exists.
- **Files touch/create:** the `agent.db` admission service and schema from
  BBT1-001, `createAgent().start/send`, and restart recovery. Derive
  `scope_key` from trusted host admission context plus validated agent identity;
  never accept it from the request body. Hash the canonical semantic input
  separately from attribution metadata according to the P1 contract.
- **Transition:** in one transaction, claim `(scope_key, request_id)`, store the
  payload hash and accepted `{ session_id, start_index }`, and mark the receipt
  `admitted` before launching a producer. Update `running`/terminal status as
  durable evidence arrives. A retry reads this authority; it never launches a
  second producer.
- **Restart rule:** nonterminal receipts are reconciled with Pi history and the
  event log. If continuation cannot be proven safe, mark an explicit
  interrupted/failed status and return the original receipt; never auto-run the
  request again. BBT1-007 owns any JSONL/event repair used by this reconciliation.
- **Tests:** same authenticated-subject+key+payload returns the original receipt
  after a fresh process;
  same key+different payload returns a stable conflict; a new-session request
  dedupes without caller `sessionId`; fault injection after receipt commit and
  before/after producer launch never causes a second model run; a different
  authenticated subject reusing the same request/session id cannot read,
  collide with, or resolve the first subject's state.
- **Acceptance:** P1's idempotency promise is durable rather than process-local,
  and uncertain crash states are explicit rather than retried.

### BBT1-009 — Production file-backed `agent.db` composition and ownership · size M

- **Title:** Make durability a live-host requirement, not only a conformance
  fixture.
- **Files touch/create:** a server-only `AgentStateStoreFactory` that opens and
  migrates one SQLite `agent.db` for a trusted storage scope; standalone
  `createAgentApp()` plus CLI, core, workspace, and full-app host composition;
  route-registration preflight; shutdown/backup hooks. The host path adapter
  derives the DB location beneath
  the durable session root (for example `<BORING_AGENT_SESSION_ROOT>/<encoded
  storage-scope>/agent.db`); no raw path or encoder enters shared contracts.
- **Rules:** the store contains event, pending/waiting, and caller-receipt tables
  and is injected as one owned unit. A T1 HTTP/DS route host rejects absent or
  in-memory storage with `DURABLE_AGENT_STATE_STORE_REQUIRED`. The harness
  receives a non-optional store and has no optional append path. Explicit
  in-memory storage remains available only to headless/unit/dev composition
  that does not register durable HTTP routes, and reports `durability:'memory'`.
- **Lifecycle:** migrate before routes become ready; one host owner closes the
  DB exactly once after streams/producers stop. Backup/restore treats `agent.db`
  and Pi JSONL under one documented ordering and never copies a live partial DB
  without the SQLite backup/checkpoint mechanism.
- **Tests:** standalone `createAgentApp()` through its normal consumer path and
  each real host composer point at a temp durable session root,
  starts through its normal composition path, writes an event/pending row/
  receipt, closes, constructs a fresh process/composer, and recovers them. Route
  registration with no store or an in-memory store rejects. Shutdown closes
  once; backup/restore preserves the three authorities and JSONL reconciliation.
- **Acceptance:** standalone and composed production hosts cannot silently run T1 on memory; one file-
  backed `agent.db` is opened, injected, migrated, restarted, backed up, and
  closed by the host.

## Verification — exact commands (verified against package.json scripts)

```bash
# runtime preflight
node -e "import('node:sqlite').then(() => console.log('node:sqlite ok'))"
# unit + conformance (agent package)
pnpm --filter @hachej/boring-agent test
# typecheck + package invariants (no agent→bash value import; façade Fastify-free)
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run lint:invariants
# ask-user plugin
pnpm --filter @hachej/boring-ask-user run test
pnpm --filter workspace-playground run test:e2e -- plugins/ask-user/e2e/ask-user.spec.ts
# monorepo import/isolation guards
pnpm run check:agent-isolation
pnpm run audit:imports
```
Node is v22.22.1 in this worktree (`node:sqlite` present, experimental warning expected). Do not add better-sqlite3.

## Review gates

- Flue append is transactional (single `runTransaction`); a mid-append throw leaves no gap (test proves it).
- DS header/field names byte-identical to `@durable-streams/client` constants; catch-up + SSE + long-poll + HEAD + 304 all covered.
- `AgentEvent.chunk` is `PiChatEvent`; AI-SDK part union unchanged; envelope only added.
- Public `stream(sessionId)` remains the façade shape, while store/replay access
  derives and authorizes trusted structured `SessionKey`; no surface-native
  addressing enters core signatures.
- Trusted `SessionKey` includes an immutable authenticated subject. Cross-user
  access first passes host ACL/session authorization and then loads the
  canonical key; imported/restored duplicate session ids cannot collide.
- Caller request receipts are keyed by trusted admission scope + `requestId`;
  exact retry returns the original receipt after restart and payload mismatch
  fails with a stable conflict.
- Exactly one approval channel after BBT1-005; `ask-user.v1.*` bridge not on the happy path.
- Store + `stream()` importable with no Fastify; only route files import Fastify (Phase 1 invariant intact).
- `piChatReplayBuffer.ts` and `?cursor=` NDJSON route still present (front cutover deferred to T2), and every retained legacy path has `TODO(remove:BBT2-006)`.
- `publishChannelEvent` append path is serialized per channel: append commits before fanout, failed append prevents fanout, and no queued event overtakes an earlier one.

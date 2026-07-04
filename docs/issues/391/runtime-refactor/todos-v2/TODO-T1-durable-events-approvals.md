# TODO-T1 — Durable event stream + on-stream approvals

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` — "Event stream contract", "Human-in-the-loop", "Two handles", "Conformance". The locked decision: adopt the **Durable Streams** wire protocol (github.com/durable-streams/durable-streams, ElectricSQL, MIT) — monotonic offsets, catch-up reads from arbitrary offset, SSE + long-poll, ETag caching, `Stream-Next-Offset`/`Stream-Up-To-Date` headers. Do **not** invent a replay protocol.
- Plan: `docs/issues/391/runtime-refactor/06-migration-phases.md` — "Phase T1 — Event envelope and replay (after Phase 1)". Track T starts after Phase 1 and runs parallel to Phases 2–4.
- Reference impl to adapt (Apache-2.0, framework-agnostic WHATWG `Request→Response`, ~1000 LOC): Flue (github.com/withastro/flue) `packages/runtime/src/runtime/event-stream-store.ts` (388 LOC) + `packages/runtime/src/runtime/handle-stream-routes.ts` (594 LOC). A shallow clone should exist at the scratchpad path in the session (`.../scratchpad/flue`); if absent, re-clone and read both files in full before touching beads BBT1-001/003. The node:sqlite ↔ `SqlStorage` adapter and the transaction wrapper to reuse are in `packages/runtime/src/node/agent-execution-store.ts` (`createNodeSqlStorage`, `createNodeTransactionSync`, `openDatabase`).
- Client (browser + channel consumers): `@durable-streams/client` (deps `@microsoft/fetch-event-source` + `fastq`) — gives reconnection, backoff, offset checkpointing. Wiring the front onto it is **T2**, not here; T1 only ships the server + in-process `replay()` + envelope + approvals.

### Current boring code this replaces/extends (verified paths)

- `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts` — the **existing bespoke replay protocol**: in-memory `PiChatReplayBuffer` (default 1000 events, monotonic `seq`, `replay_gap`/`cursor_ahead` range errors). T1 replaces this with a durable, offset-addressed store. Keep it during migration as the live fan-out fast-path if useful, but persistence + replay authority moves to the new store.
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts` — `HarnessPiChatService`. The single funnel where every event is published is `publishChannelEvent(sessionId, channel, event)` (~L398–413), ending in `channel.buffer.publish(event)`. Live events originate from `buildChannel` (~L502–525): `adapter.subscribe(event => { mapper.map → messageMetadata.enrichEvent → publishChannelEvent })`. **This is the tap point** for appending to the durable stream. `subscribe()` (~L163) and `readState()` (~L122) are the read paths.
- `packages/agent/src/server/http/routes/piChat.ts` — Fastify routes. `GET /api/v1/agent/pi-chat/:sessionId/events?cursor=N` streams NDJSON frames via `PassThrough`; `subscribe(ctx, sessionId, cursor, writeFrame)` drives it; 409 `sendReplayRangeError` on gap. This route is the thing a DS-compliant `GET`/`HEAD` handler sits beside (do not delete it in T1; add the DS route in parallel and cut the front over in T2).
- `packages/agent/src/shared/chat/piChatEvent.ts` — `PiChatEvent` union, each variant carries `seq: number`. **The boring stream unit is `PiChatEvent`, not a raw AI-SDK `UIMessageChunk`.** 08's envelope defines `AgentEvent.chunk: PiChatEvent` (the mapped/enriched event already emitted today) — keep it exactly that way; do not re-plumb to raw pi chunks in T1.
- `packages/agent/src/shared/harness.ts` — `AgentHarness`, `SendMessageInput`, `RunContext`. The header comment at L79 ("Resume is NOT a harness concern … The HTTP route owns cursor buffering + replay; harness stays reconnect-unaware") must be **updated**: T1 introduces `agent.stream()` (replay-from-offset + live tail) as the in-process read primitive per 08. Add `stream` to the façade, not to `AgentHarness` (the harness stays reconnect-unaware; the store + service own replay).
- `packages/agent/src/shared/tool.ts` — `AgentTool` (`name`, `parameters`, `execute`, `readinessRequirements`). T1 adds `needsApproval`.
- Approvals today (the "second channel" to be collapsed): `plugins/ask-user/` — `src/server/createAskUserTool.ts` (tool `ask_user`, `execute` blocks on `runtime.ask()`), `src/server/askUserServerPlugin.ts` (registers tool + `workspaceBridgeHandlers` + `AskUserStatePublisher` pushing to the Questions pane), `src/server/askUserRuntime.ts`, `src/server/askUserStore.ts` (`FileAskUserStore` → `.boring/ask-user.json`), `src/shared/types.ts`. Answers arrive over the **WorkspaceBridge** (`ask-user.v1.*` handlers), NOT the chat stream. There is no `canUseTool`/permission-prompt code in `packages/agent` — pi tools run without a boring-side gate today; `needsApproval` introduces one.

## Goal / exit criteria

Match `06-migration-phases.md` Phase T1 exit criteria:

1. `AgentEvent` envelope persisted per session; every chunk appended to a durable, offset-addressed SQLite stream at the `publishChannelEvent` tap.
2. `agent.stream(sessionId, { startIndex })` (in-process read primitive: replay + live tail) + DS-compliant `GET`/`HEAD` stream routes (catch-up from offset, SSE + long-poll) behind a Fastify↔WHATWG bridge.
3. SSE drop + reconnect replays losslessly (proven by conformance test; front cutover is T2).
4. `needsApproval` on `AgentTool`; approval-request emitted on-stream; **pending request + session `waiting` state are durable in the event-store SQLite**; turn parks (`session.waiting`); `resolveInput(sessionId, requestId, response)` in-process + `POST …/input` route.
5. **Resume model (locked — no over-claim):** *same-process* resume continues the live parked turn via its in-memory waiter. *After a process restart*, `resolveInput` on a still-pending request continues the session via a **new harness turn seeded with the approval outcome** (tool-result injection on pi JSONL rehydration). **No in-memory turn continuation is ever rehydrated across a restart, and there is NO `WaitingTurn` state machine.** A parked turn does NOT "resume to completion" from restored in-memory state.
6. ask-user + any permission prompts ride the single approval path — no second channel.
7. Harness conformance additions pass: envelope ordering, replay-from-index, durable pending-request survival across restart, and same-process approval park/resume.

## Non-negotiables

- Adapt Flue's two files; do not hand-roll DS semantics. Preserve DS header/field names verbatim (`Stream-Next-Offset`, `Stream-Up-To-Date`, `Stream-Closed`, `Stream-Cursor`; SSE fields `streamNextOffset`/`streamCursor`/`streamClosed`/`upToDate`).
- **Fix the known append bug**: Flue's `appendEvent` runs two non-transactional statements (`UPDATE … RETURNING next_offset` then a separate `INSERT`). Wrap both in one transaction (reuse `createNodeTransactionSync` = `BEGIN`/`COMMIT`/`ROLLBACK`). Same for `closeStream`+notify ordering if you touch it. Delete Flue's "safe for single-process" comment.
- Storage = `node:sqlite` (`DatabaseSync`, available: Node v22.22, `PRAGMA journal_mode=WAL` for file DBs). No new native dep.
- Envelope payload stays `PiChatEvent` (see Context). Do not change the AI-SDK part union in T1 (plan decision 1 in 08).
- `createAgent()`/façade must stay Fastify-free (Phase 1 invariant, `06` Phase 1). The DS store + `replay()` live in agent server core; only the DS route file imports Fastify.
- Two-handles rule (08): public API keyed by `sessionId` only. Stream path = `sessions/${sessionId}` (analogous to Flue `agentStreamPath`). Never accept `x-boring-workspace-id` in the store/replay signature (that resolves to `SessionCtx` in the route — T2 formalizes it).
- Migrate ask-user in place: keep the `ask_user` tool name, its form schema (`AskUserFormSchema`), and the Questions pane UX. Only the transport (bridge → on-stream request/response) changes.
- **Two authorities, kept separate (state plainly):** the SQLite `EventStreamStore` is the **replay authority** — the durable, offset-addressed log that `replay()`/the DS routes serve. It is **separate from** the pi session JSONL, which remains the **conversation-state authority** for harness rehydration (existing user sessions must keep loading — do not fold it into the event store). **Pending approval requests live in the event-stream SQLite DB**, never in the pi session JSONL and never in a new JSON file.

## Do NOT

- Do NOT delete `piChatReplayBuffer.ts` or the `?cursor=` NDJSON route in T1 (T2 owns the front cutover; keep both live until then).
- Do NOT add a second persistence format for approvals — persist pending requests in the same SQLite DB as the event stream, not a new JSON file and not the pi session JSONL/session store.
- Do NOT introduce `@durable-streams/server` or the Caddy sidecar — embed the adapted store (plan 08: sidecar is an alternative, not T1).
- Do NOT wire the browser client (`@durable-streams/client`) here — that is BBT2-002.
- Do NOT read env vars or discover `.pi/*` inside the store/façade.

## Beads

### BBT1-001 — Vendor + fix EventStreamStore into the repo  · size M
- **Title**: Adapt Flue `EventStreamStore` (transactional append, node:sqlite) into `packages/agent/src/server/events/`.
- **Location decision (recommend + justify)**: put it at `packages/agent/src/server/events/` **inside `@hachej/boring-agent`**, not a new `packages/event-streams`. Justification (one line): the store is agent-server-core with zero external consumers in T1/T2 and must not add a cross-package import cycle before Phase 2 extraction; promote to its own package only if/when a surface package needs it standalone (Track S).
- **Files to create**:
  - `packages/agent/src/server/events/eventStreamStore.ts` — port Flue `event-stream-store.ts`: `EventStreamStore` interface, `SqliteEventStreamStore`, `formatOffset`/`parseOffset`, `EventStreamReadResult`/`EventStreamMeta`. Keep the `<readSeq>_<seq>` 16-digit offset format.
  - `packages/agent/src/server/events/sqlStorage.ts` — port `createNodeSqlStorage` + `createNodeTransactionSync` + `openDatabase` (WAL, `mkdirSync`) from Flue `node/agent-execution-store.ts`. Export `runTransaction`.
  - `packages/agent/src/server/events/schemaVersion.ts` — port `migrateFlueSqlSchema` (or inline a minimal version stamp table). Rename `flue_*` tables to `boring_event_streams` / `boring_event_stream_entries` / `boring_event_stream_keys`.
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
- **Tests**: `packages/agent/src/server/events/__tests__/eventStreamStore.conformance.test.ts` — a reusable contract suite exported as `runEventStreamStoreConformance(makeStore)`:
  - append→read monotonic offsets; `readEvents({offset})` returns strictly-after; `nextOffset`/`upToDate`/`closed` correct.
  - `createStream` idempotent; append to missing throws; append to closed throws.
  - `appendEventOnce` exact-retry returns original offset; key reuse with different payload rejects.
  - **transactional atomicity**: a thrown `JSON.stringify`/insert inside the tx leaves `next_offset` unadvanced and no orphan entry (assert no gap).
  - subscribe fires on append; unsubscribe stops delivery.
  - Run against `:memory:` and a temp file DB.
- **Acceptance**: `pnpm --filter @hachej/boring-agent test` green for the new suite; `node:sqlite` used; no gap possible after a mid-append throw.

### BBT1-002 — AgentEvent envelope + append at the harness tap  · size M
- **Title**: Define `AgentEvent` envelope and append every event to the session stream from `publishChannelEvent`.
- **Files to create/touch**:
  - `packages/agent/src/shared/events.ts` (new): 
    ```ts
    export interface AgentEvent {
      v: 1
      eventIndex: number   // monotonic per session (== stream seq)
      timestamp: number
      sessionId: string
      chunk: PiChatEvent   // boring stream unit (see 08 mapping note)
    }
    export function sessionStreamPath(sessionId: string): string { return `sessions/${sessionId}` }
    ```
  - `packages/agent/src/server/pi-chat/harnessPiChatService.ts` (touch): inject an optional `EventStreamStore` (constructor option `eventStore?`). In `publishChannelEvent`, after `channel.buffer.publish(event)`, `await this.eventStore?.appendEvent(sessionStreamPath(sessionId), toAgentEvent(sessionId, event))`. Ensure the stream is created lazily in `buildChannel` (`await eventStore.createStream(path)`). Preserve current in-memory fan-out for live subscribers (do not regress latency).
  - Map `PiChatEvent.seq` ↔ `AgentEvent.eventIndex`: prefer the store-assigned offset as the source of truth. Decide and document: either (a) keep pi's `seq` as `eventIndex` and use `appendEventOnce(path, key=String(seq), …)` for idempotency, or (b) let the store assign and reconcile. **Recommend (a)** — pi already guarantees monotonic `seq`; `appendEventOnce` keyed on `seq` makes the tap idempotent across a service restart replaying the buffer.
- **Implementation notes**: `publishChannelEvent` is synchronous today; appends are async. Do not block the live fan-out on the DB write — fire the append and swallow/log errors into telemetry, OR make the funnel `async` and `await` before notifying remote subscribers if strict durability-before-delivery is required by the conformance suite (BBT1-006 "envelope ordering" decides; default: append then fan-out, awaited, to guarantee a reconnecting client never sees an event the store lost).
- **Tests**: `harnessPiChatService.eventStore.test.ts` — drive a fake adapter emitting N events; assert the store contains N `AgentEvent`s in order with contiguous `eventIndex`, each wrapping the matching `PiChatEvent`.
- **Acceptance**: every event that reaches a live subscriber is also in the durable store with a monotonic `eventIndex`; restart + `appendEventOnce` re-tap is idempotent (no dupes).

### BBT1-003 — DS-compliant GET/HEAD routes + `agent.stream()`  · size L
- **Title**: DS read handlers behind a Fastify↔WHATWG bridge; in-process `replay(sessionId, {startIndex})`.
- **Files to create/touch**:
  - `packages/agent/src/server/events/handleStreamRoutes.ts` (new): port Flue `handle-stream-routes.ts` — `handleStreamRead` (catch-up / `?live=long-poll` / `?live=sse`), `handleStreamHead`, cursor + ETag + `If-None-Match` (304) logic, heartbeats. Strip Flue-specific `assertProductEventV3`/`RunNotFoundError` branches; use boring error codes (`packages/agent/src/shared/error-codes.ts`). Keep offset validation (`-1` | `now` | `\d+_\d+`) and the `tail` param.
  - `packages/agent/src/server/http/routes/eventStream.ts` (new): Fastify route `GET`/`HEAD` `/api/v1/agent/sessions/:sessionId/events/stream` that builds a WHATWG `Request` from the Fastify request, calls `handleStreamRead`/`handleStreamHead(store, sessionStreamPath(sessionId))`, and pipes the WHATWG `Response` (incl. `ReadableStream` body for SSE) back onto `reply.raw`. Provide a small `fastifyToWebRequest(req)` + `webResponseToFastify(res, reply)` bridge (Node has `Request`/`Response`/`ReadableStream` globals on v22).
  - `packages/agent/src/server/createAgent.ts` (touch — the Phase 1 façade; if it does not yet exist, this bead depends on Phase 1's `createAgent()` and you add the method there): implement `replay(sessionId, { startIndex }): AsyncIterable<AgentEvent>` reading from the store via `readEvents({ offset: formatOffset(startIndex-1) })` paged to tail. `startIndex` is an `eventIndex` integer; translate to DS offset internally so callers never touch the wire format.
- **Implementation notes**: SSE mode must forward `AbortSignal` from `reply.raw` 'close' so the DS SSE loop tears down (Flue wires `request.signal`). Set `X-Accel-Buffering: no` (matches existing `piChat.ts`) alongside DS security headers.
- **Tests**:
  - `eventStream.route.test.ts` (inject fastify): catch-up `GET ?offset=-1` returns all events + `Stream-Next-Offset`; `?offset=<mid>` returns strictly-after; `HEAD` returns meta headers no body; `If-None-Match` → 304; `?live=sse` streams `event: data`/`event: control` frames and closes on abort.
  - `replay.test.ts`: `replay(sessionId,{startIndex:0})` yields the full log; `{startIndex:k}` yields the tail; empty/unknown session yields nothing (not a throw).
- **Acceptance**: DS conformance behaviors from Flue preserved; SSE drop mid-stream then re-`GET ?offset=<last>` returns exactly the missed events (lossless).

### BBT1-004 — `needsApproval` on AgentTool + on-stream request/park/resume  · size L
- **Title**: Approval declared on the tool; request rides the stream; turn parks durably; `resolveInput` resumes.
- **Files to touch/create**:
  - `packages/agent/src/shared/tool.ts` (touch): add `needsApproval?: boolean | ((params: Record<string, unknown>, ctx: ToolExecContext) => boolean | Promise<boolean>)`.
  - `packages/agent/src/shared/chat/piChatEvent.ts` (touch): add a `data-approval-request` part variant (id: `requestId`, `toolCallId`, `toolName`, `params`, optional `schema` for form-style requests) and a terminal `data-approval-resolved` marker — matching the plan's "`data-approval-request` part in v1" (08). Keep the AI-SDK `data-*` custom-part convention so the front renders it as a tool UI.
  - `packages/agent/src/server/pi-chat/harnessPiChatService.ts` (touch) or the pi tool-execution wrapper: before executing a tool whose `needsApproval` resolves true, (1) persist a pending request, (2) `publishChannelEvent` a `data-approval-request` (so it lands in the durable stream + reaches every client), (3) set session state `waiting` and block the tool's `execute` on a promise keyed by `requestId`. On `resolveInput`, resolve that promise with the response and let `execute` continue/return.
  - `packages/agent/src/server/events/pendingRequests.ts` (new): pending-request persistence in the same SQLite DB (`boring_pending_requests(sessionId, requestId, toolCallId, payload, createdAt)`). Cleared on resolve.
  - `packages/agent/src/shared/events.ts` (touch — the file created in BBT1-002): **define the resolve-input response union once here** (the single canonical shape every surface/transport references):
    ```ts
    export type ResolveInputResponse =
      | { kind: 'approval'; decision: 'approve' | 'deny'; reason?: string }
      | { kind: 'input'; values: Record<string, unknown> }
    ```
    `'approval'` covers `needsApproval` gates (BBT1-004); `'input'` covers form/ask-user answers (BBT1-005, `values` maps to `AskUserAnswer.values`). TODO-T2 (transport contract) and TODO-S1 (Slack approvals) reference this type by name — do not redeclare it.
  - `packages/agent/src/server/createAgent.ts` (touch): `resolveInput(sessionId: string, requestId: string, response: ResolveInputResponse)`. **Two distinct paths, both required:** (1) *same process* — look up the in-memory waiter keyed by `requestId` and resolve its promise so the live parked `execute` continues; (2) *after a restart* — the waiter is gone but the durable pending row still exists: clear the pending row and **start a NEW harness turn seeded with the approval outcome**, injecting the resolved value as a tool-result on the pi JSONL rehydration (the conversation-state authority) so the session continues from where it parked. **Never rehydrate an in-memory turn continuation; do not build a `WaitingTurn` state machine.** The durable artifacts are only: the pending-request row + the `waiting` session state — enough to re-issue a seeded turn, not to resurrect a live one.
  - `packages/agent/src/server/http/routes/eventStream.ts` or a sibling `input.ts` (new): `POST /api/v1/agent/sessions/:sessionId/input` `{ requestId, response: ResolveInputResponse }` → `agent.resolveInput(...)`.
- **Implementation notes**: reuse the existing tool-exec seam (`AgentTool.execute` receives `ToolExecContext` with `sessionId`, `toolCallId`, `abortSignal`). The park promise must reject on `abortSignal` (turn interrupted) → surface a cancel just like ask-user's `aborted` reason. Session `waiting` state should be reflected in `PiChatSnapshot.status` so `readState` shows a parked turn.
- **Tests**: `approval.test.ts` — tool with `needsApproval: true` emits a `data-approval-request` on the stream, turn parks (status `waiting`), `resolveInput` with `approve` lets `execute` run and the turn completes; `deny`/abort cancels. A second subscriber sees the same request and can resolve it (proves "answered from another client").
- **Acceptance**: 06 Phase T1 exit — "an approval issued in one client can be answered from another client holding the same session."

### BBT1-005 — Migrate ask-user + permission prompts onto the single path  · size M
- **Title**: Collapse the ask-user WorkspaceBridge channel onto the on-stream approval/input protocol.
- **Investigate first (paths in Context)**: `plugins/ask-user/src/server/{createAskUserTool,askUserServerPlugin,askUserRuntime,askUserStore}.ts`. Today: `ask_user.execute` → `runtime.ask(input, signal)` blocks; the answer arrives via `workspaceBridgeHandlers` (`ask-user.v1.*`) writing to `FileAskUserStore`; `AskUserStatePublisher` mirrors state into the Questions pane. This is a parallel channel independent of the chat stream.
- **Migration (precise)**:
  1. Reframe `ask_user` as a `needsApproval`-style **input request**: instead of `runtime.ask()` over the bridge, have `execute` emit a `data-approval-request` (subtype `input`/`form`, carrying `AskUserFormSchema`) via the same mechanism as BBT1-004 and await `resolveInput`. The tool keeps its name, parameters, and `promptSnippet` (`createAskUserTool.ts` parameters unchanged).
  2. Response shape: `resolveInput(sessionId, requestId, { kind: 'input', values })` (the `ResolveInputResponse` `'input'` variant defined in BBT1-004) maps to the existing `AskUserAnswer.values`; reuse `formatAskUserResult` so the model-visible text is unchanged.
  3. Front Questions pane subscribes to `data-approval-request` parts of subtype `form` for its inbox instead of the bridge state publisher; submit calls `POST …/input` instead of the `ask-user.v1.submit` bridge command. Keep `QuestionForm.tsx` rendering.
  4. Delete the second channel **inside T1** (same phase): the front ask-user cutover (step 3) lands in this phase, so `AskUserStatePublisher`, `askUserBridgeHandlers` (`ask-user.v1.*`), `questionsRoutes`, and `FileAskUserStore` are **removed in T1** once pending-request persistence (BBT1-004) is the single source of truth. No `@deprecated` shim, no Phase-8 cleanup bead — the no-compat policy (`todos-v2/README.md`) forbids leaving a parallel channel alive past its cutover. The front and the bridge/store deletion ship together in the same PR stack.
  5. Permission prompts: there is **no** boring-side `canUseTool` today (pi runs tools ungated). "Migrating permission prompts" here means: when a future/opt-in policy marks a tool `needsApproval`, it uses this exact path — document that in the plugin README and add one example tool wired with `needsApproval` to prove the generic path (do not build a full policy engine; that is Phase 5 credential/policy work).
- **Tests**: adapt `plugins/ask-user/e2e/ask-user.spec.ts` expectations to the on-stream request; unit test that `ask_user.execute` parks on a `data-approval-request` and resolves via `resolveInput` with `values`.
- **Acceptance**: 08 "Existing permission prompts and the ask-user plugin migrate onto this path; no second approval channel." Questions pane still works end-to-end over the on-stream request/response path; the `ask-user.v1.*` bridge handlers, `AskUserStatePublisher`, `questionsRoutes`, and `FileAskUserStore` are **deleted in T1** (not shimmed, not deferred) — a grep for `ask-user.v1.` finds no live handler after this bead.

### BBT1-006 — Harness conformance additions  · size M
- **Title**: Extend the #12 harness conformance suite: envelope ordering, replay-from-index, approval park/resume across restart.
- **Files**: find the existing harness conformance suite (search `packages/agent/src/**/conformance*.ts` / `*conformance*.test.ts`, e.g. `server/harness/pi-coding-agent/__tests__/sessionMapping.conformance.test.ts`) and add cases, or add `packages/agent/src/server/events/__tests__/durableStream.conformance.test.ts` registered alongside it.
- **Cases**:
  - **Envelope ordering**: for a scripted turn, `eventIndex` is contiguous and strictly increasing; every live-delivered event equals the stored one at that index.
  - **Replay-from-index**: `replay(sessionId,{startIndex:k})` === events with `eventIndex >= k`; `startIndex:0` === full log; matches what a DS `GET ?offset=` returns.
  - **Durable pending-request survival across restart**: emit a `needsApproval` tool → request + `waiting` state persisted → **dispose the service and rebuild it against the same SQLite file** → the pending request is still present and `session.waiting` is still reported by `readState`. `resolveInput(requestId)` then continues the session via a **new seeded harness turn** (tool-result injection on JSONL rehydration), NOT by resurrecting the disposed in-memory turn. Assert: no `WaitingTurn`/in-memory continuation is rehydrated; the seeded turn produces the post-approval continuation. (Same-process park/resume of the live turn is a separate, simpler case above.)
- **Acceptance**: all three green under `pnpm --filter @hachej/boring-agent test`; suite is reusable (exported factory) so T2's transport suite can layer on it.

## Verification — exact commands (verified against package.json scripts)

```bash
# unit + conformance (agent package)
pnpm --filter @hachej/boring-agent test
# typecheck + package invariants (no agent→bash value import; façade Fastify-free)
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run lint:invariants
# ask-user plugin
pnpm --filter ./plugins/ask-user test        # if the plugin defines `test`; else: pnpm -r --filter ask-user test
# monorepo import/isolation guards
pnpm run check:agent-isolation
pnpm run audit:imports
```
Node is v22.22 (`node:sqlite` present, experimental warning expected). Do not add better-sqlite3.

## Review gates

- Flue append is transactional (single `runTransaction`); a mid-append throw leaves no gap (test proves it).
- DS header/field names byte-identical to `@durable-streams/client` constants; catch-up + SSE + long-poll + HEAD + 304 all covered.
- `AgentEvent.chunk` is `PiChatEvent`; AI-SDK part union unchanged; envelope only added.
- `replay()`/store keyed by `sessionId` only; no `workspaceId`/platform addressing in core signatures (08 two-handles).
- Exactly one approval channel after BBT1-005; `ask-user.v1.*` bridge not on the happy path.
- Store + `replay()` importable with no Fastify; only route files import Fastify (Phase 1 invariant intact).
- `piChatReplayBuffer.ts` and `?cursor=` NDJSON route still present (front cutover deferred to T2).

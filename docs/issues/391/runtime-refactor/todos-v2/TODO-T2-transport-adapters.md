# TODO-T2 — Transport adapters (in-process + HTTP) over the public contract

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/06-migration-phases.md` — "Phase T2 — Transport adapters". Depends on **Phase T1** (`TODO-T1-durable-events-approvals.md` in this folder): the durable `EventStreamStore`, `AgentEvent` envelope, DS-compliant `GET`/`HEAD` stream routes, `agent.stream(sessionId,{startIndex})` (read primitive), and on-stream approvals must already exist. Do not start T2 until T1's conformance suite is green.
- Plan: `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` — "Vercel AI SDK `ChatTransport`" (UI state and wire protocol are separate; `sendMessages` + `reconnectToStream` is the entire transport contract), "Two handles (hard rule)", "Conformance" item 3 ("Transport conformance: `send` + `reconnect` semantics identical in-process and over HTTP").
- Durable Streams client (locked in 08): `@durable-streams/client` (deps `@microsoft/fetch-event-source` + `fastq`) provides reconnection, backoff, offset checkpointing. T2 wires the front's reconnect onto it (or a thin `ChatTransport.reconnectToStream` backed by it) against T1's DS routes.

### Current boring code (verified paths)

- `packages/agent/src/front/chat/pi/remotePiSession.ts` — `class RemotePiSession`, the **existing bespoke transport**. Key internals: `start(cursor?)` → `connectEvents(cursor, gen)` → `runEventStream(cursor, …)` which `fetch`es `buildPiChatEventsUrl({ apiBaseUrl, sessionId, cursor })` (= `GET …/pi-chat/:sessionId/events?cursor=N`), reads NDJSON via `readPiChatNdjsonStream`, and reconnects via `schedulePiChatReconnect` (jittered backoff, `reconnectAttempt`). `prompt`/`followUp`/`interrupt`/`stop` POST to the pi-chat routes. `store.dispatch({type:'cursor-sync'|'connection-state'|…})` drives UI state. **This is exactly `sendMessages` + `reconnectToStream` today, hand-rolled.**
- `packages/agent/src/front/chat/pi/piChatStream.ts` — the reconnect/cursor helpers to be superseded: `buildPiChatEventsUrl`, `readPiChatNdjsonStream`, `processPiChatSequencedEvent` (gap/stale detection), `schedulePiChatReconnect`, `calculateJitteredBackoffDelayMs`, `parsePiChatReplayRangeError`/`replayRangeErrorToRecovery` (the `replay_gap`/`cursor_ahead` → full-rehydrate recovery). DS's offset-addressed catch-up replaces the gap-recovery dance.
- `packages/agent/src/front/chat/session/usePiSessions.ts` — the React hook (misnamed in the task as `useAgentChat`; **there is no `useAgentChat`**). It owns session lifecycle and constructs the transport via `createRemoteSession` (default `createRemotePiSession`, injectable via `options.createRemoteSession` — L34, L83, L309). `activePiSession: RemotePiSession`. `PiChatPanel.tsx` (`packages/agent/src/front/chat/PiChatPanel.tsx`, 49KB) consumes this hook.
- `packages/agent/src/server/http/routes/piChat.ts` — the HTTP adapter. `getRequestContext(request)` maps `request.workspaceContext?.workspaceId` (+ `x-boring-storage-scope` header) → `PiSessionRequestContext`. **This is the `x-boring-workspace-id → SessionCtx` mapping the plan wants documented as the adapter-owned pattern.**
- `packages/agent/src/shared/harness.ts` — `SendMessageInput`, `RunContext`; L79 comment declaring the harness reconnect-unaware (T1 already moved replay to the façade — verify).
- `packages/agent/src/server/createAgent.ts` — the Phase 1 façade, the **nine** members `start`, `stream`, `send`, `resolveInput`, `interrupt`, `stop`, `sessions`, `readiness`, `dispose`. The `ChatTransport` methods map **1:1** onto façade members: `sendMessages`→`start`, `reconnectToStream`→`stream`, `resolveInput`→`resolveInput`, `interrupt`→`interrupt`, `stop`→`stop`. T2's in-process transport consumes the façade directly.
- Invariant scripts: root `scripts/audit-imports.ts` (`pnpm run audit:imports`), `packages/agent/src/…` isolation via `pnpm run check:agent-isolation`, `packages/agent` `lint:invariants` (`bash ../../scripts/check-invariants.sh .`). T2 adds a rule to one of these.

## Goal / exit criteria

Match `06-migration-phases.md` Phase T2 exit criteria:

1. **Transport contract** (`send` + `reconnect`) documented; an **in-process transport** (direct `createAgent()`) and the **HTTP+SSE adapter** both pass one shared transport conformance suite.
2. `usePiSessions`/`PiChatPanel` refit to consume **only the public contract** (no internal imports); custom `ChatTransport.reconnectToStream` wired to T1's `startIndex`/DS replay via `@durable-streams/client`.
3. Two-handles rule enforced: public agent APIs accept `sessionId` only; `x-boring-workspace-id → SessionCtx` documented as adapter-owned; a lint/invariant blocks platform-addressing types in core signatures.
4. Exit: workspace UI runs unmodified against the refit; a headless Node consumer drives the same session interleaved with the UI.

## Non-negotiables

- Do not change UI behavior. `PiChatPanel`/`usePiSessions` external API stays identical (08: "`ChatPanel`/`useAgentChat` unchanged externally"). This is an internal transport swap.
- Reconnect uses T1's DS routes + offsets, not the `?cursor=` NDJSON path. Prefer `@durable-streams/client` for reconnection/backoff/offset-checkpointing; only hand-roll if the client cannot express the `AgentEvent`→UI-store mapping cleanly (justify in the PR).
- Two handles (08): the transport contract is keyed by `sessionId`. Surface-native platform addressing (Slack thread ts, workbook/sheet id, workspace pane id, the raw `x-boring-workspace-id` header) lives in the adapter, never in the transport/core type. `SessionCtx { workspaceId, userId? }` — boring's own runtime tenancy context — is allowed on the façade and is not platform addressing.
- The in-process and HTTP transports must be behaviorally identical under the conformance suite — same event order, same reconnect-replay semantics, same approval round-trip.
- Keep pin discipline: pin `@durable-streams/client` (and its `@microsoft/fetch-event-source`/`fastq` deps) to exact versions; it is a new front dependency — check bundle-size gates (`pnpm run check:bundle-size`).

## Do NOT

- Do NOT touch the T1-built DS code — the durable event store, the DS `GET`/`HEAD` stream routes, or approvals-on-stream. That is T1. If you find a T1 gap, file a bead, do not patch it here. **Carve-out (BBT2-006):** T2 *does* delete the **LEGACY** server-side `?cursor=` NDJSON replay path in this phase (the old `PiChatReplayBuffer` + `?cursor=` route handling) once the DS transport passes conformance + the workspace playground — that legacy path is T2's to remove, and it is distinct from the T1-built DS store/routes which stay untouched.
- Do NOT delete `piChatStream.ts`/`remotePiSession.ts` until the refit passes the workspace playground and conformance; land the new transport behind `createRemoteSession` injection first, then remove the old path in the same PR's final commit.
- Do NOT let `workspaceId`/storage-scope leak into `createAgent()` signatures — resolve them in the HTTP adapter (`getRequestContext`) as today.
- Do NOT build the Slack/Excel surfaces — those are Phases S1/S2 (`06`). T2 only proves the contract with in-process + HTTP + a headless Node consumer.
- Do NOT touch the render/projection layer (`piChatReducer.ts`, `piChatPartMerging.ts`, `piChatAssistantCommit.ts`, `selectors.ts`, `PiTimelineMessage.tsx`, `toolRenderers.tsx`, `bareToolRenderers/`, `primitives/`, composer components). Decision 8 in `../08-pluggable-agent-surfaces.md`: the front chat provider is unchanged — the UI is already an ai-elements/shadcn stack insulated from the wire protocol by the `PiChatEvent → BoringChatMessage` projection. Do not "modernize" it onto AI-SDK `UIMessage.parts` and do not swap primitives; the only sanctioned render-layer follow-up (shadcn `MessageScroller` in `PiConversationSurface`) is a separate post-T2 bead, not part of this work order.

## Beads

### BBT2-001 — Transport contract doc + shared conformance suite  · size M
- **Title**: Define the `ChatTransport` contract (`send` + `reconnect`) and a suite run against in-process and HTTP.
- **Files to create**:
  - `packages/agent/src/shared/transport.ts` (new): the minimal contract (AI-SDK `ChatTransport`-shaped):
    ```ts
    export interface ChatTransport {
      // fire a user turn; returns when ACCEPTED (not when the turn completes)
      // returns the runtime-owned sessionId so a caller of a NEW session can reconnect
      sendMessages(input: AgentSendInput): Promise<{ accepted: true; sessionId: string; startIndex: number }>
      // subscribe/replay the AgentEvent stream from an offset; reconnect-safe
      reconnectToStream(sessionId: string, opts: { startIndex: number }): AsyncIterable<AgentEvent>
      resolveInput(sessionId: string, requestId: string, response: ResolveInputResponse): Promise<void>
      stop(sessionId: string): Promise<void>
      interrupt(sessionId: string): Promise<void>
    }
    ```
    Keep it `sessionId`-keyed (two-handles). `AgentSendInput` is the single shared send-input type (defined in shared per TODO-P1/BBP1-002 — do not introduce a second input type here); `ResolveInputResponse` is the union defined in `TODO-T1`/`BBT1-004` (import it, do not redeclare). Document each method + reconnect semantics (at-least-once from `startIndex`, dedupe by `eventIndex`) in the file header.
    - **Contract text (not just a bead note):** `sendMessages()` maps **1:1 onto `agent.start(input)`** — it returns the accepted receipt `{ accepted: true, sessionId, startIndex }` the instant the turn is admitted and does **not** wait for the turn to complete or read any event (no "drain to first event"). The `sessionId` is **runtime-owned**: for a NEW session the caller does not know it up front and needs the returned value to `reconnectToStream`; it echoes back an existing `sessionId` for a follow-up turn. The turn runs to completion on the façade's independent producer regardless of any consumer. The turn's events are consumed separately via `reconnectToStream(sessionId, { startIndex })` (which maps onto `agent.stream`). This accepted-then-stream split is part of the transport contract, identical in-process and over HTTP.
  - `packages/agent/src/shared/__tests__/transport.conformance.ts` (new): `runTransportConformance(makeTransport, driveAgent)` covering:
    - `sendMessages` for a NEW session returns `{ accepted: true, sessionId, startIndex }` with a runtime-owned `sessionId`; passing that `sessionId` back into `reconnectToStream` yields the turn's events in `eventIndex` order.
    - `reconnectToStream` from mid-offset replays exactly the missed events (lossless), no dupes across a simulated drop.
    - approval round-trip: a `data-approval-request` event surfaces, `resolveInput` unblocks the turn.
    - `interrupt`/`stop` terminate the turn.
    - idempotent replay: two overlapping `reconnectToStream` calls dedupe by `eventIndex`.
- **Files to touch**: none in product code yet (adapters in BBT2-002/003 register against this).
- **Acceptance**: suite compiles and is exported for reuse; documents the contract precisely.

### BBT2-002 — In-process transport over `createAgent()`  · size M
- **Title**: `ChatTransport` implemented by calling the façade directly (no HTTP).
- **Files to create**:
  - `packages/agent/src/server/transport/inProcessTransport.ts` (new): wraps `createAgent()` — `sendMessages` → `agent.start(input)` (returns the `{ accepted, sessionId, startIndex }` receipt directly, no drain — `agent.start` already yields the runtime-owned `{ sessionId, startIndex }`); `reconnectToStream` → `agent.stream(sessionId, { startIndex })`; `resolveInput`/`stop`/`interrupt` → façade methods.
- **Tests**: `inProcessTransport.test.ts` calling `runTransportConformance(makeInProcess, …)` from BBT2-001.
- **Acceptance**: in-process transport passes the shared suite; imports only `createAgent`/shared types (no Fastify, no front).

### BBT2-003 — HTTP transport over DS routes + `@durable-streams/client`  · size L
- **Title**: Front `ChatTransport` that POSTs turns and reconnects via `@durable-streams/client` against T1's DS `GET`/`HEAD` stream route.
- **Files to create/touch**:
  - `packages/agent/src/front/chat/pi/dsHttpTransport.ts` (new): implements `ChatTransport` over **only the locked canonical write-route family** (T1-defined, see `TODO-T1`): `sendMessages` → POST `…/api/v1/agents/:agentId/sessions/:sessionId/prompt` for a follow-up turn, or POST `…/api/v1/agents/:agentId/sessions` (no `sessionId`) to create a session on the first turn (reuse existing receipt shape); `reconnectToStream(sessionId,{startIndex})` → `@durable-streams/client` subscribed to `GET …/agents/:agentId/sessions/:sessionId/events/stream` (T1 route, locked family; `:agentId` canonical `default` until P7) starting at the DS offset for `startIndex`; map each `AgentEvent` back to the pi-chat UI store dispatches (`cursor-sync`, event apply) that `usePiSessions` expects. `resolveInput` → POST `…/api/v1/agents/:agentId/sessions/:sessionId/input`; `interrupt` → POST `…/api/v1/agents/:agentId/sessions/:sessionId/interrupt`; `stop` → POST `…/api/v1/agents/:agentId/sessions/:sessionId/stop`. **Do NOT** target the legacy `…/pi-chat/:sessionId/*` paths — those are deleted at cutover (BBT2-006).
  - `packages/agent/src/front/chat/pi/remotePiSession.ts` (touch): re-express `RemotePiSession` on top of `dsHttpTransport` — replace `runEventStream`/`buildPiChatEventsUrl`/`readPiChatNdjsonStream`/`schedulePiChatReconnect` usage with `reconnectToStream`. `@durable-streams/client` owns backoff + offset checkpointing (delete the bespoke `calculateJitteredBackoffDelayMs`/`schedulePiChatReconnect` reconnect loop, and the `replay_gap`/`cursor_ahead` rehydrate recovery — DS catch-up makes gaps impossible). Keep the class's public methods (`start`, `prompt`, `interrupt`, `stop`, debug state) byte-compatible so `usePiSessions` is untouched.
  - Package: add pinned `@durable-streams/client` to `packages/agent/package.json` deps.
- **Implementation notes**: `startIndex` (integer `eventIndex`) ↔ DS offset conversion lives behind the transport (T1's `stream`/routes already speak both). The old `start(cursor)` cursor becomes `startIndex`; `store.dispatch({type:'cursor-sync', cursor})` maps to the last-seen `eventIndex`. Heartbeats/`Stream-Up-To-Date` drive the `connection-state` dispatch that today comes from NDJSON heartbeats.
- **Tests**: `dsHttpTransport.test.ts` via `runTransportConformance` against an in-memory fastify app mounting T1's DS route + `createAgent()`; assert reconnect after a forced stream close replays losslessly. Update `remotePiSession.test.ts` expectations.
- **Acceptance**: HTTP transport passes the same suite as in-process (08 conformance item 3); `remotePiSession` public surface unchanged.

### BBT2-004 — Refit `usePiSessions`/`PiChatPanel` to public contract + two-handles lint  · size M
- **Title**: Consume only the public contract; document + enforce the addressing boundary.
- **Files to touch**:
  - `packages/agent/src/front/chat/session/usePiSessions.ts`: ensure it depends only on the `ChatTransport` interface + `createRemoteSession` injection (it already injects — verify no deep import into transport internals remains). No behavioral change.
  - `packages/agent/src/front/chat/PiChatPanel.tsx`: verify it imports only `usePiSessions` + shared types, no transport internals. Remove any leftover `piChatStream` imports.
  - `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` is the spec; add a short doc `packages/agent/docs/transport.md` (new) recording: the `ChatTransport` contract, and that `x-boring-workspace-id → SessionCtx` mapping lives in `getRequestContext` (`server/http/routes/piChat.ts`) — the pattern every surface adapter (Slack `conversationKey→sessionId`, Excel workbook→sessionId) replicates. Public agent APIs accept `sessionId` only.
  - **Invariant**: extend `scripts/audit-imports.ts` (or `packages/agent`'s `check-invariants`) with a rule that fails if any exported signature in `packages/agent/src/server/createAgent.ts` / `shared/transport.ts` / the façade references **surface-native platform-addressing types** — Slack team/channel/thread ts, workbook/sheet ids, workspace pane ids, and the raw `x-boring-workspace-id` header string. **Allowlist `SessionCtx`** (`{ workspaceId, userId? }`): it is boring's OWN runtime tenancy context (the `SessionStore` key) and is explicitly permitted on the façade — do NOT forbid it, and do NOT forbid `workspaceId`/`userId` as `SessionCtx` fields. The guard forbids surface-native identifier types only. Grep-based guard is acceptable (match param/type names against the forbidden surface-native set, with `SessionCtx` allowlisted), matching the style of existing `check-invariants.sh`.
- **Tests**: an invariant test whose deliberately-bad negative fixture adds a **surface-native identifier** to a `createAgent` public method — a Slack thread `ts`, a workbook/sheet id, or the raw `x-boring-workspace-id` header string — and asserts the guard **fails**. Do **NOT** use `workspaceId` in the negative fixture: `SessionCtx { workspaceId, userId? }` is allowlisted tenancy, so adding `workspaceId` must **pass** the guard (add that as the positive/allowlist assertion). `PiChatPanel` render test unchanged/green.
- **Acceptance**: workspace UI runs unmodified (08 exit); the guard blocks platform addressing in core signatures; `transport.md` documents the adapter-owned mapping.

### BBT2-005 — Headless Node consumer driving the same session  · size S
- **Title**: A script/test that drives a session over the in-process transport, interleaved with a simulated UI on the HTTP transport.
- **Files to create**:
  - `packages/agent/scripts/headless-consumer.mts` (new): `createAgent()` → in-process transport → `sendMessages` a turn, stream `AgentEvent`s to stdout, answer an approval via `resolveInput`. Runnable with `tsx` (matches existing `dev`/`eval` scripts using `tsx`).
  - `packages/agent/src/server/transport/__tests__/interleaved.test.ts` (new): one `createAgent()` shared by an in-process transport and an HTTP transport (fastify inject); the HTTP client (simulating the UI) and the Node consumer both subscribe from `startIndex`, and a turn started by one is observed losslessly by the other; an approval requested in one is answered by the other (mirrors T1 BBT1-006 cross-client resume, now at the transport layer).
- **Acceptance**: 06 Phase T2 exit — "a headless Node consumer drives the same session interleaved with the UI." Script runs clean; interleaved test green.

### BBT2-006 — Delete the legacy server-side `?cursor=` NDJSON replay path (final cutover)  · size M
- **Title**: Remove the bespoke `?cursor=` NDJSON replay end-to-end — server route handling, `PiChatReplayBuffer`, and the superseded front helpers — after the DS transport is proven.
- **Precondition (hard)**: land this **last in the same T2 PR stack**, only after BBT2-003's DS transport passes `runTransportConformance` **and** the workspace playground runs unmodified on the refit (per the no-parallel-implementations rule, `todos-v2/README.md` rule 4). Until then the legacy path may coexist (the additive DS routes are the flag, per README "Versioning & flagging").
- **Files to delete/touch**:
  - `packages/agent/src/server/http/routes/piChat.ts` (touch): remove the `?cursor=` events-route handling — the `GET …/pi-chat/:sessionId/events?cursor=N` NDJSON replay branch and its cursor parsing/validation — leaving only the T1 DS `GET`/`HEAD` stream routes as the reconnect surface. **Also delete the legacy write routes** — the `POST …/pi-chat/:sessionId/prompt`, `…/interrupt`, and `…/stop` handlers — now that `dsHttpTransport` (BBT2-003) writes only to the canonical `…/api/v1/agents/:agentId/sessions/:sessionId/{prompt,interrupt,stop}` family (creation via `POST …/agents/:agentId/sessions`) that T1 defined. The canonical family is the sole write surface post-cutover; no legacy `pi-chat` write path survives.
  - `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts` (delete): the bespoke replay buffer; and `packages/agent/src/server/pi-chat/__tests__/piChatReplayBuffer.test.ts` (delete). Remove its construction/usage in `packages/agent/src/server/pi-chat/harnessPiChatService.ts` (the ring-buffer replay wiring) — DS's durable offset-addressed catch-up (T1) is now the only replay authority.
  - `packages/agent/src/front/chat/pi/piChatStream.ts` (delete): the superseded front reconnect/cursor helpers (`buildPiChatEventsUrl`, `readPiChatNdjsonStream`, `processPiChatSequencedEvent`, `schedulePiChatReconnect`, `calculateJitteredBackoffDelayMs`, `parsePiChatReplayRangeError`/`replayRangeErrorToRecovery`) — superseded by `dsHttpTransport` (BBT2-003). Delete its tests and remove every remaining import of it (grep `piChatStream` across `packages/agent/src` and migrate/drop each). Verify `remotePiSession.ts` no longer references any of these symbols.
- **Invariant / grep gate**: extend the T2 lint/invariant (BBT2-004's guard neighborhood, or `scripts/check-invariants.sh`) with a rule that **fails if any `?cursor=` replay code remains server-side** — grep `packages/agent/src/server/**` for the `cursor` NDJSON replay branch and for `PiChatReplayBuffer`, asserting **no matches**; likewise assert `piChatStream.ts` is gone and unreferenced, and that **no legacy `pi-chat/:sessionId/{prompt,interrupt,stop}` write route** is registered (the canonical `agents/:agentId/sessions/:sessionId/*` family is the only write surface). Wire this into `pnpm --filter @hachej/boring-agent run lint:invariants`.
- **Tests**: existing pi-chat route + reconnect tests updated to the DS path (no `?cursor=` expectations remain); the new grep gate fails on a reintroduced legacy branch and passes on the cutover tree.
- **Acceptance**: no `?cursor=` NDJSON replay code (route branch, `PiChatReplayBuffer`, or `piChatStream.ts`) remains anywhere in `packages/agent`; no legacy `…/pi-chat/:sessionId/{prompt,interrupt,stop}` write route remains (the canonical `…/api/v1/agents/:agentId/sessions/:sessionId/*` family is the sole write surface); the grep/invariant gate is active in `lint:invariants`; the DS transport is the sole reconnect/replay path; workspace UI runs unmodified.

## Verification — exact commands (verified against package.json scripts)

```bash
# unit + conformance (agent package)
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run lint:invariants
# monorepo import boundary + isolation guards (two-handles enforcement lands here)
pnpm run audit:imports
pnpm run check:agent-isolation
# front bundle-size gate (new @durable-streams/client dep)
pnpm run check:bundle-size
# headless consumer smoke
pnpm --filter @hachej/boring-agent exec tsx scripts/headless-consumer.mts
# workspace UI still runs unmodified — drive the playground per the run recipe
#   (packages/workspace-playground; rebuild dist first). See project run skill.
```
T2 adds `@durable-streams/client` (pinned) to `packages/agent`. Node v22.22.

## Review gates

- In-process and HTTP transports pass the **same** `runTransportConformance` suite — identical `send`/`reconnect`/approval semantics (08 item 3).
- Reconnect goes through `@durable-streams/client` + T1's DS offsets; the `?cursor=` NDJSON path and `schedulePiChatReconnect`/`replay_gap` recovery are removed from the front (or fully superseded) by the final commit.
- `usePiSessions`/`PiChatPanel` external API unchanged; workspace UI runs unmodified (no consumer edits).
- Public contract keyed by `sessionId` only; the platform-addressing invariant guard is active and tested; `x-boring-workspace-id → SessionCtx` documented as adapter-owned (`transport.md`).
- Headless Node consumer interleaves with the UI against one shared `createAgent()` session (06 T2 exit).
- No new server-side event/approval logic (T1 owns it); any T1 gap filed as a bead, not patched here.

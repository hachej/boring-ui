# T1-durable-events — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md)
- [ ] P1 stub seams present: `createAgent()` façade + `resolveInput`/historical-`stream` typed stubs merged (BBP1-002..006) — T1 fills these in (else STOP+report)
- [ ] `packages/agent/src/server/createAgent.ts` and `packages/agent/src/shared/events.ts` exist before coding; T1 extends them and does not create a second façade/events module.
- [ ] `node -e "import('node:sqlite').then(() => console.log('node:sqlite ok'))"` passes (experimental warning is expected; no `better-sqlite3`).
- [ ] Current pi-chat tap rechecked: `publishChannelEvent(sessionId, channel, event)` in `packages/agent/src/server/pi-chat/harnessPiChatService.ts` is still the single live-event funnel, and the legacy `?cursor=` route in `packages/agent/src/server/http/routes/piChat.ts` is still the route kept until BBT2-006.

## Beads
- [ ] BBT1-001 — Vendor + fix EventStreamStore into the repo
- [ ] BBT1-002 — AgentEvent envelope + append at the harness tap
- [ ] BBT1-003 — DS-compliant GET/HEAD routes + `agent.stream()`
- [ ] BBT1-004 — `needsApproval` on AgentTool + on-stream request/park/resume
- [ ] BBT1-005 — Migrate ask-user + permission prompts onto the single path
- [ ] BBT1-006 — Harness conformance additions

## Verification commands
- [ ] `node -e "import('node:sqlite').then(() => console.log('node:sqlite ok'))"`
- [ ] `pnpm --filter @hachej/boring-agent test`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-ask-user run test`
- [ ] `pnpm --filter workspace-playground run test:e2e -- plugins/ask-user/e2e/ask-user.spec.ts`
- [ ] `pnpm run check:agent-isolation`
- [ ] `pnpm run audit:imports`

## Review gates
- [ ] Flue append is transactional (single `runTransaction`); a mid-append throw leaves no gap (test proves it).
- [ ] DS header/field names byte-identical to `@durable-streams/client` constants; catch-up + SSE + long-poll + HEAD + 304 all covered.
- [ ] `AgentEvent.chunk` is `PiChatEvent`; AI-SDK part union unchanged; envelope only added.
- [ ] `stream()`/store keyed by runtime-owned globally unique `sessionId` only; `agentId` is route/session metadata and never a store/replay key; no `workspaceId`/platform addressing in core signatures (08 two-handles).
- [ ] Exactly one approval channel after BBT1-005; `ask-user.v1.*` bridge not on the happy path.
- [ ] Store + `stream()` importable with no Fastify; only route files import Fastify (Phase 1 invariant intact).
- [ ] `publishChannelEvent` appends through a per-channel serialized async path: SQLite append commits before live fanout; failed append prevents fanout; no event overtakes an earlier event.
- [ ] `agent.sessions.pendingInputs(ctx, opts?)` is the only pending-input listing API; it is an `AgentSessions` façade accessor reading `state.db` (not a raw `SessionStore`/JSONL method and not `events.db`); `ctx: SessionCtx` is required and cross-tenant leakage is tested.
- [ ] `piChatReplayBuffer.ts` and `?cursor=` NDJSON route still present (front cutover deferred to T2) and retained legacy code carries `TODO(remove:BBT2-006)`.

## Exit criteria
- [ ] `AgentEvent` envelope persisted per session in append-only `events.db`; every chunk appended to a durable, offset-addressed SQLite stream at the `publishChannelEvent` tap; T1 replaces P1's in-memory `eventIndex` source with SQLite `seq` on the same field.
- [ ] `agent.stream(sessionId, { startIndex })` + DS-compliant `GET`/`HEAD` stream routes (catch-up from offset, SSE + long-poll) behind a Fastify↔WHATWG bridge.
- [ ] SSE drop + reconnect replays losslessly (proven by conformance test; front cutover is T2).
- [ ] `needsApproval` on `AgentTool`; approval-request emitted on-stream; pending request + session `waiting` state durable in `state.db`; turn parks; `resolveInput(sessionId, requestId, response)` in-process + `POST …/input` route.
- [ ] Resume model: same-process resume continues the live parked turn; after a restart `resolveInput` continues via a **new seeded harness turn** (tool-result injection on JSONL rehydration) — no in-memory turn continuation rehydrated, no `WaitingTurn` state machine.
- [ ] ask-user + any permission prompts ride the single approval path — no second channel (`ask-user.v1.*` bridge, `AskUserStatePublisher`, `questionsRoutes`, `FileAskUserStore` deleted in T1).
- [ ] Harness conformance additions pass: envelope ordering, replay-from-index, durable pending-request survival across restart, same-process approval park/resume.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)

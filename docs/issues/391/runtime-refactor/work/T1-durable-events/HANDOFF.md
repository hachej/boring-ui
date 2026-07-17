> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

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
- [ ] BBT1-004 — transactional approval request/pending state + authorized resolve
- [ ] BBT1-005 — Migrate ask-user + permission prompts onto the single path
- [ ] BBT1-006 — Harness conformance additions
- [ ] BBT1-007 — Pi JSONL / durable-event crash recovery
- [ ] BBT1-008 — Durable caller request receipts
- [ ] BBT1-009 — Production file-backed `agent.db` composition and ownership

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
- [ ] Public API uses runtime-owned `sessionId`; store/cache access derives a trusted structured session scope and UUID uniqueness is not authorization.
- [ ] `sessionStreamPath` and `appendAgentEvent` receive the trusted structured
      `SessionKey`; the harness retains the admission-time binding rather than
      reconstructing it from caller data.
- [ ] `SessionKey` and caller receipt scope include an authenticated subject;
      cross-user duplicate request/session ids neither collide nor authorize.
- [ ] Trusted key encoding/path helpers remain server-only; shared exports no
      `SessionKey` constructor, encoder, or storage path.
- [ ] Exactly one approval channel after BBT1-005; `ask-user.v1.*` bridge not on the happy path.
- [ ] Store + `stream()` importable with no Fastify; only route files import Fastify (Phase 1 invariant intact).
- [ ] `publishChannelEvent` appends through a per-channel serialized async path: SQLite append commits before live fanout; failed append prevents fanout; no event overtakes an earlier event.
- [ ] `agent.sessions.pendingInputs(ctx, opts?)` is the only pending-input listing API; it reads authoritative redacted `agent.db` rows and cross-scope access/resolution is rejected.
- [ ] `piChatReplayBuffer.ts` and `?cursor=` NDJSON route still present (front cutover deferred to T2) and retained legacy code carries `TODO(remove:BBT2-006)`.
- [ ] Standalone `createAgentApp()` and every T1-enabled CLI/core/workspace/full-app composer open one file-backed
      `agent.db` under the durable session root, injects it non-optionally, and
      closes it exactly once; route registration rejects memory/absence.

## Exit criteria
- [ ] `AgentEvent`, pending/waiting state, and idempotency receipts share `agent.db`; cross-table transitions commit atomically.
- [ ] `agent.stream(sessionId, { startIndex })` + DS-compliant `GET`/`HEAD` stream routes (catch-up from offset, SSE + long-poll) behind a Fastify↔WHATWG bridge.
- [ ] SSE drop + reconnect replays losslessly (proven by conformance test; front cutover is T2).
- [ ] `needsApproval` request event + pending row commit together; resolution is authorized/idempotent and does not delete the last recovery record before durable outcome.
- [ ] Restart expires/cancels the disposed waiter unless a future durable continuation journal exists; seeded recovery is never called resume.
- [ ] ask-user uses the single path after pending-state import or an explicit deployment drain; rollback is documented.
- [ ] Fault injection proves JSONL-before-event-append is reconciled or represented by an explicit durable terminal failure.
- [ ] Same caller `requestId`+payload returns its original receipt after restart;
      a different payload conflicts; crash windows never duplicate a model run.
- [ ] Fresh host-composer restart and backup/restore recover events, pending
      input, receipts, and the documented JSONL reconciliation state.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)

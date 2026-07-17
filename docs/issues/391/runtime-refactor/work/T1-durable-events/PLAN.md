> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# T1-durable-events — Plan

> **Post-v1 work order (2026-07-10).** Durable event admission, replay, and
> request idempotency remain valuable but are not part of the first dedicated
> workspace-backed release. Dispatch only after a named consumer requires the
> durable contract; P1 must not prebuild it.

> Phase: Phase T1 — Event envelope and replay (after Phase 1) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the event-stream contract, human-in-the-loop, two-handles, and conformance sections; the locked Durable Streams wire-protocol decision this phase implements.

## Design context
Phase T1 adds durable offset-addressed replay and one approval path after P1. The wire follows Durable Streams, but v1 embeds one SQLite `agent.db`: append-only events, authoritative pending/waiting rows, and idempotency receipts share a transaction when one logical transition touches them. Pi JSONL remains the conversation-state compatibility authority. T1 must define and fault-test recovery when JSONL commits before a transport event append. Public APIs retain `sessionId`; access and caches use a trusted structured session scope rather than UUID uniqueness as authorization. Same-process approval resolution may continue a live waiter. Across restart, v1 preserves visibility but either expires/cancels the turn or performs explicitly named recovery; it does not call a seeded new turn transparent resume. The legacy cursor route remains only until T2 cutover.

## Verified current repo reality (pre-T1)
- The current live stream is still the legacy pi-chat path: `packages/agent/src/server/pi-chat/harnessPiChatService.ts` funnels events through `publishChannelEvent(sessionId, channel, event)` and `PiChatReplayBuffer`, while `packages/agent/src/server/http/routes/piChat.ts` exposes `GET /api/v1/agent/pi-chat/:sessionId/events?cursor=N` as NDJSON with 409 cursor-range errors.
- P1-created files are not present in this prep worktree yet: `packages/agent/src/server/createAgent.ts` and `packages/agent/src/shared/events.ts` must exist before T1 starts. T1 extends those P1 seams; it does not invent parallel façades.
- `packages/agent/src/shared/session.ts` currently has `SessionStore` list/create/load/delete only; `agent.sessions.pendingInputs(ctx, opts?)` is a T1 façade accessor over the authoritative `agent.db` pending-request table and must be explicitly scoped by trusted host context.
- `packages/agent/src/shared/tool.ts` currently has `AgentTool` without `needsApproval`; `plugins/ask-user` is the only existing approval-like channel and uses WorkspaceBridge operations `ask-user.v1.*` plus `FileAskUserStore`.
- `packages/agent/package.json` currently has no `./core` export and does have `test`, `test:e2e`, `test:chat-baseline`, `test:bombadil:chat`, `test:regression`, `typecheck`, `lint:invariants`, and `check:isolation`. `plugins/ask-user/package.json` is `@hachej/boring-ask-user` and has `test`.
- The local Node is v22.22.1 and `import('node:sqlite')` works with the expected experimental warning; T1 still keeps an explicit preflight command because the store depends on it.

## Deliverables
- `AgentEvent` envelope around the existing `PiChatEvent`; monotonic index persisted in `agent.db`. Supersedes the bespoke replay route at T2 cutover.
- One SQLite authority: event append, pending/waiting transitions, Pi re-tap
  keys, and caller request receipts share `agent.db`. Caller receipts are keyed
  by trusted admission scope plus `requestId`, so new-session retries survive
  restart before a caller has a `sessionId`. Pi JSONL remains the
  conversation-state compatibility authority and has an explicit
  reconciler/terminal-failure rule.
- Production host wiring for standalone `createAgentApp()` and CLI/core/
  workspace/full-app opens/migrates one file-backed `agent.db` beneath the
  durable session root and injects it as a required owned unit. T1 route hosts
  reject missing/in-memory storage; only explicit transport-less headless/dev
  composition may use the in-memory adapter.
- `agent.stream(sessionId, { startIndex })` (replay-from-offset + live tail — the read primitive from 08); HTTP adapter = DS-compliant `GET`/`HEAD` stream routes (catch-up from offset, SSE + long-poll).
- Approvals/HITL on-stream: `needsApproval`, request event and pending row in one transition, `resolveInput()`, and ask-user migration after a drain/import rule. Same-process continuation is distinct from restart recovery.
- Harness conformance additions include envelope/replay ordering, transactional
  approval state, durable caller receipt idempotency, restart semantics, and the
  JSONL-before-event-append fault window.

## Exit criteria
- SSE drop + reconnect replays losslessly; another authorized client can answer an approval; standalone `createAgentApp()` and normal CLI/core/workspace/full-app restart prove file-backed recovery; restart leaves no unanswerable or silently resumed request; JSONL/event divergence is reconciled or represented by an explicit durable terminal state.

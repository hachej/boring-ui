> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# T2-transport — Handoff checklist

Derived strictly from [TODO.md](TODO.md) and [PLAN.md](PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] T1-durable-events merged — [../T1-durable-events/HANDOFF.md](../T1-durable-events/HANDOFF.md)
- [ ] T1 conformance suite green: durable `EventStreamStore`, `AgentEvent` envelope, DS `GET`/`HEAD` stream routes, `agent.stream(sessionId,{startIndex})`, and on-stream approvals already exist (do not start T2 before this)

## Beads
- [ ] BBT2-001 — Transport contract doc + shared conformance suite
- [ ] BBT2-002 — In-process transport over `createAgent()`
- [ ] BBT2-003 — HTTP transport over DS routes + `@durable-streams/client`
- [ ] BBT2-004 — Refit `usePiSessions`/`PiChatPanel` to public contract + two-handles lint
- [ ] BBT2-005 — Headless Node consumer driving the same session
- [ ] BBT2-006 — Delete the legacy server-side `?cursor=` NDJSON replay path (final cutover)
- [ ] BBT2-007 — Input-asset intake strategy over environment facts

## Verification commands
- [ ] `pnpm --filter @hachej/boring-agent test`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm run audit:imports`
- [ ] `pnpm run check:agent-isolation`
- [ ] `pnpm run check:bundle-size`
- [ ] `pnpm --filter @hachej/boring-agent exec tsx scripts/headless-consumer.mts`
- [ ] Workspace UI still runs unmodified — drive the playground per the run recipe (`packages/workspace-playground`; rebuild dist first)

## Review gates
- [ ] In-process and HTTP transports pass the **same** `runTransportConformance` suite — identical `send`/`reconnect`/approval semantics (08 item 3).
- [ ] Reconnect goes through `@durable-streams/client` + T1's DS offsets; the `?cursor=` NDJSON path and `schedulePiChatReconnect`/`replay_gap` recovery are removed from the front by the final commit.
- [ ] `usePiSessions`/`PiChatPanel` external API unchanged; workspace UI runs unmodified (no consumer edits).
- [ ] Public contract keyed by `sessionId` only; the platform-addressing invariant guard is active and tested; `x-boring-workspace-id → SessionCtx` documented as adapter-owned (`transport.md`).
- [ ] Input-asset intake is strategy-driven: writable accepting environment sink, provider-direct asset path allowed by host policy, or stable rejection; no behavior branches on `runtimeMode`.
- [ ] Headless Node consumer interleaves with the UI against one shared `createAgent()` session ([../../INDEX.md](../../../../391/runtime-refactor/INDEX.md) Phase T2 exit).
- [ ] No new server-side event/approval logic (T1 owns it); any T1 gap filed as a bead, not patched here.

## Exit criteria
- [ ] Transport contract (`send` + `reconnect`) documented; an in-process transport (direct `createAgent()`) and the HTTP+SSE adapter both pass one shared transport conformance suite.
- [ ] `usePiSessions`/`PiChatPanel` refit to consume only the public contract (no internal imports); custom `ChatTransport.reconnectToStream` wired to T1's `startIndex`/DS replay via `@durable-streams/client`.
- [ ] Two-handles rule enforced: public agent APIs accept `sessionId` only; `x-boring-workspace-id → SessionCtx` documented as adapter-owned; a lint/invariant blocks platform-addressing types in core signatures.
- [ ] Workspace UI runs unmodified against the refit; a headless Node consumer drives the same session interleaved with the UI.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../../../391/runtime-refactor/PR-PLAN.md) (this package's section)

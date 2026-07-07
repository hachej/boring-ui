# T2-transport — Plan

> Phase: Phase T2 — Transport adapters · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the AI-SDK `ChatTransport` (`sendMessages` + `reconnectToStream`) contract, the two-handles hard rule, and conformance item 3 (`send`+`reconnect` semantics identical in-process and over HTTP).

## Design context
Phase T2 formalizes the transport contract over the T1 durable stream. It defines a minimal AI-SDK-shaped `ChatTransport` (`sendMessages` + `reconnectToStream` + `resolveInput`/`interrupt`/`stop`), keyed by `sessionId` only, mapping 1:1 onto the Phase 1 façade members. It proves the contract with one shared conformance suite passed identically by an **in-process** transport (direct `createAgent()` consumption) and an **HTTP+SSE** adapter. The front stack (`RemotePiSession`/`usePiSessions`/`PiChatPanel` — the actual client stack) is refit to consume only the public contract (no internal imports), with reconnect wired to T1's `startIndex`/DS offsets via `@durable-streams/client` — replacing the bespoke `?cursor=` NDJSON replay and the `schedulePiChatReconnect`/`replay_gap` recovery dance. The two-handles rule is enforced by a lint/invariant that forbids surface-native platform-addressing types (Slack thread ts, workbook/sheet ids, workspace pane ids, raw `x-boring-workspace-id`) in core signatures, with boring's own `SessionCtx` tenancy context allowlisted. `sendMessages` returns an accepted receipt (`{ accepted, sessionId, startIndex }`) without draining; the turn runs on the façade's independent producer and is consumed separately via `reconnectToStream`. `originSurface?` session-create provenance is populated here (workspace/Slack/embed) for S3's badge. The legacy `?cursor=` server path, `PiChatReplayBuffer`, and `piChatStream.ts` front helpers are deleted **last**, only after the DS transport passes conformance and the workspace playground runs unmodified. T2 also replaces pure mode's temporary blanket attachment rejection with an environment-scoped `none | direct | workspace` capability: pure direct accepts only data-URL/HTTPS image parts that never touch workspace storage, pure none rejects all, and filesystem modes accept direct plus workspace-backed attachments. UI behavior and the render/projection layer are untouched — this is an internal transport swap.

## Deliverables
- Transport contract (`send` + `reconnect`) documented; in-process transport (direct `createAgent()` consumption) and HTTP+SSE adapter both pass a shared transport conformance suite.
- Front transport refit (`RemotePiSession`/`usePiSessions`/`PiChatPanel` — the actual client stack) to consume only the public contract (no internal imports); reconnect wired to DS `startIndex` replay via `@durable-streams/client`.
- Two-handles rule enforced: public agent APIs accept `sessionId` only; `x-boring-workspace-id`→`SessionCtx` mapping is HTTP-adapter code, documented as the pattern surface adapters replicate.
- Attachment validation is capability-driven per environment: `none` rejects all, `direct` accepts data-URL/HTTPS image parts that never touch workspace storage, and `workspace` accepts direct plus workspace-backed attachments.

## Exit criteria
- workspace UI runs unmodified against the refit; a headless Node consumer drives the same session interleaved with the UI.

## Verdict: **Revise** — direction is right, but ship-blocking gaps

Direction is correct (pi events as authority, projection on the wire, reducer client-side). But several concrete gaps will produce the exact bugs the plan claims to fix.

### Concrete amendments

**1. Eliminate split-brain, don't sequence it.**
The plan keeps AI SDK assistant chunks "for the first turn" and only suppresses them after follow-ups. Two writers into one model = the same bug class. Pick one:
- emit pi-message events from turn 0 and have the client ignore AI SDK assistant text/tool/reasoning parts entirely when pi mode is on, **or**
- gate per-session: server flips a `pi-events-mode: on` data chunk before any content; client picks one reducer for the whole session.
Mixed mode reintroduces the merge/misplacement bugs.

**2. Define `toolResult` reducer rule explicitly.**
Section "Client reducer" lists 6 rules but says nothing about `pi-message-start/end role: 'toolResult'`. Pi web-ui attaches tool results to the owning assistant's `tool-*` part by `toolCallId`. Specify: on `pi-message-end toolResult`, locate part by `toolCallId` on the assistant and set its `output`/state. Don't append a standalone bubble.

**3. Tool/reasoning part identity is missing from the wire DTO.**
`pi-message-update assistant` must carry `{ partKind, partKey (toolCallId | reasoningId | textId), state, deltaOrSnapshot }` — not an opaque `event: AssistantMessageEvent`. Without explicit part keys, idempotency rule 6 ("by messageId + part key") has no `part key`. Also: `event: AssistantMessageEvent` couples wire to pi internals; define a stable DTO.

**4. Add `seq` + resume.**
No mention of ordering source-of-truth or reconnect. Add a monotonic `seq` per session on every `data-pi-*` chunk and a `GET /pi-messages?sinceSeq=` for resume. Otherwise a dropped SSE mid-stream leaves a corrupt projection with no recovery path.

**5. Persistence: the short-term plan loses data.**
"AI SDK `/messages` persistence remains for normal non-follow-up chats only" is undecidable at write time — a chat becomes follow-up retroactively. Result: refresh after a follow-up turn → history shows only first turn. Either:
- ship the canonical endpoint now (pi `session.state.messages` → UIMessage projector) and skip client-side persistence entirely when pi mode is on, **or**
- persist the pi-projected `UIMessage[]` from the reducer with the same `messageId`s for idempotent rehydrate.
The "long-term" item is actually ship-blocking.

**6. messageId stability invariant.**
Reducer assumes pi `messageId` is stable from `message_start` through `message_end`. Add a unit test pinning this against the pi runtime; if pi ever assigns the id only at end, the whole reducer breaks.

**7. FIFO needs server-side ordering too.**
Client FIFO is necessary but not sufficient (HTTP/2 reorder, retries). `POST /followup` should accept a client `seq` and the server should reject/queue out-of-order rather than relying on arrival order alone.

**8. Optimistic queued bubble reconciliation.**
Rule 5 says "replace/mark optimistic bubble as committed when pi emits real user message." Specify the match key — pi will assign its own `messageId`. Use a client-generated `clientNonce` echoed back on `/followup` response and surfaced on the pi user `message_start` (server attaches), otherwise reconciliation is heuristic on text equality and will misbehave with duplicates.

### Risk ranking
1. Split-brain during migration window (#1) — highest, recreates current bugs.
2. Reload data loss (#5) — user-visible regression.
3. Missing part-key DTO (#3) — silently corrupts tool/reasoning state.
4. No seq/resume (#4) — flaky on real networks.

Tests section is fine but add: reducer test for `toolResult` attach-by-toolCallId, and a "drop & resume" integration test.

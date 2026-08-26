# Chat-turn sequence

```mermaid
sequenceDiagram
  participant B as Browser / RemotePiSession
  participant H as Addressed HTTP projection
  participant G as Embedded AgentGateway
  participant S as HarnessPiChatService
  participant P as Pi harness adapter
  participant N as Native Pi agent
  participant D as Durable event store
  participant L as Live replay buffer

  B->>H: GET state, then GET events(cursor)
  H->>G: readSessionState / connectSession
  G->>S: readState / subscribe
  S-->>G: snapshot + live subscription
  G-->>H: snapshot + addressed event envelopes
  H-->>B: JSON + NDJSON stream

  B->>H: POST prompt(requestId, clientNonce, content)
  H->>G: connectSession().send(prompt)
  G->>S: prompt(context, sessionId, payload)
  S->>P: adapter.prompt(input)
  P->>N: start native Pi run
  S-->>G: accepted cursor
  G-->>H: AgentSendReceipt
  H-->>B: HTTP 202 receipt

  N-->>P: native run events
  P-->>S: subscribed events
  S->>S: map to sequenced PiChatEvent
  opt durable stream enabled
    S->>D: append before live fan-out
  end
  S->>L: publish event
  L-->>G: subscribed event
  G-->>H: AgentSessionEvent envelope
  H-->>B: NDJSON frame
  B->>B: validate sequence and reduce event
```

The browser hydrates once and keeps an addressed NDJSON subscription while prompt acceptance returns independently of the Pi run. Native Pi events become sequenced `PiChatEvent`s, append durably first when enabled, then fan out through the live buffer to the browser reducer.

## Depicted files

- `packages/agent/src/front/chat/pi/remotePiSession.ts`
- `packages/agent/src/front/chat/pi/piChatStream.ts`
- `packages/agent/src/front/chat/pi/piChatReducer.ts`
- `packages/agent/src/server/agent-host/httpProjection.ts`
- `packages/agent/src/server/agent-host/embeddedGateway.ts`
- `packages/agent/src/server/agent-host/buildAgentComposition.ts`
- `packages/agent/src/core/piChatSessionService.ts`
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts`
- `packages/agent/src/server/pi-chat/piChatEvents.ts`
- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
- `packages/agent/src/server/events/eventStreamStore.ts`

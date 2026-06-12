# Pi-native chat history projection

## Problem

Pi has the correct chat model: a session is an ordered sequence of messages, and native follow-ups are just later user messages consumed by the running agent. The current browser adapter still treats follow-ups as special display artifacts because AI SDK reconstructs one active assistant message per request and can merge or misplace multi-turn chunks in a single stream.

This causes fragile behavior:

- queued messages may require custom insertion/splitting.
- assistant text can merge across turns unless part IDs are namespaced.
- tool/reasoning chunks from a follow-up can attach to the wrong AI SDK assistant message.
- browser `/messages` persistence can race or store a partial text-only projection.

## Goal

Follow-up should be special only at the input API boundary:

```ts
// while pi is idle
piSession.prompt(text)

// while pi is streaming
piSession.followUp(text)
```

After pi accepts/consumes the message, rendering/history should not distinguish normal messages from follow-up messages. The browser should render ordered pi messages like pi's own web UI does.

## Reference: pi web-ui

`earendil-works/pi/packages/web-ui` renders from pi session state and direct events:

- subscribes to `AgentSession` events (`message_start`, `message_update`, `message_end`, `agent_start/end`, `turn_start/end`).
- renders stable `session.state.messages`.
- renders the active streaming assistant separately to avoid duplicate stable+streaming display.

Because `@boring/agent` runs pi on the server, the browser cannot read `AgentSession.state` directly. We need a server-to-browser projection of pi message events.

## Review feedback integrated

Opus reviewed this plan and returned **revise**. The important corrections are now part of the plan:

- avoid split-brain migration: do not let AI SDK own first-turn history while pi projection owns follow-up history.
- define stable browser DTOs rather than exposing opaque pi internals.
- include stable part keys for text/reasoning/tool state.
- attach tool results to the owning assistant tool part by `toolCallId`.
- add monotonic per-session `seq` for ordering and eventual resume.
- solve persistence/hydration in the same pass, not later.
- use `clientNonce` + client/server sequence for optimistic queued follow-up reconciliation; do not rely on text matching.

## User decisions

The user accepted these choices:

1. Hydration source: read pi JSONL/session entries on demand and convert to UI messages if possible.
2. Out-of-order follow-up POST: reject with stable `followup_out_of_order` error first.
3. Pi mode scope: pi event reducer owns the whole session from first message.
4. Optimistic reconciliation: use `clientNonce` + `clientSeq`.
5. AI SDK assistant chunks in pi mode: suppress assistant text/reasoning/tool chunks at the AI SDK adapter layer; emit `data-pi-*` events instead, then the frontend reducer converts those into normal `UIMessage.parts` for existing text/reasoning/tool renderers. This does **not** remove UI formatting.
6. Review artifacts: move review output under `packages/agent/docs/plans/reviews/`.

## Decision

Build a pi-message projection channel and reducer from turn 0.

AI SDK remains useful as HTTP/SSE transport machinery, but it is not the chat history authority in pi mode. Pi events are the history authority for the whole session.

## Server contract

Emit browser-safe pi message chunks for all pi messages, not just follow-ups. Every event carries a monotonic `seq` scoped to the boring session.

```ts
type PiChatEvent =
  | { type: 'pi-mode'; seq: number; enabled: true }
  | { type: 'pi-agent-start'; seq: number }
  | { type: 'pi-agent-end'; seq: number }
  | { type: 'pi-message-start'; seq: number; messageId: string; role: 'user' | 'assistant'; clientNonce?: string; text?: string }
  | { type: 'pi-message-end'; seq: number; messageId: string; role: 'user' | 'assistant'; final: PiUiMessageSnapshot }
  | { type: 'pi-text-start'; seq: number; messageId: string; partId: string }
  | { type: 'pi-text-delta'; seq: number; messageId: string; partId: string; delta: string }
  | { type: 'pi-text-end'; seq: number; messageId: string; partId: string; text?: string }
  | { type: 'pi-reasoning-start'; seq: number; messageId: string; partId: string }
  | { type: 'pi-reasoning-delta'; seq: number; messageId: string; partId: string; delta: string }
  | { type: 'pi-reasoning-end'; seq: number; messageId: string; partId: string; text?: string }
  | { type: 'pi-tool-call-start'; seq: number; messageId: string; toolCallId: string; toolName: string }
  | { type: 'pi-tool-call-delta'; seq: number; messageId: string; toolCallId: string; delta: unknown }
  | { type: 'pi-tool-call-end'; seq: number; messageId: string; toolCallId: string; input: unknown }
  | { type: 'pi-tool-result'; seq: number; messageId: string; toolCallId: string; output: unknown; isError?: boolean }

type PiUiMessageSnapshot = {
  id: string
  role: 'user' | 'assistant'
  parts: UIMessage['parts']
}
```

AI SDK data chunk names:

- `data-pi-message-start`
- `data-pi-message-update`
- `data-pi-message-end`
- `data-pi-agent-start`
- `data-pi-agent-end`

In pi mode, the server must not send assistant text/reasoning/tool chunks that mutate AI SDK's active assistant history. It can still send data chunks, status chunks, and transport finish/error chunks. No split brain.

`data-pi-mode { enabled: true }` is emitted before the first content event so the client switches to the pi reducer for the whole session.

## Client reducer

Maintain `piMessages: UIMessage[]` derived from pi events.

Rules:

1. `pi-message-start user`
   - append/update a normal user message using pi `messageId`.
   - if it matches a locally queued pending follow-up, mark that pending entry consumed.

2. `pi-message-start assistant`
   - append a normal assistant message at the correct ordered position.

3. Part events
   - `pi-text-*` update text parts by `{ messageId, partId }`.
   - `pi-reasoning-*` update reasoning parts by `{ messageId, partId }`.
   - `pi-tool-call-*` update tool parts by `{ messageId, toolCallId }`.
   - `pi-tool-result` locates the owning assistant tool part by `toolCallId` and sets output/error state. Do not append standalone tool result bubbles.

4. `pi-message-end assistant`
   - replace/complete the assistant from pi's final message snapshot.
   - if streaming deltas were missing, synthesize final text from the snapshot.

5. Local queued follow-up while streaming
   - generate `clientNonce` and append an optimistic user bubble with status `queued`/`waiting`.
   - post to `/followup` using FIFO serialization and include `{ clientNonce, clientSeq }`.
   - when pi emits the real user message with matching `clientNonce`, replace/mark the optimistic bubble as committed and adopt pi `messageId`.
   - if no nonce is available (legacy server), fallback to FIFO only, never text equality as primary identity.

6. Duplicate events are idempotent by `seq`, `messageId`, and part key.

## FIFO follow-up posting

Client must serialize follow-up POSTs:

```txt
send q1(clientSeq=1) -> await 202 -> send q2(clientSeq=2) -> await 202 -> send q3(clientSeq=3)
```

Do not fire all queued POSTs concurrently. Pi executes follow-ups in arrival order, so client must preserve arrival order.

Server should also track the next expected `clientSeq` per active session while a stream is open. If an out-of-order follow-up arrives, either:

- reject with `409 followup_out_of_order`, or
- hold it server-side until missing earlier sequence arrives.

Default recommendation: reject with stable error code first; add hold/reorder later only if UX needs retries.

## Persistence and hydration

This is part of the implementation, not a later enhancement.

- Do not manually persist text-only projected history to `/messages`.
- Add a server endpoint to return canonical pi session messages converted to `UIMessage[]`.
- On reload, hydrate from canonical pi history.
- While pi mode is enabled, client `/messages` persistence is disabled or ignored for chat history.
- `/messages` may remain for non-pi/fallback harnesses only.

Open design choice: the canonical endpoint can either:

1. read pi session JSONL and convert entries to UI messages on demand; or
2. maintain a server-side projection cache during streaming and persist that projection.

Prefer 1 if pi JSONL exposes enough stable message data; otherwise use 2 with pi event replay.

## Rendering

Use the existing `ChatPanel` message renderer, but feed it pi-projected `UIMessage[]` when pi event mode is active.

Waiting follow-ups:

- render optimistic queued user bubble in italic
- muted/different background
- small `Waiting…` label
- after pi emits the real user message, render as normal user bubble

Tool/reasoning follow-up turns:

- must render under the assistant message that owns them.
- no tool/reasoning chunks from follow-up turns may attach to the first assistant message.

## Ordering and resume

Each `data-pi-*` event gets monotonic `seq`.

Client reducer ignores events with `seq <= lastAppliedSeq`.

Initial implementation must at least support full rehydrate from canonical pi messages on page load. Streaming resume via `sinceSeq` can be added if the existing HTTP stream-resume path needs it, but dropped-stream recovery must never rely on a stale partial client projection.

## Tests

Unit:

- reducer handles user -> assistant text.
- reducer handles user -> assistant reasoning -> text.
- reducer handles user -> assistant tool call -> tool result -> text, with tool result attached by `toolCallId`.
- reducer handles 3 queued follow-ups in FIFO order.
- duplicate pi start/end events do not duplicate messages.
- duplicate/out-of-order `seq` events are ignored or rejected as specified.
- optimistic queued message reconciles by `clientNonce`, including duplicate text messages.

Server:

- emits pi message events for initial user/assistant.
- emits pi message events for consumed follow-up user/assistant.
- emits `data-pi-mode` before content.
- suppresses AI SDK assistant chunks while pi mode is enabled so they do not mutate AI SDK history.
- canonical pi hydration endpoint returns the same ordered messages after reload.
- follow-up POST rejects or handles out-of-order `clientSeq`.

Browser/integration:

- real playground + OpenRouter Qwen 3.6.
- queue three text follow-ups; assert exact user/assistant interleaving.
- queue a tool follow-up (`list files` / `open package.json`) while first turn streams; assert tool UI appears under the follow-up assistant turn, not the first assistant.

## Non-goals

- Do not replace pi runtime.
- Do not invent a separate history truth.
- Do not persist lossy projected text-only history.
- Do not make follow-up a separate chat concept after pi consumes it; it is just a normal user message.

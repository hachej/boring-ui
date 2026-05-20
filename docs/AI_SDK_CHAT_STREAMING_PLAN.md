# AI SDK-Native Chat Streaming Plan

## Goal

Move the live chat display path back toward AI SDK-native `UIMessageChunk` handling while keeping the custom pi side-channel needed for native follow-up queueing, persistence, and debug/recovery.

The desired end state:

- AI SDK owns visible live message rendering for text/reasoning/tool parts.
- `useChat({ experimental_throttle: 50 })` is the primary React render throttle.
- `data-pi-*` remains a side channel for queue orchestration, pi message IDs, persistence, and compatibility.
- ChatPanel no longer needs to maintain a full parallel hot-path message renderer for normal streaming.

## Current state

Recent main commits improved symptoms:

- `fix(agent): coalesce tool-call fragments in chat`
  - Coalesces adjacent assistant tool fragments before rendering.
- `fix(agent): smooth pi message streaming`
  - Avoids rebuilding from AI SDK envelopes mid-stream.
- `fix(agent): throttle pi stream projection`
  - Adds `experimental_throttle: 50` to `useChat`.
  - Adds a matching 50ms client-side buffer for custom `data-pi-*` text/reasoning deltas.

These fixes help, but they leave us with two render systems:

1. AI SDK `useChat.messages`.
2. Custom `usePiChatProjection().piMessages`.

The custom path exists for good reasons, mainly pi native follow-up queueing and multi-turn streams, but it now duplicates responsibilities that AI SDK already solves better: part identity, React update throttling, and canonical message chunk handling.

## Why `data-pi-*` still exists

Do **not** blindly remove `data-pi-*`.

We need it for:

- pi-native message IDs.
- Native follow-up queue markers (`data-followup-consumed`, queued user turns inside one HTTP stream).
- Multi-turn stream boundaries.
- Persistence/rebuild after refresh.
- Tool result metadata and file-change events.
- Debug drawer / raw event inspection.

The plan is not “delete the pi protocol”. The plan is “stop using the pi protocol as the primary live display renderer when AI SDK standard chunks can do that job”.

## Target architecture

### Server stream

For visible content, emit canonical AI SDK chunks:

- `start`
- `text-start`
- `text-delta`
- `text-end`
- `reasoning-start`
- `reasoning-delta`
- `reasoning-end`
- `tool-input-available`
- `tool-output-available`
- `tool-output-error`
- `finish`

Keep side-channel chunks:

- `data-pi-message-start`
- `data-pi-message-end`
- `data-pi-text-*` during migration only / compatibility
- `data-pi-tool-*` during migration only / compatibility
- `data-followup-consumed`
- `data-file-changed`
- `data-status`

### Client stream

`ChatPanel` should prefer AI SDK messages for live display.

`usePiChatProjection` should become one of:

1. A compatibility fallback when only `data-pi-*` chunks are present.
2. A persistence/hydration helper for saved `data-pi-*` history.
3. A queue side-channel consumer that drives pending/queued UI but does not render every token.

### Smoothing

Rely on AI SDK for primary smoothing:

```ts
useChat({
  experimental_throttle: 50,
})
```

If provider chunks are visually bad even after throttle, add server-side chunk smoothing before writing AI SDK chunks. AI SDK `smoothStream()` is designed for `streamText()`, not arbitrary pi events, but the same idea can be implemented in the pi adapter: buffer text/reasoning and emit word/line-ish chunks while passing tools/status through immediately.

## Implementation plan

### Phase 1 — Map the stream contract

Files:

- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
- `packages/agent/src/server/harness/pi-coding-agent/stream-adapter.ts`
- `packages/agent/src/server/harness/pi-coding-agent/__tests__/streaming.test.ts`
- `packages/agent/src/server/harness/pi-coding-agent/__tests__/stream-adapter*.test.ts`

Tasks:

1. Document which pi events currently produce standard AI SDK chunks vs `data-pi-*` chunks.
2. Identify where `createHarness.ts` filters out standard chunks:
   - currently `text-*` / `reasoning-*` chunks are removed from `sdkChunksForTurn`.
3. Add tests describing the desired dual stream:
   - standard chunks are emitted for visible text/reasoning.
   - `data-pi-*` chunks are still emitted for side-channel state.
   - queued follow-up turns namespace part IDs and do not collide.

Acceptance:

- Contract tests fail before implementation and clearly show expected standard chunks.

### Phase 2 — Emit standard visible chunks again

Tasks:

1. Stop filtering standard `text-*` and `reasoning-*` chunks out of `sdkChunksForTurn`.
2. Ensure part IDs are stable and namespaced across inline queued turns.
3. Verify tool chunks are canonical and complete:
   - `tool-input-available` at tool call end/start as appropriate.
   - `tool-output-available` / `tool-output-error` at execution end.
4. Keep `data-pi-*` side-channel chunks in the same stream.

Acceptance:

- AI SDK `useChat.messages` contains visible assistant text/reasoning/tools during normal live streaming.
- Side-channel chunks still arrive for follow-up queue/persistence.

### Phase 3 — Make ChatPanel prefer AI SDK messages

Files:

- `packages/agent/src/front/ChatPanel.tsx`
- `packages/agent/src/front/pi/piChatProjection.ts`
- `packages/agent/src/front/pi/piNativeFollowUpQueue.ts`
- `packages/agent/src/front/__tests__/ChatPanel.test.tsx`
- `packages/agent/src/front/pi/__tests__/piChatProjection.test.ts`

Tasks:

1. Add a capability check:
   - if `messages` has standard visible assistant parts for the active stream, render `messages + projectedTailMessages`.
   - otherwise fall back to `piMessages`.
2. Keep `handlePiData` for side effects and persistence compatibility, but prevent it from competing with AI SDK live rendering.
3. Narrow or remove broad assistant-message coalescing once AI SDK chunks give stable message structure.
4. Keep follow-up queue UI working:
   - pending user message appears immediately.
   - `data-followup-consumed` clears pending state.
   - next assistant starts in correct position.

Acceptance:

- Normal stream display comes from AI SDK messages.
- Legacy/saved `data-pi-*` sessions still render.
- Follow-up queue behavior unchanged.

### Phase 4 — Remove duplicate hot-path buffering where safe

Tasks:

1. If AI SDK standard chunks are the primary display path, remove or disable custom 50ms token buffering for active live display.
2. Keep a simple fallback buffer only for compatibility path.
3. Keep `experimental_throttle: 50` in `useAgentChat`.
4. Add a config/constant if we need to tune throttle later.

Acceptance:

- One primary live renderer.
- No competing per-token state updates.
- Smooth streaming with fewer layout jumps.

### Phase 5 — Auto-scroll on new user turn

Files:

- `packages/agent/src/front/primitives/conversation.tsx`
- `packages/agent/src/front/ChatPanel.tsx`

Tasks:

1. Add an explicit scroll-to-bottom trigger for new user submissions / queued follow-ups.
2. Preserve user-controlled scroll during passive streaming:
   - force bottom on local submit.
   - do not yank to bottom if user scrolled up while assistant streams.
3. Add tests or a small integration harness if feasible.

Acceptance:

- Entering a new message scrolls to bottom immediately.
- Streaming does not fight user scroll position.

## Test matrix

### Unit / component tests

- ChatPanel renders standard AI SDK message stream without pi projection.
- ChatPanel falls back to pi projection for persisted `data-pi-*` sessions.
- Tool groups remain collapsed and grouped.
- Queued follow-up user message appears and clears on consume.
- Adjacent legitimate assistant messages are not incorrectly merged.
- `text-end` final text repairs partial text.

### Server stream tests

- pi text events emit both:
  - standard `text-*` chunks
  - side-channel `data-pi-text-*` chunks during migration
- pi reasoning events emit standard `reasoning-*` chunks.
- tool execution emits standard tool input/output chunks plus side-channel data.
- inline queued turn IDs do not collide.

### Manual UX checks

- Long text response streams smoothly.
- Tool-heavy response produces compact collapsed tool groups.
- Follow-up submitted while assistant is running appears in correct order.
- New user submit scrolls to bottom.
- User scrolling up during assistant stream is respected.
- Refresh/reopen session preserves history.

## Risks

### Broad assistant coalescing

Current coalescing merges adjacent assistant messages when either side has a tool part. This should become unnecessary or narrower once AI SDK visible chunks are canonical. Risk: legitimate adjacent assistant messages can lose separation.

### Duplicate visible parts during migration

If ChatPanel renders both AI SDK standard parts and pi projection parts, duplicate text/tool cards can appear. The client must choose one primary display source per stream.

### Queue boundaries

AI SDK generally models one assistant response at a time. Pi native follow-up can produce multiple turns in one HTTP response. Part ID namespacing and message boundaries must be tested carefully.

### Persistence format drift

Saved sessions may contain old `data-pi-*` envelopes. Fallback rebuild must remain until old sessions can be migrated or ignored safely.

## Open decisions

1. Should `data-pi-text-*` continue forever as persistence data, or be replaced with persisted canonical `UIMessage`s plus smaller pi metadata?
2. Should stream smoothing be:
   - only AI SDK `experimental_throttle`, or
   - plus server-side pi chunk smoothing?
3. Should throttle be hardcoded at 50ms or exposed as a `ChatPanel` / app option?
4. How long do we support old sessions containing only `data-pi-*` envelopes?

## Proposed branch/worktree

- Branch: `plan/ai-sdk-chat-streaming`
- Worktree: `/home/ubuntu/projects/boring-ui-v2-ai-sdk-chat-streaming`

This plan file should land first, then implementation should proceed in small commits by phase.

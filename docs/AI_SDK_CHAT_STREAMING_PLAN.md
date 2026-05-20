# AI SDK-Native Chat Streaming Plan

## Goal

Leverage AI SDK for as much of chat streaming as possible while preserving the pi-native message queue behavior that AI SDK does not model on its own.

Desired end state:

- Normal single-turn assistant streaming renders from AI SDK `useChat.messages`.
- AI SDK owns visible text/reasoning/tool part identity and React update throttling.
- `data-pi-*` remains a side-channel for queue orchestration, pi message IDs, compatibility persistence, and debug/recovery.
- Custom `usePiChatProjection()` is no longer the default hot-path renderer for ordinary turns; it is a fallback for queue/legacy cases.
- Entering a new user message explicitly scrolls to bottom without fighting user scroll during passive streaming.

## Key finding from git history

We should **not** revert to the pre-queue implementation. The native follow-up queue work is real and necessary.

But history shows a better hybrid point than current `main`:

### Good historical shape — `3289397c fix(agent): project pi follow-up history`

This commit kept AI SDK standard visible chunks for the first/normal assistant turn and only suppressed standard text/reasoning chunks for inline queued follow-up turns:

```ts
const sdkChunksForTurn = inlineTurnIndex > 0
  ? sdkChunks.filter((chunk) => {
      const t = (chunk as { type?: string }).type
      return t !== "text-start" && t !== "text-delta" && t !== "text-end"
        && t !== "reasoning-start" && t !== "reasoning-delta" && t !== "reasoning-end"
    })
  : sdkChunks
```

That is the architecture we want to recover: **AI SDK for the normal visible stream, pi projection only for queued inline turns / legacy fallback.**

### Divergence — `cba3e810 feat(agent): render chat from pi DTO stream`

This changed the architecture so every turn filtered out AI SDK text/reasoning chunks and rendered from `data-pi-*` DTOs instead. That fixed follow-up history correctness but made us reimplement AI SDK responsibilities:

- token update cadence
- part identity
- text/reasoning/tool projection
- visible stream smoothing
- message grouping

Recent commits (`853c108c`, `9b631694`, `38a3018a`) patch symptoms of that divergence. They should not become the long-term architecture.

## What to keep vs revert

### Keep

- Native follow-up queue mechanism.
- `data-followup-consumed` and projected pending user messages.
- `data-pi-*` side-channel events.
- Pi message ID preservation.
- Persisted history compatibility.
- `useChat({ experimental_throttle: 50 })`.
- `usePiChatProjection()` as fallback and persistence compatibility.

### Rework / partially revert

- The global suppression of standard AI SDK `text-*` / `reasoning-*` chunks.
- Default rendering from `piMessages` whenever any pi projection exists.
- Broad assistant-message coalescing as a normal display fix.
- Custom 50ms pi delta batching as the normal stream smoother.

## Why `data-pi-*` still exists

Do **not** blindly delete `data-pi-*`.

It is needed for:

- pi-native message IDs.
- Native follow-up queue markers.
- Multi-turn stream boundaries inside one HTTP response.
- Compatibility with sessions already persisted as `data-pi-*` envelopes.
- Tool result metadata and file-change events.
- Debug drawer / raw event inspection.

The goal is to stop using `data-pi-*` as the **default visible renderer** for normal single-turn streams.

## Target architecture

### 1. Server stream: dual channel

For visible content, emit canonical AI SDK chunks whenever AI SDK can model the turn:

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

For side-channel state, continue emitting:

- `data-pi-message-start`
- `data-pi-message-end`
- `data-pi-text-*` for compatibility / fallback while migration is active
- `data-pi-reasoning-*` for compatibility / fallback while migration is active
- `data-pi-tool-*` for compatibility / fallback while migration is active
- `data-followup-consumed`
- `data-file-changed`
- `data-status`

### 2. Server stream: normal vs queued turns

Use the historical hybrid rule:

- `inlineTurnIndex === 0`: keep standard AI SDK visible chunks.
- `inlineTurnIndex > 0`: suppress **all standard visible chunks** (`text-*`, `reasoning-*`, canonical tool chunks, sources/files) and let `data-pi-*` projection render the queued inline turn until we have a robust multi-message AI SDK strategy. Non-visible status/control chunks may pass through if they cannot mutate the active AI SDK assistant message.

Why: AI SDK’s `AbstractChat` active response state models one assistant response at a time. Pi can emit multiple user/assistant turns inside one open HTTP stream when a follow-up is queued. Until we explicitly solve multi-response boundaries for AI SDK, queued inline turns remain the pi projection path.

### 3. Client display source selection

ChatPanel should choose visible sources by **stream segment**, not by the whole HTTP response. This matters because a response can begin as a normal AI-SDK-rendered assistant turn and later receive a queued follow-up inside the same HTTP stream.

Definitions:

- Segment 0: the initial assistant response for the user's submitted message.
- Queued segment N: any user/assistant turn that begins after `data-followup-consumed` in the same HTTP response.

Rules:

1. Segment 0 starts in `pending` display mode.
2. `data-pi-message-start` alone does not choose pi projection. Normal streams often receive side-channel IDs before visible text.
3. If segment 0 receives a standard visible assistant part first (`text`, `reasoning`, or canonical tool part), segment 0 locks to `ai-sdk`.
4. If segment 0 settles with no standard visible assistant parts but pi projection exists, segment 0 uses `pi-projection`.
5. When `data-followup-consumed` appears, start a new queued segment boundary. Do **not** remount/re-render the already locked segment 0.
6. Queued segments use `pi-projection` until we explicitly implement multi-assistant-message AI SDK streaming. The displayed transcript is therefore a composition: stable AI SDK-rendered segment 0 followed by pi-projected queued user/assistant tail.
7. Loaded legacy history that only contains `data-pi-*` envelopes uses `pi-projection` for the affected messages.
8. Never render both AI SDK visible parts and pi-projected visible parts for the same segment.

Important anti-jump acceptance: a normal stream often starts with `data-pi-message-start` before the first standard `text-delta`. That must not cause a temporary pi-rendered message that remounts into an AI SDK-rendered message a moment later. `data-pi-message-start` alone should not lock display mode.

Important queue acceptance: if a follow-up is queued after segment 0 has already locked to AI SDK, segment 0 remains AI SDK-rendered and stable; only the queued tail renders via pi projection. Do not switch the entire active response from AI SDK to pi projection.

### 4. Data part persistence vs transient callbacks

The stream must be explicit about which `data-*` chunks become persisted AI SDK UI parts and which are transient callbacks only.

Initial rule:

- Persistent UI data parts: `data-pi-*` needed for legacy rebuild/persistence during migration, and any queue markers the selector must inspect after React updates.
- Transient callback-only data parts: high-frequency/status-only events that do not need replay (future optimization), unless a test proves the client selector/persistence needs them.

Do not move `data-followup-consumed` or `data-pi-message-start/end` to transient-only until the queue selector and persistence story no longer scans message parts.

### 5. Smoothing

Primary smoothing should be AI SDK React throttling:

```ts
useChat({ experimental_throttle: 50 })
```

Custom pi delta batching should be fallback-only:

- active only when ChatPanel is rendering pi projection,
- not needed for normal AI SDK-rendered streams.

If the standard AI SDK stream still looks bad, add a server-side pi-event smoother later, modeled after AI SDK `smoothStream()` behavior: buffer text/reasoning into word/line-ish chunks, pass tools/status through immediately.

## Proposed implementation phases

### Phase 0 — Clean baseline

Use the dedicated branch/worktree:

- Branch: `plan/ai-sdk-chat-streaming`
- Worktree: `/home/ubuntu/projects/boring-ui-v2-ai-sdk-chat-streaming`

Before implementation, ensure there are no scratch edits:

```bash
git status --short
```

Acceptance:

- Only this plan commit is present before code work starts.

### Phase 1 — Contract tests for the recovered hybrid stream

Files:

- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
- `packages/agent/src/server/harness/pi-coding-agent/stream-adapter.ts`
- `packages/agent/src/server/harness/pi-coding-agent/__tests__/streaming.test.ts`
- `packages/agent/src/server/harness/pi-coding-agent/__tests__/stream-adapter*.test.ts`

Add failing tests for:

1. Normal first assistant turn emits both:
   - standard `text-start` / `text-delta` / `text-end`, and
   - side-channel `data-pi-text-*`.
2. Normal first assistant reasoning emits both:
   - standard `reasoning-start` / `reasoning-delta` / `reasoning-end`, and
   - side-channel `data-pi-reasoning-*`.
3. Queued inline follow-up turn suppresses all standard visible chunks for `inlineTurnIndex > 0` and emits `data-pi-*` for projection. It must not append queued-tail visible text/reasoning/tool/source/file parts onto AI SDK segment 0.
4. Tool calls in segment 0 emit canonical AI SDK tool chunks only when the canonical sequence is valid:
   - every `tool-output-available` / `tool-output-error` must have a preceding `tool-input-available` for the same `toolCallId` in the active AI SDK response, or
   - standard tool output must be suppressed and the pi side-channel/fallback renderer must handle it.
5. Add an explicit execution-start/end-only test: if pi emits `tool_execution_start` / `tool_execution_end` without an assistant `toolcall_end`, the adapter must either synthesize the canonical `tool-input-available` before output or suppress the canonical output. AI SDK must never receive orphan tool output.
6. Part IDs remain namespaced across inline turns.

Acceptance:

- Tests describe the exact recovered hybrid contract.
- Tests fail before Phase 2 if current global suppression remains.
- Tool tests prove AI SDK cannot receive orphan `tool-output-*` chunks.

### Phase 2 — Recover server hybrid behavior

Implementation:

1. Change `sdkChunksForTurn` filtering in `createHarness.ts` from global filtering to segment-aware filtering:
   - segment 0: keep standard visible chunks,
   - queued segments (`inlineTurnIndex > 0`): suppress all standard visible chunks.
2. Keep `data-pi-*` side-channel emissions for all turns during migration.
3. Do not alter follow-up queue control flow.
4. Keep standard tool chunks emitted only for segment 0 and only when the canonical tool-input-before-output invariant is satisfied.
5. If needed, track `standardToolInputsSeen` per active response to guard standard `tool-output-*` emission.

Acceptance:

- Phase 1 stream tests pass.
- Existing follow-up/abort/streaming tests pass.
- No AI SDK stream includes orphan `tool-output-*` chunks.

Note: Phase 2 alone may not improve visible UX because current ChatPanel still prefers `piMessages` whenever projection exists. UX improvement lands in Phase 3.

### Phase 3 — Client display-source selection

Files:

- `packages/agent/src/front/ChatPanel.tsx`
- `packages/agent/src/front/pi/piChatProjection.ts`
- `packages/agent/src/front/pi/piNativeFollowUpQueue.ts`
- `packages/agent/src/front/__tests__/ChatPanel.test.tsx`
- `packages/agent/src/front/pi/__tests__/piChatProjection.test.ts`

Implementation:

1. Add a small display segmentation helper in ChatPanel:
   - detects standard visible assistant parts for segment 0,
   - detects `data-followup-consumed` as the queued-tail boundary,
   - keeps segment 0's display mode stable after it locks,
   - renders queued tail from pi projection without replacing segment 0.
2. Keep `handlePiData` subscribed for queue and persistence side effects.
3. Keep projected pending user tail appended to the active segment/tail.
4. Ensure DebugDrawer sees the same visible transcript the user sees, plus raw stream remains accessible elsewhere.

Acceptance tests:

- Normal stream that starts with `data-pi-message-start` and then receives standard text never briefly renders pi projection before switching to AI SDK.
- ChatPanel prefers AI SDK visible text when both AI SDK text and pi projection exist for a normal single-turn stream.
- If a follow-up is queued after AI SDK text has already streamed for segment 0, segment 0 remains AI SDK-rendered and only the queued tail renders from pi projection.
- ChatPanel uses pi projection for a stream/segment with queued follow-up marker and no reliable standard multi-message AI SDK representation.
- Persisted `data-pi-*`-only history still renders.
- Follow-up queued user message still appears immediately and clears on `data-followup-consumed`.
- After a normal AI-SDK-rendered turn is persisted and reloaded, the same text/tools render from the saved history.

### Phase 4 — Retire symptom patches from the normal path

Files:

- `packages/agent/src/front/ChatPanel.tsx`
- `packages/agent/src/front/pi/piChatProjection.ts`

Implementation:

1. Restrict broad assistant tool-fragment coalescing to pi projection fallback only, or remove it if AI SDK standard chunks make it unnecessary.
2. Restrict custom 50ms pi delta batching to fallback projection only.
3. Keep `experimental_throttle: 50` in `useAgentChat` for AI SDK messages.
4. Keep final text repair in pi fallback; it is still useful for compatibility.

Acceptance:

- Normal AI SDK path has one primary renderer and one primary throttle.
- No duplicated text/tool cards.
- Legitimate adjacent assistant messages are not merged accidentally.

### Phase 5 — Explicit new-message autoscroll

Files:

- `packages/agent/src/front/primitives/conversation.tsx`
- `packages/agent/src/front/ChatPanel.tsx`

Implementation:

1. Expose an imperative or keyed scroll-to-bottom trigger from the conversation wrapper.
2. Trigger it on local user submit and queued follow-up submit.
3. Do not force-scroll during passive assistant streaming if the user has scrolled up.
4. Make the trigger testable by mocking `scrollToBottom` / `useStickToBottomContext`, or by passing a keyed prop that can be asserted in component tests.

Acceptance:

- Entering a new message scrolls to bottom immediately.
- Queued follow-up submit scrolls to bottom immediately.
- Streaming respects user scroll position.
- Tests assert the scroll trigger without relying only on manual QA.

## Test matrix

### Server stream tests

- Normal text turn: standard text chunks + pi side-channel chunks.
- Normal reasoning turn: standard reasoning chunks + pi side-channel chunks.
- Queued inline follow-up: no standard visible chunks for inline turn; pi projection chunks present.
- Tool execution: standard tool chunks and side-channel metadata where needed.
- Tool execution-start/end-only: no orphan canonical `tool-output-*` reaches AI SDK.
- Follow-up queue: pending -> consumed -> next assistant order remains correct.

### Client component/unit tests

- AI SDK display preferred for normal single-turn stream.
- Pi projection display used for queued/multi-turn stream.
- Pi projection display used for legacy `data-pi-*`-only history.
- Tool groups remain compact/collapsed.
- Adjacent assistant messages are not broadly merged outside fallback.
- New user submit triggers bottom scroll.

### Manual UX checks

- Long normal text response streams smoothly.
- Reasoning stream with thoughts enabled is smooth.
- Tool-heavy response renders compact collapsed tool groups.
- Follow-up submitted while assistant is running appears in correct order.
- Refresh/reopen session preserves history.
- New message auto-scrolls to bottom.
- User scrolling up during assistant stream is respected.

## Risks and mitigations

### Risk: display-source flapping

If the stream starts with side-channel chunks and later receives standard visible chunks, a naive selector can render pi projection for a moment and then remount into AI SDK rendering.

Mitigation: lock display mode per segment; `data-pi-message-start` alone does not choose pi projection.

### Risk: queued follow-up after AI SDK segment started

A stream can begin as normal AI SDK output, then later receive `data-followup-consumed` and another assistant turn. Switching the whole response to pi projection would remount already-streamed text.

Mitigation: segment the display. Keep segment 0 stable on AI SDK and append a pi-projected queued tail.

### Risk: duplicate visible output

If both AI SDK messages and pi projection render at once, users see duplicate text/tools.

Mitigation: one display-source selector, covered by tests.

### Risk: orphan AI SDK tool outputs

AI SDK expects a tool output to correspond to an existing tool invocation part. Pi can emit execution start/end events separately from assistant `toolcall_end` events.

Mitigation: canonical stream tests require tool-input-before-output; suppress or synthesize canonical tool input before output.

### Risk: queued turns break in AI SDK path

AI SDK active response state is one assistant response; pi can emit multiple turns in one HTTP stream.

Mitigation: queued inline turns stay on pi projection path until explicitly solved.

### Risk: broad coalescing hides legitimate assistant boundaries

Current coalescing can merge adjacent assistant messages if either has a tool part.

Mitigation: limit coalescing to fallback projection only, or remove after AI SDK path is restored.

### Risk: old sessions only contain `data-pi-*`

Mitigation: keep `rebuildPiMessagesFromDataParts()` fallback until we either migrate or accept dropping old session display.

### Risk: throttle feels laggy

Mitigation: keep 50ms initially because AI SDK docs use it; later expose tuning if needed.

## Open decisions

1. How long do we keep `data-pi-text-*` side-channel after the AI SDK path is stable?
2. Should queued inline assistant turns eventually become multiple canonical AI SDK messages in one HTTP response, or remain pi projection only?
3. Should stream smoothing remain client-side throttle only, or add server-side pi chunk smoothing?
4. Should throttle be app-configurable?

## Recommended next commit after plan approval

Implement Phase 1 + Phase 2 together in a small server-only commit:

- Add/adjust streaming tests for hybrid normal vs queued behavior.
- Restore `inlineTurnIndex > 0` filtering in `createHarness.ts`.
- Run targeted agent server streaming/follow-up tests.

Then implement client display-source selection as a separate commit.

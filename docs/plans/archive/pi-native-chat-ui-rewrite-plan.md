# Pi-native Chat UI Rewrite Plan

## 0. Status and scope

Status: draft plan. No implementation has started.

This plan is now structured around the Pi-native design we converged on after reviewing:

- the current Boring chat implementation as a behavior inventory;
- old Pi web-ui as the browser/render-state precedent;
- Pi coding-agent TUI as the semantic baseline for sessions, queues, commands, retry, and editor behavior.

The rewrite may not copy the current `useChat` / projection / follow-up merge architecture. It should preserve user-visible behavior where explicitly kept below, but when Boring’s current behavior conflicts with Pi semantics, this plan calls out the deliberate change.

## 1. Core decision

Rewrite the agent chat UI/control layer from scratch around a Pi-native remote-session model.

Keep reusable visual primitives and renderer ideas from current Boring. Replace chat state, transport, command orchestration, history ownership, and server route mapping.

Pi is the target for this clean path. Do not preserve generic harness pluggability or AI-SDK-shaped stream contracts in this rewrite.

## 2. Why rewrite

The current chat frontend has split-brain state:

- AI SDK `useChat().messages`
- Pi projection messages
- pending follow-up queue state
- optimistic waiting bubbles
- server/client `/messages` snapshots
- `ChatPanel` display merge/fallback logic

That model creates complexity and regressions. Patching it risks keeping the same failure mode under different names.

The new implementation makes Pi session state/events the single authority, exposed to the browser through a remote Pi-session facade.

## 3. Hard rules

1. Do not use `@ai-sdk/react/useChat`.
2. Do not let AI SDK own chat history.
3. Do not keep current `displayMessages` merge logic.
4. Do not keep separate `piMessages` + `messages` + `projectedTailMessages` histories.
5. Do not use text equality as primary browser follow-up reconciliation.
6. Do not rely on client-side PUT snapshots as canonical history.
7. Do not rewrite workspace UI, DockView, plugin shell, or visual primitives unless required by the new state contract.
8. Preserve `UiBridge.postCommand` as the only authoritative UI-command dispatch path; chat stream UI-command cards remain display-only.
9. Do not build a runtime-agnostic harness abstraction for this rewrite.
10. Do not preserve `sendMessage(): AsyncIterable<UIMessageChunk>` as any internal contract.
11. Server chat routes should call a Pi-focused session service that mirrors Pi AgentSession semantics: state, subscribe, prompt, followUp, queue clear, stop/abort, interrupt/retry abort.
12. All browser-shared DTOs remain platform-safe: no `node:*`, no `Buffer`, no raw Pi implementation objects in `src/shared/**`.
13. Frontend chat components talk to `RemotePiSession` / hooks, not directly to route paths. HTTP/NDJSON details stay behind the remote-session facade.

## 4. Reference baselines

### 4.1 Current Boring implementation: behavior inventory only

Use current Boring code/tests to identify user-visible behavior and regression history. Do not use it as the architecture template.

Important current files to treat as behavior references, not architecture references:

- `packages/agent/src/front/ChatPanel.tsx`
- `packages/agent/src/front/hooks/useAgentChat.ts`
- `packages/agent/src/front/hooks/useSessions.ts`
- `packages/agent/src/front/pi/piChatProjection.ts`
- `packages/agent/src/front/pi/piNativeFollowUpQueue.ts`
- `packages/agent/src/server/http/routes/chat.ts`
- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts`

Existing tests are also behavior inventory. Do not throw them away just because their implementation target changes. Before replacing a module, classify its current tests as:

- **port**: same user-visible behavior, rewrite against new Pi-native DTOs/store/routes;
- **adapt**: same regression class, but expected behavior changes to Pi/TUI semantics;
- **delete with rationale**: test only locked old AI SDK/projection internals that this rewrite intentionally removes.

High-value regression-test sources to mine before implementation:

- `packages/agent/src/front/__tests__/ChatPanel.test.tsx`
- `packages/agent/src/front/hooks/__tests__/useAgentChat.test.ts`
- `packages/agent/src/front/hooks/__tests__/useSessions.test.ts`
- `packages/agent/src/front/pi/__tests__/piChatProjection.test.ts`
- `packages/agent/src/front/pi/__tests__/piNativeFollowUpQueue.test.ts`
- `packages/agent/src/front/primitives/__tests__/tool-call-group.test.tsx`
- `packages/agent/src/front/__tests__/toolRenderers.test.tsx`
- `packages/agent/src/server/http/routes/__tests__/chat.test.ts`
- `packages/agent/src/server/http/routes/__tests__/sessions.test.ts`
- `packages/agent/src/server/http/routes/__tests__/sessions.integration.test.ts`
- `packages/agent/src/server/harness/pi-coding-agent/__tests__/sessionMapping.conformance.test.ts`
- `packages/agent/src/server/harness/pi-coding-agent/__tests__/sessions.load.test.ts`
- `packages/agent/src/server/http/__tests__/sessionChangesTracker.test.ts`
- `packages/agent/src/shared/__tests__/tool-ui.test.ts`
- `packages/workspace/src/front/chrome/chat/__tests__/ChatPanelHost.test.tsx`
- `packages/workspace/src/front/chrome/session-list/__tests__/SessionBrowser.test.tsx`
- `packages/workspace/src/__tests__/plugin-integration.test.tsx`

TDD rule for implementation tasks: write or port the failing regression tests first, then implement the smallest Pi-native code that passes them. If a task cannot start with a test, its acceptance criteria must explain why and name the manual/e2e proof that replaces it.

### 4.2 Pi web-ui: browser/render-state precedent

Reference files:

- `/tmp/pi-github-repos/earendil-works/pi@bigrefactor/packages/web-ui/src/components/AgentInterface.ts`
- `/tmp/pi-github-repos/earendil-works/pi@bigrefactor/packages/web-ui/src/components/StreamingMessageContainer.ts`

Old Pi web-ui did not use AI SDK, browser `EventSource`, or request/response chat streaming. It received an in-process `session?: Agent`, then:

- called `session.subscribe((event) => ...)`;
- rendered stable history from `session.state.messages`;
- sent input with `session.prompt(...)`;
- stopped with `session.abort()`;
- rendered a separate streaming container as a performance optimization, while the Agent session remained the single state authority;
- batched visible streaming updates with `requestAnimationFrame`.

### 4.3 Pi coding-agent TUI: semantic baseline

Reference files:

- `/tmp/pi-github-repos/earendil-works/pi@bigrefactor/packages/coding-agent/src/core/agent-session.ts`
- `/tmp/pi-github-repos/earendil-works/pi@bigrefactor/packages/coding-agent/src/modes/interactive/interactive-mode.ts`

Pi TUI is the best reference for command/session semantics:

- read state from the in-process session (`session.state`, queue getters, streaming/retry status);
- subscribe to session events (`queue_update`, message events, retry events, etc.);
- call session methods directly (`prompt`, `followUp`, `abort`, `abortRetry`, `clearQueue`);
- default follow-up delivery is `one-at-a-time`;
- queued follow-ups are displayed as pending text below the editor;
- “dequeue/edit queued” clears queued messages and restores all queued text into the editor;
- slash/extension commands are not blindly queued as follow-ups;
- auto-retry emits `auto_retry_start` / `auto_retry_end` and shows retry status.

Do not copy TUI terminal components. TUI code is coupled to terminal editors, keybindings, containers, loaders, and render loops. Boring should reuse Pi core/session APIs on the server and render with React primitives on the client.

## 5. What to keep, adapt, or remove

### 5.1 Keep/adapt visual pieces only

Keep or adapt these visual pieces:

- message bubble primitives;
- composer visual primitives;
- reasoning renderer and thought visibility toggle;
- tool card/renderers, grouped tool-call display, and file/artifact open affordances;
- terminal/code block components;
- attachment/file chips and upload/error visual states;
- model/thinking selector visuals;
- empty state/suggestions;
- slash command and mention picker visuals;
- plugin update status banner visuals;
- debug drawer as an optional host/admin surface, backed by new session APIs;
- theme tokens/CSS variables.

These components may move or receive new props, but must not carry transport/state logic.

### 5.2 Replace completely

Replace these pieces completely:

- `useAgentChat` as an AI SDK wrapper;
- Pi projection hook as separate history owner;
- native follow-up queue hook as separate display owner;
- `ChatPanel` as giant orchestration component;
- frontend `/messages` persistence after stream settle;
- route-calling logic scattered through React components instead of a `RemotePiSession` facade;
- server emission path that forces Pi events through AI SDK visible chunks for the browser.

### 5.3 Deliberate first-cut removals / deferrals

Remove or defer these from the first Pi-native cut:

- `/clear` slash command. Do not add local-only transcript filtering in the first rewrite. If view-clear returns later, it must be a non-canonical viewport filter, not message mutation.
- Message-level regenerate/rewind. Do not implement `/rewind` or regenerate in the initial ChatPanel. Preserve enough Pi entry/turn ids so a later server-side branch/regenerate feature can be added without client transcript surgery.
- Steering UI/queue. Busy normal sends are follow-ups only.
- Per-item queued follow-up delete. Use TUI-style restore-all-to-composer instead.
- Separate “Clear queued” UI action. Stop clears queue; Edit queued restores local queue text to the composer and then clears the server queue.
- Full queued-message editor. First cut only supports TUI-style restore-all.
- Full cross-tab optimistic sync.
- Session tree/branch UI.

## 6. Remote Pi session architecture

### 6.1 Remote session-shaped facade

Boring cannot pass the server’s in-process Pi `AgentSession` object to the browser. The browser gets a remote session-shaped facade instead:

```ts
interface RemotePiSession {
  getState(): PiChatSnapshot
  subscribe(listener: (event: PiChatEvent) => void): () => void
  prompt(payload: PromptPayload): Promise<PromptReceipt>
  followUp(payload: FollowUpPayload): Promise<FollowUpReceipt>
  clearQueue(): Promise<QueueClearReceipt>
  stop(): Promise<StopReceipt>
  dispose(): void
  interrupt(): Promise<CommandReceipt>
}
```

Remote mapping:

```txt
Pi in-process session.state/getters  -> GET /api/v1/agent/pi-chat/:sessionId/state
Pi session.subscribe(...)            -> GET /api/v1/agent/pi-chat/:sessionId/events?cursor=<seq>
Pi session.prompt(...)               -> POST /prompt
Pi session.followUp(...)             -> POST /followup
Pi session.clearQueue()              -> POST /queue/clear (client restores from local state first)
Pi session.abort()/abortRetry()      -> POST /stop or POST /interrupt
```

`RemotePiSession` must use lightweight lifecycle/generation guards. Do not introduce a heavyweight FSM or statechart library.

Rules:

- each instance has a `generation` counter;
- `dispose()` increments generation, aborts stream fetches, clears reconnect/heartbeat timers, and removes listeners;
- `/state`, `/events`, command receipts, and reconnect timers capture generation;
- callbacks no-op if disposed or generation changed;
- expose only simple connection lifecycle for UI/debug.

### 6.2 Target architecture

```txt
Server Pi AgentSession
  -> PiSessionService (thin remote facade over Pi session APIs)
  -> HTTP remote-session protocol (`/state`, `/events`, command POSTs)
  -> RemotePiSession client
  -> pi chat reducer/store/selectors
  -> committedMessages + streamingMessage + queuePreview + optimisticOutbox
  -> new ChatPanel shell
  -> existing React visual primitives/renderers
```

There is one frontend chat owner per `{storageScope, workspaceId, sessionId}`. Session navigation is adjacent state, not a second message owner. `RemotePiSession` is the frontend seam; routes, NDJSON, reconnect, and command receipts are implementation details behind it.

## 7. Target module layout

```txt
packages/agent/src/shared/chat/
  piChatEvent.ts              # browser-safe event DTOs and NDJSON stream frames
  boringChatMessage.ts        # render-model types; adapter to old visual props if needed
  piChatSnapshot.ts           # PiChatSnapshot, queue previews, session status DTOs
  piChatCommand.ts            # command payloads + receipt DTOs
  piChatSchemas.ts            # zod or equivalent shallow runtime validators for snapshots/events/receipts; keep hot stream validation cheap
  chatError.ts                # stable chat error payloads
  chatSubmitPayload.ts        # browser-safe prompt/attachment DTOs

packages/agent/src/server/pi-chat/
  piSessionService.ts         # small server facade over Pi AgentSession; main backend seam
  PiAgentSessionAdapter.ts    # private Pi-only adapter isolating installed Pi API naming/version drift
  piChatEvents.ts             # Pi AgentSessionEvent -> PiChatEvent mapping
  piChatHistory.ts            # canonical Pi session history -> render messages
  piChatSnapshot.ts           # Pi session state -> PiChatSnapshot
  piChatReplayBuffer.ts       # session-scoped seq replay/resume ring
  piFollowUps.ts              # nonce/seq display metadata over Pi's canonical follow-up queue
  piChatTelemetry.ts          # existing telemetry events in one place

packages/agent/src/server/http/routes/
  piChat.ts                   # thin routes that call PiSessionService

packages/agent/src/front/chat/pi/
  remotePiSession.ts          # browser facade shaped like Pi AgentSession; owns /state, /events, command POSTs
  piChatReducer.ts            # pure reducer, heavily tested
  piChatStore.ts              # Zustand or equivalent external store; throttled/coalesced high-frequency delta notifications
  piChatStream.ts             # NDJSON-over-fetch parser + abort/reconnect/heartbeat handling
  useRemotePiSession.ts       # React lifecycle hook for RemotePiSession
  usePiAgentChat.ts           # public React hook for ChatPanel selectors/actions
  selectors.ts                # derived display/composer state

packages/agent/src/front/chat/session/
  usePiSessions.ts            # agent-owned session list/create/switch/delete; can adapt existing useSessions
  activeSessionStorage.ts     # scoped localStorage helpers
  SessionList.tsx             # reusable display component/primitives for agent sessions

packages/agent/src/front/chat/components/
  ChatPanel.tsx               # new shell, small
  MessageTimeline.tsx         # committed + streaming render
  ComposerBar.tsx             # composer container over visual primitive
  RuntimeNotices.tsx          # warmup/blocker/error/plugin/retry notices
```

## 8. Shared state and render model

### 8.1 Frontend chat state

The frontend store has one canonical state per `{storageScope, workspaceId, sessionId}`.

```ts
type PiChatStatus =
  | 'idle'
  | 'hydrating'
  | 'submitted'
  | 'streaming'
  | 'aborting'
  | 'error'

type PiChatState = {
  sessionId: string
  workspaceId?: string
  storageScope: string
  status: PiChatStatus
  turnId?: string
  lastSeq: number
  committedMessages: BoringChatMessage[]
  streamingMessage?: BoringChatMessage
  queue: { followUps: QueuedUserMessage[] }
  optimisticOutbox: Record<string, OptimisticUserMessage>
  pendingToolCallIds: Set<string>
  connection: {
    state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    lastHeartbeatAt?: number
  }
  error?: ChatError
  retryNotice?: {
    attempt: number
    maxAttempts: number
    delayMs: number
    errorMessage: string
  }
  hydrated: boolean
}
```

`committedMessages` and `streamingMessage` are allowed because they mirror Pi’s native stable-history + live-message shape and live inside one reducer/store. `queue` mirrors Pi/TUI queue state. They must not become separate owners.

`messagesForRender = committedMessages + streamingMessage + visible optimistic outbox placeholders` is the only message-timeline render selector. Queue preview renders only from queue selectors. ChatPanel/components must not reimplement merge logic, manually combine committed/streaming/outbox into message arrays, or read competing histories.

`RemotePiSession` owns lifecycle: hydrate `/state`, open `/events`, dispatch sequenced events, send command POSTs, reconcile command receipts, and handle reconnect/resync. React hooks/components consume `RemotePiSession` state/actions; they do not call routes directly.

### 8.2 Session navigation state

Session navigation state is separate and lives in `@hachej/boring-agent`, not `@hachej/boring-workspace`:

```ts
type PiSessionNavigationState = {
  sessions: SessionSummary[]
  activeSessionId?: string
  loading: boolean
  error?: ChatError
}
```

Switching sessions must dispose/ignore the previous session’s stream callbacks before hydrating the next session. Workspace shells can render the agent’s session list/navigation component, but all create/switch/delete/reset behavior stays in the agent package.

### 8.3 Render message model

Define `BoringChatMessage` immediately instead of making AI SDK `UIMessage` the contract.

```ts
type BoringChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  status?: 'pending' | 'streaming' | 'done' | 'aborted' | 'error'
  parts: BoringChatPart[]
  createdAt?: string
  clientNonce?: string
  piEntryId?: string
  turnId?: string
}

type BoringChatPart =
  | { type: 'text'; id?: string; text: string }
  | { type: 'reasoning'; id: string; text: string; state?: 'streaming' | 'done' }
  | { type: 'tool-call'; id: string; toolName: string; input?: unknown; state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'aborted'; output?: unknown; errorText?: string; ui?: ToolUiMetadata }
  | { type: 'file'; filename?: string; mediaType?: string; url?: string }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; text: string }
```

Message id rules:

- `id` must be stable across `/state` hydrations for the same Pi session entry.
- Prefer Pi session entry id when available.
- If Pi event lacks an entry id during streaming, use a stable server-generated id and reconcile to final `piEntryId` on `message-end`.
- Do not generate random client ids for canonical messages.
- Keep `piEntryId` / `turnId` even though regenerate/branch UI is deferred.

Adapters may convert this to existing primitive props. Do not leak AI SDK message types into the store or server contract.

### 8.4 Rendering model

The new ChatPanel renders compositionally:

```tsx
<MessageTimeline messages={messagesForRender} />
<RuntimeNotices notices={notices} />
<ComposerBar status={composerStatus} onSend={sendMessage} onStop={stop} />
```

It does not know about Pi stream DTO internals or route mechanics.

Message selectors must cover:

- empty state vs non-empty state;
- queued follow-up placeholders;
- active assistant streaming message;
- unresolved tool-call shimmer while streaming;
- forced settlement of unresolved tools on `agent-end` / abort / error;
- reasoning visibility based on persisted thought setting;
- dismissible errors/composer runtime notices;
- simple auto-retry runtime notice from Pi `auto_retry_start` / `auto_retry_end`;
- connection/reconnecting notice;
- throttled/coalesced high-frequency delta rendering without delaying reducer seq application. Zustand is acceptable, but React 18/Zustand batching alone is not the stream performance strategy.

Tool results render inside the owning assistant message by `toolCallId`. Standalone tool-result bubbles are not displayed unless explicitly modeled as standalone messages.

## 9. Frontend component reuse map

This rewrite changes state, protocol, and orchestration. It must not redesign the chat UI by default.

| Component area | Current files | Rewrite action |
| --- | --- | --- |
| Message bubbles/actions/markdown | `packages/agent/src/front/primitives/message.tsx` | Keep visual primitive. Adapt inputs from `BoringChatMessage`/`BoringChatPart`; remove AI SDK coupling if present. |
| Scroll container/empty state/download | `packages/agent/src/front/primitives/conversation.tsx` | Keep visual primitive and scroll behavior. New `MessageTimeline` composes it. |
| Reasoning/thoughts | `packages/agent/src/front/primitives/reasoning.tsx` | Keep collapse/expand visual behavior. Feed from `BoringChatPart(type='reasoning')`. |
| Tool cards and grouped summary | `packages/agent/src/front/primitives/tool.tsx`, `packages/agent/src/front/primitives/tool-call-group.tsx`, `packages/agent/src/front/toolRenderers.tsx`, `packages/agent/src/front/bareToolRenderers/*` | Keep visuals and default renderers. Replace AI SDK `ToolUIPart`/`UIMessage` dependency with neutral `ToolPart`/`BoringChatPart` adapters. |
| Composer frame/input/submit/attachments | `packages/agent/src/front/primitives/prompt-input.tsx`, `prompt-input-wrappers.tsx`, `prompt-input-context.ts`, `use-prompt-input-provider-attachments.ts` | Keep visuals and DOM/data attrs. Remove AI SDK `ChatStatus`/`FileUIPart`/`SourceDocumentUIPart` contracts; adapt to Boring chat attachment/source types. |
| Attachments/chips | `packages/agent/src/front/primitives/attachments.tsx`, `packages/agent/src/front/chatAttachments.ts` | Keep chip visuals and visible-vs-server-enriched payload behavior. |
| Code/artifact rendering | `packages/agent/src/front/primitives/code-block.tsx`, `artifact.tsx`, `ArtifactOpenContext` | Keep visuals and file/artifact open affordances. |
| Slash/mention pickers | `packages/agent/src/front/primitives/slash-command-picker.tsx`, `mention-picker.tsx`, `use-picker-keyboard.ts` | Keep visuals/keyboard behavior. Wire to new composer policy modules. |
| Chat orchestration | `packages/agent/src/front/ChatPanel.tsx`, old hooks/projection/follow-up queue | Rewrite. Behavior reference only; do not copy merge/projection logic. |

Rule: decouple AI SDK types, not visuals. Preserve className structure, motion/collapse behavior, focus behavior, and `data-boring-agent-part` attributes unless a change is explicitly called out in this plan.

## 10. Tool rendering contract

Do not reimplement tool UI from scratch. The new message timeline should continue to use the current renderer stack behind an adapter:

```txt
BoringChatPart(type='tool-call')
  -> toToolPart(part): ToolPart
  -> ToolCallGroup / grouped tool-call row adapted to BoringChatPart/ToolPart
  -> resolveToolRenderer(part.ui?.rendererId ?? part.toolName, mergedToolRenderers)
  -> existing default shadcn renderers + consumer/plugin overrides
```

Reusable components/primitives to preserve:

- `packages/agent/src/front/primitives/tool.tsx`: `Tool`, `ToolHeader`, `ToolContent`, `ToolInput`, `ToolOutput`, `getStatusBadge`
- `packages/agent/src/front/primitives/tool-call-group.tsx`: grouped/collapsible tool-call presentation and status summary; adapt its inputs away from AI SDK `UIMessage` / `isToolUIPart`, but preserve UI/behavior
- `packages/agent/src/front/toolRenderers.tsx`: shadcn-styled default renderers for `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`, `exec_ui`, `get_ui_state`, and fallback rendering
- `packages/agent/src/front/bareToolRenderers/*`: neutral `ToolPart`, `ToolRenderer`, `ToolRendererOverrides`, `resolveToolRenderer`, `mergeToolRenderers`, `langFromPath`, and `DiffView`
- `CodeBlock`, `Artifact*`, `Terminal`, and `ArtifactOpenContext` path-open behavior

Tool components stay in `@hachej/boring-agent/front` for this rewrite, not `@hachej/boring-ui-kit`. They are chat/agent primitives: they know tool-call states, streaming/running/settled/error semantics, artifact opening, and renderer overrides. `@hachej/boring-ui-kit` should keep only low-level bricks such as `Collapsible`, `Badge`, `Button`, and `Tooltip`.

Plugin authors building custom renderers should import agent tool primitives from `@hachej/boring-agent/front`, not ui-kit.

Custom tool renderer API is in-scope at the minimal seam level from issue #34:

- server tools may return `ToolUiMetadata` with `rendererId`, display label/group/icon, and safe serializable details, commonly nested at `output.details.ui`;
- plugin/frontend packages may contribute `toolRenderers: Record<rendererId, ToolRenderer>`;
- renderer ids should be namespaced by plugin/package, e.g. `ask-user.question` or `@scope/plugin/question`;
- workspace/agent composition merges plugin-provided renderers into ChatPanel’s `toolRenderers` prop;
- resolution order is `rendererId` first, then `toolName`, then safe default fallback;
- backend metadata never loads or executes frontend code; it only selects an already-registered renderer;
- duplicate `rendererId` collisions must be deterministic and visible;
- unknown renderer IDs must render safely with the default renderer.

Existing public seam to preserve: `ChatPanelProps.toolRenderers?: ToolRendererOverrides`. The new Pi-native ChatPanel can rename internals, but package consumers should still have a direct prop-level override path. Workspace/plugin integration should feed plugin renderer contributions into that same prop rather than inventing a parallel renderer registry inside chat.

## 11. Composer primitive ownership

Do not move the whole chat composer into `@hachej/boring-ui-kit` as part of this rewrite. The current `PromptInput` is a chat/agent primitive, not a pure design-system primitive: it owns attachment state, paste/upload behavior, screenshot capture, referenced sources, submit status, data attributes used by tests/hosts, and currently still has AI SDK type coupling that this rewrite removes.

Target split:

- `@hachej/boring-ui-kit`: low-level generic bricks only (`InputGroup`, `InputGroupTextarea`, `Button`, `Tooltip`, `DropdownMenu`, `Command`, `HoverCard`, etc.).
- `@hachej/boring-agent/front/primitives`: agent/chat primitives (`PromptInput`, `PromptInputTextarea`, `PromptInputFooter`, `PromptInputSubmit`, attachment/source hooks).
- `packages/agent/src/front/chat/components/ComposerBar.tsx`: thin Pi-native composition of those primitives plus model/thinking/slash/warmup policy.

A future extraction is allowed only if the extracted component is truly generic. Good candidates: visual-only prompt frame/wrapper pieces such as `PromptInputBody`, `PromptInputHeader`, `PromptInputFooter`, `PromptInputTools`, and `PromptInputButton` if they can use `@hachej/boring-ui-kit`’s `cn` and have no agent/browser-file/chat-status dependencies. Bad candidates for ui-kit in this rewrite: upload/provider state, attachments, source refs, slash-command policy, model/thinking controls, warmup/blocker policy, and session-specific submit behavior.

## 12. Protocol: snapshot, events, commands

### 12.1 Snapshot: `GET /state`

`/state` is the remote equivalent of reading Pi/TUI’s in-process session state before subscribing.

```ts
type QueuedUserMessage = {
  id: string
  kind: 'followup'
  clientNonce?: string
  clientSeq?: number
  displayText: string
  createdAt?: string
}

type PiChatSnapshot = {
  protocolVersion: 1
  sessionId: string
  seq: number
  status: PiChatStatus
  activeTurnId?: string
  messages: BoringChatMessage[]
  queue: { followUps: QueuedUserMessage[] }
  followUpMode: 'one-at-a-time'
  error?: ChatError
}
```

`GET /api/v1/agent/pi-chat/:sessionId/state` returns canonical ordered render messages plus live state (`protocolVersion`, `seq`, queue, status, active turn id). Client hydrates once per session/workspace from `/state`, rejects unsupported protocol versions with a stable runtime notice, then applies events with `seq > snapshot.seq`.

Active browser reload while the agent is running is a first-class regression target. Reload must not collapse to an empty chat, lose the active assistant turn, lose accepted-but-unconsumed follow-up queue previews, duplicate the session-list entry, or require browser transcript cache to recover. `/state` must contain enough committed history + live status/active turn/queue/seq for `RemotePiSession` to reconnect and continue from canonical Pi state. If the exact in-flight streaming text cannot be reconstructed from Pi after process/runtime recovery, the UI must still hydrate committed canonical history, show accurate running/reconnecting state or a settled error/aborted notice, clear stale optimistic browser outbox against server queue state, and never overwrite the session with an empty local snapshot.

### 12.2 Event stream: NDJSON over fetch

There is exactly one live channel per `{storageScope, workspaceId, sessionId}`:

```txt
GET /api/v1/agent/pi-chat/:sessionId/events?cursor=<seq>
```

Wire format is NDJSON over fetch, not browser `EventSource` and not AI SDK stream chunks:

```txt
Content-Type: application/x-ndjson
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no

{"type":"message-delta","seq":12,...}\n
{"type":"tool-call","seq":13,...}\n
```

Parser requirements:

- tolerate partial UTF-8 chunks and lines split across reads;
- ignore blank lines and unknown fields;
- validate `type` before reducer dispatch;
- validate event payload shape before reducer dispatch; malformed events become connection/protocol errors, not partial state mutations;
- enforce seq gap logic only for sequenced events;
- handle seq-less heartbeat frames without mutating chat history.

Heartbeat frames are transport liveness only and are not replayed:

```ts
type PiChatStreamFrame = PiChatEvent | { type: 'heartbeat'; now: string }
```

Server sends heartbeat every 15–30s on idle live streams. Client updates connection liveness without notifying message subscribers. If no bytes/heartbeat arrive within the configured timeout, client reconnects with the same cursor; on replay gap, it rehydrates `/state`. Reconnects use jittered exponential backoff to avoid thundering-herd reconnects after deploys, proxy drops, or runtime restarts.

Every `PiChatEvent` carries monotonic `seq` scoped to the session, not just the active turn. `/events` stays open while `RemotePiSession` is mounted; it is a remote `session.subscribe(...)`, not the old AI SDK resume endpoint. Do not return `204` just because the session is idle; keep the stream alive with heartbeats.

Server subscribe/replay ordering:

1. Validate cursor.
2. Register the live subscriber.
3. Replay buffered events with `seq > cursor`.
4. Continue streaming live events/heartbeats.

Do not replay first and subscribe second; that can drop events emitted between replay and subscription.

Replay buffer/resource contract:

- replay storage must be bounded by count, bytes, time, or an equivalent cap; do not keep unbounded per-session arrays/maps;
- remove `/events` subscribers and clear heartbeat/reconnect timers when the client disconnects or session is disposed;
- exact replay defaults are implementation/config choices; cursor outside retained range returns `replay_gap`.

Replay range contract:

- valid `cursor` -> replay events with `seq > cursor`, then stay open for live events/heartbeats;
- `cursor < minReplaySeq - 1` -> `409 replay_gap` with `{ latestSeq }`;
- `cursor > latestSeq` -> `409 cursor_ahead` with `{ latestSeq }`;
- client handles replay range errors by fetching `/state` and reconnecting from `state.seq`.

Client processing:

- `seq <= lastSeq`: ignore as stale/duplicate;
- `seq === lastSeq + 1`: apply;
- `seq > lastSeq + 1`: resync by re-fetching `/state` and reconnecting from returned seq.

```ts
type PiChatEvent =
  | { type: 'agent-start'; seq: number; turnId: string }
  | { type: 'agent-end'; seq: number; turnId: string; status: 'ok' | 'aborted' | 'error' }
  | { type: 'message-start'; seq: number; messageId: string; role: 'user' | 'assistant'; clientNonce?: string; clientSeq?: number; text?: string; files?: BoringChatPart[] }
  | { type: 'message-delta'; seq: number; messageId: string; partId: string; kind: 'text' | 'reasoning'; delta: string }
  | { type: 'message-part-end'; seq: number; messageId: string; partId: string; kind: 'text' | 'reasoning'; text: string }
  | { type: 'message-end'; seq: number; messageId: string; final: BoringChatMessage }
  | { type: 'tool-call'; seq: number; messageId: string; toolCallId: string; toolName: string; input: unknown; ui?: ToolUiMetadata }
  | { type: 'tool-result'; seq: number; messageId: string; toolCallId: string; output: unknown; isError?: boolean; errorText?: string; ui?: ToolUiMetadata }
  | { type: 'queue-updated'; seq: number; queue: { followUps: QueuedUserMessage[] } }
  | { type: 'followup-consumed'; seq: number; clientNonce?: string; clientSeq?: number; messageId: string }
  | { type: 'file-changed'; seq: number; path: string; changeType: string }
  | { type: 'ui-command'; seq: number; command: unknown; displayOnly: true }
  | { type: 'usage'; seq: number; usage: unknown }
  | { type: 'auto-retry-start'; seq: number; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: 'auto-retry-end'; seq: number; success: boolean; attempt: number; finalError?: string }
  | { type: 'error'; seq: number; turnId?: string; retryable?: boolean; error: ChatError }
```

The server may add fields, but reducer ignores unknown fields. `/state` is the only hydration snapshot; the live stream does not need a synthetic `session-hydrated` event.

Tool UI metadata may be present on `tool-call`, `tool-result`, or only inside `output.details.ui`; reducers/adapters normalize it onto `BoringChatPart.ui` using existing `ToolUiMetadata` / `extractToolUiMetadata` shape. Treat tool UI metadata as untrusted display metadata: validate the top-level shape before renderer resolution, strip/ignore malformed metadata, and fall back safely. Renderer-specific `ui.details` validation belongs to each custom renderer.

`message-end.final` is authoritative and replaces the in-progress message with the same `messageId`. Do not implement heuristic text repair such as “only extend if final starts with current.”

### 12.3 Command POSTs and receipts

Command POSTs return quickly; their canonical effects arrive on the event stream. Do not keep an HTTP response open across follow-up turns.

```txt
GET    /api/v1/agent/pi-chat/:sessionId/state
GET    /api/v1/agent/pi-chat/:sessionId/events?cursor=<seq>
POST   /api/v1/agent/pi-chat/:sessionId/prompt
POST   /api/v1/agent/pi-chat/:sessionId/followup
POST   /api/v1/agent/pi-chat/:sessionId/queue/clear
POST   /api/v1/agent/pi-chat/:sessionId/interrupt
POST   /api/v1/agent/pi-chat/:sessionId/stop
```

User-visible submits carry `clientNonce`; follow-ups also carry `clientSeq`. `clientNonce` is the idempotency key for prompt/follow-up sends. Stop, interrupt, and queue clear are naturally idempotent enough for the first cut and do not need a separate command id.

```ts
type CommandReceipt = {
  accepted: true
  cursor: number
}

type PromptReceipt = CommandReceipt & { clientNonce: string; duplicate?: boolean }
type FollowUpReceipt = CommandReceipt & { clientNonce: string; clientSeq: number; queued: true; duplicate?: boolean }
type QueueClearReceipt = CommandReceipt & { cleared: number }
type StopReceipt = CommandReceipt & { stopped: boolean; clearedQueue: QueuedUserMessage[] }
```

Error responses use stable error payloads:

```ts
{ error: { code: string; message: string; retryable?: boolean; details?: unknown } }
```

Error ownership rules:

- Command/pre-flight errors are HTTP responses and do not mutate transcript state.
- Accepted turn errors are sequenced stream/state events (`error` plus terminal `agent-end`).
- Transport/replay errors are connection status, not assistant messages; reconnect/resync before surfacing fatal UI.

## 13. Server responsibilities

### 13.1 Route responsibilities

Routes stay thin:

- validate params/body/query and return stable errors;
- resolve workspace/auth/runtime context;
- set NDJSON streaming headers and disable buffering;
- on event stream close, unsubscribe that client only; do not abort the Pi turn;
- call `PiSessionService`;
- no message projection logic in route handlers.

### 13.2 PiSessionService responsibilities

`PiSessionService` is the only server-side chat seam for this rewrite. It wraps Pi `AgentSession` directly; it is not a generic harness abstraction and not a second queue/transcript system.

Use a tiny private server-side `PiAgentSessionAdapter` to isolate installed Pi API naming/version drift and make unit tests cheap. This adapter is Pi-only, internal to `packages/agent/src/server/pi-chat/`, and must not become runtime-agnostic harness pluggability.

```ts
interface PiAgentSessionAdapter {
  readSnapshot(): unknown
  subscribe(cb: (event: unknown) => void): () => void
  prompt(input: unknown): Promise<void>
  followUp(text: string): Promise<void>
  clearQueue(): unknown
  abort(): void
  abortRetry?(): void
}
```

Responsibilities:

- create/load/list/delete sessions through Pi’s session manager as the only session system of record;
- call installed Pi APIs through the private `PiAgentSessionAdapter`;
- build `PiChatSnapshot` from Pi session state/queue/status;
- expose typed session-scoped event stream with replay cursor and gap recovery contract;
- start prompts and follow-ups against Pi directly;
- map Pi message/tool/reasoning/file/change/queue/auto-retry events to `PiChatEvent`;
- persist canonical history from Pi events/session state;
- maintain stable `turnId` and monotonic session-scoped `seq`;
- maintain FIFO display metadata over Pi’s canonical follow-up queue for nonce/seq/browser reconciliation;
- implement `abort`, `interrupt`, `stop`, TUI-style queued-followup clear after client-first composer restore, and simple retry cancellation when Pi exposes `abortRetry()`;
- preserve file-change events and `sessionChangesTracker` integration;
- emit telemetry and stable error codes.

### 13.3 Authorization, workspace scoping, and session identity

Every `PiSessionService` method receives resolved request context. Routes do not trust session ids alone.

```ts
type PiSessionRequestContext = {
  workspaceId: string
  storageScope?: string
  authSubject?: string
  requestId: string
}
```

`PiSessionService` verifies that the requested Pi session belongs to the resolved workspace/scope before returning state, accepting commands, or opening event streams.

Pi’s session manager is the system of record. Boring must not create a second transcript/session file for the same chat.

- User-visible Boring session id is the Pi session id.
- Boring-specific metadata (workspace id, title, updatedAt, model defaults) is stored as Pi session metadata/custom entries or a thin index keyed by Pi session id.
- The thin index may store only metadata such as `{ sessionId, workspaceId, title, createdAt, updatedAt, modelDefault?, lastSeq? }`.
- The index must not store canonical transcript messages.
- Delete removes the Pi session and any thin Boring metadata/index entry.
- A streamed session must appear exactly once in the session list.

Pi SDK default storage: `createAgentSession()` defaults to `SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir))`, where `agentDir` defaults to `~/.pi/agent` and session directory is `~/.pi/agent/sessions/--<encoded-cwd>--/`. Files are named `<timestamp>_<piSessionId>.jsonl`. Passing custom `sessionManager`, `agentDir`, or explicit session dir changes this; `SessionManager.inMemory()` creates no files. Boring should configure this once and treat Pi JSONL files as the only canonical session files.

## 14. Follow-up, queue, slash, and retry semantics

### 14.1 Follow-up semantics

User submits carry `clientNonce`, including first idle prompt. Follow-ups also carry `clientSeq`. Server dedupes prompt/follow-up sends by `{ sessionId, clientNonce }` and uses `clientSeq` for follow-up ordering. Optimistic user messages reconcile by nonce/seq metadata, never by text equality.

- Idle send: `POST /prompt` starts a turn and includes `{ clientNonce }`.
- Busy send: `POST /followup` queues a text-only follow-up with `{ clientNonce, clientSeq }`.
- Server is authoritative on busy/idle using Pi session state. If `prompt` arrives while session is busy, reject with a stable retryable code rather than starting a second concurrent turn; browser should call follow-up endpoint for busy sends.
- HTTP command responses own acceptance/rejection: `202` means queued/accepted; non-2xx means not accepted. Do not duplicate this with `followup-accepted` / `followup-rejected` stream events.
- Browser owns optimistic outbox only until command acceptance. Once POST returns `202`, Pi’s queue is canonical delivery queue and `PiSessionService` owns display metadata.
- Stream emits `queue-updated` as canonical queued-state changes, mirroring Pi/TUI `queue_update`.
- Posting retries are bounded with exponential backoff for retryable failures such as `followup_session_not_ready`.
- Server rejects out-of-order follow-up seqs and dedupes same nonce/seq.
- When Pi emits the real user message, server emits `followup-consumed` with nonce/seq where available. Reducer replaces/commits optimistic placeholder using nonce/seq.
- `PiSessionService` keeps only a tiny FIFO display metadata wrapper over Pi’s canonical follow-up queue. It is not a second delivery queue.
- If metadata is missing after restart/recovery, server queue state wins and browser clears stale optimistic placeholders with a notice.

Accepted-but-unconsumed follow-ups are live runtime queue state, not durable transcript. If runtime/server restarts before consumption, queued items may be lost. On reconnect, `/state` plus `queue-updated` is authoritative; browser clears optimistic outbox entries not present in server queue and shows a dismissible notice.

### 14.2 TUI-style edit queued

Primary queue edit UX follows Pi TUI:

- Queue preview shows queued follow-up text.
- “Edit queued” first synchronously copies current local `state.queue.followUps` display text into the composer, joined by blank lines before any existing draft.
- Client then calls `POST /queue/clear`.
- Server clears queued follow-ups and emits `queue-updated`.
- Current active agent turn keeps running.
- If no queued messages exist locally, show “No queued messages” and do not call the server.
- If the network drops before `/queue/clear` succeeds, the user retains the draft text; show a notice that queued messages may still send unless they retry Edit queued or Stop.

No per-item delete is required. No separate Clear queued action is required. Stop clears all queued follow-ups. Escape/interrupt does not clear queued follow-ups.

Follow-ups are text-only in this rewrite. Attachments while busy remain blocked. Edit queued restores text only, from local queue state before server clear.

`followUpMode` is pinned to Pi/TUI default `one-at-a-time`; no user-facing mode selector is added.

### 14.3 Slash command busy policy

Do not blindly queue slash command text while streaming.

Slash commands declare busy behavior. Executable/app commands are local/app commands, not model text. They should not go into Pi follow-up queue unless they expand to normal user text and are explicitly allowed.

First-cut policy:

- `/reset`, `/reload`, `/help`, skill commands, and host `extraCommands` remain supported.
- `/clear` is absent from first-cut slash help/command list.
- Hot reload flag hides `/reload`.
- `/reset` remains destructive session delete with confirmation.
- `/reload` remains app/plugin reload command and must not be queued as model text.
- Skill/prompt-template commands may queue only after expanding to normal text and passing busy policy.
- Unknown/executable slash commands while streaming default to block, not queue.

### 14.4 Stop, interrupt, and retry

- Stop cancels current Pi turn and clears queued follow-ups. Host `onComposerStop` still fires.
- Escape/interrupt interrupts/cancels the active turn or retry where appropriate but leaves queued follow-ups intact.
- Closing the browser event stream is a transport disconnect, not a user abort. Event stream close only unsubscribes that client.
- If a command request is cancelled before acceptance and cannot be deduped safely, treat it as not accepted and keep/restore the draft.
- Pi auto-retry events are mapped minimally:
  - `auto-retry-start` renders runtime notice such as “Retrying (1/3)…”.
  - `auto-retry-end` clears/settles the notice.
  - Final failure shows a stable error notice.
  - No full TUI-style countdown is required in the first cut.
  - Stop/Escape cancellation calls Pi retry abort when available.
  - Retry events do not mutate transcript history.

## 15. Attachments, mentions, and composer policy

- Attachments cannot be queued while streaming; user sees notice to send them after current response.
- Visible user bubble shows original text and file chips.
- Server prompt includes inlined readable text attachments plus `@files` mentions.
- Binary attachments produce metadata markers and structured attachment metadata.
- Server revalidates all client attachment metadata.
- Enforce max file count, max per-file bytes, and max total prompt attachment bytes before submit; server revalidates.
- Persist only safe metadata and extracted text; never persist raw blob/data URLs in canonical history.
- History serializer strips transient blob/data URLs from file parts before persistence.
- Mention picker can add file references; submitted server prompt includes `@files: ...`; mentions clear after accepted submit.
- `onBeforeSubmit(draft, ctx)` can cancel before any agent/model/session-history network send.
- Workspace warmup/preparing/failed and host blockers prevent network sends without losing draft; notices render above composer; blocker actions call host.
- `initialDraft` restores into composer; optional one-time auto-submit; accepted/settled callbacks fire only for the correct session and are race-safe.
- Current ChatPanel does not generally auto-save arbitrary composer draft text across refresh. Adding scoped draft persistence would be net-new UX, not required for parity. If added, store only unsent text/attachment metadata and clear after accepted send.
- Up/down navigates previous user messages when pickers are closed, using canonical user messages selector.

## 16. Browser persistence and multi-tab policy

Server owns canonical history. Browser storage may store selected session, preferences, and local pre-acceptance outbox only.

All browser storage uses a versioned scoped prefix. `@hachej/boring-agent` stays auth-agnostic: hosts may pass opaque `storageScope` containing whatever tenant/user/workspace identity they need, but it must not contain raw emails, tokens, or secrets. If no scope is provided, fallback to workspace id, then `default`.

```txt
boring-agent:v2:{storageScope}:activeSessionId
boring-agent:v2:{storageScope}:composer:model
boring-agent:v2:{storageScope}:composer:thinking
boring-agent:v2:{storageScope}:composer:show-thoughts
boring-agent:v2:{storageScope}:{sessionId}:outbox
```

Current browser storage migration:

| Current browser storage | Keep? | New behavior |
| --- | --- | --- |
| `boring-agent:activeSessionId` | Yes | Migrate/keep as selected-session pointer under scoped v2 key; validate against Pi session list. |
| `boring-agent:composer:model` + `:user-selected` | Yes | Keep explicit user model choice only; runtime/default model comes from server/Pi. |
| `boring-agent:composer:thinking` | Yes | Keep when thinking control is enabled. |
| `boring-agent:composer:show-thoughts` | Yes | Keep thought visibility preference. |
| `boring-agent:followup-seq:*` / `boring-agent:followup-queue:*` | Yes, narrowed | Keep only pre-acceptance/local optimistic outbox state. Once server accepts, Pi queue is canonical. |
| `boring-agent:messages:${sessionId}` | No | Remove as transcript/cache source. Server/Pi JSONL is canonical. For dev/showcase fixtures, replace with fixture route, injected initial messages, or seeded Pi session. |
| Workspace layout/theme/recent/panel localStorage | Yes | Out of chat scope; keep workspace-owned UI preferences. |
| IndexedDB browser Pi runtime stores from v1 | No for server path | Do not use as canonical chat storage. Only future browser-native/offline runtime may reintroduce it behind separate mode. |

Browser localStorage must not be the canonical transcript. If retained as dev-only fallback for in-memory sessions, it must be explicitly marked fallback and never overwrite server history.

Multi-tab support is safety-focused, not full collaborative sync:

- Server/Pi remains canonical; multiple tabs may subscribe to the same session.
- Each tab owns and retries only optimistic outbox entries it created.
- Server dedupes prompt/follow-up sends by `{ sessionId, clientNonce }` plus follow-up `clientSeq` ordering.
- `storage` events or `BroadcastChannel` may sync active session id and model/thinking preferences best-effort.
- If a session is deleted/reset in another tab, current tab refreshes session list and falls back safely.
- Full real-time cross-tab optimistic outbox sync is out of scope.

## 17. Model, thinking, telemetry, and debug

### 17.1 Model selection

Preserve current behavior:

- fetch `/api/v1/agent/models`;
- use available/default model;
- persist explicit user selection only;
- clear invalid stored model;
- listen for `boring:model-change`;
- forward selected `{ provider, id }` on sends.

Existing model-selection hook can be reused if decoupled from old chat transport.

### 17.2 Thinking settings

Preserve current behavior:

- optional selector persists `off/low/medium/high`;
- only send `thinkingLevel` when host opts in;
- thought visibility persists separately.

Existing settings hook can be reused.

### 17.3 Telemetry/logging

Chat started/submitted/completed/failed telemetry keeps session/workspace/request/model provider/duration/error code. `PiSessionService` emits equivalent telemetry around Pi calls.

### 17.4 Debug/ops

Optional debug drawer can inspect system prompt, raw session messages, and activity. Session transcript/analysis routes continue to work if backed by canonical Pi session store/history, not AI SDK snapshots.

## 18. Performance, accessibility, observability, and public exports

### 18.1 Long-history strategy

First cut may render full history for parity. Add measured thresholds rather than speculative virtualization:

- warn/log in debug mode when `/state` render payload exceeds roughly 5MB or 300 messages;
- keep reducer/store shape able to accept paged history later;
- do not virtualize in first cut unless profiling proves it necessary;
- if virtualization lands later, preserve scroll-to-bottom, reasoning/tool collapse state, message actions, and search/debug affordances.

### 18.2 Accessibility and focus

Preserve or improve:

- composer focus after send, Edit queued, command error, and session switch;
- Escape priority: retry/stream interrupt before workspace close;
- accessible status announcements for retry/reconnecting/runtime notices;
- keyboard access to tool-card file open/copy/actions;
- reduced-motion-safe shimmer/collapse behavior;
- stable `data-boring-agent-part` attributes for tests/hosts.

### 18.3 Stream observability

In debug mode, expose safe protocol metadata:

- current `sessionId`, `lastSeq`, and connection state;
- last heartbeat time;
- replay gap/resync count;
- queue metadata length vs Pi queue length;
- recent event type ring buffer without payload secrets;
- active retry notice state.

Never log attachment contents, prompt bodies, tokens, or secrets by default.

### 18.4 Public export migration

Export only what workspace/app composition needs. Do not over-export internals.

Keep/export stable visual and composition seams:

- `ChatPanel` and `ChatPanelProps`;
- `PromptInput*` primitives already public today;
- `Tool*` primitives and `ToolRenderer`, `ToolPart`, `ToolRendererOverrides`;
- shared DTO types needed by plugins/workspace (`PiChatSnapshot`, `PiChatEvent`, `BoringChatMessage`, `BoringChatPart`, `QueuedUserMessage`).

Keep internal unless a workspace/app need appears:

- `RemotePiSession` concrete class;
- `piChatStore`;
- `piChatReducer`;
- `piChatStream`;
- private server `PiAgentSessionAdapter`.

Old AI-SDK-shaped public types are deprecated during migration and removed in Phase 7 if no longer needed.

## 19. Workspace/plugin integration

The primary rewrite lives in `@hachej/boring-agent`, but `@hachej/boring-workspace` must receive a targeted integration migration because it hosts the agent panel and bridges workspace events. This is not a workspace shell rewrite.

Workspace integration requirements:

- replace old agent ChatPanel imports/usages with new Pi-native ChatPanel/hook contract;
- render the agent-owned session list/navigation component where workspace currently wants a session list;
- forward workspace-scoped auth/request headers into new Pi chat/session/model routes;
- keep workspace warmup/blocker state wired so cold runtimes block/retry without losing drafts;
- rewire `PiChatEvent.file-changed` into existing workspace invalidation bridge;
- preserve `UiBridge.postCommand` as authoritative command dispatch; chat UI-command cards remain display-only;
- preserve artifact/file open callbacks from tool cards into workspace editors;
- merge plugin-provided custom tool renderers into the agent ChatPanel renderer map without moving session/chat state into workspace;
- preserve plugin reload hot-reload event handling from `/reload`, including EventSource reconnect/replay behavior;
- update workspace tests that mocked old AI SDK chat chunks to use Pi-native event DTOs.

Do not migrate unrelated workspace base UI, DockView layout code, plugin registry internals, catalogs, surface resolvers, or session-management logic into workspace. Workspace is display/composition only for sessions.

## 20. Associated GitHub issues and PRs

Use these as context when converting this plan to tasks or closing older work. The rewrite may supersede some refactor-only issues; do not blindly implement old issue shapes if they preserve split-state design.

### Primary drivers

- [#52](https://github.com/hachej/boring-ui/issues/52) — Explore pi-native wire protocol to simplify chat panel + tool wiring. Direct umbrella for this plan.
- [#12](https://github.com/hachej/boring-ui/issues/12) — Story: agent harness pluggability and Pi refactor. Historical parent, but this plan deliberately narrows scope: Pi-only clean path, no generic harness-pluggability work.
- [#44](https://github.com/hachej/boring-ui/issues/44) — Split ChatPanel into smaller components. Superseded by clean rewrite of ChatPanel shell + extracted primitives.
- [#42](https://github.com/hachej/boring-ui/issues/42) — Consolidate duplicated data-pi event parsing. Superseded by shared `PiChatEvent` DTOs and one reducer.
- [#46](https://github.com/hachej/boring-ui/issues/46) — `createHarness.ts sendMessage()` too large. Server-side PiSessionService should remove this pressure by avoiding AI-SDK-shaped streaming.

### Current behavior/regression issues to preserve or intentionally change

- [#82](https://github.com/hachej/boring-ui/issues/82) / [PR #126](https://github.com/hachej/boring-ui/pull/126) — Stop/queued-message behavior. Preserve Stop vs Escape semantics explicitly.
- [#149](https://github.com/hachej/boring-ui/issues/149) / [PR #151](https://github.com/hachej/boring-ui/pull/151) — Esc during chat should stop chat, not close workspace. Preserve chat-level keyboard priority.
- [#132](https://github.com/hachej/boring-ui/issues/132) / [PR #140](https://github.com/hachej/boring-ui/pull/140) — Reload showed compacted tail, not full transcript. Canonical server history must hydrate full transcript.
- [PR #138](https://github.com/hachej/boring-ui/pull/138) — Session chat self-heals from transient runtime 503 and plugin front refreshes on `/reload`. Preserve both lessons.
- [PR #162](https://github.com/hachej/boring-ui/pull/162) — Runtime readiness nonblocking. Coordinate with cold-runtime/session retry behavior.
- [#121](https://github.com/hachej/boring-ui/issues/121) — Model picker/model selection shortcuts. Keep model selection agent-owned and decoupled from chat transport.
- Current Boring delete-one queued follow-up behavior is intentionally not preserved in first cut; TUI-style restore-all replaces it.
- Current `/clear` and regenerate behavior are intentionally removed/deferred from first cut.

### Workspace/plugin integration issues

- [#109](https://github.com/hachej/boring-ui/issues/109) — Re-resolve open file panes after workspace plugin reload. Relevant to `/reload` EventSource replay/reimport behavior.
- [#61](https://github.com/hachej/boring-ui/issues/61) — Static CLI asset endpoint for runtime plugin front hot reload. Relevant to plugin hot reload integration, not chat state.
- [#41](https://github.com/hachej/boring-ui/issues/41) — Wire `/reload` + per-workspace hot plugin reload into multi-tenant agent server. Keep workspace isolation and reload scoping.
- [#35](https://github.com/hachej/boring-ui/issues/35) — Reload PDF/image panes on file changes. Relevant to file-change event bridge.
- [#34](https://github.com/hachej/boring-ui/issues/34) — Complete plugin custom tool renderer API. Relevant to preserving/extending tool rendering without rewriting the wheel.
- [#26](https://github.com/hachej/boring-ui/issues/26) — Move `@file` mentions from agent into workspace composer provider. Re-evaluate after this plan because agent owns session/chat state but workspace owns file context.
- [#56](https://github.com/hachej/boring-ui/issues/56) — Ask-user Pi extension with workspace-aware session bridge. Relevant to future Pi-native event/tool integration.

### Historical implementation context

- [#19](https://github.com/hachej/boring-ui/issues/19) — Refactor ChatPanel pi-native follow-up/projection logic into focused hooks. Closed partial refactor; do not preserve split-state shape.
- [#43](https://github.com/hachej/boring-ui/issues/43) — Consolidate duplicated localStorage persistence. Closed symptom of current architecture; new plan removes browser snapshot persistence as canonical.
- [#48](https://github.com/hachej/boring-ui/issues/48) — Projection dispatch-table cleanup. Useful history, superseded by reducer/event protocol.
- [PR #58](https://github.com/hachej/boring-ui/pull/58) — AI SDK chat streaming + queue deletion. Historical source for current useChat/follow-up path; behavior reference only.
- [PR #15](https://github.com/hachej/boring-ui/pull/15) — Harness-scoped follow-up capabilities. Historical behavior reference for follow-up acceptance/deletion.

## 21. Migration approach

This is a rewrite, but it should land safely.

Cutover policy:

- No public dual-mode ChatPanel and no runtime `transport="legacy|pi-native"` prop.
- Build Pi-native path separately behind new files/routes and prove it in sandbox/tests.
- Keep new route surface permanently under `/api/v1/agent/pi-chat/*`; Pi is the intentional product bet for this rewrite.
- Old `/api/v1/agent/chat/*` remains untouched until cutover, then is deleted in Phase 7 after proof.
- Do not switch transport for an already-active mounted turn; cutover is a code migration, not a per-session runtime toggle.

### Phase 0 — Spec, behavior inventory, tests first

This rewrite should be implemented TDD-first. The current tests are a map of previous failure modes, not trash. For each implementation task, port/adapt the relevant old tests before writing replacement code. Keep a short mapping table in the task or PR notes: old test/file -> new test/file -> port/adapt/delete rationale.

- Finalize this plan.
- Create checklist from functional behavior preservation/deliberate-change matrix.
- Build a regression-test inventory from the existing ChatPanel, useAgentChat, useSessions, Pi projection, follow-up queue, route, session, tool-renderer, and workspace host tests.
- Add pure reducer tests before wiring React.
- Add server protocol contract tests for Pi event mapping.
- Add session navigation tests covering persisted active id, invalid id fallback, workspace header scoping, create/switch/delete/reset.
- Add cold-runtime tests: session fetch retries transient 503 without surfacing empty/error chat, does not retry non-503 failures, gives up after bounded budget, cancels retry state on scope change/unmount, and keeps a just-created session visible through stale empty refresh.
- Add follow-up queue tests covering retry, duplicate/out-of-order seq, `/state` queue hydration, client-first Edit queued restore plus server clear, stale outbox clearing after restart/recovery, and Stop vs Escape semantics.
- Add simple auto-retry tests: Pi `auto_retry_start` renders runtime notice, `auto_retry_end` clears/settles it, final failure shows stable error notice, and Stop/Escape cancellation calls Pi retry abort when available.
- Add plugin reload tests: command-originated `/reload` reconnects plugin EventSource and re-imports same-revision replay; lifecycle-originated `boring.plugin.*` events do not retrigger reconnects.
- Add rendering tests for reasoning/tool ownership by message id and part id.
- Add visual/component parity tests or snapshots for message bubble structure, reasoning collapse, grouped tool summary, attachment chips, composer footer controls, empty state, keyboard/focus behavior, and required `data-boring-agent-part` attrs.
- Add tool renderer contract tests: `rendererId` beats tool name, tool-name fallback still works, unknown renderer ids render safely, plugin renderer collisions follow chosen policy, and default renderers receive expected `ToolPart` shape.

### Phase 1 — Shared DTOs, RemotePiSession, reducer/store

Build browser-side `RemotePiSession` facade plus `piChatReducer` with tests for:

- `/state` snapshot hydrates messages, queue, status, active turn id, and seq;
- stale `/state` hydration is ignored after session switch;
- NDJSON parser handles split chunks, split UTF-8, blank lines, heartbeat frames, malformed lines, reconnect, seq gaps, and browser reload while a turn is active;
- event/schema validation rejects malformed frames without partial state mutation;
- server subscribe/replay ordering cannot drop events emitted during replay setup;
- command receipts reconcile optimistic outbox without mutating canonical transcript;
- user -> assistant text;
- stable canonical message ids across stream -> `/state` hydration;
- reasoning -> text;
- tool call -> tool result -> text;
- duplicate/stale seq ignored;
- follow-up queued by HTTP receipt -> `queue-updated` -> `followup-consumed` -> assistant reply;
- duplicate follow-up text reconciled by FIFO nonce/seq metadata, not text equality;
- TUI-style Edit queued restores local display text to composer before clearing the server queue; clear failure preserves draft text and surfaces notice;
- abort/error states settle unresolved tool calls;
- transport/replay errors update connection state without creating assistant error messages;
- auto-retry start/end update runtime notices without mutating transcript history;
- file-changed/ui-command events do not mutate message history except through explicit display parts.

### Phase 2 — Session navigation and composer policy modules

Extract/rebuild around `RemotePiSession` and new store:

- active session storage helpers with `storageScope`;
- create/switch/delete/reset UI actions;
- bounded 503 retry for cold runtime session fetches, with version/unmount cancellation guards;
- scope-local pending-created session overlay so stale immediate refreshes do not hide newly created session;
- model selection and thinking settings reuse/adaptation;
- slash command registry wiring with busy policy;
- warmup/blocker/pre-submit policy;
- initial draft and auto-submit race guards;
- composer history from canonical user messages;
- attachment enrichment before prompt submission.

### Phase 3 — Server PiSessionService remote-session protocol

Add Pi-native `/state`, `/events`, and command endpoints while old endpoint still exists.

- Create `PiSessionService` as only server-side chat seam.
- Wrap Pi `AgentSession` directly; do not create generic harness abstraction or second queue/transcript system.
- Keep routes thin.
- Emit browser-safe `PiChatEvent` directly from Pi session events.
- Build `PiChatSnapshot` from Pi session state/queue/status.
- Keep stable `turnId` and monotonic session-scoped `seq`.
- Fix session identity before depending on new session list.
- Add session identity tests: streamed session never appears twice; only Pi sessions are listed; delete removes Pi session and thin metadata/index entry.
- Preserve file-change events and `sessionChangesTracker` integration.
- Preserve explicit Stop/Interrupt behavior.
- Preserve telemetry and stable error codes.
- Keep existing sessions/transcript/analysis route behavior unless explicitly superseded.

### Phase 4 — New ChatPanel shell and standalone sandbox

Create minimal sandbox/component outside current `ChatPanel` first.

No old hooks imported. No AI SDK state. No old merge logic.

Wire new shell to existing visual primitives for:

- message timeline through `Conversation` + `Message` primitives;
- empty state through existing conversation/ChatPanel empty-state primitives;
- reasoning and thoughts toggle through `Reasoning`;
- tool renderers via `ToolCallGroup` / `Tool` primitives and `toolRenderers` overrides;
- custom renderer routing via `ToolUiMetadata.rendererId`;
- attachment chips;
- composer through `PromptInput`, `PromptInputTextarea`, `PromptInputFooter`, and `PromptInputSubmit`;
- model/thinking selectors;
- slash/mention pickers;
- plugin update banner;
- runtime notices, including simple Pi auto-retry notices;
- debug drawer toggle.

### Phase 5 — Workspace package integration

Migrate only workspace/agent boundary:

- replace old agent ChatPanel imports/usages with new Pi-native ChatPanel/hook contract;
- render agent-owned session list/navigation component where workspace wants a session list;
- forward workspace-scoped auth/request headers into new Pi chat/session/model routes;
- keep workspace warmup/blocker state wired;
- rewire file-change events from `PiChatEvent.file-changed` into existing workspace invalidation bridge;
- preserve `UiBridge.postCommand` as authoritative dispatch;
- preserve artifact/file open callbacks;
- merge plugin-provided tool renderers;
- preserve plugin reload hot-reload EventSource behavior;
- update workspace tests from AI SDK chunk mocks to Pi-native DTOs.

### Phase 6 — Browser/e2e proof

Must pass:

- first prompt streams text smoothly;
- submitted/waiting/streaming/idle states visible and correct;
- reasoning renders in correct assistant message;
- tool calls/results render under owning assistant message and settle on error/abort;
- default tool renderers (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`, UI bridge tools) render through existing primitives;
- plugin/custom tool renderer resolves by `ToolUiMetadata.rendererId`; unknown renderer falls back safely;
- queue three text-only follow-ups while streaming; one-at-a-time interleaving preserved;
- duplicate follow-up text reconciles by nonce/seq metadata, not text;
- Edit queued restores all queued follow-up display text to composer before clearing the server queue, without stopping current turn;
- Stop aborts and clears queued follow-ups; Escape interrupts without clearing queued follow-ups;
- reload hydrates full canonical session state, including live queue/status;
- reload during active stream preserves committed history, active/running status, queue previews, and session-list identity; it resumes via `/events` when replay is available or cleanly falls back to canonical `/state` without empty-chat overwrite;
- cold page reload during runtime warmup keeps session UI loading/retrying instead of empty, then self-heals when sessions endpoint stops returning 503;
- active session id survives refresh and invalid persisted id falls back safely;
- create/switch/delete/reset sessions behave as specified;
- streamed sessions show exactly one session-list entry;
- attachments visible vs server-enriched payload behavior is preserved;
- attachment while streaming shows notice and does not queue;
- `/reset`, `/reload`, `/help`, skill commands, and extra commands work; `/clear` is absent from first-cut slash help/command list;
- `/reload` refreshes plugin frontend panels without workspace switch/remount, including same-revision replay re-import;
- model and thinking selections persist and are sent correctly;
- warmup/blocker/pre-submit cancellation keeps draft local;
- Pi auto-retry shows simple retrying notice and clears/settles on retry end;
- initial draft restore/auto-submit callbacks fire once and only for active session;
- file-change invalidation still fires;
- host `onOpenArtifact` still works from tool cards;
- required `data-boring-agent-part` attrs remain stable.

### Phase 7 — Delete old implementation

Only after proof:

- remove `@ai-sdk/react`;
- remove old `useAgentChat` wrapper;
- remove old Pi projection/follow-up hooks;
- remove AI SDK frontend assumptions;
- remove client PUT snapshot route if no longer used by any migration path;
- remove obsolete tests or rewrite them against new reducer/store.

## 22. Acceptance criteria

- Chat history has one frontend owner.
- Chat render path has one message source.
- Browser chat control flows through `RemotePiSession`, not direct route calls in components.
- New `ChatPanel` is primarily composition/rendering, not protocol logic.
- Server/Pi, not browser PUT, owns canonical history.
- `/state` hydrates transcript plus live session state.
- Follow-up state follows Pi/TUI semantics and reconciles by nonce/seq metadata.
- Regenerate/rewind is not implemented in first cut, and no client-side transcript surgery remains.
- `/clear` is removed from first-cut commands.
- Tool/reasoning chunks never attach to wrong assistant message.
- Tool rendering reuses existing `Tool` / `ToolCallGroup` / default renderer stack through one adapter.
- Plugin/custom tool rendering works through `ToolUiMetadata.rendererId` + registered frontend renderer path, with safe fallback.
- Session navigation/create/switch/delete/reset/hydration behavior matches this plan.
- Listing a streamed session shows exactly one entry; deleting removes Pi session and leaves no orphan/phantom Boring sidecar.
- Working/stop/interrupt/error/retry states match this plan.
- Existing visual quality is preserved or explicitly approved as changed.
- Existing chat primitive visuals are reused; AI SDK type coupling is removed without unnecessary restyling.
- Required `data-boring-agent-part` attributes remain stable for tests and host integrations.
- `@ai-sdk/react` is gone from agent frontend.

## 23. Non-goals

- No workspace shell rewrite. Only workspace/agent integration boundary migrates.
- No moving session management into workspace.
- No DockView rewrite.
- No plugin-system rewrite. Adding narrow tool-renderer contribution seam for issue #34 is allowed.
- No switching to `pi-web-ui` package and no direct reuse of Pi TUI terminal components.
- No Lit/mini-lit adoption.
- No steering UI or steering queue support in first cut; busy normal sends are follow-ups.
- No session tree/branch UI, message-level regenerate, or rewind in first cut.
- No full queued-message editor; first cut only supports TUI-style restore-all-to-composer.
- No full real-time multi-tab optimistic sync.
- No non-Pi harness support in this rewrite.
- No generic harness-pluggability work.
- No new database dependency inside `@hachej/boring-agent`; core/cloud can inject durable stores later.

## 24. Implementation guidance for agents

Agents implementing this must treat current chat implementation as behavior-reference only.

Allowed references:

- tests showing expected behavior;
- visual primitive components;
- Pi web-ui concepts and render batching from `AgentInterface.ts` / `StreamingMessageContainer.ts`;
- Pi TUI/session semantics from `agent-session.ts` / `interactive-mode.ts`;
- Pi `AgentEvent` / `AgentSessionEvent` model and exported session APIs;
- current route validation/error tests as behavior contracts.

Forbidden references:

- copying old `displayMessages` logic;
- copying old split history model;
- preserving AI SDK as chat state owner;
- preserving client snapshot persistence as canonical history;
- reintroducing direct route calls throughout ChatPanel instead of `RemotePiSession`.

## 25. Non-blocking implementation choices

These choices should not reopen the architecture. Resolve them inside implementation tasks with tests.

1. Use Zustand or another external store under `RemotePiSession`?
   - Recommendation: Zustand is acceptable/preferred if convenient because it is already in the workspace dependency graph. Regardless of store library, high-frequency `message-delta` rendering must be throttled/coalesced; React 18 auto-batching alone is not the performance strategy.
2. How much stream replay buffer is enough?
   - Recommendation: bounded by count, bytes, time, or equivalent cap; exact defaults are implementation/config choices. After eviction, client hydrates canonical `/state` and resumes from latest seq.
3. What is the custom tool renderer collision policy?
   - Recommendation: require namespaced ids. Reject duplicate `rendererId`s in development/test with clear error; warn and first-registration-wins in production to avoid blanking app.
4. Does issue #34 land inside this rewrite or as immediate follow-up task?
   - Recommendation: include minimal renderer contribution seam in this rewrite because new chat shell needs adapter anyway; docs/reference plugin can follow if needed.

# PI Agent + Vercel AI SDK Migration: Phase A + Phase B

## Execution Plan

**Companion doc:** `docs/plan/pi-coding-agent-vercel-chat-migration.md`

**Scope:** Build the `PiAgentCoreTransport` -- the bridge that lets Vercel AI SDK `useChat` drive `pi-agent-core`'s `Agent` class in the browser. This is the critical path piece that makes the entire migration possible.

**Key constraint:** `pi-coding-agent` is Node-only (50+ Node built-in imports). Browser mode MUST use `pi-agent-core` (zero Node imports) with our existing `defaultTools.js` routing file/git/bash operations through the boring-ui backend API.

---

## Phase A: Verify pi-agent-core browser transport contract

### Goal

Confirm the exact `Agent` + event API contract before building the transport. The nativeAdapter.jsx (857 lines) already uses this API successfully, but we need to document the precise event sequence and verify the AI SDK `UIMessageChunk` types we must emit.

### A.1 -- Document the event contract (no code changes)

**What:** Read the pi-agent-core source types and the existing nativeAdapter.jsx usage to produce a definitive event mapping document. This is "measure twice, cut once" -- the transport adapter's correctness depends entirely on this mapping being right.

**PI Agent Events (from `@mariozechner/pi-agent-core` types.d.ts):**

```
AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end", messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end", message: AgentMessage, toolResults: ToolResultMessage[] }
  | { type: "message_start", message: AgentMessage }
  | { type: "message_update", message: AgentMessage, assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end", message: AgentMessage }
  | { type: "tool_execution_start", toolCallId: string, toolName: string, args: any }
  | { type: "tool_execution_update", toolCallId: string, toolName: string, args: any, partialResult: any }
  | { type: "tool_execution_end", toolCallId: string, toolName: string, result: any, isError: boolean }
```

**AssistantMessageEvent (from `@mariozechner/pi-ai` types.d.ts):**

```
AssistantMessageEvent =
  | { type: "start", partial: AssistantMessage }
  | { type: "text_start", contentIndex: number, partial: AssistantMessage }
  | { type: "text_delta", contentIndex: number, delta: string, partial: AssistantMessage }
  | { type: "text_end", contentIndex: number, content: string, partial: AssistantMessage }
  | { type: "thinking_start", contentIndex: number, partial: AssistantMessage }
  | { type: "thinking_delta", contentIndex: number, delta: string, partial: AssistantMessage }
  | { type: "thinking_end", contentIndex: number, content: string, partial: AssistantMessage }
  | { type: "toolcall_start", contentIndex: number, partial: AssistantMessage }
  | { type: "toolcall_delta", contentIndex: number, delta: string, partial: AssistantMessage }
  | { type: "toolcall_end", contentIndex: number, toolCall: ToolCall, partial: AssistantMessage }
  | { type: "done", reason: "stop" | "length" | "toolUse", message: AssistantMessage }
  | { type: "error", reason: "aborted" | "error", error: AssistantMessage }
```

**AI SDK UIMessageChunk targets (from `ai` v6 types):**

```
UIMessageChunk (relevant subset) =
  | { type: 'start', messageId?: string }
  | { type: 'text-start', id: string }
  | { type: 'text-delta', id: string, delta: string }
  | { type: 'text-end', id: string }
  | { type: 'reasoning-start', id: string }
  | { type: 'reasoning-delta', id: string, delta: string }
  | { type: 'reasoning-end', id: string }
  | { type: 'tool-input-start', toolCallId: string, toolName: string }
  | { type: 'tool-input-delta', toolCallId: string, inputTextDelta: string }
  | { type: 'tool-input-available', toolCallId: string, toolName: string, input: unknown }
  | { type: 'tool-output-available', toolCallId: string, output: unknown }
  | { type: 'tool-output-error', toolCallId: string, errorText: string }
  | { type: 'finish', finishReason?: string }
  | { type: 'error', errorText: string }
```

### A.2 -- Definitive Event Mapping Table

This table IS the specification for Phase B implementation.

| PI Event Path | AI SDK Chunk(s) to Emit | Notes |
|---|---|---|
| `agent_start` | `{ type: 'start', messageId: uuid }` | One per sendMessages() call |
| `message_update` + `assistantMessageEvent.type === "text_start"` | `{ type: 'text-start', id: partId }` | partId = `text-${contentIndex}-${messageTs}` |
| `message_update` + `assistantMessageEvent.type === "text_delta"` | `{ type: 'text-delta', id: partId, delta }` | Hot path -- must be fast |
| `message_update` + `assistantMessageEvent.type === "text_end"` | `{ type: 'text-end', id: partId }` | |
| `message_update` + `assistantMessageEvent.type === "thinking_start"` | `{ type: 'reasoning-start', id: partId }` | partId = `reasoning-${contentIndex}-${messageTs}` |
| `message_update` + `assistantMessageEvent.type === "thinking_delta"` | `{ type: 'reasoning-delta', id: partId, delta }` | |
| `message_update` + `assistantMessageEvent.type === "thinking_end"` | `{ type: 'reasoning-end', id: partId }` | |
| `message_update` + `assistantMessageEvent.type === "toolcall_start"` | `{ type: 'tool-input-start', toolCallId: pending, toolName: pending }` | toolCallId not yet known; use contentIndex placeholder. See State Machine note. |
| `message_update` + `assistantMessageEvent.type === "toolcall_delta"` | `{ type: 'tool-input-delta', toolCallId: pending, inputTextDelta: delta }` | Partial JSON of tool args |
| `message_update` + `assistantMessageEvent.type === "toolcall_end"` | `{ type: 'tool-input-available', toolCallId: toolCall.id, toolName: toolCall.name, input: toolCall.arguments }` | Now we have the real toolCallId from the completed ToolCall |
| `tool_execution_start` | (no emit -- already covered by tool-input-available) | Could optionally re-emit tool-input-available here if toolcall_end not seen |
| `tool_execution_update` | (no direct mapping -- could emit `tool-output-available` with `preliminary: true`) | Progressive tool output. Consider emitting for long-running tools. |
| `tool_execution_end` (isError=false) | `{ type: 'tool-output-available', toolCallId, output: result }` | |
| `tool_execution_end` (isError=true) | `{ type: 'tool-output-error', toolCallId, errorText: String(result) }` | |
| `message_end` | (no direct emit -- text-end already sent) | Signals end of one assistant message, but agent may continue (tool loop) |
| `turn_end` | `{ type: 'finish-step' }` | One turn = one LLM call. Agent may do multiple turns. |
| `agent_end` | `{ type: 'finish', finishReason: 'stop' }` then `controller.close()` | Terminal event. Close the stream. |
| `assistantMessageEvent.type === "error"` | `{ type: 'error', errorText: reason }` then `controller.close()` | |

### A.3 -- Key Observations from nativeAdapter.jsx

1. **Agent creation pattern** (line 715-728): `new Agent({ initialState: { systemPrompt, model, thinkingLevel, messages, tools }, convertToLlm: defaultConvertToLlm })`
2. **Subscribe pattern** (line 731): `agent.subscribe((event) => { ... })` returns unsubscribe function
3. **Run pattern**: `agent.prompt(text)` (not `agent.run(text)` as the migration doc pseudocode shows -- the migration doc used the old API name)
4. **Abort pattern** (line 139 in agent.d.ts): `agent.abort()` exists and works
5. **Session ID** (line 728): Set via `agent.sessionId = nextSessionId` (setter, not constructor)
6. **Tool merging** (line 721): `mergePiTools(defaultTools, configuredTools)` -- same pattern needed
7. **Model resolution**: Uses `getModel()` from `@mariozechner/pi-ai` -- must have provider API keys set

---

## Phase B: Build PiAgentCoreTransport + Event State Machine

### Goal

Implement `PiAgentCoreTransport` that satisfies the `ChatTransport<UIMessage>` interface from the AI SDK, wrapping `pi-agent-core`'s `Agent` class. This is the single most important new file in the entire migration.

### B.0 -- Architecture Decision: Agent Lifecycle

The `Agent` instance should be **long-lived** (created once, reused across messages), not created fresh per `sendMessages()` call. Reasons:

1. The Agent holds conversation state (`state.messages`) -- creating a new one per call loses context
2. `nativeAdapter.jsx` uses a single Agent instance across the session lifetime (line 729: `agentRef.current = agent`)
3. The Agent's `subscribe` should be set up once, not re-subscribed per call
4. Session switching creates a new Agent (same as nativeAdapter pattern)

The `sendMessages()` method will:
1. Ensure an Agent exists (lazy init on first call)
2. Extract the latest user message from the AI SDK messages array
3. Call `agent.prompt(text)` which triggers the agent loop
4. Return a ReadableStream that translates Agent events to UIMessageChunks
5. Handle abort via `agent.abort()` + stream close

### B.1 -- Plan 01: PiAgentCoreTransport implementation

**File:** `src/front/providers/pi/piAgentCoreTransport.js`

**Estimated size:** ~180-220 lines (more than the migration doc's 80-line estimate because the event state machine adds real complexity)

#### Event State Machine

The transport must track state across events because:

1. **Tool call IDs are not available at `toolcall_start`** -- only at `toolcall_end` when the complete `ToolCall` object arrives. The AI SDK's `tool-input-start` chunk requires a `toolCallId`. Strategy: use a synthetic placeholder ID (`pending-tool-${contentIndex}`) during streaming, then emit the authoritative `tool-input-available` with the real ID at `toolcall_end`.

2. **Multiple content blocks interleave** -- An assistant message can have text + thinking + tool calls. The `contentIndex` in `AssistantMessageEvent` tracks which block is active. Each block needs its own part ID.

3. **Multi-turn agent loop** -- The agent may do: text -> tool call -> tool execution -> text -> tool call -> tool execution -> final text -> agent_end. Each "turn" (LLM call) produces `turn_start`/`turn_end`. The stream stays open across all turns until `agent_end`.

```
State per sendMessages() call:
  - activeTextPartId: string | null     -- currently streaming text part
  - activeReasoningPartId: string | null -- currently streaming reasoning part
  - activeToolCalls: Map<number, { placeholderId: string, realId?: string }> -- contentIndex -> IDs
  - messageTimestamp: number             -- for generating unique part IDs
  - finished: boolean                    -- guard against double-close
```

#### Implementation Skeleton

```js
import { Agent } from '@mariozechner/pi-agent-core'
import { getModel } from '@mariozechner/pi-ai'
import { mergePiTools } from './defaultTools'
import { getPiAgentConfig } from './agentConfig'

export class PiAgentCoreTransport {
  constructor({ tools, getApiKey, sessionId }) {
    this._tools = tools
    this._getApiKey = getApiKey
    this._sessionId = sessionId
    this._agent = null
  }

  get agent() { return this._agent }

  // Called by ChatStage when session changes
  resetAgent(sessionData) { /* create new Agent with sessionData */ }

  async sendMessages({ messages, abortSignal, trigger }) {
    // 1. Lazy-init agent if needed
    // 2. Extract last user message text (+ images if any)
    // 3. Create ReadableStream
    // 4. In stream.start():
    //    a. Set up event state machine
    //    b. Subscribe to agent events
    //    c. Call agent.prompt(text)
    //    d. Wire abortSignal -> agent.abort()
    // 5. Return stream
  }

  async reconnectToStream() { return null }  // No server-side stream to reconnect to
}
```

#### Detailed Task Breakdown

**Task 1: Core transport class + text/reasoning streaming**

Files:
- `src/front/providers/pi/piAgentCoreTransport.js` (new, ~120 lines for this task)

Actions:
1. Create `PiAgentCoreTransport` class implementing `ChatTransport` interface shape
2. Constructor takes `{ tools, getApiKey, convertToLlm, sessionId }`. Stores config but does NOT create Agent yet.
3. `_ensureAgent()` method: lazy-creates `Agent` with initial state from config. Uses `getModel()` for model resolution, `mergePiTools()` for tool setup, `getPiAgentConfig()` for system prompt. Sets `agent.sessionId`. Subscribes to events.
4. `sendMessages({ messages, abortSignal, trigger })`:
   - Calls `_ensureAgent()`
   - Extracts the last user message: filter `messages` for `role === 'user'`, take last, extract text from `content` (string) or `parts` (filter for `type === 'text'`, join `.text` values)
   - If `trigger === 'regenerate-message'`: not supported for browser mode, throw or no-op
   - Returns `new ReadableStream({ start(controller) { ... } })`
5. Stream start callback:
   - Initialize event state: `{ activeTextPartId: null, activeReasoningPartId: null, finished: false, messageTs: Date.now() }`
   - Emit `{ type: 'start', messageId: crypto.randomUUID() }`
   - Subscribe to agent events (this is a NEW subscription per sendMessages call, for this stream only). The long-lived agent subscription handles session persistence etc; this per-call subscription handles stream emission.
   - Map `message_update` events:
     - `text_start` -> emit `{ type: 'text-start', id: \`text-${contentIndex}-${messageTs}\` }`, store as activeTextPartId
     - `text_delta` -> emit `{ type: 'text-delta', id: activeTextPartId, delta }`
     - `text_end` -> emit `{ type: 'text-end', id: activeTextPartId }`, clear activeTextPartId
     - `thinking_start` -> emit `{ type: 'reasoning-start', id: \`reasoning-${contentIndex}-${messageTs}\` }`, store as activeReasoningPartId
     - `thinking_delta` -> emit `{ type: 'reasoning-delta', id: activeReasoningPartId, delta }`
     - `thinking_end` -> emit `{ type: 'reasoning-end', id: activeReasoningPartId }`, clear activeReasoningPartId
   - Map `agent_end` -> emit `{ type: 'finish', finishReason: 'stop' }`, `controller.close()`, unsubscribe, set finished=true
   - Map `assistantMessageEvent.type === "error"` -> emit `{ type: 'error', errorText }`, close, unsubscribe
   - Call `this._agent.prompt(userText).catch(err => { if (!finished) { controller.error(err); unsubscribe() } })`
   - Wire abort: `abortSignal?.addEventListener('abort', () => { this._agent.abort(); if (!finished) { controller.close(); unsubscribe(); finished = true } }, { once: true })`
6. `reconnectToStream()`: returns `null` (no server stream to reconnect to)
7. `resetAgent(sessionData)`: aborts current agent if streaming, creates new Agent with sessionData's messages/model/thinkingLevel, assigns sessionId

What to avoid and why:
- Do NOT create a new Agent per `sendMessages()` call -- the Agent holds conversation state across turns
- Do NOT use the migration doc's `agent.run(text)` -- the actual API is `agent.prompt(text)` (verified from agent.d.ts)
- Do NOT enqueue chunks after `controller.close()` -- guard with `finished` flag
- Do NOT forget to unsubscribe on abort/error -- will leak memory and cause ghost events

Verify:
- `npm run test:run` passes (no regressions in existing tests)
- The file imports resolve correctly: `import { PiAgentCoreTransport } from './piAgentCoreTransport'` works in a test file
- The class shape matches what `useChat({ transport })` expects: has `sendMessages()` and `reconnectToStream()` methods

Done:
- `PiAgentCoreTransport` class exists at `src/front/providers/pi/piAgentCoreTransport.js`
- Text deltas stream correctly: agent text_delta events produce text-start/text-delta/text-end chunks
- Reasoning deltas stream correctly: agent thinking_delta events produce reasoning-start/reasoning-delta/reasoning-end chunks
- Agent errors produce error chunks and close the stream
- Agent completion produces finish chunk and closes the stream

---

**Task 2: Tool call event mapping**

Files:
- `src/front/providers/pi/piAgentCoreTransport.js` (extend, ~40 lines added)

Actions:
1. Add tool call state tracking to the event state machine:
   ```
   activeToolCalls: new Map()  // contentIndex -> { placeholderId, realId }
   ```
2. Handle `message_update` with `assistantMessageEvent.type === "toolcall_start"`:
   - Generate placeholder: `pending-tool-${contentIndex}-${messageTs}`
   - Store in `activeToolCalls.set(contentIndex, { placeholderId })`
   - Emit `{ type: 'tool-input-start', toolCallId: placeholderId, toolName: '' }`
   - (toolName not known yet at start -- AI SDK accepts empty string, will be filled at available)
3. Handle `message_update` with `assistantMessageEvent.type === "toolcall_delta"`:
   - Look up placeholder from `activeToolCalls.get(contentIndex)`
   - Emit `{ type: 'tool-input-delta', toolCallId: placeholderId, inputTextDelta: delta }`
4. Handle `message_update` with `assistantMessageEvent.type === "toolcall_end"`:
   - Extract `toolCall` from event: `{ id, name, arguments }`
   - Update activeToolCalls entry with `realId: toolCall.id`
   - Emit `{ type: 'tool-input-available', toolCallId: toolCall.id, toolName: toolCall.name, input: toolCall.arguments }`
5. Handle `tool_execution_end` (isError=false):
   - Emit `{ type: 'tool-output-available', toolCallId, output: result }`
6. Handle `tool_execution_end` (isError=true):
   - Emit `{ type: 'tool-output-error', toolCallId, errorText: String(result) }`
7. Handle `tool_execution_update` (optional -- progressive output):
   - Emit `{ type: 'tool-output-available', toolCallId, output: partialResult, preliminary: true }`
   - Only emit this if partialResult is non-null (not all tools emit updates)

What to avoid and why:
- Do NOT assume toolCallId is available at `toolcall_start` -- it is only available at `toolcall_end` when the ToolCall object is complete
- Do NOT emit `tool-output-available` for the same toolCallId twice (once from tool_execution_update and once from tool_execution_end) without the `preliminary` flag on the update -- the AI SDK will finalize the tool result on the non-preliminary emit

Verify:
- Manual trace: simulate event sequence [toolcall_start, toolcall_delta, toolcall_end, tool_execution_start, tool_execution_end] and verify correct chunk emission order
- Tool results appear in the useChat messages array as `tool-result` parts after execution

Done:
- Tool calls stream their input progressively (start/delta/available)
- Tool results (success and error) produce correct output chunks
- Multiple concurrent tool calls (different contentIndex values) are tracked independently

---

**Task 3: Unit tests for the event state machine**

Files:
- `src/front/providers/pi/piAgentCoreTransport.test.js` (new, ~200-250 lines)

Actions:
1. Create test file using vitest
2. **Do not mock the Agent class.** Instead, extract the event-to-chunk mapping logic into a testable pure function: `mapAgentEventToChunks(event, state) -> { chunks: UIMessageChunk[], nextState }`. This function lives inside `piAgentCoreTransport.js` as a named export for testing.
3. Test cases for text streaming:
   - `text_start` -> produces `text-start` chunk with correct id
   - `text_delta` -> produces `text-delta` chunk with matching id and delta
   - `text_end` -> produces `text-end` chunk, clears active text part
   - Multiple text blocks (different contentIndex) get different part IDs
4. Test cases for reasoning streaming:
   - `thinking_start` -> produces `reasoning-start` chunk
   - `thinking_delta` -> produces `reasoning-delta` chunk
   - `thinking_end` -> produces `reasoning-end` chunk
5. Test cases for tool calls:
   - `toolcall_start` -> produces `tool-input-start` with placeholder ID
   - `toolcall_delta` -> produces `tool-input-delta` with matching placeholder
   - `toolcall_end` -> produces `tool-input-available` with REAL toolCallId, toolName, input
   - `tool_execution_end` (success) -> produces `tool-output-available`
   - `tool_execution_end` (error) -> produces `tool-output-error`
6. Test cases for interleaving:
   - text_start -> text_delta -> text_end -> toolcall_start -> toolcall_delta -> toolcall_end -> tool_execution_end -> text_start -> text_delta -> text_end -> agent_end
   - Verify all chunks are emitted in correct order with correct IDs
7. Test cases for multi-turn:
   - Two turns (turn_start -> message events -> turn_end -> turn_start -> message events -> turn_end -> agent_end)
   - Verify stream stays open across turns, closes only on agent_end
8. Test cases for error handling:
   - `assistantMessageEvent.type === "error"` -> produces error chunk
   - agent_end after error -> no double-finish
9. Test case for abort:
   - Verify finished flag prevents post-close enqueues

What to avoid and why:
- Do NOT test the full Agent integration here -- that is an integration test concern. Test only the pure event mapping logic.
- Do NOT use fake timers unless testing debounce behavior -- the mapping is synchronous

Verify:
- `npx vitest run src/front/providers/pi/piAgentCoreTransport.test.js` -- all tests pass
- Coverage on the mapping function approaches 100% of branches

Done:
- All event type mappings have at least one test
- Interleaving scenario (text + tools + text) passes
- Multi-turn scenario passes
- Error and abort scenarios pass

---

**Task 4: Abort handling + edge cases**

Files:
- `src/front/providers/pi/piAgentCoreTransport.js` (extend, ~20 lines)
- `src/front/providers/pi/piAgentCoreTransport.test.js` (extend, ~40 lines)

Actions:
1. Abort handling in `sendMessages()`:
   - When `abortSignal` fires: call `this._agent.abort()`, emit `{ type: 'abort', reason: 'User cancelled' }` if stream not already finished, then close stream, unsubscribe
   - Guard: if abortSignal is already aborted at call time, return immediately-closed stream with abort chunk
   - The `agent.abort()` method (confirmed in agent.d.ts line 139) will cause the agent loop to stop, which will emit `agent_end` or an error event. The abort handler should set `finished = true` BEFORE calling `agent.abort()` to prevent the subsequent agent_end from trying to close an already-closed stream.
2. Edge case: `sendMessages()` called while agent is already streaming:
   - The Agent class only supports one `prompt()` at a time (there is a `runningPrompt` field in the class)
   - Strategy: await `agent.waitForIdle()` before calling `agent.prompt()`, OR reject with error if already streaming
   - Prefer: `await this._agent.waitForIdle()` then proceed. This means the second call waits for the first to finish. The AI SDK handles this correctly because it won't call sendMessages while status is 'streaming'.
3. Edge case: empty messages array (no user messages):
   - Return immediately-closed stream: `new ReadableStream({ start(c) { c.enqueue({ type: 'finish' }); c.close() } })`
4. Add tests for all three edge cases

What to avoid and why:
- Do NOT swallow the abort signal -- the user expects the Stop button to actually stop token generation, not just hide the UI. `agent.abort()` is the real stop.
- Do NOT let abort + agent_end race condition produce `controller.enqueue on closed stream` errors. The `finished` flag is the guard.

Verify:
- Test: abort before agent_end produces abort chunk, no errors
- Test: abort after agent_end is a no-op
- Test: empty messages returns closed stream
- `npx vitest run src/front/providers/pi/piAgentCoreTransport.test.js` -- all pass

Done:
- AbortSignal correctly propagates to `agent.abort()`
- No race conditions between abort and agent_end
- Empty messages handled gracefully
- Double-send while streaming handled without crash

---

**Task 5: useChatTransport hook (mode selection)**

Files:
- `src/front/providers/pi/useChatTransport.js` (new, ~50 lines)

Actions:
1. Create React hook: `useChatTransport(capabilities)`
2. The hook returns the correct transport based on mode:
   ```js
   import { useMemo, useRef } from 'react'
   import { DefaultChatTransport } from 'ai'
   import { PiAgentCoreTransport } from './piAgentCoreTransport'
   import { createPiNativeTools } from './defaultTools'
   import { useDataProvider } from '../data'
   import { useQueryClient } from '@tanstack/react-query'
   import { buildApiUrl } from '../../utils/modeAwareApi'

   export function useChatTransport(capabilities) {
     const dataProvider = useDataProvider()
     const queryClient = useQueryClient()
     const tools = useMemo(
       () => createPiNativeTools(dataProvider, queryClient),
       [dataProvider, queryClient]
     )
     const transportRef = useRef(null)

     return useMemo(() => {
       if (isPiBackendMode(capabilities)) {
         // SERVER MODE: pi-coding-agent via backend
         return new DefaultChatTransport({
           api: buildApiUrl('/api/v1/agent/chat'),
           credentials: 'include',
         })
       }
       // BROWSER MODE: pi-agent-core in-browser
       if (!transportRef.current) {
         transportRef.current = new PiAgentCoreTransport({ tools })
       } else {
         // Update tools if they changed (provider reconnect, etc.)
         transportRef.current.updateTools(tools)
       }
       return transportRef.current
     }, [capabilities, tools])
   }
   ```
3. `isPiBackendMode(capabilities)` check: look at capabilities response for `mode === 'hosted'` or similar flag. For now, browser mode is the default (no backend agent endpoint exists yet).
4. The `PiAgentCoreTransport` instance is kept in a ref so it persists across re-renders (preserving the Agent instance and its conversation state).
5. Export the hook and the `isPiBackendMode` helper (the helper is useful for tests and other components).

What to avoid and why:
- Do NOT create a new PiAgentCoreTransport on every render -- it holds Agent state. Use ref.
- Do NOT import `DefaultChatTransport` at the top level if it pulls in server-only code. Verify it is browser-safe. (It is -- it is just a fetch wrapper.)
- Do NOT hardcode the API URL -- use `buildApiUrl()` from the mode-aware API utility (already exists in codebase)

Verify:
- Hook returns PiAgentCoreTransport in browser mode (default)
- Hook returns DefaultChatTransport when backend mode is active
- Transport instance is stable across re-renders (same ref)
- `npm run test:run` passes

Done:
- `useChatTransport` hook exists and returns correct transport by mode
- Browser mode transport uses PiAgentCoreTransport with our custom tools
- Server mode transport uses DefaultChatTransport hitting the backend API
- Transport instance is ref-stable (Agent state preserved)

---

## Dependency Graph

```
Task 1 (core transport + text/reasoning)
  |
  +---> Task 2 (tool call mapping) -- depends on Task 1's class structure
  |       |
  |       +---> Task 3 (unit tests) -- depends on Task 1 + 2's exported mapping function
  |               |
  +---------------+---> Task 4 (abort + edge cases) -- depends on Tasks 1-3
                          |
                          +---> Task 5 (useChatTransport hook) -- depends on Task 1-4 (needs working transport)
```

**Wave structure:**
- Wave 1: Task 1 (core class)
- Wave 2: Task 2 (tool calls) -- builds on Task 1
- Wave 3: Task 3 (tests) -- validates Tasks 1+2
- Wave 4: Task 4 (abort/edges) + Task 5 (hook) -- can be parallel since they touch different files

## Files Created / Modified

| File | Status | Purpose |
|---|---|---|
| `src/front/providers/pi/piAgentCoreTransport.js` | NEW | Core transport adapter |
| `src/front/providers/pi/piAgentCoreTransport.test.js` | NEW | Unit tests for event mapping |
| `src/front/providers/pi/useChatTransport.js` | NEW | React hook for mode-based transport selection |

**No existing files modified.** This is pure additive work. The transport is not wired into the UI yet -- that is Phase C (ChatStage.jsx).

## Verification Criteria

After all tasks complete:

1. `npx vitest run src/front/providers/pi/piAgentCoreTransport.test.js` -- all green
2. `npm run test:run` -- no regressions
3. The transport can be manually tested by temporarily replacing the Anthropic transport in `poc-stage-wings/src/VercelPiChat.jsx` with `PiAgentCoreTransport` (requires API key for the model provider)
4. Event mapping covers all 11 PI AgentEvent types and all 12 AssistantMessageEvent types
5. The mapping function is exported and testable independently of the Agent class

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| `toolcall_start` has no toolCallId | Use contentIndex-based placeholder, emit real ID at `toolcall_end` |
| Agent throws during `prompt()` | Catch in stream start, emit error chunk, close stream |
| Abort + agent_end race | `finished` boolean flag, set before `agent.abort()` |
| Agent not idle when second sendMessages arrives | `await agent.waitForIdle()` before prompt |
| Part IDs collide across turns | Include messageTimestamp in all part IDs |
| getModel() returns null (no API keys) | Check in _ensureAgent, throw descriptive error |
| defaultConvertToLlm import | Import from `@mariozechner/pi-web-ui` -- BUT we want to decouple from pi-web-ui. Check if pi-agent-core re-exports it or if we need a minimal converter. Fallback: write a 20-line converter that filters to user/assistant/toolResult messages. |

## Notes for Executor

- The migration doc says `agent.run(text)` but the actual API is `agent.prompt(text)` or `agent.prompt(message)`. Use `agent.prompt(text)` for simple text input.
- `defaultConvertToLlm` is currently imported from `@mariozechner/pi-web-ui` in nativeAdapter.jsx. Since we are decoupling from pi-web-ui, we should either: (a) import it from pi-web-ui temporarily and mark as TODO, or (b) write a minimal converter. The converter just needs to filter AgentMessages to LLM-compatible Message types (user, assistant, toolResult). Check if `pi-agent-core` has a default converter built in (the Agent constructor's `convertToLlm` parameter is optional per agent.d.ts line 13).
- The Agent class already has `abort()` (line 139 of agent.d.ts) -- no need to implement custom abort logic.
- The `getApiKey` option on Agent constructor (line 40 of agent.d.ts) handles dynamic API key resolution. Wire this to the existing `runtime.providerKeys.get()` pattern.
- Provider API keys in dev mode are seeded from `VITE_PI_*_API_KEY` env vars (see nativeAdapter.jsx lines 809-820). The transport does not handle key storage -- that stays in the runtime.

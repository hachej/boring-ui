# Harness follow-up capabilities plan

## Problem

The current `followup-pi-history` branch proves that pi-native follow-up can fix ordering/duplication for queued chat messages, but the implementation leaks pi-specific stream semantics into the shared chat UI:

- `ChatPanel` reduces `data-pi-*` chunks directly.
- Generic AI SDK message persistence is disabled in the panel.
- Follow-up posting assumes the harness can accept `/followup` while a stream is active.

That is wrong for pluggable harnesses. DeepAgent / AI SDK Agent integrations are already designed around the AI SDK UI Message Stream Protocol: one message submission produces one assistant response stream. They do not expose a pi-style `followUp()` API for injecting another user message into a currently running stream.

## Research notes

### AI SDK Agent

AI SDK Agent exposes a per-call interface:

```ts
agent.generate({ messages | prompt, abortSignal, ... })
agent.stream({ messages | prompt, abortSignal, ... })
```

`createAgentUIStream({ agent, uiMessages, abortSignal })` consumes a UI message array and streams one assistant response as `UIMessageChunk`s. It does not advertise native user-message queueing while the stream is active.

### `useChat`

Current AI SDK React `sendMessage()` pushes/replaces a user message and immediately calls `makeRequest()`. `makeRequest()` creates a new `activeResponse` and starts a transport request. There is no built-in queued-user-message behavior for `sendMessage()` while status is `submitted`/`streaming`.

Therefore, for ordinary AI SDK/DeepAgent transports, safe behavior is:

```txt
ready -> sendMessage()
busy  -> block send, or app-owned local queue that drains after ready
```

### DeepAgent

DeepAgent / DeepAgentSDK documentation and package metadata indicate AI SDK integration via the AI SDK UI Message Stream Protocol. It should not need to emit Boring/pi-specific DTOs. It should be usable as a normal AI SDK Agent/transport path.

### Pi

Pi is special because pi sessions support native follow-up queueing:

```ts
piSession.followUp(text)
```

That API lets a second user turn be queued while the first response is still streaming. This should be treated as pi-harness internal machinery, exposed only through an explicit capability.

## Target design

Separate three concerns:

1. **Composer busy policy** — what the UI does when user presses send while status is busy.
2. **Harness follow-up capability** — whether the backend can accept a busy-time follow-up.
3. **Stream/history protocol** — how assistant/user turns are represented to `useChat`.

The common ChatPanel must not assume `data-pi-*` for every harness.

## Capability model

Add frontend-visible runtime capabilities, fetched or embedded with session/runtime metadata. Prefer **not** to mutate the minimal `AgentHarness` interface unless implementation proves it is necessary; keep capabilities at the app/session/route metadata layer so the harness seam remains small and stable.

```ts
export type FollowUpMode = 'native' | 'client-drain' | 'none'

export interface AgentHarnessCapabilities {
  followUpMode?: FollowUpMode
  historyMode?: 'ai-sdk' | 'pi-native-projection'
}
```

Initial defaults come from runtime/session metadata, not from inspecting the harness interface:

```ts
followUpMode = runtimeCapabilities.followUpMode ?? 'none'
historyMode = runtimeCapabilities.historyMode ?? 'ai-sdk'
```

Pi runtime metadata can opt into:

```ts
{
  followUpMode: 'native',
  historyMode: 'pi-native-projection' // temporary, pi-scoped compatibility only
}
```

`pi-native-projection` is not a new shared protocol. It is explicitly session/harness-scoped temporary debt for the current pi adapter while we verify whether pi can emit fully transparent AI SDK `UIMessageChunk`s for inline native follow-up.

DeepAgent / AI SDK Agent harness should use:

```ts
{
  followUpMode: 'none', // at first
  historyMode: 'ai-sdk'
}
```

Optional later mode:

```ts
followUpMode: 'client-drain'
```

This means frontend displays queued bubbles and waits until ready, then calls normal `sendMessage()`.

## Composer behavior

Let:

```ts
const isBusy = status === 'submitted' || status === 'streaming'
const followUpMode = capabilities.followUpMode ?? 'none'
const canSubmitWhileBusy = followUpMode === 'native' || followUpMode === 'client-drain'
const sendDisabled = !hasMessage || (isBusy && !canSubmitWhileBusy)
```

Behavior:

| Mode | Busy send button | Busy Enter | Action |
|---|---:|---:|---|
| `none` | disabled | no-op | Composer may stay editable; show hint: `Wait for the current response to finish.` |
| `native` | enabled | queues | Show waiting bubble, POST `/followup`, harness owns queue. |
| `client-drain` | enabled | queues | Show waiting bubble, do not POST `/followup`; on ready call `sendMessage(next)`. |

For this branch, implement only `none` and `native`. Defer `client-drain` unless required.

## Pi-native behavior

When `followUpMode === 'native'` and user sends while busy:

1. Frontend appends an optimistic queued user bubble.
2. Frontend POSTs `/api/v1/agent/chat/:sessionId/followup` with `clientSeq` + `clientNonce`.
3. Server validates sequence/idempotency.
4. Pi harness calls `piSession.followUp(...)`.
5. Pi harness owns ordering and consumption.
6. Frontend removes the waiting state when harness emits the consumed/user turn signal.

Important: the UI should treat waiting bubbles as display-only; it should not mutate AI SDK canonical messages except for the native pi projection path while it exists.

## Non-pi behavior

When `followUpMode === 'none'` and user sends while busy:

- Do not POST `/followup`.
- Do not call `sendMessage()`.
- Keep composer text/files intact.
- Disable send button and prevent Enter submit.
- Display helper copy near send/composer.

DeepAgent and AI SDK Agent harnesses therefore remain protocol-transparent.

## History protocol direction

### Short-term

Keep pi projection isolated behind `historyMode === 'pi-native-projection'`.

- `ChatPanel` only runs `data-pi-*` reducer when history mode is pi projection.
- Otherwise, `useChat().messages` remains canonical and existing AI SDK persistence stays enabled.
- `/messages` pi projection helper should only be applied for pi projection sessions, not globally.

### Long-term

Prefer transparent AI SDK messages for pi too:

- Pi adapter converts pi events into ordinary AI SDK `UIMessageChunk`s where possible.
- If AI SDK cannot stream multiple assistant/user message boundaries in one response cleanly, keep pi-native projection local to a Pi transport/panel.
- Do not require DeepAgent or other harnesses to translate into Boring-specific custom data parts.

## Implementation steps

1. **Define capabilities**
   - Add shared `AgentHarnessCapabilities`/runtime metadata type.
   - Expose capabilities via session/runtime metadata or a small server endpoint; avoid adding required fields to `AgentHarness` unless no cleaner seam exists.
   - Pi runtime sets `followUpMode: 'native'`, `historyMode: 'pi-native-projection'`.
   - Default is `followUpMode: 'none'`, `historyMode: 'ai-sdk'`.

2. **Gate busy-send behavior**
   - In `ChatPanel`, compute mode.
   - If busy + mode none: disable send and block submit.
   - If busy + native: keep current optimistic waiting bubble + `/followup` flow.
   - Remove unconditional follow-up posting paths.

3. **Gate pi projection**
   - Only run `data-pi-*` reducer, pi persistence, and raw `data-pi-*` rebuild when `historyMode === 'pi-native-projection'`.
   - Otherwise `useAgentChat({ persistMessages: true })` handles normal AI SDK history.

4. **Server route gating**
   - `/followup` should reject when the current runtime does not support native follow-up.
   - Use a stable error code, e.g. `followup_unsupported`, from the canonical error-code enum/middleware path rather than raw ad hoc strings.
   - `projectPiDataMessages()` should only be used for pi projection sessions/harnesses.

5. **Tests**
   - Pi mode: busy send posts `/followup`, shows waiting bubble, clears when consumed.
   - None mode: busy send button disabled; Enter does not submit; no `/followup` request.
   - Non-pi history: raw AI SDK chunks/messages persist through normal `useAgentChat` path.
   - Pi history: existing follow-up ordering tests remain green.

6. **Docs**
   - Document follow-up modes in `packages/agent/docs/plans/agent-package-spec.md` or a follow-up interface doc.
   - State explicitly that DeepAgent / AI SDK Agent uses `followUpMode: 'none'` initially and normal AI SDK stream protocol.

## Harness-specific tools and plugin UI

Tool activation should follow the same capability-scoped pattern as follow-ups.

Current tool flow:

- `AgentTool` is the shared server-side tool contract.
- `registerAgentRoutes()` builds core tools from the runtime bundle:
  - harness/shell tools (`bash`, `execute_isolated_code` when available),
  - filesystem tools (`read`, `write`, `edit`, `find`, `grep`, `ls`),
  - upload tools.
- Hosts can add tools with `extraTools` / `getExtraTools`.
- Plugins can add tools through the pi plugin loader.
- `mergeTools()` combines standard, host, scoped, and plugin tools; later registrations can override by name.
- The active harness receives the final tool list. The pi harness currently adapts that list into pi `customTools`.
- The frontend catalog endpoint exposes active tool names/descriptions/schemas.
- `ChatPanel` renders tool parts generically, with optional custom renderers via `toolRenderers`.

This means a harness may activate additional harness-specific tools without making them core. Example:

```txt
pi runtime only:
  pi.subagent / subagent

deepagent runtime only:
  deepagent.handoff / memory / etc.
```

Guidelines:

1. Core tools should be the portable workspace/tooling baseline.
2. Harness-specific tools should be contributed by the harness/runtime binding, not assumed by the shared frontend.
3. Tool names should be stable and collision-aware. Prefer namespacing for harness-only semantics if the tool is not portable (`pi.subagent`, `deepagent.handoff`) unless compatibility with an existing tool name is intentional.
4. Prompt snippets/system prompt entries must be derived from the active tool list only.
5. The catalog must reflect the current runtime/session tool list; the UI must not assume every harness has every tool.

Plugin-owned tool UI:

- Today, plugins can bring server-side agent tools.
- Today, the host/app shell can provide matching frontend renderers through `ChatPanel.toolRenderers`.
- There is not yet a formal automatic plugin contract for bundling `server tool + frontend tool renderer` as one unit.

Future plugin shape could be explicit app-shell composition, for example:

```ts
// server side
export const tools = [myTool]

// frontend side, bundled by the host app
export const toolRenderers = {
  my_tool: MyToolRenderer,
}
```

Do not dynamically load arbitrary plugin frontend code from the server at runtime. Frontend renderers should be explicit imports/registrations in the host/app shell so bundling, trust, and versioning remain clear.

For this follow-up capability plan, tool UI is adjacent but not required for implementation. The key invariant is that harness/plugin-specific tools and renderers must remain additive and capability/catalog-driven, not hardcoded into shared chat assumptions.

## Open questions

1. Where should capabilities be resolved for frontend: session metadata, `/models`, `/capabilities`, or `createAgentApp` injected config? Current recommendation: session/runtime metadata or `/capabilities`, not a required `AgentHarness` field.
2. Should `client-drain` be implemented now or deferred?
3. Can pi adapter emit fully transparent AI SDK multi-message streams without custom `data-pi-*` history projection?
4. Should tool capability metadata include renderer hints (`rendererId`, display group, icon), or should renderers remain keyed only by tool name for now?

## Recommendation

Do not merge current `data-pi-*` behavior as unconditional ChatPanel logic. First isolate it behind `historyMode === 'pi-native-projection'` and gate busy-send follow-up behind `followUpMode === 'native'`. Treat `pi-native-projection` as temporary pi-only compatibility, not a shared frontend protocol.

This gives us:

- Pi: native follow-up works.
- DeepAgent / Agent SDK: normal AI SDK protocol remains clean.
- Other harnesses: composer safely blocks send while busy.
- Future: optional client-drain queue can be added without touching harnesses.

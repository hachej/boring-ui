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
export interface AgentRuntimeCapabilities {
  /**
   * Runtime can accept a user follow-up while the current response is busy.
   * If false, composer send is disabled while busy.
   */
  nativeFollowUp: boolean

  /**
   * AI SDK `useChat().messages` is the canonical history source.
   * If false, the harness/adapter owns canonical history projection.
   */
  aiSdkOwnsHistory: boolean
}
```

Initial defaults come from runtime/session metadata, not from inspecting the harness interface:

```ts
nativeFollowUp = runtimeCapabilities.nativeFollowUp ?? false
aiSdkOwnsHistory = runtimeCapabilities.aiSdkOwnsHistory ?? true
```

Pi runtime metadata can opt into:

```ts
{
  nativeFollowUp: true,
  aiSdkOwnsHistory: false, // temporary: pi adapter owns history projection
}
```

`aiSdkOwnsHistory: false` is not a new shared protocol. It is an explicit session/harness-scoped escape hatch for adapters where AI SDK message reconstruction is not the canonical source. In the current implementation, only pi uses this path, via temporary `data-pi-*` projection, while we verify whether pi can emit fully transparent AI SDK `UIMessageChunk`s for inline native follow-up.

DeepAgent / AI SDK Agent harness should use:

```ts
{
  nativeFollowUp: false,
  aiSdkOwnsHistory: true,
}
```

A future frontend-owned queue/drain mode can be added later if needed, but it is not part of this first-pass capability surface.

## Composer behavior

Let:

```ts
const isBusy = status === 'submitted' || status === 'streaming'
const sendDisabled = !hasMessage || (isBusy && !capabilities.nativeFollowUp)
```

Behavior:

| Capability | Busy send button | Busy Enter | Action |
|---|---:|---:|---|
| `nativeFollowUp: false` | disabled | no-op | Composer may stay editable; show hint: `Wait for the current response to finish.` |
| `nativeFollowUp: true` | enabled | queues | Show waiting bubble, POST `/followup`, harness owns queue. |

For this branch, do not implement frontend queue/drain for non-native runtimes.

## Pi-native behavior

When `nativeFollowUp === true` and user sends while busy:

1. Frontend appends an optimistic queued user bubble.
2. Frontend POSTs `/api/v1/agent/chat/:sessionId/followup` with `clientSeq` + `clientNonce`.
3. Server validates sequence/idempotency.
4. Pi harness calls `piSession.followUp(...)`.
5. Pi harness owns ordering and consumption.
6. Frontend removes the waiting state when harness emits the consumed/user turn signal.

Important: the UI should treat waiting bubbles as display-only; it should not mutate AI SDK canonical messages except for the native pi projection path while it exists.

## Non-pi behavior

When `nativeFollowUp === false` and user sends while busy:

- Do not POST `/followup`.
- Do not call `sendMessage()`.
- Keep composer text/files intact.
- Disable send button and prevent Enter submit.
- Display helper copy near send/composer.

DeepAgent and AI SDK Agent harnesses therefore remain protocol-transparent.

## History protocol direction

### Short-term

Keep adapter-owned projection isolated behind `aiSdkOwnsHistory === false`.

- `ChatPanel` only runs the temporary `data-pi-*` reducer when AI SDK does not own history and the active runtime is the pi projection path.
- Otherwise, `useChat().messages` remains canonical and existing AI SDK persistence stays enabled.
- `/messages` pi projection helper should only be applied for adapter-owned/pi-projection sessions, not globally.

### Long-term

Prefer transparent AI SDK messages for pi too:

- Pi adapter converts pi events into ordinary AI SDK `UIMessageChunk`s where possible.
- If AI SDK cannot stream multiple assistant/user message boundaries in one response cleanly, keep pi-native projection local to a Pi transport/panel.
- Do not require DeepAgent or other harnesses to translate into Boring-specific custom data parts.

## Implementation blueprint

Locked implementation choices for the first pass:

- Adapt the current `followup-pi-history` implementation in place by capability-gating it. Do not pause for a full transparent-AI-SDK rewrite.
- Non-pi / DeepAgent / AI SDK Agent mode blocks send while busy. Do **not** implement frontend queue/drain yet.
- Capabilities should come from runtime/session metadata exposed to the frontend, preferably a dedicated `GET /api/v1/agent/capabilities` route.
- Keep current pi projection as temporary, adapter-owned compatibility behind `aiSdkOwnsHistory === false`.
- Add a stable unsupported-follow-up error code: `FOLLOWUP_UNSUPPORTED`.

This means the next implementation bead should transform the already-working pi follow-up branch into a pluggable design:

```txt
pi runtime:
  nativeFollowUp = true
  aiSdkOwnsHistory = false
  current waiting bubble + /followup + pi reducer remains active

DeepAgent / AI SDK Agent runtime:
  nativeFollowUp = false
  aiSdkOwnsHistory = true
  send blocked while busy
  normal useChat messages/persistence
  no data-pi reducer
  no /followup
```

### 1. Define shared capability types

Add a shared type near existing shared contracts, e.g. `packages/agent/src/shared/capabilities.ts`:

```ts
export interface AgentRuntimeCapabilities {
  nativeFollowUp: boolean
  aiSdkOwnsHistory: boolean
}

export const DEFAULT_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  nativeFollowUp: false,
  aiSdkOwnsHistory: true,
}
```

Do not make this a required `AgentHarness` field in the first pass. Resolve capabilities from the runtime binding/app configuration.

### 2. Expose capabilities to the frontend

Add a small route, locked first-pass shape:

```txt
GET /api/v1/agent/capabilities
```

Response:

```json
{
  "nativeFollowUp": true,
  "aiSdkOwnsHistory": false
}
```

For current pi-only `registerAgentRoutes()` runtime binding, return pi capabilities:

```ts
{
  nativeFollowUp: true,
  aiSdkOwnsHistory: false,
}
```

For future DeepAgent / AI SDK Agent route registration, return defaults:

```ts
{
  nativeFollowUp: false,
  aiSdkOwnsHistory: true,
}
```

Capability scope invariant: the capabilities consumed by `ChatPanel`, `/followup`, and `/messages` projection must be derived from the **same runtime/session binding** as chat and catalog routes. Do not use an unrelated app-global constant if workspaces/sessions can resolve to different harnesses. For request-scoped workspaces, this route must call the same workspace/runtime resolution path as chat/catalog.

### 3. Consume capabilities in `ChatPanel`

Add capability loading to the frontend hook/panel layer. Initial default before fetch should be safe:

```ts
nativeFollowUp = false
aiSdkOwnsHistory = true
```

Interaction while capabilities load:

- Existing history may render using the safe AI SDK path until capabilities arrive.
- Sending while busy remains blocked because the default is `nativeFollowUp: false`.
- First non-busy submit may proceed with defaults if capability fetch is still pending; this is acceptable because the normal AI SDK path is the safe baseline.
- Once capabilities load for a pi runtime, subsequent busy sends can use native follow-up and pi projection activates.
- Optional polish: disable only the send button until capabilities load if the implementation wants to avoid this temporary downgrade, but this is not required for correctness.

Then compute busy-send policy:

```ts
const isBusy = status === 'submitted' || status === 'streaming'
const sendDisabled = !hasMessage || (isBusy && !capabilities.nativeFollowUp)
```

Behavior:

- `nativeFollowUp === false`:
  - composer remains editable;
  - send button disabled while busy;
  - Enter submit is a no-op while busy;
  - no queued bubble;
  - no `/followup` request;
  - optional helper copy: `Wait for the current response to finish.`
- `nativeFollowUp === true`:
  - current pi waiting-bubble behavior is enabled;
  - busy send creates optimistic queued bubble;
  - POST `/api/v1/agent/chat/:sessionId/followup`;
  - pi harness owns actual queueing/ordering.
- frontend queue/drain:
  - deferred future extension only;
  - do not expose an active queue/drain mode in the first pass;
  - do not implement local drain queue in this branch.

### 4. Gate pi projection in `ChatPanel`

All of the following must run only when:

```ts
aiSdkOwnsHistory === false
```

- `data-pi-*` reducer into `piMessages`;
- `data-followup-consumed` handling;
- projected follow-up assistant tail logic;
- `rebuildPiMessagesFromDataParts()` effects;
- pi-specific persistence that strips/projects `data-pi-*`;
- `persistMessages: false` for `useAgentChat`.

When `aiSdkOwnsHistory === true`:

- pass `persistMessages: true` / omit `persistMessages: false`;
- render `messages` from `useChat` directly;
- do not inspect `data-pi-*`;
- do not use pi canonical projection helpers.

### 5. Gate server `/followup`

`POST /api/v1/agent/chat/:sessionId/followup` must check runtime capabilities before accepting.

If unsupported:

```http
409 Conflict
{
  "error": {
    "code": "FOLLOWUP_UNSUPPORTED",
    "message": "follow-up is not supported by this runtime"
  }
}
```

Add `FOLLOWUP_UNSUPPORTED` to the canonical error code enum/source (`packages/agent/src/shared/error-codes.ts` and any published error-code docs/tests). Do not return raw ad hoc strings outside that path.

If supported, keep existing `clientSeq`/`clientNonce` idempotency and pi `harness.followUp(...)` path.

### 6. Gate server history projection

`projectPiDataMessages()` should only run for sessions/runtimes where `aiSdkOwnsHistory === false` and the active adapter is the current pi projection path.

For `aiSdkOwnsHistory === true`, `/messages` should save the incoming `UIMessage[]` normally, only applying generic safe stripping such as removing large `data:` file URLs.

### 7. Tests

Required tests for the first pass:

- Capabilities route:
  - pi runtime returns `nativeFollowUp: true` + `aiSdkOwnsHistory: false`;
  - default/non-pi test fixture returns `nativeFollowUp: false` + `aiSdkOwnsHistory: true`.
- Composer behavior:
  - `nativeFollowUp: false` disables send while busy;
  - Enter while busy does not submit;
  - no waiting bubble is created;
  - no `/followup` request is made.
- Pi native behavior:
  - `nativeFollowUp: true` preserves current busy-send waiting bubble;
  - POST `/followup` still includes `clientSeq` + `clientNonce`;
  - consumed marker clears waiting state.
- History ownership:
  - `aiSdkOwnsHistory: true` uses normal `useChat().messages` and normal persistence;
  - `aiSdkOwnsHistory: false` keeps existing pi follow-up ordering and canonical persistence tests green for the current pi adapter.
- Server route:
  - unsupported `/followup` returns stable `FOLLOWUP_UNSUPPORTED`;
  - supported duplicate `{ clientSeq, clientNonce }` remains idempotent;
  - stale different nonce remains rejected.

### 8. Refactor target for the current branch

The existing branch already contains working pieces:

- `ChatPanel` pending follow-up queue/waiting bubble UI;
- serialized `/followup` posting with `clientSeq`/`clientNonce`;
- pi `data-pi-*` reducer and canonical persistence;
- server-side pi DTO projection and follow-up idempotency;
- real browser smoke coverage for pi native follow-up.

Do not throw this away. Refactor it as follows:

```ts
const adapterOwnsHistory = !capabilities.aiSdkOwnsHistory
```

Then gate current behavior:

- if `adapterOwnsHistory` for the current pi adapter, enable current `data-pi-*` reducer/persistence;
- if not `adapterOwnsHistory`, leave `useChat().messages` canonical and keep normal AI SDK persistence;
- if `canNativeFollowUp && isBusy`, use current queued bubble + `/followup` posting path;
- if `!canNativeFollowUp && isBusy`, block send and keep composer text/files intact;
- keep pi browser smoke tests as regression coverage;
- add non-pi capability tests to prove no pi-specific code path activates.

This achieves both goals in one implementation pass: preserve pi message queue correctness and restore a cleaner adapter boundary for future DeepAgent/AI SDK Agent harnesses.

### 9. Docs

Document follow-up modes in `packages/agent/docs/plans/agent-package-spec.md` or a follow-up interface doc.

State explicitly:

- DeepAgent / AI SDK Agent uses `nativeFollowUp: false` initially.
- DeepAgent / AI SDK Agent uses `aiSdkOwnsHistory: true` and the normal AI SDK UI Message Stream Protocol.
- Pi native follow-up is an optimization/adapter behavior, not a shared chat protocol.

## Related tool UI plan

Harness/plugin-specific tool activation and plugin-owned tool UI are adjacent but independently shippable. See [`harness-tool-ui-capabilities.md`](./harness-tool-ui-capabilities.md).

## Open questions

1. Where should capabilities be resolved for frontend: session metadata, `/models`, `/capabilities`, or `createAgentApp` injected config? Current recommendation: session/runtime metadata or `/capabilities`, not a required `AgentHarness` field.
2. Should a future release add frontend-owned queue/drain for non-native runtimes, or should unsupported runtimes always block send while busy?
3. Can pi adapter emit fully transparent AI SDK multi-message streams without custom `data-pi-*` history projection?

## Recommendation

Do not merge current `data-pi-*` behavior as unconditional ChatPanel logic. First isolate it behind `aiSdkOwnsHistory === false` and gate busy-send follow-up behind `nativeFollowUp === true`. Treat adapter-owned projection as temporary pi-only compatibility for the current implementation, not a shared frontend protocol.

This gives us:

- Pi: native follow-up works.
- DeepAgent / Agent SDK: normal AI SDK protocol remains clean.
- Other harnesses: composer safely blocks send while busy.
- Future: optional frontend-owned queue/drain can be added without touching harnesses.

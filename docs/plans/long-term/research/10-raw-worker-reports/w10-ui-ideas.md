## 1. Named, durable, in-place data parts

**Recommendation:** take this, but type it end to end and plug it into our renderer registry. **Source:** Flue `useDataWriter`; Eve has no direct equivalent. **Kind:** protocol change plus a renderer convention; not a standalone component.

### Mechanism

An agent declares a named client-facing channel during render and writes JSON values to it:

```ts
const writeOrder = useDataWriter("orderCard", {
  schema: v.object({
    orderId: v.string(),
    status: v.picklist(["queued", "paid", "shipped"]),
  }),
});
writeOrder({ orderId: "ord_123", status: "queued" });
writeOrder({ orderId: "ord_123", status: "paid" });
```

The exact Flue overloads are:

```ts
function useDataWriter<TSchema extends v.GenericSchema>(
  name: string,
  options: { schema: TSchema },
): (data: v.InferOutput<TSchema>) => void;
function useDataWriter(name: string): (data: unknown) => void;
```

The hook is deliberately write-only and non-reactive:

- The model does not see the value.
- A write does not cause the agent to re-render.
- The agent cannot read the current value back through the hook.
- Mounting the writer emits nothing.
- Values are normalized as JSON; `undefined` and non-serializable values fail.
- With a Valibot schema, every write is validated before append.

Writer names are structural runtime identity, not incidental labels:

- Names must be unique within one render.
- The exact set of names must remain stable on every re-render.
- Adding or removing a writer on a later render is an error.
- Writers therefore have to be declared unconditionally.
- They are forbidden in subagent renders.

That rule gives the runtime a stable slot table for a message.

### Wire and replay model

One write appends a durable log record resembling:

```ts
type DataPartUpdate = { type: 'data-part' conversationId: string messageId: string name: 'orderCard' data: { orderId: string; status: string } position: number }
```

The client materializes that into a message part:

```ts
type OrderCardPart = { type: 'data-orderCard' data: { orderId: string; status: 'queued' | 'paid' | 'shipped' } }
```

The apparent “append versus update” ambiguity resolves cleanly:

- Each writer call is an append to the durable update log.
- The materialized message has one stable slot per writer name.
- Later writes replace that slot's `data` in place.
- Its relative position among text, files, and other data slots remains stable.
- A replay of history therefore reconstructs the latest value without card duplication.

Flue's reply-extraction API separately exposes:

```ts
type AgentReply = { // ... data: Record<string, unknown[]> }
```

The array retains writes for a name in emission order, while the chat projection presents the latest value. That distinction is useful: audit consumers can inspect transitions without forcing the UI to render them all. On a fresh load, `history()` returns the already-materialized message with the latest `data-<name>` part. While live, `observe()` applies subsequent durable writes to the same part. After reconnect, its rehydration path recomputes from canonical state, so an update missed by the browser is not lost.

### Client rendering contract

Flue's documented rendering pattern is only a type branch:

```tsx
if (part.type === "data-orderCard") {
  return <OrderCard data={part.data as OrderCard} />;
}
```

The schema does not flow into the public client union: tagged SDK source exposes data parts as `{ type: \`data-${string}\`; data: unknown }`. That is the main weakness to fix rather than copy. For us, use the existing renderer-resolution idea from `toolRenderers.tsx`and`shared/tool-ui.ts`:

```ts
interface DataPartMap {
  "order.card": { orderId: string; status: OrderStatus };
  "plan.progress": { completed: number; total: number; label?: string };
}
type DataPart<K extends keyof DataPartMap = keyof DataPartMap> = {
  type: "data";
  id: string;
  name: K;
  revision: number;
  data: DataPartMap[K];
  ui?: ToolUiMetadata;
};
type DataPartRenderer<K extends keyof DataPartMap> = React.ComponentType<{
  part: DataPart<K>;
  isStreaming: boolean;
}>;
```

Suggested wire event:

```json
{
  "type": "data-part-upsert",
  "seq": 81,
  "messageId": "msg_42",
  "partId": "data:order.card",
  "name": "order.card",
  "revision": 3,
  "data": { "orderId": "ord_123", "status": "paid" },
  "ui": { "rendererId": "commerce.order-card" }
}
```

Use `(messageId, partId)` as identity and reject a non-increasing `revision`. Do not use array position as the only identity; our reducer already has to merge and re-key optimistic material.

### What this adds to ours

Our current `BoringChatPart` union has text, reasoning, tool-call, file, and notice parts. Rich non-tool state has to masquerade as tool output, live in message text, or escape to page-specific state. Named data parts add a first-class lane for:

- Plans and checklists that evolve while prose continues.
- Generated records, order state, charts, citations, and previews.
- Stable “working result” cards that do not become a stack of stale tool calls.
- Server-authored UI state whose lifecycle is tied to transcript replay.

This complements our differentiator rather than replacing it. Tool renderers remain ideal for invocation lifecycle, approval, input, and output. Data renderers cover agent-authored view models that are not tool invocations.

### Cost and risks

**Cost: L.** It touches agent APIs, event schemas, snapshot persistence, replay reduction, part merging, renderer registration, unknown-part fallbacks, transcript export, and tests. The main product risks are schema evolution and untrusted payload size. Require a versioned name or schema version, cap serialized bytes per write, preserve unknown parts visibly, and never permit arbitrary component code to come from the wire.

## 2. Provisional tool results that replace in place

**Recommendation:** take this early; it has unusually high leverage with our current UI. **Source:** Eve `action.partial`. **Kind:** small protocol change plus reducer behavior; our components already provide the extension point.

### Mechanism

An Eve action implemented as an async generator can yield provisional outputs before its final result. The stream emits `action.partial` for the same action call, followed by `action.result`. The UI treats partial values as snapshots, not append-only chunks:

```ts
type ActionPartial = EveEvent<
  "action.partial",
  {
    actionCallId: string;
    name: string;
    output: unknown;
  }
>;
type ActionResult = EveEvent<
  "action.result",
  {
    actionCallId: string;
    name: string;
    output: unknown;
  }
>;
```

Adjacent partials may be coalesced. Consumers must therefore render the latest received snapshot and must not infer that every intermediate state arrives. The final result supersedes the partial state.

### Suggested wire/API

We already have `tool-call` and `tool-result` keyed by `toolCallId`. Add one event without changing the renderer lookup contract:

```ts
type PiChatToolProgressEvent = { type: 'tool-progress' seq: number messageId: string toolCallId: string revision: number output: unknown ui?: ToolUiMetadata }
```

Materialize it onto the existing part:

```ts
type ToolPart = { // existing fields state: 'input-available' | 'running' | 'output-available' | 'output-error' progress?: { revision: number output: unknown } }
```

A renderer receives the same logical card through its lifecycle:

```tsx
function TerminalRenderer({ part }: ToolRendererProps) { const output = part.output ?? part.progress?.output return <TerminalFrame output={output} provisional={!part.output} /> }
```

### What this adds to ours

Our reducer already merges UI metadata from the starting call and final result, and our resolution order (`rendererId`, then tool name, then fallback) is stronger than Eve's default UI story. What is missing is a protocol-supported middle state with meaningful payload. This would make existing renderers materially better for:

- Live command output without creating transcript fragments.
- Search result batches that refine in one card.
- Sandbox and deployment progress.
- Long-running subagent status.
- Preview generation and data import summaries.

It replaces ad hoc progress encoded in text deltas or external component state.

### Cost and risks

**Cost: M.** The server adapter must expose progress, the event schema and reducer need revision handling, and renderers need a compatibility fallback. Cap update frequency and payload size. Persist only the latest materialized partial in snapshots while retaining enough event metadata for diagnostics. Never promise delivery of every progress tick.

## 3. Structured human-input requests independent of tool names

**Recommendation:** take the protocol concept; render it through our existing inline renderer system. **Source:** Eve `input.requested` and `respond()`. **Kind:** protocol change and control API, with reusable components on top.

### Mechanism

Eve emits structured requests when execution needs user input. The React hook projects pending requests into message/tool state and exposes a separate response command:

```ts
respond<TOutput>( inputResponses: Array<{ requestId: string optionId?: string value?: unknown }>, options?: RespondOptions<TOutput>, ): Promise<void>
```

The request has durable identity, prompt metadata, choices or a schema, and a lifecycle distinct from chat prose. The client emits a local `client.input.responded` projection immediately, while the authoritative server event eventually confirms the continuation. Conceptual wire shape:

```json
{
  "type": "input.requested",
  "data": {
    "turnId": "turn_7",
    "requests": [
      {
        "requestId": "req_region",
        "title": "Deployment region",
        "description": "Choose where to deploy",
        "kind": "select",
        "options": [
          { "id": "iad1", "label": "Washington, D.C." },
          { "id": "fra1", "label": "Frankfurt" }
        ]
      }
    ]
  },
  "meta": { "id": "evt_...", "at": "..." }
}
```

### What this adds to ours

We have several useful pieces already:

- An `ask_user` tool can be rendered inline.
- Bare tool primitives understand `approval-requested` and `approval-responded` states.
- `rendererId` metadata lets the runtime select a rich host renderer.

But the durable chat protocol still models the interaction as a particular tool call. That couples a universal execution pause to tool naming and tool-output conventions. Add a generic control part:

```ts
type InputRequestPart = {
  type: "input-request";
  id: string;
  requestId: string;
  turnId: string;
  state: "pending" | "submitting" | "answered" | "expired";
  input: InputDescriptor;
  response?: JsonValue;
  ui?: ToolUiMetadata;
};
```

And a command:

```ts
chat.respond({ turnId, requestId, response, clientNonce });
```

Our renderer registry can still resolve `ui.rendererId` and present the request inline. The protocol, not the component, then guarantees idempotency, replay, disabled-after-answer state, and continuation of the correct paused turn.

### Cost and risks

**Cost: L.** This needs runtime parking, durable request state, response idempotency, snapshot representation, authorization, optimistic reconciliation, accessibility, and expiration semantics. Start with select, confirm, and short text. Do not initially accept arbitrary JSON Schema forms; the security and validation surface grows quickly.

## 4. First-class authorization prompts instead of error-shaped OAuth

**Recommendation:** take this as a dedicated part and lifecycle. **Source:** Eve authorization events and message parts; Flue has no equivalent client abstraction. **Kind:** protocol change plus an authorization-card component.

### Mechanism

Eve treats authorization as a recoverable execution state, not a terminal error. Its projected message part carries:

```ts
type AuthorizationPart = {
  type: "authorization";
  state: "pending" | "completed";
  displayName: string;
  description?: string;
  authorization: {
    url?: string;
    userCode?: string;
    expiresAt?: string;
    instructions?: string;
  };
  outcome?: "authorized" | "declined" | "failed" | "timed-out";
};
```

The running turn can park at `authorization.required` and resume after the callback produces `authorization.completed`. The durable session cursor remains the same source of truth, so refresh does not erase the prompt.

### What this adds to ours

Our error model can attach codes, details, retryability, and host-rendered actions. That is adequate for “connect account” as a notice, but it does not encode the state machine. A dedicated part provides:

- Safe link presentation and device-code copy UI.
- Expiration countdown and refresh behavior.
- One place to distinguish decline, timeout, and provider failure.
- Replay-safe completion that disables stale buttons.
- A parked-turn indicator rather than a misleading failed message.

Suggested event family:

```ts
type AuthorizationRequiredEvent = {
  type: "authorization-required";
  seq: number;
  turnId: string;
  authorizationId: string;
  provider: string;
  url: string;
  userCode?: string;
  expiresAt?: string;
};
type AuthorizationCompletedEvent = {
  type: "authorization-completed";
  seq: number;
  turnId: string;
  authorizationId: string;
  outcome: "authorized" | "declined" | "failed" | "timed-out";
  error?: ChatFailure;
};
```

The UI should open only validated `https:` URLs and should never receive provider tokens.

### Cost and risks

**Cost: L.** The UI card is small; callback correlation, secret handling, durable parking, expiration, and multi-tab behavior are the real work. This should share the response/idempotency substrate proposed for structured input, but remain a separate part. Authorization has different security, expiry, and external-navigation semantics.

## 5. A durable submission handle with process-independent `wait()`

**Recommendation:** take this for background turns, refresh recovery, and non-UI callers. **Source:** Flue `send()`, `wait()`, and `read()`; Eve only approximates it through session attach and stream scanning. **Kind:** protocol and SDK capability; no component required.

### Exact Flue behavior

`send()` returns an admission object containing a durable submission identity and the stream checkpoint. Admission means the server accepted the submission; it does not mean execution succeeded.

```ts
const admission = await client.send({
  agent: "SupportAgent",
  conversationId,
  message: { role: "user", body: "Investigate the charge" },
});
await client.wait(admission, { signal, onEvent: audit });
const reply = await client.read(admission);
```

`wait()` observes durable updates starting from the admission checkpoint:

- It resolves when the specific submission settles successfully.
- It rejects with `FlueExecutionError` for `failed`, `aborted`, or `terminal_event_missing`.
- It can be called again after browser or worker process loss using the persisted admission.
- It is an observer, not the execution driver; losing the waiting process does not stop the agent.
- If settlement already exists, it can complete immediately.
- Its event callback sees conversation traffic and can receive duplicates, so it is not the UI reducer.
- The callback is awaited serially.

`read()` can accept an admission object or a bare submission id, making reattachment practical across processes.

### Eve equivalent and gap

Eve can persist `{ sessionId, streamIndex }`, attach to the exact session, resume its durable event stream, and call `MessageResponse.result()` until the next waiting/completed/failed boundary. That is a session-cursor primitive, not a submission-addressed wait primitive. A new process must know which event boundary belongs to its turn and scan accordingly. There is no equally direct `wait(submissionId)` contract.

### What this adds to ours

We already have `turnId`, durable session snapshots, sequence replay, and active-turn state. The UI survives reconnect, but there is no obvious portable promise token that a job, notification worker, route handler, or newly loaded client can await without adopting the whole chat reducer. Suggested API:

```ts
type TurnAdmission = {
  sessionId: string;
  turnId: string;
  submissionId: string;
  admittedAtSeq: number;
};
interface AgentClient {
  submit(input: SubmitInput): Promise<TurnAdmission>;
  wait(
    handle: TurnAdmission | string,
    options?: WaitOptions,
  ): Promise<TurnSettlement>;
  readReply(handle: TurnAdmission | string): Promise<StructuredReply>;
}
```

The settlement must be stored independently of live socket ownership. Persist the admission in the URL, job payload, or IndexedDB when the caller needs recovery.

### Cost and risks

**Cost: M–L.** Existing turn identities reduce the work, but durable settlement indexing, retention, authorization, idempotent submission, and cross-process tests are substantial. Define retention explicitly. A submission id must not become an unscoped capability that bypasses session/workspace authorization.

## 6. One UI-facing failure disposition across transport, execution, and action-needed states

**Recommendation:** take the classification layer, borrowing boundaries rather than either framework's exact types. **Source:** Flue has the stronger transport/execution split; Eve has stronger first-class user-action states. **Kind:** client convention with a small protocol extension.

### What Flue exposes

Synchronous request rejection uses:

```ts
class FlueApiError extends Error { status: number body: unknown ref?: string }
```

The server error envelope supports machine and diagnostic context:

```json
{
  "error": {
    "type": "invalid_input",
    "message": "...",
    "ref": "err_...",
    "dev": "local-only detail",
    "meta": {}
  }
}
```

An admitted execution that later fails becomes:

```ts
class FlueExecutionError extends Error { failure: 'failed' | 'aborted' | 'terminal_event_missing' submissionId: string error: unknown }
```

Caller cancellation remains distinguishable as `AbortError` rather than being folded into execution failure. Stream-layer classes separately represent fetch, closed stream, durable-stream, and backoff-abort failures. `observe()` does not throw through React:

- Initial 404 becomes `phase: 'absent'`.
- 400, 401, and 403 become fatal `phase: 'error'` until manual refresh.
- Network failures, 429, 503, and server failures retain old state in `connecting` and retry.
- A closed observer becomes `phase: 'closed'`.

This is good operational separation, but it still lacks a single UI action contract.

### What Eve exposes

Eve `ClientError` carries status, raw body, and normalized response headers. Execution failure is normally an event/result status rather than a thrown transport exception. Its larger contribution is conceptual: input and authorization are not labeled “retryable errors.” They are durable, renderable states with domain-specific actions.

### Suggested normalized shape

Our `ChatError` already has `code`, `message`, `retryable`, and `details`. Add a UI disposition at the boundary rather than proliferating component-specific tests:

```ts
type ChatFailure = {
  code: string;
  message: string;
  scope: "request" | "connection" | "turn" | "tool" | "session";
  disposition:
    "retry-automatic" | "retry-manual" | "action-required" | "terminal";
  action?:
    | { kind: "reauthenticate"; authorizationId: string }
    | { kind: "respond"; requestId: string }
    | { kind: "retry-turn"; turnId: string }
    | { kind: "contact-support"; ref: string };
  status?: number;
  ref?: string;
  retryAfterMs?: number;
  safeDetails?: JsonValue;
};
```

Then render based on `disposition` and `action.kind`, not HTTP status or message matching. Keep developer diagnostics out of production payloads.

### What this adds to ours

It unifies existing retry notices, host actions, gateway failures, protocol errors, and turn errors without discarding the richer per-domain parts proposed above. It answers three separate UI questions explicitly:

- Will the client recover by itself?
- Can the user do something now?
- Is the failed scope one request, one turn, or the whole session?

### Cost and risks

**Cost: M.** Most work is mapping all producers and testing presentation, not changing storage. Do not reduce authorization and structured input back into generic actions. The error action can point at their part; the durable part remains canonical.

## 7. Separate authoritative events from a pluggable UI projection

**Recommendation:** take a constrained version: keep our canonical reducer, add composable part projectors. **Source:** Eve `useEveAgent({ reducer })` and its local projection-event lane. **Kind:** client architecture convention.

### Eve mechanism

The hook can use the default message reducer or a caller-supplied projection:

```ts
type EveAgentReducer<TData> = {
  initial(): TData;
  reduce(data: TData, event: EveAgentProjectionEvent): TData;
};
function useEveAgent<TData>(options: {
  reducer: EveAgentReducer<TData>;
  initialEvents?: EveEvent[];
  initialSession?: { sessionId: string; streamIndex: number };
  optimistic?: boolean;
}): UseEveAgentHelpers<TData>;
```

`events` contains authoritative server events. Optimistic mutations are delivered to the reducer as separate local-only events such as:

```ts
type ClientProjectionEvent = | { type: 'client.message.submitted'; data: ... } | { type: 'client.message.failed'; data: ... } | { type: 'client.input.responded'; data: ... }
```

They do not pollute the authoritative event array. This makes audit/replay and optimistic UI distinct concepts.

### What this adds to ours

Our `piChatReducer` is sophisticated and should remain canonical. It already handles optimistic outbox anchoring, `clientNonce` reconciliation, stale snapshots, sequence gaps, rehydration, and tool-part merging. Replacing that with arbitrary application reducers would weaken invariants. The useful adaptation is a projector registry:

```ts
type PartProjector<E extends PiChatEvent = PiChatEvent> = {
  id: string;
  accepts(event: PiChatEvent): event is E;
  reduce(context: ProjectionContext, event: E): ProjectionPatch;
};
createPiChatClient({
  projectors: [dataPartProjector, authorizationProjector, inputProjector],
});
```

The core reducer owns ordering, message identity, and replay. Projectors may only upsert namespaced parts or side panels through validated patches. Keep raw authoritative events in an optional bounded diagnostics/audit buffer.

### Cost and risks

**Cost: M.** Refactoring seams and invariant tests are the bulk of it. Avoid exposing an unrestricted reducer over the entire chat state. One bad plugin could otherwise break ordering, optimistic reconciliation, or unknown-event forward compatibility.

## 8. An observation facade with explicit phases and canonical rehydration

**Recommendation:** take only as a library boundary; most underlying behavior already exists. **Source:** Flue `history()` and `observe()`; Eve's store also uses `useSyncExternalStore`. **Kind:** SDK/component-state convention, not a new protocol for us.

### Exact Flue contract

`history()` is a one-shot canonical read:

```ts
history(conversationId, options?): Promise<FlueConversationSnapshot>
```

It returns one point-in-time snapshot and resolves URLs for durable file parts. A missing conversation rejects as a 404 API error. `observe()` creates a lazy external store:

```ts
type ObservationSnapshot = {
  conversation?: FlueConversationState;
  offset?: string;
  phase: "loading" | "connecting" | "live" | "absent" | "error" | "closed";
  error?: Error;
};
interface AgentConversationObservation {
  getSnapshot(): ObservationSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  close(): void;
}
```

Important operational guarantees:

- Calling `observe()` itself performs no network I/O.
- The first subscriber triggers an atomic history hydration.
- Live updates start at that snapshot's exact checkpoint.
- `getSnapshot()` returns stable external-store snapshots and new object identity on change.
- A reconnect keeps the old conversation visible while phase becomes `connecting`.
- Recovery rehydrates a fresh canonical snapshot rather than trusting partial client state.
- Update positions at or below the last applied batch/index are ignored.
- A changed store `incarnation` detects reset even when numeric positions overlap.
- Initial 404 becomes `absent` and does not poll until `refresh()`.
- 400/401/403 become non-retrying `error`; transient failures back off from one to thirty seconds.
- Unsubscribing the last React listener does not close the transport; `close()` is explicit.

Flue's SDK docs name long-poll as the observer default, while its React guide describes SSE with long-poll fallback. Consumers should configure transport explicitly rather than depend on that documentation mismatch. The React hook adds optimistic echo behavior:

- It inserts the user message immediately.
- Admission resolves the send promise.
- Canonical replay re-keys the durable user message to the optimistic id to preserve React identity and position.
- Failed sends remain visible and are reported through `failedSends` for retry.
- `historyReady` becomes true after the atomic initial load and stays true during reconnects.

### What this adds to ours

Our implementation already does the difficult work:

- Snapshot hydration with a sequence checkpoint.
- Duplicate suppression and gap-triggered rehydration.
- Backoff and reconnect phases.
- Optimistic outbox matching by `clientNonce`.
- Anchored insertion and stable transcript placement.
- Preservation of newer local history when a snapshot is stale.

The gain is encapsulation:

```ts
const observation = piChatClient.observe(sessionId) const snapshot = useSyncExternalStore( observation.subscribe, observation.getSnapshot, observation.getServerSnapshot, )
```

That would let ChatPanel consume a small state machine rather than own transport lifecycle details, and would make SSR, multi-surface reuse, and isolated tests easier.

### Cost and risks

**Cost: M** as a refactor, **L** if attempted as a rewrite. Extract around the proven reducer and stream implementation. Do not replace the existing nonce reconciliation or gap recovery merely to imitate another API.

## 9. Conversation-owned immutable attachment references

**Recommendation:** take only the identity and authorization invariants; keep our broader upload UX. **Source:** Flue attachment store and `attachmentUrl()`; Eve uses inline/client-resolvable file data only. **Kind:** storage/protocol change with an attachment-rendering convention.

### Exact Flue contract

Flue send input accepts image attachments with base64 characters, not a data URL:

```ts
type DeliveredAttachment = { type: 'image' data: string mimeType: string filename?: string }
```

The documented maximum encoded payload is 14 MiB. The runtime persists immutable bytes under a stable attachment id owned by the conversation. The public durable message carries a file reference:

```ts
type FilePart = { type: 'file' mediaType: string id?: string size?: number url?: string filename?: string }
```

The store lookup is scoped by both conversation id and attachment id, and integrity is digest-checked. A mismatched conversation lookup returns no object rather than exposing bytes. The client helper is a URL constructor:

```ts
attachmentUrl(conversationId: string, attachmentId: string): string
```

During `history()` and live message materialization, the SDK fills a missing file URL with the mounted agent's conversation attachment route. The optimistic image may initially use a local data URL and have no durable id; canonical replay replaces it with the durable reference.

### Authorization boundary

`attachmentUrl()` does not fetch and does not attach bearer headers. An `<img src>` works only when normal browser credentials, same-origin cookies, a public URL, or a signed URL suffice. In Flue 2.0.3, the download route is part of each mounted agent surface. Ordinary application middleware placed before the mount must authenticate and authorize it. Conversation scoping in storage prevents accidental cross-conversation id use, but it does not decide whether the requesting principal is allowed to read that conversation. For bearer-only clients, the UI needs an authenticated fetch to a Blob URL, a same-origin proxy, or a short-lived signed URL.

### Eve equivalent

Eve accepts AI SDK file content, commonly with `data:` URL/base64 data, and emits safe file metadata in `message.received`. Raw sandbox paths and bytes are not streamed. Its default reducer preserves a file URL only when the original is already client-resolvable (`http(s)` or data URL). There is no comparable Eve attachment upload/readback service or `attachmentUrl()` abstraction in the inspected client documentation and source.

### What this adds to ours

Our uploader is already broader: it accepts arbitrary files, sends credentials and workspace identity, and returns raw/Markdown paths; chat history also has attachment routes. The worthwhile invariants are:

- Every durable file part has an immutable opaque id.
- The id is scoped to session/conversation and tenant.
- The wire never leaks a filesystem path.
- History returns an address or fetch descriptor, not raw bytes.
- Optimistic local previews reconcile to canonical ids.
- Fetch authorization is explicit in the client contract.

Suggested fetch descriptor for bearer-capable apps:

```ts
type AttachmentRef = {
  id: string;
  filename?: string;
  mediaType: string;
  size?: number;
  digest?: string;
};
function attachmentRequest(ref: AttachmentRef): {
  url: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
};
```

### Cost and risks

**Cost: M** if storage is already conversation-scoped; **L** if paths are persisted as identity today. Avoid base64 in the main event stream for nontrivial files. Support Range requests and signed/download URLs for media.

## 10. Turn-guarded durable cancellation

**Recommendation:** take. **Source:** Eve. **Kind:** control protocol. **Cost:** S–M. **Mechanism/API:** Eve distinguishes local `stop()`, which only stops consumption, from `session.cancel({ turnId })`, which durably cancels server work. The turn guard makes a late click or stale tab harmless. Use `cancelTurn({ sessionId, turnId, clientNonce })` and keep streaming until a canonical cancelled/terminal event; never interpret a stale id as “cancel the current turn.” **Adds to ours:** an explicit user promise that Stop halts server work, plus multi-tab safety. Name local-only behavior `disconnect()` or `stopFollowing()`.

## 11. Semantic message routing

**Recommendation:** take after data/control parts. **Source:** Flue. **Kind:** protocol convention. **Cost:** M. **Mechanism/wire:** keep authorship separate from presentation: `{ role, purpose: 'conversation'|'orchestration'|'advisory'|'diagnostic', visibility: 'transcript'|'activity'|'developer-only'|'hidden', signal?: { name, attributes } }`. A policy, not the wire, selects components. **Adds to ours:** subagent dispatch, advisories, and diagnostics can be replayed but routed outside the prose transcript. Unknown values need a visible safe fallback; producers must not be able to hide failures accidentally.

## 12. Addressable child-session timelines

**Recommendation:** take when multi-agent activity is a primary surface. **Source:** Eve. **Kind:** protocol plus nested timeline component. **Cost:** L. **Mechanism/wire:** Eve's parent emits `subagent.called/completed` with a `childSessionId`. Add `child: { sessionId, relationshipId, agentLabel?, access: 'inherit'|'explicit' }` to our `pi-subagent` tool part; subscribe lazily when expanded. **Adds to ours:** our renderer metadata already gives a good summary card; the child reference adds a live, durable drill-down without flattening all child events into the parent. Authorization, recursion depth, retention, and parent/child cancellation are the cost drivers.

## 13. Ephemeral structured client context

**Recommendation:** take narrowly. **Source:** Eve `clientContext`/`prepareSend`. **Kind:** request convention. **Cost:** S–M. **Mechanism/API:** `send(message, { clientContext: { schema: 'boring.client-context/v1', route, selection, capabilities, locale, timezone } })`. It influences one turn but is neither a transcript message nor durable conversation state. **Adds to ours:** selected records, current route, locale, and UI capabilities can reach the agent without fake hidden prose. Treat it as an untrusted hint, forbid secrets, define logging, and expose it in developer diagnostics.

## 14. Atomic raw-event snapshot plus cursor

**Recommendation:** diagnostics only. **Source:** Eve `snapshot()`. **Kind:** SDK/protocol. **Cost:** M–L. **Mechanism/API:** Eve atomically returns the durable event prefix and the exact `{ sessionId, streamIndex }` after it; event ids dedupe overlap, while stream index defines order. An interrupted step may re-emit equivalent content under new ids. Our opt-in shape could be `{ sessionId, throughSeq, events, truncatedBeforeSeq? }`. **Adds to ours:** deterministic bug exports, alternate projections, and time travel. Keep our materialized state snapshot as the normal startup path; raw logs need retention bounds, redaction, and privileged access.

## 15. Per-turn validated structured result

**Recommendation:** take for task-oriented agents. **Source:** Eve `outputSchema`/`result.completed`. **Kind:** protocol/SDK convention. **Cost:** M. **Mechanism/API:** `submit({ message, resultSchema })` returns an admission; `wait(admission)` reaches settlement; `readResult(admission, schema)` returns the validated terminal payload. Eve's `MessageResponse.result()` similarly returns message, events, status, session id, and typed data at a session boundary. **Adds to ours:** page transitions, created-record navigation, comparison tables, and workflow handoff no longer parse assistant prose. Keep this distinct from live data parts: one is a terminal programmatic answer, the other a replayable evolving view model. Schema failure must be a typed terminal settlement.

## Cross-framework equivalence map

| Need | Flue 2.0.3 | Eve | Ours on `origin/main` | Takeaway |
| --- | --- | --- | --- | --- |
| Live non-text UI state | Named `data-<name>` slots via `useDataWriter` | No direct equivalent; custom reducer can project arbitrary events | No generic data part; rich tool parts and notices | Add typed data slots and reuse renderer resolution |
| Live tool progress | No distinct public primitive found beyond updates/data | `action.partial`, last snapshot wins before result | Start/final tool lifecycle with metadata merging | Add one provisional result event |
| One-shot canonical read | `history()` | `snapshot()` returns event prefix + cursor | Materialized state snapshot + `seq` | Keep our state snapshot; raw prefix only for diagnostics |
| Live materialized subscription | `observe()` external store with phases and rehydrate | `useEveAgent` store/reducer | Mature reducer/stream embedded in front layer | Extract an observation facade, do not rewrite semantics |
| Optimistic echo | Local insert, canonical re-key, retained failed sends | Local projection events excluded from authoritative log | Nonce-based outbox and anchored canonical merge | Ours is already strong |
| Process-independent completion | `wait(admission)` and `read(submissionId)` | Attach session/cursor and scan to boundary | Turn/session state, no clear portable await handle | Add a durable admission token |
| Human input | No comparable generic primitive found | `input.requested` + `respond()` | `ask_user` renderer/tool conventions | Promote to durable generic control part |
| Authorization | No first-class UI state found | Required/completed events and authorization part | Error/notice host actions | Make authorization its own lifecycle |
| Cancellation | Abort submission/client observation | Local `stop()` versus durable turn-id cancel | Active turn and abort flow | Make local detach vs server cancel explicit |
| Attachments | Base64 image upload; conversation-owned ids and generated URL | Inline/client-resolvable file input; no readback service found | Broader upload plus history routes | Keep ours; tighten opaque identity/auth contract |
| Failure taxonomy | API vs execution vs stream classes; observer retry phases | Thin `ClientError`; failure events; action-needed states | `ChatError.retryable`, gateway error, notices/actions | Normalize disposition/scope/action |
| Alternate projections | Fixed SDK materialization | Generic reducer plus authoritative raw event array | Fixed sophisticated reducer plus renderer registry | Add constrained part projectors |
| Subagent UI | No comparable child timeline contract found | Parent events reference child session | `pi-subagent` renderer metadata | Add child stream refs only when needed |
| Structured terminal output | Reply extraction and named data history | Per-turn schema and `result.completed` | No obvious public typed turn result | Pair typed result with durable settlement |

## Implementation sequence

The ranking is product value, not dependency order. A low-risk implementation sequence is:

1. Add provisional tool progress, because it exploits our renderer infrastructure with limited surface area.
2. Normalize failure disposition so new control states have consistent fallback behavior.
3. Introduce the durable submission/settlement handle and reuse it for structured terminal results.
4. Add named data-part persistence and a typed renderer registry.
5. Build generic input requests, then authorization on the same idempotent continuation substrate.
6. Extract the observation facade after the new event families settle, preserving the current reducer.
7. Add child-session timelines only when there is a real multi-agent navigation requirement.

## Source notes

- Flue behavior was checked against the requested offline 2.0.3 docs and the tagged SDK source, especially [`client.ts`](https://github.com/withastro/flue/blob/v2.0.3/packages/sdk/src/client.ts) and [`public/conversation.ts`](https://github.com/withastro/flue/blob/v2.0.3/packages/sdk/src/public/conversation.ts).
- The pinned offline docs were the authority for `useDataWriter`, `history`, `observe`, `wait`, errors, attachments, and React behavior where the published package declarations were not retrievable from the shell registry.
- Eve client behavior was checked against its primary docs for [frontend integration](https://github.com/vercel/eve/blob/main/docs/guides/frontend/overview.mdx), [sessions, runs, and streaming](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md), [client streaming](https://github.com/vercel/eve/blob/main/docs/guides/client/streaming.mdx), [messages](https://github.com/vercel/eve/blob/main/docs/guides/client/messages.mdx), [continuations](https://github.com/vercel/eve/blob/main/docs/guides/client/continuations.mdx), and [structured output](https://github.com/vercel/eve/blob/main/docs/guides/client/output-schema.mdx).
- Eve implementation details were cross-checked in [`use-eve-agent.ts`](https://github.com/vercel/eve/blob/main/packages/eve/src/react/use-eve-agent.ts), [`client-error.ts`](https://github.com/vercel/eve/blob/main/packages/eve/src/client/client-error.ts), and [`file-parts.ts`](https://github.com/vercel/eve/blob/main/packages/eve/src/client/file-parts.ts).
- Eve route authorization behavior was checked against [auth and route protection](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md): route authentication does not by itself enforce tenant ownership of a known session id.
- Our comparison used `origin/main` versions of the shared chat schemas, `piChatReducer`, `piChatStream`, `toolRenderers.tsx`, `bareToolRenderers/renderers.tsx`, `shared/tool-ui.ts`, upload helpers, and attachment routes.

## not worth taking

### Flue's untyped client-side data-part union

Do not copy `{ type: \`data-${string}\`; data: unknown }`as the final application API. It makes every renderer cast data despite an agent-side schema already existing. Take named in-place identity, but generate or register a shared`DataPartMap` so server validation and client typing refer to the same versioned contract.

### Structural hook-name invariance as the public authoring model

Flue's requirement that the exact `useDataWriter` name set never change across renders makes durable slots tractable, but it imports React-hook-like structural constraints into agent business logic. Our API should make stable slot identity explicit:

```ts
ctx.data.upsert({ id: "plan", name: "plan.progress", data });
```

Validate duplicate ids and type names without requiring every potential channel to be mounted unconditionally.

### A fully user-supplied chat reducer

Eve's reducer is elegant for a small headless client, but our reducer contains hard-won correctness around optimistic anchors, stale snapshots, gaps, tool merging, and message identity. Allow validated namespaced projectors, not replacement of the canonical state machine.

### Replaying the full raw event log for ordinary UI startup

Eve's atomic event snapshot is valuable for custom reductions and audits. It is inferior to our materialized snapshot for a mature, long-running chat's normal load path. Keep raw-event export opt-in, bounded, redacted, and privileged.

### Base64 attachment bodies in chat requests as the primary upload path

Both frameworks tolerate inline/base64 inputs, but this increases request memory, retry cost, and event risk. Our separate upload flow is a better foundation for arbitrary files. Take opaque conversation ownership and canonical references, not the transport choice.

### `attachmentUrl()` as sufficient authentication abstraction

A string builder cannot represent bearer headers, expiring signatures, or Blob-fetch requirements. Keep a convenience URL only for cookie/signed deployments; expose an authenticated request or resolver abstraction for the general case.

### Treating unsubscribe as a live connection lease

Flue deliberately keeps observation alive when the last listener unsubscribes until `close()`. That can preserve state across React churn, but copied blindly it leaks transports in navigation-heavy shells. Use an explicit owner scope or short grace-period reference counting around our observation facade.

### Eve's thin `ClientError` as the UI error model

Status, raw body, and headers are good debugging inputs but do not answer whether the client retries, the user must act, or the session is terminal. Normalize them into the proposed failure disposition before they reach components.

### Eve's local `stop()` naming without an explicit local/server distinction

“Stop” commonly implies server cancellation to users. Expose `disconnect()` or `stopFollowing()` for local consumption and `cancelTurn({ turnId })` for durable cancellation. The UI button labeled Stop should call the latter unless its copy explicitly says updates will merely be hidden.

### One generic card protocol for data, tools, input, authorization, and failures

All five can share renderer lookup and visual primitives, but their durable semantics differ:

- Data is a last-write-wins view model.
- A tool is an invocation lifecycle.
- Input is an idempotent continuation request.
- Authorization crosses an external security boundary and expires.
- A failure carries recovery disposition and scope.

Collapsing them into `{ type: 'card', payload: unknown }` would move protocol invariants into components and weaken replay correctness—the opposite of what is worth taking from these frameworks.

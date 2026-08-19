# Flue 2.0.3 technical analysis

Documentation source: the 2.0.3 pages bundled in `@flue/cli@2.0.3`; statements in quotation marks are verbatim excerpts.

## 1. Per-page findings

### `guide/building-agents`

- An agent is a synchronous JavaScript function whose return value is its system instructions; the runtime re-renders it before every model call and rebuilds those instructions from current hook/state values.

- A module is registered only when `'use agent'` is its first statement; every exported capitalized function becomes an agent, and the exported function name becomes durable identity unless pinned by `Fn.agentName = 'kebab-name'`.

- Every instance is addressed by an application-chosen `id`; first contact creates it, later sends to the same agent identity plus id continue it.

- Direct HTTP `POST /<mount>/:id` is admission-only (`202`); `GET` follows the conversation. `dispatch()` is likewise fire-and-forget and a registered dispatch-only agent needs no HTTP mount.

- Standalone Node code uses `start({ agents, db? })`, `init(agent,{id})`, `handle.dispatch(...)`, then `handle.read(receipt)`; `db` omission is in-memory.

### `guide/agent-hooks`

- Resource hooks (`useTool`, `useSkill`, `useSubagent`, `useSandbox`) may be conditional; Flue diffs each render and narrates capability changes to the model.

- `usePersistentState(name, initial)` is JSON-serializable, name-keyed, durable state; render values are snapshots, so derived writes should use functional updaters.

- Lifecycle order exposes `useResponseStart`, `useAgentStart`, `useAgentFinish`, `useResponseFinish`; callbacks are at-least-once, and response start/finish return values merge into response `metadata`.

- `initialData` is creation-only, optionally validated by an agent static schema, recorded once, and read with `useInitialData()`; later supplied values are ignored.

- `useDataWriter(name,{schema?})` durably appends one-way client parts (`data-<name>`); it does not re-render the agent and is invisible to the model.

### `guide/routing`

- `app.ts` is the single explicit HTTP route map; registration never auto-mounts an agent and file layout never implies routes.

- `createAgentRouter(agent)` mounts, relative to its chosen prefix: `POST /:id`, `GET|HEAD /:id`, `POST /:id/abort`, and `GET /:id/attachments/:attachmentId`.

- Admission returns `202` with `{ streamUrl, offset, submissionId, uid? }`; there is no synchronous wait mode on `POST`.

- The router supplies no auth and no production CORS. Middleware must precede the mount and cover `/<mount>/*`; authorization must validate the caller against the `:id`, not merely authenticate.

- A registered but unmounted agent remains callable through `dispatch()`; mounting the same agent twice exposes the same durable conversations because URL is not identity.

### `guide/channels`

- A channel is verified inbound HTTP only: package code verifies raw-body signatures/replay windows/handshakes, then application handlers route native provider payloads through `dispatch()`.

- Outbound is deliberately application-owned through the provider SDK; Flue has “no outbound messaging API, no reply routing, and no send-message abstraction over providers.”

- Channel handlers choose an instance, normally use `channel.instanceId(ref)`, pass trusted context through `initialData`/signal attributes, and should use provider event IDs for idempotent redelivery.

- `channel.route()` is a pure subrouter factory; hand-written channels use `createChannelRouter([{method,path,handler}])`, with non-empty `/`-prefixed suffixes and verification against unconsumed bytes.

- Packages are Fetch/Web-Crypto based and work on Node and Cloudflare. This page does not state that channel packages peer-depend on `@flue/runtime`.

### `guide/database`

- Node persistence is selected by source-root `db.ts`, whose default export is a `PersistenceAdapter`; Cloudflare rejects `db.ts` because every conversation uses Durable Object SQLite.

- Stored domains are canonical append-only conversation records, accepted submission/lease rows, persisted-state records, and immutable attachment bytes; sandbox files, credentials, external effects, and business data are outside the store.

- No `db.ts`: `vite dev` uses `node_modules/.cache/flue/dev.db` and cold-start resets it; `flue run` uses persistent `node_modules/.cache/flue/run.db`; built Node defaults to process-memory SQLite.

- `sqlite(path?)` uses Node's `node:sqlite`, creates parents, and uses WAL; omitted or `':memory:'` is memory-only.

- Adapters are bring-your-own-driver. `migrate()` is idempotent at boot, then `connect()`; a shared database supports replacement/recovery, not active-active ownership of one conversation.

### `guide/react`

- `useFlueAgent({url|client})` materializes one conversation into React state; `sendMessage()` optimistically appends and resolves at admission, not completion.

- `historyReady` flips only after one coherent durable snapshot; later SSE/long-poll reconnects do not reset it. Default live mode is SSE with long-poll fallback.

- Message parts are Flue-owned `text`, `reasoning`, `dynamic-tool`, and `file` shapes, not AI SDK types; completed canonical assistant messages override best-effort partial text/reasoning.

- SSR returns empty idle state and opens no connection; omitted `url`/`client` leaves the hook dormant. A supplied client must be memoized and remains caller-owned.

### `guide/project-layout`

- Required `app.ts`; optional `db.ts`, `cloudflare.ts`, `flue.config.ts`, and `vite.config.ts`.

- Source-root precedence is `.flue/`, then `src/` (recommended), then project root; first match wins and layouts are never merged.

- All entry discovery and the `'use agent'` scan use that one source root unless explicit config paths override entries.

- Default Vite build output is `dist/`.

### `guide/deploy`

- `flue()` resolves entries/config, scans agents, and stamps durable identity into transformed agent functions; Vite owns dev and build.

- Target detection is Cloudflare when `@cloudflare/vite-plugin` is present, otherwise Node, unless explicit `target` overrides it.

- Node output is self-starting `dist/server.mjs` plus non-listening `dist/app.mjs`; port defaults to `3000`, deployed code does not load `.env`, and dependencies remain external.

- Cloudflare requires `flue()` before `cloudflare()`, generated `.flue-vite/` inputs, `nodejs_compat`, and one user-authored append-only Durable Object migration entry per agent class.

- An agent addition on Cloudflare is agent export + optional HTTP mount + `new_sqlite_classes`; renames/removals require `renamed_classes`/`deleted_classes`.

### `guide/models`

- Root renders must call `useModel('provider/model', options?)` exactly once; it returns nothing. Subagents receive model choice from their declaration and inherit the parent when omitted.

- `thinkingLevel` is `'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max'`, default `'medium'`; non-reasoning model metadata causes it to be silently dropped.

- Compaction defaults include `keepRecentTokens: 8000`; `reserveTokens` is model-aware and at most `20000`. `compaction:false` disables threshold compaction only, not overflow recovery or manual compaction.

- Model, thinking, and compaction declarations are submission-scoped: a change detected during a response latches for the next submission.

- Provider specifiers split at the first `/`; credentials come from environment. Cloudflare additionally registers `cloudflare/...` Workers AI when included, with AI Gateway on by default.

### `guide/node-target`

- Built server default port is `3000`; Vite dev default is `5173`; the Node build externalizes application dependencies.

- Node without `db.ts` is process-local memory. Durable storage recovers work after replacement, but every conversation still requires exactly one live owner and affinity routing.

- `local(options?)` is Node-only, defaults `cwd` to `process.cwd()`, invokes host shell/filesystem, and exposes only shell-essential environment variables unless explicitly added.

- `sqlite(path?)` returns a persistence adapter; omitted path means memory.

### `guide/cloudflare-target`

- Each exported agent becomes one generated Durable Object class and binding: `SupportChat` -> `FlueSupportChatAgent` and `FLUE_SUPPORT_CHAT_AGENT`; identity, not filename or mount, controls them.

- Canonical streams, attachments, and submissions live in per-instance DO SQLite; source-root `db.ts` is a build error.

- Admission schedules a zero-delay alarm; the alarm claims and awaits the full response. Mid-response scheduled callbacks wait for settlement, while incoming steering may still join at the next turn boundary.

- `extend({base?,wrap?})` customizes generated agent classes; code must not override Flue-owned `fetch`, `onRequest`, `onFiberRecovered`, or `alarm`.

- `cloudflare.ts` named exports become Worker exports; its default may supply non-HTTP handlers (`scheduled`, queues, email) but must not supply `fetch`.

### `guide/why-flue`

- The design is explicitly harness-first: each agent receives tools, skills, instructions, and an optional sandbox, based on Pi.

- Functions plus hooks make capability/state composition dynamic rather than configuration-object based.

- Durability is framed as durable replayable logs, automatic interrupted-session continuation, and reconnectable clients.

- Openness covers models, sandbox providers, hosts, MCP, and Durable Streams; the prioritization is non-trivial long-lived agents over demo convenience.

### `guide/migration`

- v2 removes `flue dev/build`, the automatic router, `defineAgent`, framework Workflows, and the deployment-wide SDK; replacements are Vite, explicit mounts, synchronous hook-based functions, `init()`/durable tools/external orchestration, and one client per conversation URL.

- Beta storage schema version is stated as `5`, current schema as `8`, and migration is reset-only; beta state must be exported before upgrade and re-seeded.

- `POST` removes `?wait`; beta `{message,images}` becomes a delivered-message object with optional top-level `initialData` and `uid`.

- Workflow APIs and run events are wholly removed: “There is no framework job abstraction to migrate to.” Cloudflare Workflows or another orchestrator can durably store dispatch receipts and replies.

- Minimum Cloudflare `compatibility_date` is `2026-04-01`; `FlueRegistry` and generated Workflow classes must be deleted by migration.

### `reference/agent-api`

- Exact agent types: `type AgentFunction<TProps=void> = TProps extends void ? () => string|undefined|void : (props:TProps) => string|undefined|void`; `interface AgentProps { id:string }`.

- Identity must match `/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/`; resolution order is build-stamped binding, `agentName`, then function `name`.

- Statics are `agentName?:string`, `initialData?:v.GenericSchema`, `durability?:{maxAttempts?:number;timeoutMs?:number}`; defaults are `maxAttempts:10`, `timeoutMs:3_600_000`.

- `dispatch(agent,{id,message,initialData?,uid?}) -> Promise<{submissionId,acceptedAt,uid}>`; `init()` creates an address only, not an instance or I/O.

- Dynamic changes generate reserved `resources`, `instructions`, or `environment` signals and compaction rebaselines snapshots; framework-reserved types cannot be admitted by callers.

### `reference/events`

- `observe(subscriber)->()=>void` is isolate-global, live-only, synchronous-on-emission, non-blocking for returned promises, failure-contained, and ordered only by per-context `eventIndex`.

- Every event carries `{v:3,eventIndex:number,timestamp:string}` plus applicable correlation fields; `turn_request` is in-process only and contains full model-visible instructions/messages/tools.

- The v3 vocabulary has exactly 27 types; the complete table is in §3.

- Deltas (`text_delta`, thinking deltas, `toolcall_delta`) are explicitly live preview; canonical completed messages/tool outcomes are authoritative.

- `instrument()` combines observation with an exactly-once-`next()` execution-interceptor chain and key-based duplicate protection.

### `reference/errors`

- `FlueError` carries stable `type`, caller-safe `message/details`, dev-only `dev`, optional structured `meta`, and server-only `cause`; `name` is not a discriminator.

- Framework route errors use `{error:{type,message,details,dev?,meta?,ref?}}`; logged 500s include `err_<ULID>` both as `error.ref` and `flue-error-ref`.

- HEAD errors have no body; client-aborted long polls return empty `499`; mid-stream errors terminate without an envelope.

- Only `AgentInstanceExistsError` and `AgentInstanceNotFoundError` are importable HTTP error classes; cancellation is a `DOMException` named `AbortError`.

- Complete route codes and class/type list are in §4.

### `reference/configuration`

- `FlueConfig = {target?,app?,db?,cloudflare?,agents?,providers?,tracing?}`; config is strict except `flue run`, which drops unknown keys.

- Config basename priority: `.ts`, `.mts`, `.mjs`, `.js`, `.cjs`, `.cts`; TypeScript config loading requires Node `>=22.19` or `>=23.6` and erasable syntax.

- Default agent glob is `**/*.{ts,mts,js,mjs}` under the source root; dot directories plus `node_modules`, `dist`, `output`, `.wrangler` are excluded.

- `flue(config?): Plugin[]` merges defined inline fields over file fields, with no deep merge; Node forces SSR ESM target `node22`, defaults sourcemaps `true`, and retains user `outDir` (default `dist`).

- `flueWorkerConfig()` contributes `virtual:flue/worker`, bindings, `nodejs_compat`, and minimum date validation; user Wrangler settings and migrations pass through.

### `sdk/overview`

- `@flue/sdk` is ESM-only, fetch-based, and depends on `@durable-streams/client`; each client owns exactly one conversation URL.

- `send()` wraps `POST`; `wait()` follows updates from admission offset; `read()` composes wait plus history; `history()` materializes; `observe()` hydrates and tails; `abort()` posts `/abort`.

- The SDK provides offset resume, reconnection, dynamic headers, and at-least-once redelivery handling; it provides no enumeration/deletion or agent-name addressing.

- Server-internal callers should use runtime `init()`/`dispatch()` rather than HTTP SDK calls.

### `sdk/create-flue-client`

- `createFlueClient(options:CreateFlueClientOptions):FlueClient` is synchronous and does no network I/O.

- `HttpClientOptions = {url:string,fetch?:typeof fetch,headers?:RequestHeaders,token?:string}`; trailing slashes are stripped.

- Relative URLs resolve against `location.origin` only in a browser; elsewhere they throw exactly `TypeError: relative url requires a browser; pass an absolute URL`.

- Headers merge after bearer token, so explicit `authorization` wins; a header factory is re-run for every request and every stream reconnection.

- JSON requests are single fetches; stream retry/backoff is configured per `wait()`/`observe()` call, not at client construction.

### `sdk/events`

- SDK consumers see materialized conversation state or `ConversationStreamChunk`; runtime `FlueEvent` is never transported by the SDK.

- `FlueEventStream<T>` is `AsyncIterable<T>` with `cancel(reason?)` and opaque `offset`; cancel ends iteration without throwing.

- Stream offset advances only after all events in a delivered batch are yielded, producing at-least-once rather than skip-prone resume semantics.

- `FlueStreamOptions` defaults `offset:'-1'`, `live:true` where this raw interface means long-poll; SDK `observe()` uses SSE by default and falls back.

- `observe()` deduplicates by chunk `position`; raw `wait().onEvent` may redeliver and includes unrelated conversation chunks after the admission offset.

### `sdk/errors`

- `FlueApiError` is `{status,body,ref?}` for non-2xx JSON calls; `body` remains `unknown`; `wait()` cannot emit it and `observe()` never throws.

- `FlueExecutionError` is `{target:'agent_submission',targetId,failure:'failed'|'aborted'|'terminal_event_missing',error}` for admitted work that did not complete.

- Re-exported stream errors are `DurableStreamError`, `StreamClosedError`, `FetchError`, `FetchBackoffAbortError`; an internal `ConversationStreamError` is not exported.

- Stream retry covers network errors, `429`, `503`, and all `5xx`, indefinitely by default; caller `AbortSignal` rejects `wait()` with its reason rather than an SDK error.

- `observe()` maps initial `404` to `phase:'absent'`; `400/401/403` are fatal; other failures retry from 1 s exponential delay capped at 30 s.

### `cli/overview`

- `@flue/cli` requires Node `22.19+`; the binary provides `init`, `run`, `add`, `update`, and `docs`, but no dev/build commands.

- `--help/-h` and `--version/-v` are the only globals; undeclared flags are rejected.

- Primary payload goes to stdout; prompts, streaming progress, and errors go to stderr.

### `cli/run`

- Exact synopsis: `flue run <path> --message <text> [--name <agent>] [--id <id>] [--data <json>] [--uid <uid> | --new] [--env <path>] [--json]`.

- Only the named module/import graph loads; `app.ts` never loads. Default id is a generated ULID; default storage is `node_modules/.cache/flue/run.db`.

- `--uid` conflicts with `--new` and `--data`; `--data` is creation-only; multi-agent modules require explicit `--name`.

- JSON outcomes are `completed`, `failed`, `aborted`, or pre-run `error`; exit codes are `0`, `1`, and `130` respectively.

### `cli/init`

- Exact synopsis: `flue init [directory] [--target <node|cloudflare>] [--deploy] [--force]`; `--root` is an equivalent hidden-in-synopsis directory option but conflicts with the positional path.

- It writes but does not install. Node defaults to no HTTP deployment; Cloudflare always implies `--deploy`.

- Noninteractive use requires `--target`; `--force` overwrites skeleton files, while normal mode keeps and reports existing files.

- Always generated: config, package/TS files, gitignore/env, Hello agent, `AGENTS.md`, README; deploy adds Vite/app; Node adds `db.ts`; Cloudflare adds `cloudflare.ts`.

### `cli/add`

- `flue add [<kind> <name|url>] [--print]` retrieves Markdown blueprints; no arguments list the catalog.

- Kinds are exactly `channel`, `database`, `sandbox`, `tooling`; an absolute docs URL selects the generic build-from-scratch guide.

- It is not a package installer; coding-agent detection or `--print` writes the guide to stdout. Registry base is `https://flueframework.com/cli/blueprints/`.

### `cli/update`

- `flue update <kind> <name|url> [--print]` requires both arguments and emits the same blueprint as `add` with update intent.

- It does not inspect or modify the project; the coding agent compares and applies the guide while preserving customizations.

- Kind, URL, stdout, and `--print` semantics match `add` exactly.

### `ecosystem/tooling/braintrust` (skim)

- Blueprint creates `braintrust.ts`, uses runtime `observe()`, installs Braintrust `3.17`, and bridges the current terminal `tool` event to Braintrust's expected older `tool_call` vocabulary.

- Content export is on and broad; masking must be application-configured. Cloudflare final-span delivery is best-effort because observer uploads cannot extend DO lifetime.

### `ecosystem/tooling/opentelemetry` (skim)

- `createOpenTelemetryInstrumentation()` emits GenAI spans/metrics but configures no SDK, exporter, sampling, credentials, or flush lifecycle.

- It pins GenAI conventions commit `4c8add...`, projection revision `5`, extension revision `4`; content is on by default and shares a 56 KiB per-span in-band budget.

- Direct HTTP admission persists validated `traceparent`/`tracestate`; baggage and `dispatch()` trace context do not propagate.

### `ecosystem/tooling/sentry` (skim)

- Blueprint combines an event bridge for issues/logs with OpenTelemetry GenAI spans; traces default off (`SENTRY_TRACES_SAMPLE_RATE=0`) and model/tool content is separately opt-in.

- Node uses `@sentry/node`; Cloudflare uses `@sentry/cloudflare` and `wrap` on each generated DO. Failed operation plus settlement deduplication aims for one issue per terminal failure.

### `ecosystem/tooling/jetty` (skim)

- Jetty has no `flue add` blueprint; use `@jetty/sdk`, keep grader separate, and send an agent reply to `gradeWithJetty()` as a stored trajectory.

- Local grading uses Node `start()`/`init()`; deployed Cloudflare agents can instead be prompted through `@flue/sdk` from a Node grading process.

### `ecosystem/tooling/vitest-evals` (skim)

- Blueprint tests the public mounted-agent HTTP boundary, gives every case a fresh conversation id, and captures events from admission offset/submission id.

- It normalizes response text, usage/cost, and tool calls; `FLUE_BASE_URL` switches local vs deployed targets, and the agent must already be mounted/authenticated.

## 2. Agent lifecycle end to end

### Addressing and admission

1. A caller chooses the `Agent` function and instance `id`.

2. Server-side delivery calls `dispatch(agent,{id,message,initialData?,uid?})`; programmatic round trips use `init(agent,{id?,uid?}).dispatch(...)`; HTTP sends `POST <mount>/:id`.

3. Every surface normalizes a bare string to `{kind:'user',body}` and validates the full `DeliveredMessage`.

4. A user delivery may include base64 image attachments; each is capped at `14 * 1024 * 1024` base64 characters.

5. A signal validates non-empty `type`, string attributes, XML-safe optional `tagName`, and rejects framework-reserved signal types.

6. The runtime resolves durable agent identity and registered target before admission.

7. `uid` enforces the incarnation precondition: omitted means continue-or-create; string means continue-only; `null` means create-only.

8. On first contact, `initialData` is parsed synchronously through the agent static schema; the parsed value is recorded as immutable instance creation data.

9. On continuation, supplied `initialData` is ignored; combining it with a string `uid` is invalid before durable writes.

10. Image bytes are written as immutable attachments and canonical input records refer to their attachment metadata.

11. Admission writes or idempotently finds an accepted-submission row before model work. That row includes submission id, accepted time, kind (`dispatch`/`direct`), payload, status, and later claim/lease/attempt state.

12. The accepted queue is ordered with every direct and dispatched input for the same agent instance.

13. Admission emits live `submission_queued`; an idempotent replay may re-emit it for the same submission.

14. HTTP immediately returns `202 {streamUrl,offset,submissionId,uid}`; `dispatch()` returns `{submissionId,acceptedAt,uid}`.

15. The returned HTTP `offset` is the stream head after recording the input, so following it excludes the admitted message and observes only the response-side work.

### Claim and response initialization

16. An idle instance schedules processing; Cloudflare schedules a zero-delay DO alarm, while Node's coordinator owns and claims persisted queue work.

17. A worker atomically claims the runnable head, assigning owner, lease, attempt id/count, and first-start/deadline bookkeeping.

18. Claim emits `submission_running {attemptCount,maxAttempts}`; replacement attempts re-emit it with the increased count.

19. A delivery arriving while a response is live may enter a join state instead of running a separate attempt.

20. A joined submission emits `submission_queued` and eventually `submission_settled`, but no `submission_running`.

21. The response scope runs `useResponseStart` once at the true start; returned keys initialize response metadata.

22. An operation boundary emits `operation_start`, then `agent_start`.

23. The runtime applies the currently delivered input as a canonical `user_message` for `kind:'user'`, or a canonical signal record for `kind:'signal'`.

24. Signals enter model context as XML-tagged blocks; direct user messages remain user-purpose chat input.

25. The input is durably applied before subsequent model progress is treated as recoverable evidence.

26. `useAgentStart` callbacks execute for each delivered message; their committed effects, append records, and persistent-state writes checkpoint at the hook seam.

27. The root agent function renders synchronously with `{id}`.

28. The render reads `useInitialData`, current delivery, and persistent-state snapshots; it declares model, resources, lifecycle callbacks, data writers, and instructions.

29. The returned string is followed by `useInstruction()` contributions in call order, separated by blank lines.

30. Missing/duplicate `useModel`, invalid return values, re-entrant renders, or duplicate named resources fail before a provider turn.

31. Model/thinking/compaction choices are latched for the submission, even though resource declarations continue to re-render per turn.

32. Before the first turn, optional MCP failures may append a framework `resources` signal; between turns, resource/instruction/environment diffs append their reserved narration records.

### Model turn loop

33. Each turn starts with a fresh render and resource reconciliation.

34. Automatic compaction may first append a structural compaction boundary; a client then receives `conversation-reset` rather than raw canonical records.

35. Agent-purpose inference emits `turn_start {turnId,purpose:'agent'}`.

36. The runtime builds the full provider request from system instructions, canonical/recovered context, live tool declarations, and model options.

37. It emits in-process-only `turn_request`; image bytes are replaced by `IMAGE_DATA_OMITTED` in events, not in model context.

38. Provider streaming opens an assistant message and durably records partial assistant progress in append-only stream batches.

39. Live observers receive `message_start`, then interleaved `text_delta`, `thinking_*`, and `toolcall_delta` previews.

40. Client wire projection emits `message-started`, `message-delta`, thinking/data parts, and tool-input chunks; offsets identify record batches, not messages.

41. The completed provider call emits `turn` with request summary, normalized `ModelResponse`, duration, and `isError`.

42. Normalized finish reasons are `stop`, `length`, `toolUse`, `error`, or `aborted`; provider-native reason remains telemetry-only.

43. `message_end` carries the authoritative completed assistant message for that model step.

44. If the response contains tool calls, the runtime begins each with `tool_start` and canonical call arguments.

45. Calls in a tool batch may execute concurrently; the turn boundary does not commit the batch until every outcome is known.

46. Tool input validation failures become error tool results and let the model correct them; a thrown tool similarly records an error result rather than failing the submission directly.

47. Ordinary tool results are JSON-snapshotted; output schema/serialization errors become typed error outcomes visible to the model.

48. `durable:true` tools re-execute after interruption, but each `step.do(name,fn)` replays a previously recorded step value.

49. A persistent-state write inside a tool commits atomically with the tool batch; an interrupted uncommitted batch does not expose that write on recovery.

50. Terminal `tool` events publish when the model tool batch durably commits, not when an individual handler merely returns.

51. Canonical tool-call/tool-result records feed client `dynamic-tool` parts through `tool-input`, `tool-output`, or `tool-output-error` chunks.

52. The runtime emits `turn_messages` with the completed assistant step and tool-result messages.

53. A new turn begins if calls/results require continued reasoning; the agent function re-renders before it.

54. Dispatches received while busy may join at this turn boundary; their canonical inputs appear in accepted order and `useAgentStart` handles them.

55. Conditional resources can change at this boundary. The runtime appends `resources`, `instructions`, or full `environment` narration before the next request.

56. The loop ends when the model returns no calls or the whole current batch yields `terminate:true` outcomes.

### Finish and settlement

57. `agent_end` carries only messages produced by that loop run, not the whole transcript.

58. `useAgentFinish` callbacks may inspect the harness/response and may continue model work; continuations do not extend the submission deadline.

59. When the true response is done, `useResponseFinish` runs once and merges returned keys into response metadata.

60. The canonical assistant response closes; many model steps are folded into the submission's first assistant message in materialized client state.

61. Client wire emits `message-completed`; text/reasoning parts become `state:'done'`.

62. The operation emits terminal `operation {durationMs,isError,result?,usage?}`, then `idle`.

63. The runtime reserves an exact `SubmissionSettledRecord` obligation in the submission store before finalization.

64. It appends canonical `submission_settled {submissionId,outcome,error?}` to the conversation stream.

65. It finalizes the accepted-submission row from `terminalizing` to its terminal state after verifying the canonical record exists.

66. It emits live `submission_settled`; this is the authoritative terminal observability event.

67. Joined submissions settle against the coalesced response that answered them and `read()` returns that same reply.

68. Materialized state stores all settlements in an index; failed/aborted submissions also append a visible advisory timeline message, while completed submissions use the assistant reply as the marker.

69. `init().read(receipt)` reattaches by durable submission id, resolves `{text,data,metadata?,uid?,submissionId}`, or rejects `AgentRunError` for failed/aborted outcomes.

70. SDK `wait()` watches the `submission-settled` chunk and rejects `FlueExecutionError`; SDK `read()` then fetches materialized history and extracts the matching/coalesced reply.

### Interruption, timeout, and abort

71. Recovery reads only durable admission rows, attempt bookkeeping, canonical records, and attachment/state data; an unrecorded computation is not evidence.

72. It first closes partial assistant output as aborted, preserving the partial in history.

73. Recorded model/tool/state work is never rerun; uncommitted work may rerun subject to attempt and deadline budgets.

74. Unresolved ordinary tool calls become explicit unknown-outcome errors; they are not blindly re-executed.

75. Durable tools resume through step records; delegated tasks resume from child transcripts.

76. Default maximum total attempts is `10`; default submission wall-clock deadline is `3_600_000 ms`.

77. `handle.abort()`/`POST /abort` records durable abort intent for the running head and every queued submission, then returns before asynchronous settlement.

78. A completed settlement wins a race with abort; otherwise each affected submission settles outcome `aborted` with `SubmissionAbortedError`.

79. Failed recovery eventually settles `submission_interrupted`, `submission_retry_exhausted`, or `submission_timeout`; every accepted input is owed a terminal outcome.

80. This is at-least-once execution over exactly-once durable recording; external effects remain application-owned and require idempotency.

### Durable record/storage inventory named by the reviewed pages

- Accepted-submission row: admission payload, `submissionId`, kind, queue state, attempt count, owner/lease, abort intent, settlement reservation/final state.

- Conversation birth/creation record: instance uid plus parsed `initialData`.

- Canonical user-message record (`user_message`).

- Canonical signal record, including application and framework narration signals.

- Assistant response start/progress/completion records; partial output remains append-only and is closed on recovery.

- Tool-call and tool-outcome records, including duration, terminate flag, and interrupted/unknown outcomes.

- Durable-tool `step.do` value records keyed by tool-call id and deterministic step name.

- Persistent-state write records keyed by state name.

- Client data-writer records keyed by part name.

- Compaction records/boundaries and compacted summaries.

- Attachment records: immutable bytes plus id, MIME type, size, digest, and optional filename.

- `SubmissionSettledRecord`: submission id, `completed|failed|aborted`, and optional serialized error.

- Exact internal canonical record union is intentionally not exposed over HTTP; clients receive history snapshots and projected update chunks.

## 3. `reference/events`: complete event vocabulary

All rows also carry `v:3`, `eventIndex`, `timestamp`, and applicable `instanceId`, `submissionId`, `agentName`, `conversationId`, `session`, `parentSession`, `taskId`, `harness`, `operationId`, `turnId` correlation.

| Event type | When emitted | Payload fields |
|---|---|---|
| `agent_start` | Agent loop begins inside an operation. | `type` only. |
| `agent_end` | Agent loop ends. | `messages: AgentMessage[]` produced by this run. |
| `idle` | Session returns idle after every terminal operation, success or failure. | `type` only. |
| `submission_queued` | Durable admission completes; idempotent admission replay can re-emit. | `submissionId`; `kind:'dispatch'|'direct'`. |
| `submission_running` | Each claimed attempt begins, including recovery attempts. | `submissionId`; `kind`; `attemptCount`; `maxAttempts`. |
| `submission_settled` | Every durable terminal path, outside session scope. | `submissionId`; `outcome:'completed'|'failed'|'aborted'`; optional stackless `error:{name?,message,type?,details?,dev?,meta?}`. |
| `submission_recovery` | Coordinator failure/defer/contained recovery condition; may repeat roughly every 30 s on backstop wakes. | optional `submissionId`, `kind`; `operation:'materialize_submission'|'finalize_settlement'|'reconcile_submission'|'start_submission'|'process_submission'|'reconcile_pass'|'enforce_deadline'`; `outcome:'deferred'|'agent_unavailable'|'attempt_cap_deferred'|'terminated'`; optional counts and error. `attempt_cap_deferred` is retained but no longer emitted. |
| `operation_start` | `prompt`, `skill`, `task`, `shell`, or `compact` begins. | `operationId`; `operationKind`. |
| `operation` | Exactly once for every started operation. | `operationId`; `operationKind`; `durationMs`; `isError`; optional `error`, `result`, aggregate `usage`. |
| `turn_start` | Agent-purpose model turn begins; not emitted for compaction turns. | `turnId`; `purpose:'agent'|'compaction'|'compaction_prefix'`. |
| `turn_request` | Immediately before provider call; in-process only. | `turnId`; `purpose`; full `request:ModelRequest` including system prompt/messages/tools. |
| `turn` | Provider call completes or normalizes failure. | `turnId`; `purpose`; `durationMs`; `request:ModelRequestInfo`; `response:ModelResponse`; `isError`. |
| `turn_messages` | Agent-purpose turn boundary after tool batch commit. | `turnId`; `purpose`; `message:AgentMessage`; `toolResults:AgentMessage[]`. |
| `message_start` | Any loop-materialized user, assistant, or tool-result message begins. | `message:AgentMessage`; `turnId`. |
| `message_end` | That message completes; authoritative for completed assistant message. | `message:AgentMessage`; `turnId`. |
| `text_delta` | Streamed assistant text fragment. | `text:string`; turn correlation is envelope-only. |
| `thinking_start` | Streamed reasoning block begins. | optional zero-based `contentIndex`. |
| `thinking_delta` | Reasoning fragment arrives. | optional `contentIndex`; `delta:string`. |
| `thinking_end` | Reasoning block completes. | optional `contentIndex`; full `content:string`. |
| `toolcall_delta` | Tool call has stable id/name and another JSON-argument fragment arrives. | `toolCallId`; `toolName`; `argumentTextDelta`. |
| `tool_start` | Model or caller shell tool execution begins. | `toolName`; `toolCallId`; optional `args` declared but currently not populated. |
| `tool` | Tool outcome publishes; model tools publish at batch durable commit. | `toolName`; `toolCallId`; `isError`; optional `result`; `durationMs`. |
| `task_start` | Delegated `task()`/model task tool starts. | `taskId`; `prompt`; optional `agent`, `cwd`. |
| `task` | Delegated task terminates. | `taskId`; optional `agent`; `isError`; optional `result`; `durationMs`. |
| `compaction_start` | Non-empty threshold, overflow, or manual compaction starts. | `reason:'threshold'|'overflow'|'manual'`; `estimatedTokens`. |
| `compaction` | Exactly once after each `compaction_start`. | `messagesBefore`; `messagesAfter`; `durationMs`; `isError`; optional `error`, aggregate `usage`. |
| `log` | Runtime or `FlueLogger` structured log. | `level:'info'|'warn'|'error'`; `message`; optional `attributes`. |

### Event payload subtypes and live-only projection

- `ModelRequestInfo`: `providerId`, `providerName`, `requestedModel`, `api`, optional `serverAddress`, `serverPort`, `reasoningLevel`, `maxTokens`, `temperature`, `contextCompacted?:true` (declared but currently never populated).

- `ModelResponse`: optional `responseId`, `responseModel`, `output`, `usage`, normalized `finishReason`, `providerFinishReason`, `gatewayLogId`, classified `error`.

- `PromptUsage`: token counts `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`; same keys plus `total` under `cost`.

- `FlueObservation` adds live-only `agentInput`, `agentOutput`, `origin`, `description`, `args`, `effectiveResult`, `toolCallId`, and classified `errorInfo`.

- `origin` is `model|caller|framework|adapter`; caller `shell()` is `toolName:'bash'`.

- Observations are deep-cloned, cycle-preserving, deep-frozen, and the same object is delivered to every subscriber.

- `IMAGE_DATA_OMITTED` is exactly `'[image data omitted from event]'` and replaces base64 bytes throughout events.

- `observe()` has no replay, filtering, backpressure, cross-process aggregation, veto, or mutation.

## 4. `reference/errors`: complete error vocabulary

### HTTP envelope

```ts
{
  error: {
    type: string;
    message: string;
    details: string;
    dev?: string;
    meta?: Record<string, unknown>;
    ref?: string;
  }
}
```

- `type`, `message`, and `details` are always present.

- `dev` is local-development-only and omitted when empty.

- `meta` is mode-independent when the class provides it.

- `ref = 'err_' + ULID` appears only when the server logged a 500-class render; the identical value is returned in `flue-error-ref`.

- Every normal body carries `content-type: application/json`, `x-content-type-options: nosniff`, and `cross-origin-resource-policy: cross-origin`.

- `FlueHttpError` uses class status/headers; an escaping non-HTTP `FlueError` is typed 500; any other thrown value becomes redacted `internal_error` 500.

### Complete framework-owned route codes

| Type | HTTP | Exact scope/extra contract |
|---|---:|---|
| `invalid_request` | 400 | Bad URL/parameters/message, empty id, invalid initial data, illegal `uid` + `initialData`; class not exported. |
| `invalid_json` | 400 | Body exists but JSON parsing failed; parser report in `details`. |
| `unsupported_media_type` | 415 | Body lacks `Content-Type: application/json`. |
| `method_not_allowed` | 405 | Adds `Allow`. |
| `route_not_found` | 404 | No framework route; does not enumerate routes. |
| `stream_not_found` | 404 | Conversation has never received a prompt. |
| `attachment_not_found` | 404 | Unknown attachment or not owned by default conversation. |
| `agent_instance_not_found` | 404 | Continue-only uid miss/mismatch, or read against absent instance. |
| `agent_instance_exists` | 409 | Create-only conflict; `meta.uid` exposes existing incarnation. |
| `runtime_unavailable` | 503 | Dev runtime loading/draining/failed; `Retry-After: 1`, `meta.state`. |
| `internal_error` | 500 | Generic redaction of non-Flue failure, with logged ref. |

### Complete documented class/type list

| Class or error | Stable type / shape | Semantics and structured fields |
|---|---|---|
| `FlueError` | base `{type,details,dev,meta?,cause}` | Stable discriminator is `type`; `cause` never crosses wire. |
| `AgentInstanceExistsError` | `agent_instance_exists`, 409 | `.uid`; same value in `meta.uid`. |
| `AgentInstanceNotFoundError` | `agent_instance_not_found`, 404 | Missing and uid-mismatch intentionally indistinguishable. |
| `AgentRunError` | plain `Error` | `.outcome:'failed'|'aborted'`, `.submissionId`, serialized settlement as `cause`. |
| `AttachmentConflictError` | `attachment_conflict` | Adapter export; `meta.path`, `meta.attachmentId`. |
| `AttachmentIntegrityError` | `attachment_integrity` | Adapter export; `meta.attachmentId`, `reason:'size'|'digest'|'chunks'`. |
| `AttachmentNotAvailableError` | `attachment_not_available` | Delegation attachment not visible; `meta.attachmentId`. |
| `CloudflareAIBindingError` | `cloudflare_ai_binding_error` | Cloudflare subpath; status/body bounded to 2000 chars; 413 sets `meta.reason:'request_too_large'`. |
| `ConversationStreamStoreError` | `conversation_stream_store_failure` | Adapter export; `meta.operation`, `path`, `reason`. |
| no exported class | `conversation_record_invariant` | Persisted record violates canonical stream contract. |
| `DelegationDepthExceededError` | `delegation_depth_exceeded` | Nested task/harness delegation exceeded limit; message contains limit. |
| `InstrumentationAlreadyInstalledError` | `instrumentation_already_installed` | Same instrumentation key already active. |
| `OperationFailedError` | `operation_failed` | Harness operation did not complete; `meta.operation`, prose `reason`. |
| `PersistedFormatVersionError` | `persisted_format_version_unsupported` | Adapter startup failure; `meta.storedVersion`, `supportedVersion`. |
| `ResultUnavailableError` | plain `Error` | `.reason`, `.assistantText`; structured-result model gave up. |
| `SandboxOperationUnsupportedError` | `sandbox_operation_unsupported` | `meta.operation`, `provider`, `options`; rejected before mutation. |
| `SessionBusyError` | `session_busy` | A session already runs one operation. |
| `SessionNotFoundError` | `session_not_found` | Internal lookup; public get-or-create surface cannot hit it. |
| `SkillDefinitionValidationError` | `skill_definition_validation` | `meta.issues:ValidationIssue[]`. |
| `SkillNotRegisteredError` | `skill_not_registered` | Named discovered skill absent. |
| `SubagentNotDeclaredError` | `subagent_not_declared` | `task({agent})` named an undeclared delegate. |
| `SubmissionAbortedError` | `submission_aborted` | Durable terminal aborted settlement. |
| `SubmissionInterruptedError` | `submission_interrupted` | Attempt budget exhausted before input application; meta phase/counts. |
| `SubmissionRetryExhaustedError` | `submission_retry_exhausted` | Interrupted after input until attempts exhausted; counts and optional `{name,id}[]` interrupted tools. |
| `SubmissionTimeoutError` | `submission_timeout` | Submission exceeded `timeoutMs`. |
| `ToolInputValidationError` | `tool_input_validation` | `meta.tool`, `issues`; normally becomes model-visible tool error. |
| `ToolNameConflictError` | `tool_name_conflict` | Duplicate or framework-reserved tool name. |
| `ToolOutputSerializationError` | `tool_output_serialization` | `meta.tool`; optional serialization `cause`. |
| `ToolOutputValidationError` | `tool_output_validation` | `meta.tool`, `issues`. |
| `InvalidRequestError` | `invalid_request` | Not exported; match `instanceof FlueError` and `.type`. |
| cancellation | `DOMException` name `AbortError` | Never a `FlueError`; local read cancellation does not abort submission. |

### Validation and settlement shapes

```ts
interface ValidationIssue {
  readonly message: string;
  readonly path?: readonly PropertyKey[];
}
```

```ts
{
  type: 'submission_settled';
  submissionId: string;
  outcome: 'completed' | 'failed' | 'aborted';
  error?: {
    name?: string;
    message: string;
    type?: string;
    details?: string;
    dev?: string;
    meta?: Record<string, unknown>;
  };
}
```

- A `FlueError` preserves name/message/type/details/meta; any non-Flue cause is replaced wholesale by generic `internal_error` when settled/wired.

- Settlement records never contain stacks.

- `WORKERS_AI_OVERFLOW_MARKER` is exactly `'(request_too_large)'`.

- `RETRYABLE_INTERRUPTION_MARKER` is exactly `'(retryable_interruption)'`.

### SDK-only error list

| SDK class | Shape |
|---|---|
| `FlueApiError` | `status:number`, `body:unknown`, `ref?:string`; non-2xx JSON request. |
| `FlueExecutionError` | `target:'agent_submission'`, `targetId`, `failure:'failed'|'aborted'|'terminal_event_missing'`, `error:unknown`. |
| `DurableStreamError` | `code`, optional `status`, `details`; code union below. |
| `StreamClosedError` | code `STREAM_CLOSED`, status `409`, `streamClosed:true`, optional `finalOffset`. |
| `FetchError` | `status`, optional `text/json`, `headers`, `url`. |
| `FetchBackoffAbortError` | No extra fields. |
| internal `ConversationStreamError` | Stream-chunk validation failure; not exported. |

`DurableStreamError.code` is exactly `NOT_FOUND|CONFLICT_SEQ|CONFLICT_EXISTS|BAD_REQUEST|BUSY|SSE_NOT_SUPPORTED|UNAUTHORIZED|FORBIDDEN|RATE_LIMITED|ALREADY_CONSUMED|ALREADY_CLOSED|PARSE_ERROR|STREAM_CLOSED|UNKNOWN`.

## 5. `reference/agent-api`: exact programmatic contract

### Agent function and statics

```ts
type AgentFunction<TProps = void> = TProps extends void
  ? () => string | undefined | void
  : (props: TProps) => string | undefined | void;

type Agent = AgentFunction<AgentProps> & AgentStatics;

interface AgentProps { id: string }

interface AgentStatics {
  agentName?: string;
  initialData?: v.GenericSchema;
  durability?: DurabilityConfig;
}

interface DurabilityConfig {
  maxAttempts?: number;
  timeoutMs?: number;
}
```

- Agent functions must return synchronously; Promise return throws `[flue] Agent functions must be synchronous.`

- Legal instruction return is string or `undefined`/void. Root only receives `{id}`; direct child invocation is forbidden as re-entrant render.

- `agentName` in a `'use agent'` module must be a string literal. Duplicate identities or invalid identity pattern fail registration.

- `initialData` validates exactly once before first durable admission; its parsed output is recorded.

- `maxAttempts` is a positive integer including initial attempt, default `10`; `timeoutMs` is positive wall-clock ms from first-attempt start, default `3_600_000`.

### Delivered input

```ts
type DeliveredMessage =
  | { kind:'user'; body:string; attachments?:DeliveredAttachment[] }
  | {
      kind:'signal';
      type:string;
      body:string;
      attributes?:Record<string,string>;
      tagName?:string;
    };

type DeliveredMessageInput = string | DeliveredMessage;
type DeliveredAttachment = PromptImage & { filename?:string };
```

- String shorthand is user input.

- Signals project as XML blocks and default tag name is `signal`.

- Reserved signal types: `resources`, `instructions`, `environment`, `stream_interrupted`, `stream_continued`, `submission_aborted`, `submission_interrupted`, `compaction`, `memory`.

### `dispatch()` and conditions

```ts
function dispatch(agent:Agent, request:AgentDispatchRequest):Promise<DispatchReceipt>;

interface AgentDispatchRequest {
  id:string;
  message:DeliveredMessageInput;
  initialData?:unknown;
  uid?:string|null;
}

interface DispatchReceipt {
  submissionId:string;
  acceptedAt:string;
  uid:string;
}
```

- Resolve means admitted/queued, never reply-complete.

- `uid` omitted: unconditional create-or-continue.

- `uid:string`: continue that incarnation only; missing/mismatch -> `AgentInstanceNotFoundError`; cannot combine with initial data.

- `uid:null`: create only; existing -> `AgentInstanceExistsError` with existing uid.

- Busy deliveries join at a turn boundary where possible; otherwise remain durable queue submissions and are never dropped.

### `init()`, read, abort, lookup

```ts
function init(agent:Agent, options?:{id?:string;uid?:string|null}):AgentInstanceHandle;

interface AgentInstanceHandle {
  readonly id:string;
  dispatch(request:string|{message:DeliveredMessageInput;initialData?:unknown}):Promise<DispatchReceipt>;
  read(target:string|DispatchReceipt, options?:{
    onEvent?:(chunk:ConversationStreamChunk)=>void;
    signal?:AbortSignal;
  }):Promise<AgentReply>;
  abort():Promise<void>;
}

interface AgentReply {
  text:string;
  data:Record<string,unknown[]>;
  metadata?:Record<string,unknown>;
  uid?:string;
  submissionId:string;
}

function getAgentInstance(agent:Agent,id:string):Promise<{id:string;uid?:string}|null>;
```

- `init()` is a pure address constructor; omitted id mints one, but nothing exists until contact.

- The handle's first successful contact pins uid for future sends.

- `read()` is durable and reattachable from another process; repeating it returns the same settled reply.

- `read(...,{signal})` cancels only the wait. `abort()` durably stops the entire instance's current and queued work.

- Reading a same-instance submission from a tool that owns the live response deadlocks by construction.

### Standalone runtime

```ts
function start(options:StartOptions):Promise<Flue>;

interface StartOptions {
  agents:readonly (Agent|{agent:Agent;name?:string})[];
  db?:PersistenceAdapter;
  env?:Record<string,string|undefined>;
  providers?:readonly Provider[];
}

interface Flue {
  stop():Promise<void>;
  [Symbol.asyncDispose]():Promise<void>;
}
```

- `agents` is required/non-empty; identity is explicit name then function identity, never array position.

- `db` defaults memory; `env` defaults `process.env`; omitted providers registers all built-ins, empty registers none.

- `stop()` drains then disconnects; one process may have only one configured Flue runtime.

### Harness

```ts
interface FlueHarness {
  readonly name:string;
  prompt<S extends v.GenericSchema>(text:string,options:PromptOptions<S>&{result:S}):CallHandle<PromptResultResponse<v.InferOutput<S>>>;
  prompt(text:string,options?:PromptOptions):CallHandle<PromptResponse>;
  compact():Promise<void>;
  readonly sandbox:Sandbox;
}

interface CallHandle<T> extends Promise<T> {
  readonly signal:AbortSignal;
  abort(reason?:unknown):void;
}
```

- `harness.prompt()` uses a private scratch conversation; repeated calls in one harness continue it, and clients never see it.

- `PromptOptions` fields are `result?`, `tools?`, `model?`, `thinkingLevel?`, `signal?`, `images?`.

- A `result` schema injects `finish`; giving up rejects `ResultUnavailableError`.

- Prompt usage aggregates all turns, extraction retries, and compaction calls; cost comes from per-million-token catalog rates.

- `harness.compact()` is no-op when empty, fails on summarization/abort, and throws `SessionBusyError` while another operation runs.

- `harness.sandbox` is a live getter; absent sandbox throws, and it must not be cached across conditional environment swaps.

### Tool authoring and durable steps

```ts
defineTool({
  name:string,
  description:string,
  input?:TopLevelObjectSchema,
  output?:Schema,
  harness?:boolean,
  durable?:boolean,
  run(context):ToolRunEnvelope|String|void|Promise<...>
})
```

- Legal bare returns are only string shorthand or void without an output schema; object/array/number/boolean/null must be wrapped `{output}`.

- `{terminate:true}` ends only when every result in a multi-call batch terminates; throwing never terminates.

- Tool context always contains `toolCallId`, optional `signal`, and `log`; flags add `harness` and/or `step`.

```ts
interface ToolStep {
  do<T>(name:string,fn:()=>T|Promise<T>):Promise<T>;
}
```

- Step names are unique non-empty strings per call; values must be small JSON-serializable data.

- Exactly-once-recorded, at-least-once-executed: a crash after `fn` but before record may repeat `fn`.

### Skills, subagents, MCP

- `defineSkill()` validates/freezes `{name,description,instructions,license?,compatibility?,metadata?,allowedTools?,files?}`; name max `64`, description max `1024`, compatibility max `500`.

- Skill paths must be safe relative paths and cannot be `SKILL.md`; instructions are required/non-empty.

- `defineSubagent()` validates/freezes `{name,description,agent,model?,thinkingLevel?}`; omitted model/thinking inherit.

- `GeneralSubagent` is reserved `flue-general`, has no parent instructions/resources, and receives shared environment plus parent model.

- `defineMcpConnection()` defaults transport `streamable-http`, SDK timeout `60 s`, `resetTimeoutOnProgress:false`, `optional:false`.

- Adapted names are `mcp__<server>__<tool>` with invalid chars replaced by `_`; auth functions resolve per request and re-resolve once on `401`.

### Dynamic resources and signals

- System skill catalog and task roster remain on a durable baseline to preserve prompt-cache prefix; live availability is conveyed through canonical signals.

- A `resources` signal is one per changed kind and ends with the full current roster; tool update detection includes description/input-schema digest.

- Optional MCP failure emits a per-submission `resources` signal with `resource='mcp'`; recovery is later narrated as normal tool additions.

- Instruction digest change emits exact body `System instructions updated.`

- Sandbox presence flip emits a full `environment` snapshot and supersedes same-boundary resource deltas.

- `useDelivery()` cursor ignores narration signals.

## 6. Routing and exposure contract

```ts
import { createAgentRouter } from '@flue/runtime/routing';
function createAgentRouter(agent:Agent):Hono;
```

### Mounted routes relative to the host prefix

| Route | Response/meaning |
|---|---|
| `POST /:id` | Validate and durably admit `DeliveredMessage` + optional `initialData`/`uid`; `202`. |
| `GET /:id` | History snapshot or updates/live stream according to query. |
| `HEAD /:id` | Stream metadata only. |
| `POST /:id/abort` | Record conversation-wide abort intent. |
| `GET /:id/attachments/:attachmentId` | Return immutable attachment bytes. |

- Pure/no-options factory; router identity is agent identity, never mount path.

- Handler runtime lookup is request-time, so construction before bootstrap is safe.

- Unmatched known-path method yields canonical `405`; invalid/anonymous identity fails router construction.

- Returned Hono exposes `.fetch`, satisfying `Fetchable` and other fetch-shaped hosts.

### Auth layering

- There is intentionally no router authentication or agent-specific auth API.

- Mount host middleware before `app.route(...)`, e.g. `app.use('/agents/support/*', authAndAuthorize)`.

- The wildcard must include send/read/abort/attachment routes.

- Authentication alone is insufficient: caller-chosen conversation id is an object-authorization boundary.

- Server-issued ids or ids derived from authenticated principals reduce guessing/ownership mistakes.

- Application middleware owns its own status/envelope; Flue does not impose `unauthorized`/`forbidden` error types.

### CORS layering

- Agent router sets no `Access-Control-*` headers.

- Vite dev/preview defaults are localhost-permissive and credentialed; raw production Node and deployed Workers need explicit host CORS.

- Cross-origin clients need exposed `Stream-Next-Offset`, `Stream-Up-To-Date`, and `Location` headers.

- Same-origin UI plus agent deployment needs no CORS middleware.

### Dispatch-only agents

- Registration is build scan, independent from router creation.

- A registered agent may have zero mounts and remain callable by verified webhooks, channel handlers, queue/cron code, Cloudflare handlers, and `dispatch()`.

- Dispatch bypasses HTTP middleware; the calling application code is responsible for verification, target id, and message normalization.

- A private monitoring mount can later expose the same conversations behind admin middleware without changing storage identity.

## 7. Contradictions and refinements to prior conclusions

### “Flue has no scheduler of its own”

- Contradicted if read literally across targets.

- Cloudflare agent modules may use the Agents SDK methods `schedule()` and `scheduleEvery()` through `extend({base})`.

- These schedules live inside each generated agent Durable Object and share its alarm with Flue response execution.

- A scheduled callback due during a running response waits until that response settles; delivery is durable, timing is not guaranteed while busy.

- No external Worker cron trigger is required for `scheduleEvery()` after the object has been created.

- Worker-level cron is also supported through the default `scheduled` handler in source-root `cloudflare.ts`, usually followed by `dispatch()`.

- Node scheduling remains application-owned (process scheduler/cron); Flue's cross-target schedule guide supplies target patterns rather than a single portable scheduler engine.

- Precise replacement conclusion: Flue has no target-independent scheduler abstraction, but the Cloudflare target exposes a first-class in-agent scheduler inherited from the Agents SDK and supports Worker cron integration.

### “Workflows are not a Flue feature per se”

- Confirmed and strengthened for v2.

- The migration page says framework Workflows were removed: `defineWorkflow`, `invoke`, run APIs/routes/events, discovery, React workflow hook, and registry classes are gone.

- Exact guidance: “There is no framework job abstraction to migrate to.”

- Flue provides workflow-friendly primitives: durable admission receipts, reattachable `read()`, durable tools with `step.do`, standalone `start()`, and SDK conversation calls.

- Multi-step orchestration, retries, status inspection, and cross-service checkpoints belong to Cloudflare Workflows, Inngest, CI, scripts, or another application-owned orchestrator.

- Precise replacement conclusion: workflows are a usage pattern around Flue agents, not a Flue runtime object in v2.

### “The protocol is state-based and never exposes deltas”

- Contradicted.

- The preferred SDK/React application surface is state-based (`history()` and materialized `observe()`), and canonical completed messages are authoritative.

- The HTTP updates protocol exposes incremental chunks including `message-delta`, tool input/output transitions, data writes, message start/completion, settlements, and resets.

- The runtime event stream exposes even finer live deltas: `text_delta`, `thinking_delta`, and `toolcall_delta`.

- `toolcall_delta` is explicitly live-only and never persisted/replayed; runtime deltas are best-effort and a late observer misses earlier fragments.

- Durable client update chunks are replayable by offset, but `conversation-reset` may replace incremental accumulated state at structural boundaries.

- Precise replacement conclusion: Flue is canonically record/state based and offers authoritative materialized snapshots, while also exposing both durable projected update chunks and best-effort live model deltas.

### “Channel packages peer-depend on `@flue/runtime`”

- Not established by any scoped page.

- `guide/channels` says blueprints install a provider ingress package and the provider's own outbound SDK; it does not specify package peer dependencies.

- Channel code imports `dispatch` from `@flue/runtime`, but that is application source and does not prove the connector package's manifest relationship.

- The hand-written router helper `createChannelRouter` is exported from `@flue/runtime`; packaged channel objects expose `route()` themselves.

- Exact dependency metadata would require package manifests or channel ecosystem pages; do not retain the peer-dependency conclusion from these pages alone.

### Additional documentation inconsistency: persistence version numbers

- `guide/migration` states the beta stored schema version `5` and the current release stores Flue schema version `8`.

- The already-reviewed `reference/data-persistence-api` states current exported `FLUE_FORMAT_VERSION` is `1` and describes adapter format stamps.

- These appear to be different version domains (runtime/schema lineage versus public adapter format stamp), but neither scoped page explicitly reconciles them.

- Do not describe them as one counter or substitute one value for the other.

### Additional documentation inconsistency: dispatch idempotency field

- `guide/channels` passes `idempotencyKey: payload.event_id` to `dispatch()` and says provider redelivery with that key never runs a second turn.

- `reference/agent-api` defines `AgentDispatchRequest` with only `id`, `message`, `initialData?`, and `uid?`; it does not list `idempotencyKey` anywhere in the exact signature.

- The events page nevertheless mentions “`idempotencyKey`-deduplicated retries” while explaining repeated `submission_queued` emission.

- Therefore idempotent admission evidently exists internally/on at least one surface, but the reviewed public Agent API reference does not expose or specify the field; do not rely on it without checking installed TypeScript declarations/runtime behavior.

### Additional documentation inconsistency: direct HTTP request body example

- `guide/routing` and `reference/agent-api` specify the direct body as a bare `DeliveredMessage`, with `initialData` and `uid` as optional top-level siblings.

- `guide/migration` says the new body is `{ "message": { "kind":"user", "body":"..." } }`, which introduces a wrapper absent from the other two contracts.

- Prefer the routing/reference contract (`{kind,body,initialData?,uid?}`) unless a compatibility test proves the wrapper is accepted.

### Additional refinement: timeout semantics

- `reference/agent-api` says the deadline is checked cooperatively before turns/recovery and “not preemptively during provider calls,” so a hung provider call can outlive it.

- The already-reviewed `guide/durability` says the coordinator supervises attempts, fires abort at the deadline, abandons signal-ignoring work, and settles after a short grace.

- Reconciliation: user code/provider calls are not forcibly preempted at arbitrary instruction points; the coordinator can abort/abandon the attempt and fence late writes. The wording differs enough that an implementation test is warranted for a truly hung provider transport.

### Additional refinement: Cloudflare build wiring

- `guide/deploy` describes authored `wrangler.jsonc` being merged into generated `.flue-vite.wrangler.jsonc`.

- `reference/configuration` describes `flueWorkerConfig()` contributing values inside the Cloudflare Vite plugin and says Flue never reads/merges/writes a Wrangler config file.

- The current exact configuration contract requires `cloudflare({config:flueWorkerConfig()})`; generated-file prose in the guide/migration appears to describe an adjacent or earlier integration path.

- Treat `reference/configuration` as the API reference for code; verify generated artifacts rather than relying on the guide's filename narrative.

## 8. 10 mechanisms most worth copying

1. Admit every input durably before returning, then make settlement a separate canonical record addressable by the admission receipt.

2. Use append-only canonical conversation records plus projection layers, so recovery, materialized UI state, streaming updates, and audit all derive from one truth.

3. Separate agent registration/identity from HTTP exposure, allowing dispatch-only private agents and arbitrary authenticated mount layouts.

4. Re-render declarative capabilities at turn boundaries and narrate resource/instruction/environment changes into the transcript so dynamic behavior stays model-coherent.

5. Combine at-least-once execution with exactly-once recording, fencing uncertain ordinary side effects while offering explicit durable step checkpoints for opted-in tools.

6. Make dispatch receipts and settled replies reattachable across process loss, turning agent calls into safe building blocks for external workflow engines.

7. Give every instance an incarnation uid with create-only/continue-only conditional sends, preventing accidental reuse without treating the uid as authorization.

8. Keep live telemetry rich but non-authoritative—complete turn/tool events, correlation ids, error classification, redacted images—while preserving a separate durable ledger.

9. Expose a materialized conversation API for most clients while retaining opaque-offset incremental streams with replay, reset, and at-least-once redelivery semantics.

10. Bind outbound destinations and credentials in trusted application tool factories, leaving the model only the narrow action arguments it is authorized to choose.

# Pi native-capability overlap audit

## Scope and evidence

| Item | Audited value |
|---|---|
| Consumer dependency | pnpm alias `@mariozechner/pi-coding-agent` -> `@earendil-works/pi-coding-agent@0.80.7` |
| Installed coding-agent path | `/home/ubuntu/projects/boring-ui-v2/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.7_.../node_modules/@earendil-works/pi-coding-agent` |
| Installed core | `@earendil-works/pi-agent-core@0.80.7` |
| Installed ai used by core/coding-agent | `@earendil-works/pi-ai@0.80.7` |
| Other installed ai | `@earendil-works/pi-ai@0.80.10`; not the authoritative surface for this audit |
| npm latest observed 2026-08-10 | Earendil core/ai/coding-agent `0.82.1`; old Mario coding-agent `0.73.1`, deprecated |
| Authoritative API basis | installed `package.json`, `exports`, `.d.ts`, and `dist/*.js` at `0.80.7` |
| Docs basis | `https://pi.dev/docs/latest` index, installed `0.80.7/docs/*.md`, and latest web pages |
| Version-drift rule | where latest docs differ, the installed `0.80.7` declaration/runtime wins |

Docs index walked first: `https://pi.dev/docs/latest`.

Docs reviewed: `/providers`, `/usage`, `/sessions`, `/session-format`, `/sdk`, `/json`, `/rpc`, `/skills`, `/compaction`, `/extensions`, `/packages`, `/settings`, `/security`.

Direct `curl -sL --max-time 30 https://r.jina.ai/https://pi.dev/docs/latest/...` and `npm view ... --json` were invoked but the sandbox returned no response body.

The same official pages were retrieved through the web fetcher; installed docs supplied the version-matched text.

Npm package pages and the Earendil npm organization page supplied current registry versions.

Key version-drift example: latest SDK docs mention `summarization_retry_*`; installed `0.80.7 AgentSessionEvent` does not export those events.

## Bottom line

Pi already supplies the agent loop, model/provider normalization, event stream, tool protocol, native coding tools, cancellation and tool progress, steering/follow-up queues, JSONL session trees, in-memory and injected session storage in core, replay-to-model context, compaction, branch summaries, skills parsing/discovery, extension loading, package discovery, and RPC/JSONL process integration.

Boring-ui should not maintain alternate implementations of those semantics unless its host contract is materially stronger.

The materially stronger boring-ui requirements are multi-tenant ownership, host-volume placement, durable reconnect cursors, idempotent client nonces, governed MCP, workspace/sandbox abstractions, secret boundaries, billing/metering, and browser DTO compatibility.

Those requirements justify adapters and host repositories; they do not justify reimplementing the pi turn loop or pi transcript semantics underneath them.

## 1. Package split and portability

### Package ownership

| Package | Native responsibility | Persistence | Tools | UI/runtime |
|---|---|---|---|---|
| `pi-ai` | provider/model catalog, auth abstraction, normalized messages, streaming protocol, cost/token accounting, OAuth helpers, image APIs | injectable `CredentialStore`; no conversation store | schema-only `Tool`; validation helpers | fetch/stream layer; intended to bundle for browsers with selective imports |
| `pi-agent-core` | stateful agent loop, tool execution, lifecycle events, steering/follow-up queues, portable `AgentHarness`, portable session/storage interfaces, JSONL implementation over injected FS, compaction, branch summary, skills/prompts over injected environment | `SessionStorage`, `SessionRepo`, `InMemory*`, `Jsonl*` over injected `FileSystem` | executable `AgentTool`, hooks, progress, sequential/parallel execution | core entry is runtime-abstracted; `./node` adds local Node execution |
| `pi-coding-agent` | Node coding harness/CLI, `AgentSession`, file-backed `SessionManager`, built-in coding tools, resource/package loader, extensions, TUI, print/JSON/RPC modes | local append-only JSONL; fixed implementation plus in-memory mode | read/bash/edit/write/grep/find/ls and extension/custom tools | Node >=22.19; TUI, subprocesses, filesystem, workers, jiti |

### Declared package exports

```ts
// @earendil-works/pi-agent-core
exports = {
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  "./node": { types: "./dist/node.d.ts", import: "./dist/node.js" },
  "./package.json": "./package.json"
}

// @earendil-works/pi-ai
exports = {
  ".": "./dist/index.*",
  "./compat": "./dist/compat.*",
  "./providers/*": "./dist/providers/*.*",
  "./api/*": "./dist/api/*.*",
  "./oauth": "./dist/oauth.*",
  "./bedrock-provider": "./dist/bedrock-provider.*"
}

// @earendil-works/pi-coding-agent
exports = {
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  "./rpc-entry": { import: "./dist/rpc-entry.js" }
}
```

### Direct Node builtin scan of installed `dist/*.js`

| Package/entry | Exact direct builtins | Verdict |
|---|---|---|
| `pi-agent-core` entire dist | `node:child_process`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:readline` | only `harness/env/nodejs.js` imports them |
| `pi-agent-core` `.` graph excluding `./node` | none directly in core/harness modules; injected `ExecutionEnv`/`FileSystem` | portable in design; default `Agent` imports `pi-ai/compat`, so bundler/provider compatibility still matters |
| `pi-agent-core/node` | all seven above | Node-only local execution adapter |
| `pi-ai` entire dist | `node:crypto`, `node:fs`, `node:fs/promises`, `node:http`, `node:os`, `node:readline`, `node:zlib` | mixed; provider/OAuth/CLI modules include Node paths |
| `pi-ai` core `.` | auth context uses bundler-opaque dynamic `node:fs/promises` and `node:os`; catches failure | browser-intended and tree-shakeable; pass explicit auth/store in constrained runtimes |
| `pi-ai/api/openai-codex-responses` | `node:os`, `node:zlib` | that direct API implementation is Node-dependent |
| `pi-ai` OAuth helpers | `node:crypto`, `node:http` | local callback-server OAuth is Node-dependent |
| `pi-coding-agent` | `node:child_process`, `node:crypto`, `node:events`, `node:fs`, `node:fs/promises`, `node:module`, `node:os`, `node:path`, `node:readline`, `node:string_decoder`, `node:url`, `node:worker_threads` | Node-only |

### Native and runtime-sensitive dependencies

| Package | Direct native/runtime concern |
|---|---|
| `pi-agent-core` | no native dependency; `ignore`, `yaml`, `typebox`, `pi-ai` |
| `pi-ai` | no declared native addon; provider SDKs; AWS SDK; proxy agents; OpenTelemetry |
| `pi-coding-agent` | `@silvia-odwyer/photon-node@0.3.4` WASM/native image path; optional `@mariozechner/clipboard`; `jiti`; `cross-spawn`; `proper-lockfile` |

`pi-agent-core` is the only package appropriate as the primary abstraction in a constrained host.

`pi-coding-agent` can be isolated behind a server/worker boundary but cannot run in a browser, edge isolate without Node compatibility, or a sandbox forbidding process/filesystem/worker APIs.

## 2. Complete public API surface

The following ledger is the public `0.80.7` export surface, not every internal file reachable by filesystem path.

### `@earendil-works/pi-ai` root: type and data protocol

```ts
type KnownApi = "openai-completions" | "mistral-conversations" | "openai-responses" |
  "azure-openai-responses" | "openai-codex-responses" | "anthropic-messages" |
  "bedrock-converse-stream" | "google-generative-ai" | "google-vertex" | "pi-messages";
type Api = KnownApi | (string & {});
type KnownImagesApi = "openrouter-images";
type ImagesApi = KnownImagesApi | (string & {});
type ProviderId = KnownProvider | string;
type ImagesProviderId = "openrouter" | string;
type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ModelThinkingLevel = "off" | ThinkingLevel;
type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;
type CacheRetention = "none" | "short" | "long";
type Transport = "sse" | "websocket" | "websocket-cached" | "auto";
type ProviderEnv = Record<string, string>;
type ProviderHeaders = Record<string, string | null>;
type SessionAffinityFormat = "openai" | "openai-nosession" | "openrouter";
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
type Message = UserMessage | AssistantMessage | ToolResultMessage;
type ImagesInputContent = TextContent | ImageContent;
type ImagesOutputContent = TextContent | ImageContent;
type ImagesStopReason = "stop" | "error" | "aborted";
type StreamFunction<A extends Api = Api, O extends StreamOptions = StreamOptions> =
  (model: Model<A>, context: Context, options?: O) => AssistantMessageEventStream;
type ImagesFunction<A extends ImagesApi = ImagesApi, O extends ImagesOptions = ImagesOptions> =
  (model: ImagesModel<A>, context: ImagesContext, options?: O) => Promise<AssistantImages>;
```

Exported interfaces: `ThinkingBudgets`, `ProviderResponse`, `StreamOptions`, `ApiOptionsMap`, `ProviderStreams`, `ProviderImages`, `ImagesOptions`, `SimpleStreamOptions`, `TextSignatureV1`, `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`, `Usage`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `ImagesContext`, `AssistantImages`, `Tool`, `Context`, `OpenAICompletionsCompat`, `OpenAIResponsesCompat`, `AnthropicMessagesCompat`, `OpenRouterRouting`, `VercelGatewayRouting`, `ModelCostRates`, `ModelCostTier`, `ModelCost`, `Model`, `ImagesModel`.

```ts
interface Tool<P extends TSchema = TSchema> { name: string; description: string; parameters: P }
interface Context { systemPrompt?: string; messages: Message[]; tools?: Tool[] }
interface UserMessage { role: "user"; content: string | (TextContent | ImageContent)[]; timestamp: number }
interface ToolResultMessage<D = any> {
  role: "toolResult"; toolCallId: string; toolName: string;
  content: (TextContent | ImageContent)[]; details?: D;
  addedToolNames?: string[]; isError: boolean; timestamp: number;
}
interface AssistantMessage {
  role: "assistant"; content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api; provider: ProviderId; model: string; responseModel?: string; responseId?: string;
  diagnostics?: AssistantMessageDiagnostic[]; usage: Usage; stopReason: StopReason;
  errorMessage?: string; timestamp: number;
}
```

### `pi-ai` root: stream event API

```ts
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

class EventStream<T, R = T> implements AsyncIterable<T> {
  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R);
  push(event: T): void;
  end(result?: R): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
  result(): Promise<R>;
}
class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage>;
function createAssistantMessageEventStream(): AssistantMessageEventStream;
```

### `pi-ai` root: models/providers/auth

```ts
interface Provider<A extends Api = Api> {
  readonly id: string; readonly name: string; readonly baseUrl?: string;
  readonly headers?: ProviderHeaders; readonly auth: ProviderAuth;
  getModels(): readonly Model<A>[];
  refreshModels?(): Promise<void>;
  stream<T extends A>(model: Model<T>, context: Context, options?: ApiStreamOptions<T>): AssistantMessageEventStream;
  streamSimple(model: Model<A>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}
interface Models {
  getProviders(): readonly Provider[];
  getProvider(id: string): Provider | undefined;
  getModels(provider?: string): readonly Model<Api>[];
  getModel(provider: string, id: string): Model<Api> | undefined;
  refresh(provider?: string): Promise<void>;
  getAuth(model: Model<Api>): Promise<AuthResult | undefined>;
  stream<A extends Api>(model: Model<A>, context: Context, options?: ApiStreamOptions<A>): AssistantMessageEventStream;
  complete<A extends Api>(model: Model<A>, context: Context, options?: ApiStreamOptions<A>): Promise<AssistantMessage>;
  streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
  completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>;
}
interface MutableModels extends Models {
  setProvider(provider: Provider): void; deleteProvider(id: string): void; clearProviders(): void;
}
function createModels(options?: { credentials?: CredentialStore; authContext?: AuthContext }): MutableModels;
function createProvider<A extends Api = Api>(input: CreateProviderOptions<A>): Provider<A>;
function hasApi<A extends Api>(model: Model<Api>, api: A): model is Model<A>;
function calculateCost<A extends Api>(model: Model<A>, usage: Usage): Usage["cost"];
function getSupportedThinkingLevels<A extends Api>(model: Model<A>): ModelThinkingLevel[];
function clampThinkingLevel<A extends Api>(model: Model<A>, level: ModelThinkingLevel): ModelThinkingLevel;
function modelsAreEqual<A extends Api>(a: Model<A> | null | undefined, b: Model<A> | null | undefined): boolean;
```

```ts
interface CredentialStore {
  read(providerId: string): Promise<Credential | undefined>;
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
  delete(providerId: string): Promise<void>;
}
class InMemoryCredentialStore implements CredentialStore;
function defaultProviderAuthContext(): AuthContext;
function envApiKeyAuth(name: string, envVars: readonly string[]): ApiKeyAuth;
function lazyOAuth(input: { name: string; load: () => Promise<OAuthAuth> }): OAuthAuth;
```

Exported auth types: `ModelAuth`, `ApiKeyCredential`, `OAuthCredential`, `Credential`, `CredentialStore`, `AuthContext`, `AuthResult`, `AuthPrompt`, `AuthEvent`, `AuthLoginCallbacks`, `ApiKeyAuth`, `OAuthAuth`, `ProviderAuth`, `AuthModel`, `ModelsError`, `ModelsErrorCode`.

### `pi-ai` root: utilities and test provider

```ts
function lazyStream(model: Model<Api>, setup: () => Promise<AsyncIterable<AssistantMessageEvent>>): AssistantMessageEventStream;
function lazyApi(load: () => Promise<ProviderStreams>): ProviderStreams;
function repairJson(json: string): string;
function parseJsonWithRepair<T>(json: string): T;
function parseStreamingJson<T = Record<string, unknown>>(partialJson: string | undefined): T;
function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean;
function getOverflowPatterns(): RegExp[];
function isRetryableAssistantError(message: AssistantMessage): boolean;
function validateToolCall(tools: Tool[], toolCall: ToolCall): any;
function validateToolArguments(tool: Tool, toolCall: ToolCall): any;
function StringEnum<T extends readonly string[]>(values: T, options?: { default?: T[number]; description?: string }): TSchema;
function formatThrownValue(value: unknown): string;
function extractDiagnosticError(error: unknown): DiagnosticErrorInfo;
function createAssistantMessageDiagnostic(type: string, error: unknown, details?: Record<string, unknown>): AssistantMessageDiagnostic;
function registerSessionResourceCleanup(cleanup: (sessionId?: string) => void): () => void;
function cleanupSessionResources(sessionId?: string): void;
```

Faux exports: `FauxModelDefinition`, `FauxContentBlock`, `FauxResponseFactory`, `FauxResponseStep`, `RegisterFauxProviderOptions`, `FauxProviderRegistration`, `FauxProviderHandle`, `fauxText`, `fauxThinking`, `fauxToolCall`, `fauxAssistantMessage`, `createFauxCore`, `fauxProvider`.

Image exports: `ImagesProvider`, `ImagesModels`, `MutableImagesModels`, `createImagesModels`, `CreateImagesProviderOptions`, `createImagesProvider`.

### `pi-ai/providers/*` subpaths

```ts
getBuiltinModel(provider, modelId): Model;
getBuiltinProviders(): BuiltinProvider[];
getBuiltinModels(provider): Model[];
builtinProviders(): Provider[];
builtinModels(options?: CreateModelsOptions): MutableModels;
builtinImagesProviders(): ImagesProvider[];
builtinImagesModels(options?: CreateModelsOptions): MutableImagesModels;
```

Provider factory exports:

```ts
amazonBedrockProvider(): Provider<"bedrock-converse-stream">;
antLingProvider(): Provider<"openai-completions">;
anthropicProvider(): Provider<"anthropic-messages">;
azureOpenAIResponsesProvider(): Provider<"azure-openai-responses">;
cerebrasProvider(): Provider<"openai-completions">;
cloudflareAIGatewayProvider(): Provider<"anthropic-messages" | "openai-completions" | "openai-responses">;
cloudflareWorkersAIProvider(): Provider<"openai-completions">;
deepseekProvider(): Provider<"openai-completions">;
fireworksProvider(): Provider<"anthropic-messages" | "openai-completions">;
githubCopilotProvider(): Provider<"anthropic-messages" | "openai-completions" | "openai-responses">;
googleVertexProvider(): Provider<"google-vertex">;
googleProvider(): Provider<"google-generative-ai">;
groqProvider(): Provider<"openai-completions">;
huggingfaceProvider(): Provider<"openai-completions">;
kimiCodingProvider(): Provider<"anthropic-messages">;
minimaxCnProvider(): Provider<"anthropic-messages">;
minimaxProvider(): Provider<"anthropic-messages">;
mistralProvider(): Provider<"mistral-conversations">;
moonshotaiCnProvider(): Provider<"openai-completions">;
moonshotaiProvider(): Provider<"openai-completions">;
nvidiaProvider(): Provider<"openai-completions">;
openaiCodexProvider(): Provider<"openai-codex-responses">;
openaiProvider(): Provider<"openai-responses">;
opencodeGoProvider(): Provider<"anthropic-messages" | "openai-completions">;
opencodeProvider(): Provider<"anthropic-messages" | "google-generative-ai" | "openai-completions" | "openai-responses">;
openrouterProvider(): Provider<"openai-completions">;
openrouterImagesProvider(): ImagesProvider;
togetherProvider(): Provider<"openai-completions">;
vercelAIGatewayProvider(): Provider<"anthropic-messages">;
xaiProvider(): Provider<"openai-completions">;
xiaomiProvider(): Provider<"openai-completions">;
xiaomiTokenPlanCnProvider(): Provider<"openai-completions">;
xiaomiTokenPlanAmsProvider(): Provider<"openai-completions">;
xiaomiTokenPlanSgpProvider(): Provider<"openai-completions">;
zaiProvider(): Provider<"openai-completions">;
zaiCodingCnProvider(): Provider<"openai-completions">;
```

Each provider model module also exports its generated uppercase `*_MODELS` catalog constant.

### `pi-ai/api/*`, compat, OAuth, Bedrock

Every direct chat API module exports exactly:

```ts
const stream: StreamFunction<API_ID, ProviderSpecificOptions>;
const streamSimple: StreamFunction<API_ID, SimpleStreamOptions>;
```

Provider option types exported at root: `AnthropicEffort`, `AnthropicOptions`, `AnthropicThinkingDisplay`, `AzureOpenAIResponsesOptions`, `BedrockOptions`, `BedrockThinkingDisplay`, `GoogleOptions`, `GoogleThinkingLevel`, `GoogleVertexOptions`, `MistralOptions`, `OpenAICodexResponsesOptions`, `OpenAICodexWebSocketDebugStats`, `OpenAICompletionsOptions`, `OpenAIResponsesOptions`, `PiMessagesEvent`, `PiMessagesOptions`, `PiMessagesRewriteImpact`.

```ts
// @earendil-works/pi-ai/compat
registerApiProvider<A extends Api, O extends StreamOptions>(provider: ApiProvider<A, O>, sourceId?: string): void;
getApiProvider(api: Api): ApiProviderInternal | undefined;
getApiProviders(): ApiProviderInternal[];
unregisterApiProviders(sourceId: string): void;
registerFauxProvider(options?: RegisterFauxProviderOptions): FauxProviderRegistration;
registerBuiltInApiProviders(): void;
resetApiProviders(): void;
stream<A extends Api>(model: Model<A>, context: Context, options?: ProviderStreamOptions): AssistantMessageEventStream;
complete<A extends Api>(model: Model<A>, context: Context, options?: ProviderStreamOptions): Promise<AssistantMessage>;
streamSimple<A extends Api>(model: Model<A>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
completeSimple<A extends Api>(model: Model<A>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>;
```

`compat` additionally re-exports legacy static catalogs, env API-key helpers, legacy API aliases, image APIs, all lazy API factories, and all root exports.

`oauth` re-exports OAuth provider registry/types/login implementations.

`bedrock-provider` exports `bedrockProviderModule: { stream; streamSimple }`.

### `@earendil-works/pi-agent-core` agent API

```ts
type StreamFn = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
  AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
type ToolExecutionMode = "sequential" | "parallel";
type QueueMode = "all" | "one-at-a-time";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;
```

```ts
interface AgentTool<P extends TSchema = TSchema, D = any> extends Tool<P> {
  label: string;
  prepareArguments?: (args: unknown) => Static<P>;
  execute(toolCallId: string, params: Static<P>, signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<D>): Promise<AgentToolResult<D>>;
  executionMode?: "sequential" | "parallel";
}
interface AgentToolResult<D> {
  content: (TextContent | ImageContent)[]; details: D;
  addedToolNames?: string[]; terminate?: boolean;
}
```

```ts
class Agent {
  constructor(options?: AgentOptions);
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void;
  get state(): AgentState;
  set/get steeringMode: QueueMode;
  set/get followUpMode: QueueMode;
  steer(message: AgentMessage): void;
  followUp(message: AgentMessage): void;
  clearSteeringQueue(): void;
  clearFollowUpQueue(): void;
  clearAllQueues(): void;
  hasQueuedMessages(): boolean;
  get signal(): AbortSignal | undefined;
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;
  prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  prompt(input: string, images?: ImageContent[]): Promise<void>;
  continue(): Promise<void>;
}
```

```ts
agentLoop(prompts: AgentMessage[], context: AgentContext, config: AgentLoopConfig,
  signal?: AbortSignal, streamFn?: StreamFn): EventStream<AgentEvent, AgentMessage[]>;
agentLoopContinue(context: AgentContext, config: AgentLoopConfig,
  signal?: AbortSignal, streamFn?: StreamFn): EventStream<AgentEvent, AgentMessage[]>;
runAgentLoop(prompts, context, config, emit, signal?, streamFn?): Promise<AgentMessage[]>;
runAgentLoopContinue(context, config, emit, signal?, streamFn?): Promise<AgentMessage[]>;
streamProxy(model: Model<any>, context: Context, options: ProxyStreamOptions): ProxyMessageEventStream;
```

Core type exports: `AgentOptions`, `AgentState`, `AgentContext`, `AgentEvent`, `AgentLoopConfig`, `AgentLoopTurnUpdate`, `PrepareNextTurnContext`, `ShouldStopAfterTurnContext`, `BeforeToolCallContext`, `BeforeToolCallResult`, `AfterToolCallContext`, `AfterToolCallResult`, `AgentToolCall`, `ProxyAssistantMessageEvent`, `ProxyStreamOptions`.

### `pi-agent-core` portable harness and persistence API

```ts
class AgentHarness<S extends Skill = Skill, P extends PromptTemplate = PromptTemplate,
  T extends AgentTool = AgentTool> {
  constructor(options: AgentHarnessOptions<S, P, T>);
  prompt(text: string, options?: { images?: ImageContent[] }): Promise<AssistantMessage>;
  skill(name: string, additionalInstructions?: string): Promise<AssistantMessage>;
  promptFromTemplate(name: string, args?: string[]): Promise<AssistantMessage>;
  steer(text: string, options?: { images?: ImageContent[] }): Promise<void>;
  followUp(text: string, options?: { images?: ImageContent[] }): Promise<void>;
  nextTurn(text: string, options?: { images?: ImageContent[] }): Promise<void>;
  appendMessage(message: AgentMessage): Promise<void>;
  compact(customInstructions?: string): Promise<CompactResult>;
  navigateTree(targetId: string, options?: TreeOptions): Promise<NavigateTreeResult>;
  getModel(): Model<any>; setModel(model: Model<any>): Promise<void>;
  getThinkingLevel(): ThinkingLevel; setThinkingLevel(level: ThinkingLevel): Promise<void>;
  getTools(): T[]; setTools(tools: T[], activeToolNames?: string[]): Promise<void>;
  getActiveTools(): T[]; setActiveTools(toolNames: string[]): Promise<void>;
  getSteeringMode(): QueueMode; setSteeringMode(mode: QueueMode): Promise<void>;
  getFollowUpMode(): QueueMode; setFollowUpMode(mode: QueueMode): Promise<void>;
  getResources(): AgentHarnessResources<S, P>; setResources(resources: AgentHarnessResources<S, P>): Promise<void>;
  getStreamOptions(): AgentHarnessStreamOptions; setStreamOptions(options: AgentHarnessStreamOptions): Promise<void>;
  abort(): Promise<AbortResult>; waitForIdle(): Promise<void>;
  subscribe(listener: (event: AgentHarnessEvent<S, P>, signal?: AbortSignal) => Promise<void> | void): () => void;
  on<K extends keyof AgentHarnessEventResultMap>(type: K, handler: Hook<K>): () => void;
}
```

```ts
interface SessionStorage<M extends SessionMetadata = SessionMetadata> {
  getMetadata(): Promise<M>;
  getLeafId(): Promise<string | null>;
  setLeafId(leafId: string | null): Promise<void>;
  createEntryId(): Promise<string>;
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  findEntries<T extends SessionTreeEntry["type"]>(type: T): Promise<Extract<SessionTreeEntry, {type:T}>[]>;
  getLabel(id: string): Promise<string | undefined>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  getEntries(): Promise<SessionTreeEntry[]>;
}
interface SessionRepo<M extends SessionMetadata, C extends SessionCreateOptions, L> {
  create(options: C): Promise<Session<M>>;
  open(metadata: M): Promise<Session<M>>;
  list(options: L): Promise<M[]>;
  delete(metadata: M): Promise<void>;
  fork(sourceMetadata: M, options: C & SessionForkOptions): Promise<Session<M>>;
}
```

```ts
class Session<M extends SessionMetadata = SessionMetadata> {
  constructor(storage: SessionStorage<M>, contextBuildOptions?: SessionContextBuildOptions);
  getMetadata(): Promise<M>; getStorage(): SessionStorage<M>;
  getLeafId(): Promise<string | null>; getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  getEntries(): Promise<SessionTreeEntry[]>; getBranch(fromId?: string): Promise<SessionTreeEntry[]>;
  buildContextEntries(options?: SessionContextBuildOptions): Promise<SessionTreeEntry[]>;
  buildContext(options?: SessionContextBuildOptions): Promise<SessionContext>;
  getLabel(id: string): Promise<string | undefined>; getSessionName(): Promise<string | undefined>;
  appendMessage(message: AgentMessage): Promise<string>;
  appendThinkingLevelChange(level: string): Promise<string>;
  appendModelChange(provider: string, modelId: string): Promise<string>;
  appendActiveToolsChange(activeToolNames: string[]): Promise<string>;
  appendCompaction<T>(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: T, fromHook?: boolean): Promise<string>;
  appendCustomEntry(customType: string, data?: unknown): Promise<string>;
  appendCustomMessageEntry<T>(customType: string, content: string | Content[], display: boolean, details?: T): Promise<string>;
  appendLabel(targetId: string, label: string | undefined): Promise<string>;
  appendSessionName(name: string): Promise<string>;
  moveTo(entryId: string | null, summary?: { summary: string; details?: unknown; fromHook?: boolean }): Promise<string | undefined>;
}
```

Concrete exports: `InMemorySessionStorage`, `InMemorySessionRepo`, `JsonlSessionStorage`, `JsonlSessionRepo`.

```ts
JsonlSessionStorage.open(fs, filePath): Promise<JsonlSessionStorage>;
JsonlSessionStorage.create(fs, filePath, { cwd, sessionId, parentSessionPath?, metadata? }): Promise<JsonlSessionStorage>;
loadJsonlSessionMetadata(fs, filePath): Promise<JsonlSessionMetadata>;
createSessionId(): string;
createTimestamp(): string;
uuidv7(): string;
toSession<M>(storage: SessionStorage<M>): Session<M>;
getEntriesToFork(storage, { entryId?, position? }): Promise<SessionTreeEntry[]>;
```

Persistence types: `SessionTreeEntryBase`, `MessageEntry`, `ThinkingLevelChangeEntry`, `ModelChangeEntry`, `ActiveToolsChangeEntry`, `CompactionEntry`, `BranchSummaryEntry`, `CustomEntry`, `CustomMessageEntry`, `LabelEntry`, `SessionInfoEntry`, `LeafEntry`, `SessionTreeEntry`, `SessionContext`, `SessionMetadata`, `JsonlSessionMetadata`, `SessionCreateOptions`, `SessionForkOptions`, `JsonlSessionCreateOptions`, `JsonlSessionListOptions`, `JsonlSessionRepoApi`, `SessionContextBuildOptions`, `ContextEntryTransform`, `CustomEntryContextMessageProjector`.

### `pi-agent-core` environment, resources, compaction, utilities

```ts
interface FileSystem { /* cwd/path/stat/read/write/append/list/exists/create/remove operations */ }
interface Shell { exec(command: string, options?: ShellExecOptions): Promise<Result<...>> }
interface ExecutionEnv extends FileSystem, Shell {}
class NodeExecutionEnv implements ExecutionEnv; // only from @earendil-works/pi-agent-core/node
```

```ts
loadSkills(env: ExecutionEnv, dirs: string | string[]): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }>;
loadSourcedSkills<TSource, TSkill extends Skill>(env, inputs): Promise<{ skills: TSkill[]; diagnostics: SkillDiagnostic[] }>;
formatSkillInvocation(skill: Skill, additionalInstructions?: string): string;
formatSkillsForSystemPrompt(skills: Skill[]): string;
loadPromptTemplates(env, paths): Promise<{ prompts: PromptTemplate[]; diagnostics: PromptTemplateDiagnostic[] }>;
loadSourcedPromptTemplates(env, inputs): Promise<{ prompts: PromptTemplate[]; diagnostics: PromptTemplateDiagnostic[] }>;
parseCommandArgs(argsString: string): string[];
substituteArgs(content: string, args: string[]): string;
formatPromptTemplateInvocation(template: PromptTemplate, args?: string[]): string;
```

```ts
const DEFAULT_COMPACTION_SETTINGS: { enabled: true; reserveTokens: 16384; keepRecentTokens: 20000 };
calculateContextTokens(usage: Usage): number;
getLastAssistantUsage(entries: SessionTreeEntry[]): Usage | undefined;
estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate;
shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean;
estimateTokens(message: AgentMessage): number;
findTurnStartIndex(entries, entryIndex, startIndex): number;
findCutPoint(entries, startIndex, endIndex, keepRecentTokens): CutPointResult;
generateSummary(messages, models, model, reserveTokens, signal?, instructions?, previousSummary?, thinkingLevel?): Promise<Result<string, CompactionError>>;
prepareCompaction(entries, settings): Result<CompactionPreparation | undefined, CompactionError>;
compact(preparation, models, model, instructions?, signal?, thinkingLevel?): Promise<Result<CompactionResult, CompactionError>>;
collectEntriesForBranchSummary(session, oldLeafId, targetId): Promise<CollectEntriesResult>;
prepareBranchEntries(entries, tokenBudget?): BranchPreparation;
generateBranchSummary(entries, options): Promise<Result<BranchSummaryResult, BranchSummaryError>>;
serializeConversation(messages: Message[]): string;
```

Other core exports: result helpers `ok`, `err`, `getOrThrow`, `getOrUndefined`, `toError`; stable error classes `FileError`, `ExecutionError`, `CompactionError`, `BranchSummaryError`, `SessionError`, `AgentHarnessError`; shell capture; message converters; truncation helpers and constants.

### `@earendil-works/pi-coding-agent` top-level ledger

CLI/config exports: `Args`, `parseArgs`, `CONFIG_DIR_NAME`, `VERSION`, `getAgentDir`, `getPackageDir`, `getDocsPath`, `getExamplesPath`, `getReadmePath`, `MainOptions`, `main`.

Session exports: `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`, `ModelCycleResult`, `ParsedSkillBlock`, `PromptOptions`, `SessionStats`, `parseSkillBlock`, `AgentSessionRuntime`, `CreateAgentSessionRuntimeFactory`, `CreateAgentSessionRuntimeResult`, `AgentSessionRuntimeDiagnostic`, `AgentSessionServices`, `CreateAgentSessionFromServicesOptions`, `CreateAgentSessionServicesOptions`, `CreateAgentSessionOptions`, `CreateAgentSessionResult`, `createAgentSession`, `createAgentSessionFromServices`, `createAgentSessionRuntime`, `createAgentSessionServices`.

Auth/model exports: `ApiKeyCredential`, `AuthCredential`, `AuthStatus`, `AuthStorage`, `AuthStorageBackend`, `FileAuthStorageBackend`, `InMemoryAuthStorageBackend`, `OAuthCredential`, `ModelRegistry`, model resolver types/functions.

Session-file exports: `CURRENT_SESSION_VERSION`, all entry/header/context/tree/info types, `SessionManager`, `migrateSessionEntries`, `parseSessionEntries`, `getLatestCompactionEntry`, `sessionEntryToContextMessages`, `buildContextEntries`, `buildSessionContext`.

Compaction exports: `BranchPreparation`, `BranchSummaryResult`, `CollectEntriesResult`, `CompactionResult`, `CutPointResult`, `FileOperations`, `GenerateBranchSummaryOptions`, `DEFAULT_COMPACTION_SETTINGS`, `calculateContextTokens`, `collectEntriesForBranchSummary`, `compact`, `estimateTokens`, `findCutPoint`, `findTurnStartIndex`, `generateBranchSummary`, `generateSummary`, `getLastAssistantUsage`, `prepareBranchEntries`, `serializeConversation`, `shouldCompact`.

Resource exports: `PackageManager`, `DefaultPackageManager`, `PathMetadata`, `ProgressCallback`, `ProgressEvent`, `ResolvedPaths`, `ResolvedResource`, `ResourceCollision`, `ResourceDiagnostic`, `ResourceLoader`, `DefaultResourceLoader`, `loadProjectContextFiles`, `SettingsManager`, settings types, skills types/functions.

Extension exports: every named event/result/context/API/runtime/tool/renderer type in `core/extensions/index`, plus `createEventBus`, `createExtensionRuntime`, `defineTool`, `discoverAndLoadExtensions`, `ExtensionRunner`, tool-result type guards, and wrappers.

Tool exports: operation/input/options/details types for seven built-ins, definition factories, local bash operations, mutation queue, truncation, diff generation.

Mode exports: `InteractiveMode`, `runPrintMode`, `runRpcMode`, `RpcClient`, RPC command/response/state/UI types.

TUI exports: all component classes listed in `dist/index.d.ts`, theme helpers, `Theme`, `ThemeColor`, diff/highlighting helpers.

Utility exports: `copyToClipboard`, `parseFrontmatter`, `stripFrontmatter`, `convertToPng`, `resizeImage`, `formatDimensionNote`, `getShellConfig`.

### `pi-coding-agent` principal callable signatures

```ts
createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
createAgentSessionServices(options: CreateAgentSessionServicesOptions): Promise<AgentSessionServices>;
createAgentSessionFromServices(options: CreateAgentSessionFromServicesOptions): Promise<CreateAgentSessionResult>;
createAgentSessionRuntime(factory: CreateAgentSessionRuntimeFactory, options): Promise<AgentSessionRuntime>;
```

```ts
class AgentSession {
  subscribe(listener: AgentSessionEventListener): () => void;
  prompt(text: string, options?: PromptOptions): Promise<void>;
  steer(text: string, images?: ImageContent[]): Promise<void>;
  followUp(text: string, images?: ImageContent[]): Promise<void>;
  sendCustomMessage(message, options?: { triggerTurn?: boolean; deliverAs?: "steer"|"followUp"|"nextTurn" }): Promise<void>;
  sendUserMessage(content, options?: { deliverAs?: "steer"|"followUp" }): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  abort(): Promise<void>; waitForIdle(): Promise<void>; dispose(): void;
  setModel(model: Model<any>): Promise<void>; cycleModel(direction?: "forward"|"backward"): Promise<ModelCycleResult | undefined>;
  setThinkingLevel(level: ThinkingLevel): void; cycleThinkingLevel(): ThinkingLevel | undefined;
  setActiveToolsByName(names: string[]): void; getActiveToolNames(): string[]; getAllTools(): ToolInfo[];
  compact(customInstructions?: string): Promise<CompactionResult>; abortCompaction(): void;
  navigateTree(targetId: string, options?): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }>;
  executeBash(command: string, onChunk?: (chunk: string) => void, options?): Promise<BashResult>;
  reload(options?): Promise<void>; exportToHtml(path?: string): Promise<string>; exportToJsonl(path?: string): string;
}
```

```ts
class AgentSessionRuntime {
  switchSession(path: string, options?): Promise<{ cancelled: boolean }>;
  newSession(options?): Promise<{ cancelled: boolean }>;
  fork(entryId: string, options?): Promise<{ cancelled: boolean; selectedText?: string }>;
  importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }>;
  dispose(): Promise<void>;
}
```

```ts
class SessionManager {
  static create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager;
  static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager;
  static continueRecent(cwd: string, sessionDir?: string): SessionManager;
  static inMemory(cwd?: string, options?: NewSessionOptions): SessionManager;
  static forkFrom(sourcePath: string, targetCwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager;
  static list(cwd: string, sessionDir?: string, onProgress?: SessionListProgress): Promise<SessionInfo[]>;
  static listAll(sessionDir?: string, onProgress?: SessionListProgress): Promise<SessionInfo[]>;
  setSessionFile(path: string): void; newSession(options?: NewSessionOptions): string | undefined;
  appendMessage(message): string; appendThinkingLevelChange(level: string): string;
  appendModelChange(provider: string, modelId: string): string;
  appendCompaction<T>(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: T, fromHook?: boolean): string;
  appendCustomEntry(type: string, data?: unknown): string;
  appendCustomMessageEntry<T>(type: string, content, display: boolean, details?: T): string;
  appendSessionInfo(name: string): string; appendLabelChange(targetId: string, label?: string): string;
  getBranch(fromId?: string): SessionEntry[]; buildContextEntries(): SessionEntry[]; buildSessionContext(): SessionContext;
  getEntries(): SessionEntry[]; getTree(): SessionTreeNode[]; branch(entryId: string): void; resetLeaf(): void;
  branchWithSummary(entryId: string | null, summary: string, details?: unknown, fromHook?: boolean): string;
  createBranchedSession(leafId: string): string | undefined;
}
```

```ts
createReadTool(cwd: string, options?: ReadToolOptions): AgentTool;
createBashTool(cwd: string, options?: BashToolOptions): AgentTool;
createEditTool(cwd: string, options?: EditToolOptions): AgentTool;
createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool;
createGrepTool(cwd: string, options?: GrepToolOptions): AgentTool;
createFindTool(cwd: string, options?: FindToolOptions): AgentTool;
createLsTool(cwd: string, options?: LsToolOptions): AgentTool;
createCodingTools(cwd: string, options?: ToolsOptions): AgentTool[];
createReadOnlyTools(cwd: string, options?: ToolsOptions): AgentTool[];
```

## 3. Session and persistence

### Coding-agent native store

Default directory: `~/.pi/agent/sessions/--<cwd-with-slashes-replaced>--/`.

Override precedence: `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > `settings.json.sessionDir` > default.

Filename: timestamp plus UUID, `.jsonl`.

Header:

```ts
interface SessionHeader {
  type: "session"; version?: number; id: string; timestamp: string;
  cwd: string; parentSession?: string;
}
```

Current format version: `3`.

V1 was linear; V2 added `id`/`parentId` trees; V3 renamed legacy hook messages to custom messages.

Load automatically migrates old entries in memory; rewrite behavior belongs to `SessionManager`.

Each subsequent line is one append-only entry.

Native entry union: message, thinking-level change, model change, compaction, branch summary, custom state, custom message, label, session info.

Branches share one file; `parentId` forms the tree and the current leaf determines active context.

`buildContextEntries()` follows leaf ancestry and applies compaction.

`buildSessionContext()` reconstructs model messages plus restored model/thinking state.

Native lifecycle: create, open, continue recent, list, list all, branch in-place, fork to new file, clone current branch, import JSONL, export JSONL/HTML.

`AgentSession` persists completed messages on `message_end` internally.

`entry_appended` exposes committed entries to observers.

### Can the consumer supply its own store?

`pi-coding-agent SessionManager`: no storage-backend interface.

Choices are native filesystem JSONL or `SessionManager.inMemory()`.

An external DB/object store cannot be plugged into this class without an adapter that mirrors/imports/exports JSONL or a fork.

`pi-agent-core AgentHarness`: yes.

It consumes `Session`, which consumes the public async `SessionStorage` interface.

`SessionRepo` abstracts create/open/list/delete/fork.

This is the native seam a multi-tenant host should use if it can move from coding-agent `AgentSession` to core `AgentHarness`.

`JsonlSessionStorage` itself is portable because filesystem operations are injected.

`JsonlSessionRepo` can therefore target a virtual, remote, or sandbox filesystem implementation.

### What pi does not store for a host

No tenant/workspace/user ownership policy.

No database row-level authorization.

No durable event-stream cursor log distinct from transcript entries.

No HTTP reconnect token or bounded replay-window protocol.

No client nonce/idempotency ledger.

No durable host lifecycle/lease ownership.

No host-specific attachment object store.

No billing reservation/settlement record.

### Boring-ui overlap

`packages/agent/src/server/harness/pi-coding-agent/sessions.ts` is 1,037 lines around native pi JSONL.

It adds namespace roots, tenant context, summary prefix indexes, native-file wrappers, UI snapshots, attachment handling, and host listing semantics.

The raw parsing, tree reconstruction, message extraction, title extraction, and native-session resume portions overlap pi.

The tenant context, durable-volume placement, wrapper linkage, attachment URLs, and indexed host summaries do not.

The safest reduction is to make pi `Session`/`SessionStorage` canonical and keep a thin host metadata/index repository.

## 4. Events

### Low-level exact surface

```ts
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
```

`Agent.subscribe(listener)` is subscribable and returns unsubscribe.

Listener promises are awaited in registration order.

`agent_end` is emitted before awaited `agent_end` listeners settle; `waitForIdle()` waits for settlement.

### Installed `0.80.7 AgentSessionEvent`

```ts
type AgentSessionEvent =
  | Exclude<AgentEvent, { type: "agent_end" }>
  | { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
  | { type: "agent_settled" }
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | { type: "entry_appended"; entry: SessionEntry }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: ThinkingLevel }
  | { type: "compaction_end"; reason: "manual" | "threshold" | "overflow";
      result: CompactionResult | undefined; aborted: boolean; willRetry: boolean; errorMessage?: string }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };
```

`AgentSession.subscribe(listener): () => void` is synchronous observer delivery over the normalized event stream.

### Is it enough to rebuild a UI transcript?

Yes for one connected process.

Text/reasoning deltas include `contentIndex`, delta, and the full current partial assistant message.

Tool-call start/delta/end is nested in `assistantMessageEvent`.

Tool execution emits start/update/end with call id, tool name, args, partial result, final result, and error flag.

Message end carries the full final message including usage, provider/model, stop reason, error, tool calls, and timestamps.

Turn end carries assistant plus tool-result messages.

Persisted session entries rebuild completed history after restart.

No for a robust reconnect protocol without host work.

Pi event objects do not carry a durable monotonically increasing stream sequence.

Pi does not retain a replay buffer of transient deltas.

Completed messages can be rebuilt; mid-stream deltas lost across disconnect/restart cannot.

JSON mode writes the session header then JSONL events.

RPC mode multiplexes command responses and events over LF-delimited JSON.

Neither supplies at-least-once delivery, acknowledgements, cursor-gap detection, or durable replay retention.

### Boring-ui overlap

`piChatEvents.ts` remaps native events into browser DTOs and adds sequence numbers, stable/fallback ids, dedupe, usage/error synthesis, and UI metadata.

Mapping content shapes overlaps pi; transport sequencing and browser schema do not.

`piChatHistory.ts` reconstructs assistant/tool-result displays already reconstructable from native session messages.

It still adds boring-specific parts, attachment URLs, tool UI metadata, and stable public ids.

`piChatReplayBuffer.ts` is not replaceable by pi because pi has no cursor replay.

## 5. Tools

### Definition and registration

Core tools use `AgentTool` shown above.

Coding-agent extension/custom tools use `ToolDefinition`:

```ts
interface ToolDefinition<P extends TSchema = TSchema, D = unknown, S = any> {
  name: string; label: string; description: string;
  promptSnippet?: string; promptGuidelines?: string[]; parameters: P;
  renderShell?: "default" | "self";
  prepareArguments?: (args: unknown) => Static<P>;
  executionMode?: "sequential" | "parallel";
  execute(toolCallId: string, params: Static<P>, signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<D> | undefined, ctx: ExtensionContext): Promise<AgentToolResult<D>>;
  renderCall?(args, theme, context): Component;
  renderResult?(result, options, theme, context): Component;
}
function defineTool<P extends TSchema, D = unknown, S = any>(tool: ToolDefinition<P,D,S>): ToolDefinition<P,D,S>;
```

Register via `createAgentSession({ customTools })`, `pi.registerTool(tool)`, or direct `Agent.state.tools`/`AgentHarness.setTools()`.

### Built-in tool set

All native names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.

Default enabled: `read`, `bash`, `edit`, `write`.

Read-only factory: `read`, `grep`, `find`, `ls`.

`tools` is an allowlist.

`excludeTools` is a final denylist over built-in, extension, or custom names.

`noTools: "all"` disables all.

`noTools: "builtin"` disables default built-ins while preserving extension/custom tools.

### Built-in input shapes

```ts
type ReadToolInput = { path: string; offset?: number; limit?: number };
type BashToolInput = { command: string; timeout?: number };
type EditToolInput = { path: string; edits: { oldText: string; newText: string }[] };
type WriteToolInput = { path: string; content: string };
type GrepToolInput = { pattern: string; path?: string; glob?: string; ignoreCase?: boolean;
  literal?: boolean; context?: number; limit?: number };
type FindToolInput = { pattern: string; path?: string; limit?: number };
type LsToolInput = { path?: string; limit?: number };
```

### Results, cancellation, progress

All tools return `AgentToolResult<D>` with model-visible text/image content and arbitrary UI/log details.

Failures may throw; the loop converts them to error tool results.

`afterToolCall`/`tool_result` can replace content/details/error and request termination.

The edit tool returns `details.diff`, `details.patch`, and optional `firstChangedLine`.

Read/grep/find/ls/bash details carry truncation metadata.

Default limits are 2,000 lines and 50 KiB.

The execute signal cancels the tool.

`onUpdate(partialResult)` provides arbitrary repeated progress snapshots.

Each update becomes `tool_execution_update`.

Parallel execution is global or per-tool; preparation stays ordered and final tool-result messages retain assistant source order.

`terminate: true` only stops after a batch when every finalized result in that batch requests termination.

### Host operation seams

Read, write, edit, grep, find, ls, and bash all expose operation interfaces.

Those interfaces allow remote filesystem/process implementations without reimplementing schemas, prompts, truncation, eventing, or result conversion.

The coding-agent operation types use Node `Buffer` and `NodeJS.ProcessEnv`; they are server-oriented.

Core `ExecutionEnv` is the portable alternative.

### Boring-ui overlap

`tool-adapter.ts` maps boring tools to native `ToolDefinition`, adds RunContext, telemetry, and error marking.

The wrapper is justified; an alternate execution loop is not.

Remote workspace/sandbox operations are host policy and must remain.

Native definition factories should own schema, progress, cancellation, truncation, and edit patch semantics wherever their operation contracts fit.

## 6. Skills

### Coding-agent discovery

Global roots: `<agentDir>/skills` (normally `~/.pi/agent/skills`) and `~/.agents/skills`.

Project roots after trust: `<cwd>/.pi/skills` and `.agents/skills` from cwd through ancestors to git root, or filesystem root outside git.

Package roots: conventional `skills/` or `package.json.pi.skills` globs.

Settings roots: `skills` array.

CLI roots: repeatable `--skill`; explicit paths remain active with `--no-skills`.

Discovery rule: a directory containing `SKILL.md` is a skill root and recursion stops there.

Otherwise `.pi/skills` and package skill roots may expose direct `.md` children.

`.agents/skills` root `.md` files are ignored; nested `SKILL.md` is used.

Duplicate skill names warn and first discovered wins.

Missing description rejects the skill.

Most other Agent Skills standard violations warn but load.

Pi permits skill name != parent directory.

### Parsing and public API

```ts
interface SkillFrontmatter {
  name?: string; description?: string; "disable-model-invocation"?: boolean;
  [key: string]: unknown;
}
interface Skill {
  name: string; description: string; filePath: string; baseDir: string;
  sourceInfo: SourceInfo; disableModelInvocation: boolean;
}
loadSkillsFromDir({ dir, source }): LoadSkillsResult;
loadSkills({ cwd, agentDir, skillPaths, includeDefaults }): LoadSkillsResult;
formatSkillsForPrompt(skills: Skill[]): string;
parseSkillBlock(text: string): ParsedSkillBlock | null;
```

### Progressive disclosure and activation

Startup reads frontmatter/name/description, not full instructions into context.

`formatSkillsForPrompt()` emits XML metadata for eligible skills.

The model activates a skill by calling `read` on its `SKILL.md`.

Pi does not internally interpret and execute the body as a workflow engine.

Explicit `/skill:<name> [args]` reads/expands full content into the user message.

Arguments append as a user instruction.

`disable-model-invocation: true` hides metadata from the system prompt but preserves explicit slash activation.

`enableSkillCommands` controls slash-command exposure.

Relative references/scripts/assets remain files under `baseDir`; the model loads/runs them through tools.

### Core portable skill API

Core exports analogous `loadSkills(env, dirs)`, `loadSourcedSkills`, `formatSkillInvocation`, and `AgentHarness.skill()`.

Discovery policy remains app-owned when using core.

### Boring-ui overlap

Boring already invokes native `loadSkills` and `DefaultResourceLoader` in `createHarness.ts`.

Any second SKILL.md parser, validation rules, prompt formatter, or `/skill:` expander is redundant.

Hosted disabling of ambient global/project skills is justified to prevent cross-tenant leakage.

Host/plugin catalogs and provisioning remain justified; they should feed explicit paths into native loading.

## 7. MCP

Pi `0.80.7` provides no MCP client, no MCP server config reader, no transport lifecycle, no OAuth wiring, and no tool namespacing policy.

Installed README: “No MCP.”

Installed usage docs: built-in MCP is intentionally excluded.

Search of package code finds no MCP implementation.

The `@modelcontextprotocol/sdk` text in the pnpm peer-resolution suffix is not a pi MCP feature.

MCP can only be added as an extension/package which registers translated tools.

Therefore boring-ui’s MCP client, governed source registry, secret boundary, transport cache, resources, and server implementation are not reimplementations of pi.

Suggested extension tool namespacing is host-defined; pi only requires tool names be unique in the final registry.

## 8. Context and compaction

### Native trigger and defaults

```ts
contextTokens > model.contextWindow - reserveTokens
reserveTokens = 16_384
keepRecentTokens = 20_000
enabled = true
branchSummary.reserveTokens = 16_384
```

Settings surface:

```json
{
  "compaction": { "enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000 },
  "branchSummary": { "reserveTokens": 16384 }
}
```

`AgentSession.setAutoCompactionEnabled(enabled)` persists the flag.

Manual entry: `AgentSession.compact(customInstructions?)` or `/compact [instructions]`.

Cancellation: `abortCompaction()`.

### Algorithm

Use latest valid assistant usage as exact prefix context usage.

Estimate trailing messages using approximately characters/4.

Walk backward until `keepRecentTokens` is accumulated.

Cut only at context-visible user, assistant, bash, custom, or branch-summary entries.

Never split a tool result from its tool call.

If the cut falls inside one long turn, summarize history and the turn prefix separately.

Include previous compaction summary for iterative update.

Track read and modified files cumulatively through summary details.

Append, never overwrite, a `CompactionEntry` with `summary`, `firstKeptEntryId`, `tokensBefore`, optional details, and `fromHook`.

Rebuild context as compaction summary plus retained entries.

On context overflow, auto-compact and retry once.

### Extension hooks

`session_before_compact` can cancel or return a complete custom `CompactionResult`.

`session_compact` observes the committed entry and whether it came from a hook.

`session_before_tree` can cancel or supply a custom branch summary/instructions/label.

`session_tree` reports old/new leaves and summary entry.

### Adequacy

Native compaction is sufficient for ordinary coding sessions and preserves replayable raw history in append-only storage.

It is not a substitute for storage compaction, retention policy, compliance deletion, tenant quotas, or semantic archival.

It assumes a provider/model call is permitted for summarization.

It does not guarantee a summary schema beyond prompting.

Hosts needing deterministic structured state should use the hook and keep the native cut/entry/context machinery.

## 9. Extensions and packages

### Discovery and loading

Auto locations: `<agentDir>/extensions` and trusted `<cwd>/.pi/extensions`.

Configured paths, package manifests, CLI `-e`, and inline factories are additive.

TypeScript/JavaScript modules export an `ExtensionFactory` or compatible default.

Node/development loading uses `jiti/static` via `createJiti`.

Pi aliases bundled `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, and TypeBox modules into the extension loader.

Bun binary mode supplies the same imports as virtual modules.

Loader caching is cwd/generation-aware and cleared on reload.

### Extension API registration surface

```ts
type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
pi.on(eventName, handler): void;
pi.registerTool(tool): void;
pi.registerCommand(name, options): void;
pi.registerShortcut(shortcut, options): void;
pi.registerFlag(name, options): void;
pi.getFlag(name): boolean | string | undefined;
pi.registerMessageRenderer(customType, renderer): void;
pi.registerEntryRenderer(customType, renderer): void;
pi.sendMessage(message, options?): void;
pi.sendUserMessage(content, options?): void;
pi.appendEntry(customType, data?): void;
pi.setSessionName(name): void; pi.getSessionName(): string | undefined;
pi.setLabel(entryId, label): void;
pi.exec(command, args, options?): Promise<ExecResult>;
pi.getActiveTools(): string[]; pi.getAllTools(): ToolInfo[]; pi.setActiveTools(names): void;
pi.getCommands(): SlashCommandInfo[];
pi.setModel(model): Promise<boolean>;
pi.getThinkingLevel(): ThinkingLevel; pi.setThinkingLevel(level): void;
pi.registerProvider(name, config): void; pi.unregisterProvider(name): void;
pi.events: EventBus;
```

Event names: `project_trust`, `resources_discover`, `session_start`, `session_info_changed`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_shutdown`, `session_before_tree`, `session_tree`, `context`, `before_provider_request`, `before_provider_headers`, `after_provider_response`, `before_agent_start`, `agent_start`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `model_select`, `thinking_level_select`, `tool_call`, `tool_result`, `user_bash`, `input`.

### Pi package model

Sources: npm, git, or local path.

Conventional resources: `extensions/`, `skills/`, `prompts/`, `themes/`.

Manifest resources: `package.json.pi.{extensions,skills,prompts,themes}`.

User install roots: `<agentDir>/npm` and `<agentDir>/git`.

Project roots: `.pi/npm` and `.pi/git`, only after trust.

Package filters support globs, exclusions, exact force include/exclude, and per-resource disable.

Project package wins over same global identity, except project `autoload:false` acts as a delta.

### Trust model

Extensions and packages execute arbitrary code with the full OS permissions of the pi process.

Jiti is a loader/transpiler, not a sandbox.

Project trust gates loading project `.pi` resources/settings/packages/extensions and ancestor `.agents/skills`.

Trust is not a tool sandbox and does not constrain code after load.

User/global and explicit CLI extensions participate in `project_trust`; project-local extensions cannot decide their own trust.

The host must isolate the process/container if third-party code is not fully trusted.

### Boring-ui overlap

`pluginLoader.ts` reimplements npm/local discovery and dynamic import for tool-bearing plugins.

For trusted pi-native extensions/packages, `DefaultResourceLoader` and `DefaultPackageManager` can replace it.

For untrusted multi-tenant plugins, native loading is inadequate because arbitrary code has process authority.

Boring’s sandbox/manifest/signature/governance policy remains necessary.

## 10. Steering and follow-up queue

### Native semantics

`steer` queues a user message while a run is active.

It is delivered after the current assistant response and all its tool calls finish, before the next provider request.

It does not preempt a running tool.

`followUp` waits until the agent would otherwise stop: no tool calls and no steering messages.

Queue mode `one-at-a-time` drains the oldest one per drain point.

Queue mode `all` drains the full queue at once.

Default settings for both are `one-at-a-time`.

`Agent.clearSteeringQueue()`, `clearFollowUpQueue()`, `clearAllQueues()`, and `hasQueuedMessages()` are public.

`AgentSession.clearQueue()` clears both and returns display strings.

`AgentSession.getSteeringMessages()` and `getFollowUpMessages()` expose read-only pending strings.

`queue_update` publishes full pending queues after changes.

`prompt(..., { streamingBehavior: "steer" | "followUp" })` is the unified call.

Calling `prompt` while streaming without the behavior throws.

Skill/template commands are expanded before enqueue.

Extension commands cannot be queued; they execute immediately through prompt or error through direct queue methods.

Abort clears native queues at the core harness level and can return cleared messages.

### Missing host semantics

No client nonce.

No client sequence.

No selective removal of one queued follow-up.

No queue persistence guarantee across process restart in coding-agent `AgentSession`.

No per-tenant admission, billing reservation, or deduplication.

### Boring-ui overlap

The basic queue in `piFollowUpQueueCompat.ts` duplicates native pi and should not become an independent scheduler.

Its nonce dedupe and selective cancel are real missing features.

It currently reaches private pi fields to selectively mutate queues; that is version-fragile.

Preferred direction: upstream/public queue-entry ids and selective cancellation, or keep a host admission ledger while treating pi’s public queue as execution authority.

## Reimplementation candidates

| Pi capability | Where boring-ui/host rebuilt it | Pi sufficient? | Delete host version only if |
|---|---|---|---|
| Provider catalog and normalized model shape | custom provider/model registry and config composition | Mostly | host-specific allowlists, secrets, billing aliases, and dynamic provider policy can be expressed through `Models`/provider factories or a thin registry adapter |
| Auth resolution | host key lookup and provider auth branching | Partly | credentials can use injected `CredentialStore`/`AuthContext`; tenant secret isolation and audit remain outside pi |
| Normalized LLM streaming | provider-specific SSE parsing/partial assembly | Yes | host uses `AssistantMessageEventStream` and does not need an unsupported provider protocol |
| Cost/token calculation | local usage normalization | Yes for provider usage | host billing only wraps native `Usage`; reservations, pricing contracts, and durable settlement remain host-owned |
| Agent turn loop | custom loop around prompt/provider/tool cycles | Yes | host can use `Agent`, `AgentHarness`, or `AgentSession` as single execution authority |
| Async lifecycle subscription | custom internal event emitter | Yes | the host accepts pi event ordering and adds only transport mapping |
| UI transcript assembly during a live run | `piChatEvents.ts` content/reasoning/tool state machine | Mostly | public DTO can preserve pi message ids/content indices; host keeps seq, sanitization, and browser naming only |
| Completed transcript rebuild | `piChatHistory.ts` generic pi message parsing | Mostly | native `Session.buildContext`/entries become canonical and a narrow DTO mapper replaces permissive re-parsing |
| Reconnect event replay | `piChatReplayBuffer.ts` | No | pi adds durable event ids/cursors and replay; until then host buffer/store stays |
| Event sequence allocation | `PiChatEventMapper.seq` | No | pi emits stable monotonically increasing durable sequence ids |
| Error/terminal synthesis | mapper fallback from `agent_end` | Mostly | consumer relies on native final assistant error plus `agent_settled`; version-tested event mapping remains thin |
| JSONL transcript format | `sessions.ts` parsing/migration/tree code | Yes | native `SessionManager` or core `SessionStorage` is canonical; host stops separately interpreting the file |
| Filesystem JSONL save/load/resume | `PiSessionStore` low-level storage | Yes for single-user Node | session root can be host durable volume and identity metadata can live beside, not inside a competing store |
| Custom DB/object session backend | host repository | Core yes; coding-agent no | migrate execution to core `AgentHarness` with custom `SessionStorage`/`SessionRepo` |
| In-memory sessions | host ephemeral session map | Yes | no extra tenancy/lifecycle behavior is needed |
| Session branching/tree navigation | host branch reconstruction | Yes | native entry ids are exposed as public navigation ids |
| Fork/clone/import | host file-copy flows | Yes | native runtime replacement can rebuild cwd-bound services and host authorization is checked before call |
| Session listing/search metadata | `PiSessionStore` prefix cache/index | Partly | native list performance/metadata meets scale; otherwise keep only an index, not a second transcript parser |
| Session ownership | `PiSessionIdentityService`, metadata index | No | never delete in a multi-tenant host unless storage itself enforces tenant/user ownership |
| Durable host volume routing | `BORING_AGENT_SESSION_ROOT` logic | No | native store is configured to the mounted host volume and never falls back to container home |
| UI snapshots | custom `ui_snapshot` entries and compaction | No native UI snapshot | UI can derive all state from native transcript and queues, or snapshot is moved to a custom native entry with no parallel file grammar |
| Attachments/object URLs | session attachment handling | No | pi gets an injectable attachment store and safe public URL policy |
| Message ids | fallback id synthesis | Partly | pi entry id is consistently propagated to messages/events/public DTO |
| Native queueing | follow-up/steering scheduler | Yes | host needs only `steer`, `followUp`, modes, `queue_update`, and all-queue clear |
| Nonce dedupe | `piFollowUpQueueCompat` | No | pi exposes idempotency keys or host admission ledger remains |
| Selective queue cancel | private-field compatibility shim | No | pi exposes queue entry ids and `cancelQueued(id)` publicly |
| Tool schemas | host duplicate read/write/edit/bash/grep/find/ls schemas | Yes | built-in operation contracts can bind to workspace/sandbox adapters |
| Tool execution lifecycle | custom tool runner/progress/cancel | Yes | host tools implement `ToolDefinition.execute`/`AgentTool.execute` and return native results |
| Tool telemetry | `tool-adapter.ts` | No, intentionally host | keep thin wrapper around native execution; do not duplicate state machine |
| Workspace path authority | remote workspace tools/operations | No | pi operation seams can accept host `Workspace` without leaking raw paths; otherwise host adapter stays |
| Sandbox routing | Operations adapters | No | native tool execution can be fully delegated through operations/ExecutionEnv |
| Output truncation | local truncation utilities | Yes | product accepts pi’s 2,000-line/50-KiB policy or configures native helpers consistently |
| Edit diff/patch | host diff generation | Yes | use native `details.diff`, `details.patch`, and diff functions |
| Skill frontmatter parsing | any custom SKILL.md parser | Yes | hosted discovery feeds paths into native loader |
| Skill validation | custom name/description rules | Yes | host accepts pi’s lenient Agent Skills behavior or adds policy only as a preflight |
| Skill discovery | workspace/global/package crawlers | Mostly | tenant-safe roots are explicitly selected and ambient global discovery is disabled in hosted mode |
| Progressive disclosure prompt | custom skill catalog prompt | Yes | native `formatSkillsForPrompt`/`AgentHarness.skill` is used |
| `/skill:` activation | custom command expansion | Yes | native AgentSession/AgentHarness owns input expansion |
| Skill provisioning/catalog | workspace provisioning routes | No | package installation, entitlement, versioning, and tenant policy remain host-owned |
| Context file discovery | custom AGENTS.md walk | Yes when desired | host accepts pi discovery; boring may intentionally disable it to compose governed context |
| Prompt templates | custom markdown command loader | Yes | native ResourceLoader is allowed to own the sources |
| Resource reload | custom hot-reload graph | Mostly | all resources are expressible as native paths/packages/factories and host can call `reload()` |
| Compaction trigger | custom threshold calculation | Yes | native settings and usage accounting are authoritative |
| Compaction cut-point logic | custom token walk/split-turn logic | Yes | no application-specific retention rule conflicts |
| Summary generation | custom compaction prompt/call | Yes/Hookable | use native default or return custom result through `session_before_compact` |
| Compaction persistence/replay | custom summary replacement | Yes | native compaction entries stay append-only and raw history is retained |
| Storage retention/compliance | deletion/archival jobs | No | never conflate LLM context compaction with data retention |
| Branch summary | custom abandoned-branch summary | Yes | native tree hooks and summary entries are used |
| Extension event bus/hooks | custom plugin lifecycle dispatcher | Yes for trusted code | plugin executes in same trusted process and native event names cover needs |
| TS extension loader | `pluginLoader.ts` dynamic imports | Yes for trusted pi extensions | package is trusted and arbitrary-code execution is acceptable |
| Plugin sandbox/security | host plugin governance | No | native jiti loader gains real isolation/capability controls; project trust alone is insufficient |
| Package discovery/install/filter | custom npm/local package crawler | Mostly | sources can use `DefaultPackageManager`; enterprise provenance/signature policy remains host-owned |
| Custom provider extension wiring | bespoke provider registration | Yes | `registerProvider` or `Models.setProvider` represents required provider |
| RPC subprocess protocol | custom stdin/stdout harness bridge | Yes | native RPC commands/events meet process isolation needs |
| HTTP/SSE/WebSocket API | host routes | No | pi RPC is not an authenticated multi-tenant network protocol |
| MCP client | boring-mcp transport/discovery/calls | No native capability | cannot delete based on pi `0.80.7` |
| MCP tool namespacing | boring-mcp policy | No | a chosen third-party pi MCP extension exactly matches governance and collision rules |
| MCP server/resources | managed-agent MCP server | No | pi adds the server surface; currently it does not |
| Project trust prompt | host trusted-resource decision | Partly | local-user trust model is appropriate; multi-tenant policy still requires server authorization |
| Retry classification/backoff | custom retry loop | Mostly | native `auto_retry_*`, settings, and provider retry behavior meet SLA; host retains request deadlines/circuit breakers |
| Abort propagation | custom AbortController fan-out | Yes for turn/tools/provider | host maps HTTP disconnect/stop to `AgentSession.abort()` and does not create another execution cancellation model |
| Session replacement runtime | custom cwd/service rebuild | Yes | use `AgentSessionRuntime`; reauthorize target before invoking it |
| Stable host errors | boring error-code layer | No | native errors are not the public multi-tenant API contract |
| Metering/admission | `PiChatMeteringCoordinator` | No | always host-owned unless pi gains transactional quota/billing interfaces |

## Deletion priority

1. Eliminate any second agent/provider/tool loop; make pi `AgentSession` or core `AgentHarness` the sole turn authority.

2. Replace generic JSONL parsing/tree/context reconstruction with native session APIs.

3. Collapse skill parsing, discovery, validation, prompt formatting, and slash activation onto native ResourceLoader/skills APIs.

4. Use native tool definitions/operation seams for schemas, cancellation, progress, truncation, and edit patches.

5. Use native compaction preparation, cut points, summaries, entries, and replay; keep only policy hooks.

6. Use native extension/package discovery only for fully trusted code.

7. Keep host-only tenancy, replay cursors, nonce/idempotency, MCP, workspace authority, secret governance, metering, and durable-volume routing.

## Final assessment

The largest foolish reimplementation is not MCP; pi deliberately has none.

It is rebuilding a second session-aware agent harness around `pi-coding-agent` while ignoring the exported `AgentSession` and, especially, the portable `pi-agent-core AgentHarness` plus `SessionStorage`/`SessionRepo` seams.

Boring-ui’s roughly 5,000 lines across session wrappers, event mapping/replay, plugin loading, follow-up compatibility, and chat history contain both real host requirements and native-pi duplicates.

The deletion target is the duplicated mechanics inside those modules, not the modules wholesale.

A multi-tenant host still needs a boundary adapter.

That adapter should authorize, meter, namespace, persist host metadata, map DTOs, and expose replay cursors.

It should delegate turn execution, transcript semantics, tool lifecycle, queue draining, skills, resource reload, and compaction to pi.

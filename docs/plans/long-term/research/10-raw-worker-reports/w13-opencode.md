# OpenCode v2 tool search and Code Mode: source reconstruction

## Bottom line

OpenCode's official implementation is two ideas joined together. The first is a bounded, deterministic TypeScript catalog. The catalog puts at most 2,000 estimated tokens of full tool signatures in the `execute` tool description. It always retains one short summary per namespace. When the full catalog does not fit, a reserved in-runtime tool named `tools.$codemode.search` searches the omitted signatures. The search is weighted lexical matching over tool paths, descriptions, and input-property names and descriptions. It uses no embeddings. It invokes no LLM. It returns full TypeScript signatures for matching tools, not opaque handles and not JSON Schema. The second idea is a same-process interpreter for a deliberately confined subset of TypeScript/JavaScript. All permitted MCP tools are already installed host-side in an object tree. Search does not materialize a tool into the provider tool list. The next `execute` call simply addresses its existing path in that tree. This does make a large MCP catalog cheap in model context. It does not make the implementation tiny. The verified Code Mode core is at least 4,284 physical source lines before several required schema, value, standard-library, and OpenAPI modules. Adding OpenCode's 291-line integration makes the verified lower bound 4,575 lines. The actual lexical search is simple: roughly 64 lines of scoring and paging. The entire TypeScript interpreter is not simple: its central runtime alone is 3,294 lines. The `MCP.toolsMeta()` premise is not present in the official `anomalyco/opencode` source inspected here. The exact 1.18.16 package manifest depends on `@opencode-ai/codemode`, but official MCP code exposes `MCP.tools()` with complete cached definitions. `MCP.toolsMeta()` appears in a separate third-party fork, `famitzsy8/opencode-tool-search-tool`. That fork must not be used as evidence for the official mechanism. There is also a real docs/source skew. The v2 docs describe per-server `codemode`, default true, and `disabled`. The exact official 1.18.16 source snapshot inspected here still gates Code Mode through the global experimental flag `OPENCODE_EXPERIMENTAL_CODE_MODE`. The source also only places MCP tools inside Code Mode; plugin tools remain provider-native. Claims below distinguish verified source behavior from the v2 documentation contract.

## Source ledger and reproducibility

### Official source actually read

- `anomalyco/opencode`, branch `dev`, `packages/opencode/package.json`.
- The manifest reports version `1.18.16` at line 2.
- It reports package name `opencode` at line 3.
- It depends on workspace package `@opencode-ai/codemode` at line 86.
- `anomalyco/opencode`, branch `dev`, `packages/opencode/src/tool/code-mode.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/opencode/src/tool/registry.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/opencode/src/session/tools.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/opencode/src/mcp/index.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/opencode/src/mcp/catalog.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/opencode/src/runtime-flags.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/codemode/src/codemode.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/codemode/src/tool-runtime.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/codemode/src/tool.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/codemode/src/index.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/codemode/src/interpreter/runtime.ts`.
- `anomalyco/opencode`, branch `dev`, `packages/codemode/README.md`.

Raw source was read through GitHub's raw endpoint via the web reader. The relevant raw URL form was:

```text
https://raw.githubusercontent.com/anomalyco/opencode/dev/<path>
```

The `main` raw Code Mode paths returned no readable snapshot in this environment. The `dev` paths were readable. Direct shell `curl`, `git clone`, and `npm pack opencode-ai@1.18.16` were attempted. They failed because this execution environment could not resolve external hosts. Therefore no claim relies on an unpacked npm tarball. UNVERIFIED: whether the registry name `opencode-ai` maps byte-for-byte to the inspected workspace package artifact. The package version and dependency are source-verified; tarball identity is not.

### Official documentation actually read

- `https://opencode.ai/v2/docs/mcp-servers`
- `https://opencode.ai/v2/docs/config`
- `https://opencode.ai/v2/docs/build`
- `https://opencode.ai/v2/docs/api`
- `https://opencode.ai/v2/docs/agents`
- `https://opencode.ai/v2/docs/plugins`

The pages were read through the web reader's rendered text. The MCP page is the source for documented `disabled`, per-server `codemode`, normalization, and timeouts. The config page is the source for documented default tool-output limits. The build/plugins material is the source for the v2 plugin registration contract. Where that contract differs from 1.18.16 source, this report says so.

### Our source actually read

All our files were read from `origin/main` with `git show origin/main:<path>`. The working tree was not used as evidence and was not modified. The inspected files were:

- `packages/agent/src/server/agent-host/buildAgentComposition.ts`
- `packages/agent/src/server/catalog/mergeTools.ts`
- `packages/agent/src/server/agent-host/mcpGrants.ts`
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts`
- `packages/agent/src/server/mcp/index.ts`
- `packages/agent/src/server/mcp/managedAgentDelegate.ts`
- `packages/agent/src/server/mcp/managedAgentMcpServer.ts`
- `packages/agent/src/server/mcp/shareEntryResources.ts`
- `packages/agent/src/shared/tool.ts`
- `packages/agent/src/shared/tool-ui.ts`
- `packages/agent/src/front/toolRenderers.tsx`
- `packages/agent/src/front/bareToolRenderers/renderers.tsx`

### Third-party source kept separate

The README at `github.com/famitzsy8/opencode-tool-search-tool` describes `MCP.toolsMeta()` and BM25/regex search. That is a fork or add-on, not the official source target. Nothing attributed below to official OpenCode depends on that README.

## 1. Tool search

### There is no provider-level `tool_search` tool

The model receives a single provider-native outer tool named `execute`. Its input is exactly one string field:

```ts
// packages/opencode/src/tool/code-mode.ts:10-18
const CODE_MODE_TOOL_ID = "execute"

export const CodeModeTool = Tool.define(CODE_MODE_TOOL_ID, async () => ({
  description: [
    "Execute TypeScript/JavaScript to orchestrate MCP tools.",
    "Write a short script that calls tools from the provided `tools` object and return the final value.",
  ].join(" "),
  parameters: z.object({ code: z.string() }),
  execute: async () => ({ title: "", metadata: {}, output: "" }),
}))
```

Source: official `dev` source, `packages/opencode/src/tool/code-mode.ts:10-18`. The catalog and search instructions are appended dynamically to that description. The search surface lives inside the interpreted `tools` object. It is therefore called from code, not as a second provider-native tool.

### Exact search signature

The runtime defines the search input and output as follows:

```ts
// packages/codemode/src/tool-runtime.ts:70-97
export interface ToolDescription {
  readonly path: string
  readonly description: string
  readonly signature: string
}

const SearchInput = Schema.Struct({
  query: Schema.optional(Schema.String),
  namespace: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Positive),
  offset: Schema.optional(Schema.NonNegative),
})

const SearchResult = Schema.Struct({
  items: Schema.Array(Schema.Struct({
    path: Schema.String,
    description: Schema.String,
    signature: Schema.String,
  })),
  remaining: Schema.NonNegative,
  next: Schema.NullOr(Schema.Struct({ offset: Schema.NonNegative })),
})
```

Source: official `dev` source, `packages/codemode/src/tool-runtime.ts:70-97`. Rendered to the model, the callable shape is effectively:

```ts
tools.$codemode.search(input: {
  query?: string
  namespace?: string
  limit?: number
  offset?: number
}): Promise<{
  items: Array<{
    path: string
    description: string
    signature: string
  }>
  remaining: number
  next: null | { offset: number }
}>
```

The default result limit is 10. `limit` must be positive. `offset` must be nonnegative. An empty query browses the catalog. An exact tool path acts as exact lookup. `namespace` restricts candidates before scoring.

### Search corpus

The search index keeps one entry per callable leaf. For each entry it stores:

- canonical dot path;
- namespace, which is the first path segment;
- tool description;
- generated full TypeScript signature;
- a lowercase search string.

The lowercase search string concatenates:

- path;
- description;
- input property names;
- input property descriptions.

It does not index output-schema fields separately. It does not index arbitrary server metadata beyond the namespace embedded in the path. It does not embed schemas. It renders the input and output schemas to the `signature` string for display. The generation line is:

```ts
// packages/codemode/src/tool-runtime.ts:307
`${toolExpression(path)}(input: ${inputTypeScript(tool.input)}): Promise<${outputTypeScript(tool.output)}>`
```

Source: official `dev` source, `packages/codemode/src/tool-runtime.ts:292-355`. The index is prepared when `CodeMode.make` constructs a runtime. In OpenCode's integration that runtime is rebuilt for the current visible MCP catalog on each outer execution.

### Search algorithm

Search is deterministic lexical scoring. The verified weights are:

| Match | Weight |
|---|---:|
| exact path or exact path segment | 20 |
| path substring | 8 |
| description substring | 4 |
| input-property name/description substring | 2 |
Source: official `packages/codemode/README.md:348-392` and implementation `tool-runtime.ts:356-419`. The implementation also creates simple singular variants. Results sort by score and then deterministically by path. There is no embedding model. There is no vector database. There is no LLM search turn. There is no BM25 in the official implementation inspected. The BM25/regex claim belongs to the third-party fork noted above.

### When search is offered

The catalog description has a default budget of 2,000 estimated tokens. The estimator is `characters / 4`, not the provider tokenizer. Every namespace and its tool count is always advertised. Complete signatures are then selected under the budget. Selection uses a fair, round-robin strategy favoring cheaper signatures across namespaces. If every signature fits, the internal search tool remains installed but is not advertised in the prompt. If any signatures are omitted, the prompt advertises `tools.$codemode.search` and explains the two-step workflow. The source instructions explicitly tell the model to search in one execution and call the returned path in the next execution. Source: official `tool-runtime.ts:460-603`.

### What the model gets back

Each hit includes `path`, `description`, and `signature`. The signature contains rendered input and output types. It is enough for the model to write a subsequent typed-looking call. It is not an opaque handle. It is not the raw MCP JSON Schema object. It does not mutate the provider's tool definitions. Paging is explicit through `remaining` and `next.offset`.

### How a found tool is called

The tool already exists in the host-side runtime tree. Search only reveals its path and signature. The model emits another `execute` call containing code such as:

```ts
const issues = await tools.github.list_issues({ owner: "acme", repo: "app" })
return issues
```

The interpreter resolves `tools.github.list_issues` against the existing tree. It invokes the associated `SandboxTool.run` closure. It never adds `github_list_issues` to the provider-native tool list. It never exchanges a search handle for a newly materialized schema. It never fetches that schema on demand from the MCP server. This is a dispatcher over an already loaded host catalog.

### Search failure modes

Lexical search can miss vocabulary that is absent from names and descriptions. A poor or generic MCP description directly hurts retrieval. Normalization can make paths less intuitive. A guessed path produces an unknown-tool diagnostic with a suggestion to search. The documented workflow costs at least one extra outer tool round trip when a signature was omitted. The default ten results can bury a relevant low-scoring tool. Paging exists, but the model must choose to use it. The signature output has no verified per-hit byte ceiling. A pathological schema can therefore make one search result large. No source-backed recall, precision, or model success-rate benchmark was found.

## 2. Code Mode

### Model-visible API

At the provider boundary the API is only:

```ts
execute({ code: string })
```

MCP servers become nested members of the interpreted `tools` object. For an MCP server configured as `github` with tool `list_issues`, the generated binding is:

```ts
tools.github.list_issues(
  input: { /* TypeScript rendered from MCP inputSchema */ }
): Promise</* TypeScript rendered from MCP outputSchema, or unknown */>
```

The actual host construction is:

```ts
// packages/opencode/src/tool/code-mode.ts:111-123
out[server] ??= {}
out[server][local] = SandboxTool.make({
  description: item.def.description ?? "",
  input: item.def.inputSchema,
  output: item.def.outputSchema,
  run: (input) => invoke(item, key, input),
})
```

Source: official `packages/opencode/src/tool/code-mode.ts:111-123`. The generated surface uses property access for identifier-safe segments. The renderer can use bracket access where a segment is not identifier-safe. The reserved host namespace is `$codemode`. The internal search call therefore has the literal path `tools.$codemode.search(...)`.

### What JavaScript is supported

The code is parsed with Acorn after TypeScript transpilation. The runtime supports ordinary expressions, variables, functions, conditionals, loops, arrays, objects, async/await, and promises. It supports up to eight concurrent tool calls by default. It deliberately excludes ambient capabilities such as:

- `eval`;
- dynamic or static imports;
- Node modules;
- direct filesystem access;
- direct process access;
- direct network access and `fetch`;
- timers;
- classes.

Source: official `packages/codemode/README.md:393-417` and `interpreter/runtime.ts`.

### Execution location and isolation

Execution is in the same OpenCode process. There is no child process. There is no worker thread in the inspected implementation. There is no OS sandbox boundary. There is no `eval` or `new Function` of model code. `CodeMode.make` returns an interpreter runtime implemented in TypeScript. The interpreter walks an Acorn AST and exposes an allowlisted global scope. That scope contains the `tools` tree and selected safe standard-library values. The security boundary is capability confinement inside the interpreter. Host closures are the only path from interpreted code to MCP effects. The central interpreter implementation is `packages/codemode/src/interpreter/runtime.ts`. Its verified physical length is 3,294 lines. Calling this a “sandbox” is reasonable as a capability model. Calling it process isolation would be incorrect.

### MCP dispatch path

For each nested call OpenCode:

1. allocates a child call ID of the form `<outer-call-id>/<counter>`;
2. records child metadata with status `running`;
3. executes the plugin `tool.execute.before` hook;
4. asks permission using the underlying flattened MCP key;
5. calls `client.callTool` with the original MCP tool name;
6. applies configured timeout, progress, and abort behavior;
7. validates the MCP SDK result envelope;
8. converts `isError` to an interpreter error;
9. executes the plugin `tool.execute.after` hook;
10. records `completed` or `error` child status.
Source: official `packages/opencode/src/tool/code-mode.ts:124-176` and `177-245`. Permissions are therefore not bypassed by the interpreter. The permission identity remains the flattened underlying MCP key.

### Result projection

`projectMcpResult` maps MCP content into interpreter values. If `structuredContent` exists, it wins as the returned value. Text parts are joined. Image, audio, embedded resources, and resource links become outer attachments. If there are only attachments, the interpreted value is a marker indicating files were returned. If there is no useful content, the value is `null`. Source: official `packages/opencode/src/tool/code-mode.ts:68-108`. The final script return value is JSON-stringified unless it is already a string. Interpreter console logs are appended to the outer result. Attachments collected across nested calls are attached to the outer tool result. Child-call status metadata is stored under the outer call's metadata.

### Output bounds

The reusable Code Mode package supports optional limits for:

- execution timeout;
- maximum tool calls;
- maximum output characters;
- maximum interpreter depth;
- maximum concurrent calls.

Its package defaults do not set timeout, maximum calls, or maximum output characters. Its verified structural defaults include maximum depth 32 and concurrency 8. OpenCode's integration does not set a `maxOutputChars` value when it calls `CodeMode.make`. It relies on the outer session abort signal and OpenCode's normal tool-output pipeline. The v2 config docs separately document default output truncation at 2,000 lines and 51,200 bytes. UNVERIFIED: the precise point at which that generic truncation is applied to the `execute` result in this exact source snapshot. Do not confuse the 2,000-token catalog budget with the 2,000-line result limit. They are unrelated controls.

### Error behavior

An MCP result with `isError` becomes an exception inside the interpreted script. The script may catch ordinary tool failures. Unknown paths become `UnknownTool` diagnostics. Bad inputs can become schema diagnostics where a real validating schema is used. The Code Mode README explicitly warns that raw JSON Schemas are render-only in the reusable package. Effect Schemas provide runtime validation. OpenCode passes MCP JSON Schema objects. Therefore TypeScript rendering is verified, but robust input validation at the interpreter boundary is not. The MCP server will still validate or reject malformed arguments. UNVERIFIED: whether another OpenCode layer converts every MCP JSON Schema to a runtime validator before this point. On uncaught failure, OpenCode returns a failed outer `execute` result containing logs and diagnostic suggestions. On abort, it interrupts the runtime race. Nested status becomes `error`, with a string error in metadata. Source: official `code-mode.ts:246-285` and `tool-runtime.ts:630-750`.

## 3. `MCP.toolsMeta()` versus full schemas

### Official API found

No `toolsMeta` symbol exists in the inspected official `packages/opencode/src/mcp/index.ts`. The official interface is materially fuller:

```ts
// packages/opencode/src/mcp/index.ts:145-156
export interface McpTool {
  def: MCPToolDef
  client: Client
  timeout?: number
}
```

`MCP.tools()` returns a record of those objects. `MCPToolDef` includes the full MCP definition, including input and output schemas. The state keeps cached definitions in `State.defs`. `MCP.tools()` combines cached definitions, active clients, and timeout configuration. Source: official `packages/opencode/src/mcp/index.ts:132-156` and `620-640`.

### Loading behavior

`McpCatalog` calls MCP `listTools` with pagination. It caches complete tool definitions. The verified pagination guard permits at most 1,000 pages. The catalog watches the protocol's tool-list-changed notification and refreshes definitions. Source: official `packages/opencode/src/mcp/catalog.ts:13-35` and `135-151`. There is no verified lazy schema fetch after search. All schemas are resident in host memory before the model searches. “Infinite MCPs” therefore means bounded model prompt cost, not bounded host catalog cost.

### Exactly what remains in model context

Under Code Mode, model-visible resident information is:

- the single outer `execute({code})` provider schema;
- fixed Code Mode instructions;
- every namespace name and its tool count;
- a fair selection of complete rendered signatures under a 2,000 estimated-token budget;
- prior search outputs already present in conversation history.

The default initial full-signature budget is 2,000 estimated tokens total, not per server. The estimate is characters divided by four. Namespace summaries grow linearly with the number of servers. The complete tool definitions grow linearly in host memory but not in initial model context. A search response grows with up to ten complete signatures by default. No verified byte cap applies to an individual rendered signature.

### Quantified asymptotics

Let `S` be visible normalized server namespaces. Let `T` be all visible tools. Let `B` be the inline catalog budget, default approximately 2,000 tokens. Let `K` be search page size, default 10. Initial model catalog cost is approximately `O(S) + O(B)`. Host catalog and search-index cost is `O(T + total schema bytes)`. One search result costs `O(K * average rendered signature size)` in tool output/history. Native direct-tool mode costs `O(total descriptions + total provider JSON Schemas)` in each provider request. That is the real context win. It is not schema-on-demand. It is schema-off-prompt with host-resident dispatch.

### Docs/source discrepancy on “meta”

The user-provided known fact names `MCP.toolsMeta()`. That function was not found in official 1.18.16 source. The closest official concept is the prepared `ToolDescription` search index. It contains path, description, generated signature, namespace, and lowercase search text. It is constructed from full `MCP.tools()` entries inside Code Mode. `MCP.toolsMeta()` itself is therefore REFUTED for the inspected official source. If a later unpublished commit adds it, that is UNVERIFIED.

## 4. Grouping and namespacing

### Normalization

The MCP sanitizer is:

```ts
// packages/opencode/src/mcp/catalog.ts:110-112
export function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}
export const toolName = (server: string, tool: string) => `${sanitize(server)}_${sanitize(tool)}`
```

Source: official `packages/opencode/src/mcp/catalog.ts:110-112`. Normalization preserves case. It replaces every character outside ASCII letters, digits, underscore, and hyphen with underscore. In native/direct mode the public tool name is `<normalized-server>_<normalized-tool>`. In Code Mode it is grouped as `tools[normalizedServer][localTool]`. The local tool name is derived by stripping the longest matching normalized server prefix plus underscore from the flattened key. The server-name candidates are sorted longest-first to avoid a shorter prefix taking a longer server's tool. Source: official `packages/opencode/src/tool/code-mode.ts:35-52`.

### Collision behavior

Code Mode prevents an outer provider-name collision between an MCP tool and a built-in tool. The provider only sees `execute`; MCP names live one level down. It does not prevent two configured server names from normalizing to the same string. It does not prevent two tool names within a server from normalizing to the same local key. Assignments into `tree[server][local]` are ordinary object assignments. The later assignment silently replaces the earlier one. The docs warn users to choose server names that remain unique after normalization. The implementation does not enforce that warning. `$codemode` is reserved for host-provided runtime tools. An MCP server normalized to `$codemode` cannot occur through the sanitizer because `$` is replaced with `_`.

### Built-in and plugin collisions

When global Code Mode is enabled in the exact source, native MCP tools are omitted from the outer provider list. That sidesteps MCP-versus-built-in name collisions. When Code Mode is disabled, `SessionTools.resolve` assigns native MCP entries by flattened key after registry tools. That assignment can replace an existing tool with the same key. The inspected registry itself does not implement a strong cross-source collision error. Code Mode changes the namespace at which collisions happen. It does not solve identity design.

## 5. `ToolRegistry.all()` and composition

### Registry contract

The official registry interface exposes:

```ts
// packages/opencode/src/tool/registry.ts:62-78
interface ToolRegistry {
  all(): Promise<Tool.Info[]>
  ids(): Promise<string[]>
  named(name: string): Promise<Tool.Info | undefined>
  tools(model: Provider.Model, agent?: Agent.Info): Promise<Tool.Info[]>
}
```

Source: official `packages/opencode/src/tool/registry.ts:62-78`. The location-scoped registry state loads:

- built-in tool definitions;
- local `.opencode/tool` TypeScript/JavaScript files;
- plugin-provided tool definitions.

`all()` returns `[...builtin, ...custom]`. Source: official `registry.ts:109-190` and `238-245`.

### Per-turn behavior

The loaded registry state is not reconstructed from disk for every model turn. It belongs to OpenCode's instance-state lifecycle. `tools(model, agent)` is evaluated when resolving a model step. It filters model-specific built-ins. It creates the dynamic Code Mode `execute` description. It applies plugin `tool.definition` transformations. Source: official `registry.ts:270-316`. MCP definitions are independently dynamic through the MCP catalog cache and tool-list change notifications.

### Important non-unification

`ToolRegistry.all()` does not include MCP tools in the inspected official source. `SessionTools.resolve` first resolves registry tools. If Code Mode is off, it then appends direct MCP tools from `MCP.tools()`. If Code Mode is on, the `execute` implementation independently reads visible `MCP.tools()` and builds its internal tree. Source: official `packages/opencode/src/session/tools.ts:374-473` and `code-mode.ts:195-245`. Thus there is one common provider tool shape, but not one common registry for all sources. The user's “built-in and plugin tools load via `ToolRegistry.all()`” premise is verified. The stronger claim that MCP is unified inside `ToolRegistry.all()` is refuted.

### Plugin docs versus exact source

The v2 docs describe plugin registration with namespace and `codemode`, default true. The exact 1.18.16 `fromPlugin` path inspected does not place plugin tools inside the Code Mode runtime tree. It converts them into custom provider-native tools. That is a docs/source skew. UNVERIFIED: whether a newer v2-only branch or packaged artifact not readable here implements the documented plugin Code Mode path.

## 6. Claimed and measured cost/benefit

### Source-backed numbers

The only hard context-control number found in official Code Mode source is the 2,000 estimated-token default catalog budget. The estimator is deliberately approximate at four characters per token. Default search page size is 10. Default maximum concurrent tool calls is 8. Default interpreter depth is 32. The v2 config docs state generic tool-output defaults of 2,000 lines and 51,200 bytes. No official benchmark was found giving:

- percent context saved on a named MCP suite;
- retrieval recall;
- successful-call rate before and after Code Mode;
- latency overhead;
- token savings net of search round trips;
- model-specific reliability.

Those metrics are UNVERIFIED.

### Non-official number worth contextualizing

An unrelated proposed MCP-search PR reports roughly 50–80k tokens of manifests for ten MCP servers, or 20–30% of a 256k window. That is contributor-reported motivation, not an official Code Mode measurement. It should not be cited as a verified benchmark for this implementation.

### Benefits established by mechanism

Provider tool-schema context becomes bounded by the one outer schema. The human-readable catalog is approximately bounded by 2,000 tokens plus namespace summaries. Tool orchestration can filter, map, retry, and combine results inside one outer tool call. Intermediate MCP payloads need not all return to the model. Multiple independent calls can run concurrently inside the interpreter. MCP permission checks and hooks remain host-controlled.

### Costs and failures established by mechanism

Search vocabulary mismatch is unavoidable with substring scoring. An omitted signature usually imposes search now, call next. The model can write syntactically invalid code. The model can use an unsupported JavaScript feature. The model can guess the wrong path. The model can send wrong arguments despite a correct rendered signature. Raw JSON Schema validation is weaker than the TypeScript-looking surface suggests. All tool schemas still cost startup/listing time and host memory. Namespace summaries still grow with server count. Broad permission still means broad authority. Silent normalization collisions can route to the wrong tool. One outer call obscures native per-tool observability and UI unless child telemetry is deliberately promoted.

## 7. Line count and implementation complexity

### Verified physical file lengths

Counts below are physical lines reported by the raw-source reader for the inspected `dev` snapshot.

| File | Lines | Role |
|---|---:|---|
| `packages/opencode/src/tool/code-mode.ts` | 291 | OpenCode integration, grouping, permissions, MCP projection |
| `packages/opencode/src/tool/registry.ts` | 421 | built-in/local/plugin registry |
| `packages/opencode/src/session/tools.ts` | 566 | per-step provider tool resolution |
| `packages/opencode/src/mcp/index.ts` | 931 | MCP clients, state, definitions, tool enumeration |
| `packages/opencode/src/mcp/catalog.ts` | 160 | listing, conversion, normalization |
| `packages/codemode/src/index.ts` | 4 | exports |
| `packages/codemode/src/tool.ts` | 91 | sandbox tool abstraction |
| `packages/codemode/src/codemode.ts` | 143 | public Code Mode API and result types |
| `packages/codemode/src/tool-runtime.ts` | 752 | signature rendering, catalog, search, dispatch |
| `packages/codemode/src/interpreter/runtime.ts` | 3,294 | TypeScript/JavaScript interpreter |
The verified reusable Code Mode subtotal is at least:

```text
4 + 91 + 143 + 752 + 3,294 = 4,284 lines
```

With the OpenCode-specific integration:

```text
4,284 + 291 = 4,575 lines
```

This is a lower bound. The package also requires files for tool errors, schema rendering/decoding, runtime values, interpreter models, standard-library objects, and OpenAPI conversion. Those files were visible in the source tree but their raw contents were not all readable in this environment. Their line counts are UNVERIFIED and excluded from the subtotal.

### Simplicity verdict

The discovery strategy is unusually simple. Its essence is a bounded string catalog, a small weighted lexical index, and exact-path dispatch. The scoring/paging implementation occupies approximately `tool-runtime.ts:356-419`, about 64 lines. Catalog selection and model instructions occupy approximately `tool-runtime.ts:460-603`, about 144 lines. That part plausibly deserves the “simplest” label. Code Mode as a whole does not. A 3,294-line AST interpreter plus a custom standard library is substantial security-sensitive infrastructure. The claim is therefore half verified and half refuted:

- verified for catalog/search/dispatch;
- refuted for safe general-purpose code execution.

## Exact 1.18.16 gate versus v2 docs

The v2 MCP docs say per-server `codemode` defaults true. They say `codemode: false` exposes individual tools directly. They say `disabled` replaces the older enable switch. They say direct tools are flattened and Code Mode tools are grouped by normalized server name. Those are documentation-contract facts. The exact source snapshot uses:

```ts
// packages/opencode/src/runtime-flags.ts:8-12,45
const experimental = truthy("OPENCODE_EXPERIMENTAL")
export const experimentalCodeMode = experimental || truthy("OPENCODE_EXPERIMENTAL_CODE_MODE")
```

`SessionTools.resolve` returns before direct MCP injection when that global flag is true. Source: official `packages/opencode/src/session/tools.ts:374-376`. No per-server `codemode` branch was found in the inspected MCP source. The exact runtime default is therefore false unless the global experimental environment switch is set. This conflicts with the v2 docs' per-server default true. The likely explanation is a transition between the published v2 contract and the source snapshot/package wiring. That explanation is an inference, not source proof.

## Comparison with boring-ui-v2 `origin/main`

### Current composition

Our current composition is plain eager concatenation:

```ts
// packages/agent/src/server/agent-host/buildAgentComposition.ts:181
const tools = [...standardTools, ...(runtimeScope.extraTools ?? [])]
```

That resulting array is passed to the harness at lines 229-237. Every included tool is a normal `AgentTool`. Our contract requires name, description, JSON Schema parameters, and an execute function:

```ts
// packages/agent/src/shared/tool.ts:10-20
export interface AgentTool {
  name: string
  description: string
  promptSnippet?: string
  readinessRequirements?: ToolReadinessRequirement[]
  parameters: JSONSchema
  execute(
    params: Record<string, unknown>,
    ctx: ToolExecContext,
  ): Promise<ToolResult>
}
```

There is no catalog handle and no runtime lookup contract.

### Current collision machinery

`mergeTools.ts` is 95 lines. It defines `last-wins` and `error` policies at lines 18-20. It statically inspects standard, extra, and plugin tool lists at lines 48-60. Its last-wins merge deletes then sets a map entry at lines 40-46 so order reflects the winner. It wraps plugin readiness where necessary. It returns a final plain array. It does not provide a runtime caller for a cataloged-but-unmaterialized tool.

### Current MCP grants

`mcpGrants.ts` is 168 lines. Its file contract explicitly says default deny and exact matching at lines 3-8. It rejects glob metacharacters at lines 10-39. `allowedTools` is an exact list at lines 41-47. `resolveAgentMcpGrants` resolves workspace and agent-specific connector grants at lines 109-168. Unknown connectors and ungranted tools are denied. `runtimeCapabilityProjection.ts:255-276` resolves those grants into runtime capability projection. The same file exposes connector IDs and allowed tools in agent description at lines 311-325. This is authorization policy, not context budgeting.

### Current MCP surfaces

The requested `packages/agent/src/server/mcp/**` files have these `origin/main` lengths:

| File | Lines |
|---|---:|
| `mcp/index.ts` | 35 |
| `mcp/managedAgentDelegate.ts` | 932 |
| `mcp/managedAgentMcpServer.ts` | 259 |
| `mcp/shareEntryResources.ts` | 244 |
These are chiefly MCP server/export/delegation surfaces. They are not a general client-side searchable tool catalog. `managedAgentMcpServer.ts:97-173` registers delegation tools individually. It returns structured and text content at lines 220-225. It converts failures into safe MCP errors at lines 243-258.

### Current renderer identity

Our result contract allows arbitrary `details`:

```ts
// packages/agent/src/shared/tool.ts:37-41
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  details?: unknown
}
```

`shared/tool-ui.ts` defines structured UI metadata:

```ts
// packages/agent/src/shared/tool-ui.ts:1-9
export interface ToolUiMetadata {
  rendererId?: string
  displayGroup?: string
  icon?: string
  details?: unknown
}
```

It extracts that metadata from `output.details.ui` at lines 38-49. Renderer selection first uses `part.ui.rendererId`. It next uses `part.toolName`. It finally uses the generic fallback. Source: our `front/bareToolRenderers/renderers.tsx:374-395`. The default direct identity map includes `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`, and `exec_ui` at `front/toolRenderers.tsx:488-498`. This identity pipeline is a product capability OpenCode's current outer-call shape does not preserve.

## a. Can we grant broadly and stay cheap?

### Context answer

Yes, with an OpenCode-style catalog, broadly granted connectors can be cheap in initial model context. Only granted-and-visible tools would enter the host catalog. The model would see one outer dispatcher schema, namespace summaries, and a bounded signature slice. Moving from 100 to 10,000 granted tools would grow host memory and namespace summaries, but not the 2,000-token signature budget. This directly addresses the current coupling between authorization breadth and provider-schema context cost.

### Security answer

No, cheap context does not make broad grants cheap in risk. The dispatcher can still invoke every broadly granted tool. Prompt injection or model error has a larger authority surface. Search makes obscure granted tools discoverable. Our default-deny grants are a useful independent control and should remain default-deny. Context optimization is not a reason to change the security default.

### What we would lose

We would lose immediate provider-native schema selection for omitted tools. We would add a search/call round trip for many tools. We would depend more heavily on MCP names and descriptions. We would make provider tool-use training less directly applicable. We would lose provider-native parallel tool-call objects, though an interpreter can replace them internally. We would make per-tool logging, approval display, tracing, and rendering harder unless child calls become first-class events. We would still pay MCP `listTools`, schema storage, refresh, and connection costs. We would introduce a new high-authority dispatcher whose permission checks must be impossible to bypass.

### Recommended scope

Decouple context visibility from authorization. Keep exact default-deny grants. Build the catalog only from the post-grant set. Allow broader grants only where product policy independently accepts the authority. Do not sell broad grants as safe merely because they are token-cheap.

## b. What happens to our tool UI?

### What OpenCode records

OpenCode exposes one provider-native tool call named `execute`. Nested MCP calls are not separate native session tool parts in the inspected integration. The outer metadata records nested call entries. Each entry contains underlying tool identity, status, and input while running/completed. On error it contains an error string. Nested attachments are aggregated onto the outer result. The child metadata does not retain each child output value. It does not retain each MCP tool's renderer ID. It does not emit our `output.details.ui` shape. Source: official `packages/opencode/src/tool/code-mode.ts:201-245` and `274-285`. UNVERIFIED: OpenCode may have a special frontend renderer for the aggregate metadata elsewhere. That would not change the absence of first-class child outputs in this integration contract.

### What a literal port would do to us

Our `ToolPart.toolName` would be `execute`. `part.ui.rendererId` would be absent unless the outer execute result supplied one. `resolveToolRendererForPart` would therefore select an `execute` renderer if registered or the fallback. The renderer for the underlying tool name would never be selected. All Slack, issue, database, calendar, delegation, and future connector interactions would collapse into one generic code/result presentation. Even a composite renderer could only show status/input with OpenCode's existing metadata. It could not reproduce output-specific rich cards because child outputs are not in the metadata. This is not an acceptable trade for our product as currently designed. Tool UI is not ornamental here. It is how users inspect arguments, progress, failure, provenance, and structured results.

### Minimum contract required to preserve rendering

A Code Mode adoption must emit first-class child lifecycle events. Each child event needs at least:

```ts
interface NestedToolEvent {
  parentCallId: string
  childCallId: string
  canonicalToolId: string
  displayToolName: string
  rendererId?: string
  input: unknown
  status: "running" | "completed" | "error"
  output?: ToolResult
  errorText?: string
  startedAt?: number
  endedAt?: number
}
```

The host catalog must retain `rendererId` beside schemas and execution closures. The dispatcher must emit the `running` event before invocation. It must emit each original `ToolResult`, including `details.ui`, on completion. The session model must store child parts or a lossless nested timeline. The frontend must route each child through the existing renderer resolver. The outer Code Mode card can show code, logs, and a grouped timeline. The nested cards can continue to render by `rendererId` or canonical tool identity. Attachments must remain associated with the producing child, not only the parent. Approvals must name the child tool and arguments. Errors must remain child-scoped even if the script catches them.

### Acceptable adoption modes

A literal OpenCode port is unacceptable for UI-rich tools. A modified Code Mode with lossless child events is acceptable in principle. A hybrid rollout is lower risk:

- keep UI-rich and high-risk tools provider-native;
- put low-UI, read-heavy MCP tools behind searchable dispatch;
- progressively add child-event render support;
- only then move rich tools behind the dispatcher.

Tool search without code execution is even safer for UI. The searched tool can still be invoked through a host dispatcher that emits an ordinary tool part carrying the underlying identity. It does not have to become a generic `execute` card.

## c. Do search or Code Mode solve collisions?

Tool search does not solve collisions. It indexes whatever canonical identity the catalog gives it. If two registrations have already collapsed to one key, search cannot recover the lost one. Code Mode sidesteps collisions with outer built-ins by placing MCPs under a separate object tree. It also makes server grouping legible to the model. It does not solve collisions between normalized server names. It does not solve collisions between normalized local tool names. Official OpenCode silently overwrites on those collisions. Our existing error policy is stronger and should be retained. We should use stable canonical IDs internally, for example connector ID plus exact MCP tool name. The model-facing path can be an alias. Alias collisions should fail catalog construction or receive deterministic disambiguators. The runtime must dispatch by canonical ID, never by re-parsing a lossy display name. Bracket notation means we do not actually need to normalize arbitrary source names into identifiers. For example:

```ts
tools.connectors["github.com/acme"]["issues/list"]({ ... })
```

That is less pretty but collision-free if the exact keys are canonical. A generated safe alias can coexist for common cases.

## Ranked list: what to steal, cost, and breakage

### 1. Steal the bounded catalog and deterministic lexical search

Priority: highest. What to take:

- one summary per namespace;
- a global signature budget;
- fair signature selection across namespaces;
- path/description/input-property lexical index;
- exact lookup, namespace filtering, and paging;
- full rendered signature in search results.

Why: This captures most of the context benefit without requiring an interpreter. Verified upstream complexity is roughly 64 lines for search plus roughly 144 lines for catalog selection/instructions, excluding schema rendering. Estimated local cost: medium, because we need a catalog type, renderer, dispatcher, tests, and session integration. What it breaks:

- omitted tools require discovery;
- weak descriptions hurt recall;
- a search result adds history tokens;
- current `AgentTool[]` composition needs a catalog/dispatcher companion.

Mitigation: Keep top/common/UI-rich tools native and search the long tail.

### 2. Steal host-resident exact-path dispatch, but use canonical IDs

Priority: high. What to take:

- schemas stay host-side;
- search returns a directly callable path;
- the runtime resolves that path to a pre-authorized closure;
- permissions and hooks wrap the closure, not model code.

What to change: Do not use lossy normalized strings as authority identities. Resolve model aliases once to stable connector/tool IDs. Reject alias collisions. Estimated local cost: medium. What it breaks:

- requires a runtime caller absent from `mergeTools.ts`;
- changes tracing and approval plumbing;
- can centralize too much authority if grants are checked only at catalog time.

Mitigation: Recheck the grant at invocation time, as OpenCode rechecks permission on each nested call.

### 3. Add lossless nested child-tool events before adopting Code Mode

Priority: mandatory prerequisite, not optional polish. What to take:

- parent/child call IDs;
- running/completed/error lifecycle;
- nested permission and hook boundaries.

What to improve over OpenCode:

- retain child output;
- retain `details.ui` and `rendererId`;
- retain child attachments;
- persist child parts for replay;
- render child calls through existing renderer resolution.

Estimated local cost: medium to high across server, shared protocol, persistence, and frontend. What it breaks:

- message/event schemas;
- replay compatibility if not versioned;
- aggregate usage accounting if child and parent are double-counted.

Mitigation: Version the nested event envelope and define parent-versus-child accounting explicitly.

### 4. Consider a small declarative orchestration language before the full interpreter

Priority: medium. Possible surface:

```json
{
  "steps": [
    { "id": "a", "tool": "github.list_issues", "input": {} },
    { "id": "b", "tool": "github.get_issue", "mapOver": "$a.items" }
  ],
  "return": "$b"
}
```

This can support sequencing, fan-out, selection, and bounded transforms. It would preserve deterministic resource limits more easily. It would be far smaller than a general AST interpreter. Estimated local cost: medium to high, but materially below cloning Code Mode. What it breaks:

- less expressive than JavaScript;
- model must learn a bespoke plan schema;
- complex transformations may still require model round trips.

### 5. Adopt the full interpreter only for proven orchestration wins

Priority: low until benchmarks exist. What it buys:

- intermediate data stays out of context;
- loops, filtering, mapping, retry, and concurrency;
- one outer provider call can perform a workflow.

Verified upstream lower bound: 4,575 lines including integration, before several required modules. Estimated local cost: high, plus ongoing security review and language-compatibility maintenance. What it breaks:

- provider-native per-tool calls;
- current renderer selection unless child events are added;
- simple mental model for audit logs;
- potentially input validation expectations;
- ordinary JavaScript compatibility at unsupported edges.

Decision gate: Require measured token, latency, success-rate, and UI outcomes on our real MCP mix.

### 6. Do not steal OpenCode's silent collision behavior

Priority: explicit rejection. Keep our `error` option and strengthen it for catalog aliases. Never let normalized aliases select authority silently. Stable canonical IDs should survive display renaming and server normalization.

### 7. Do not weaken default-deny MCP grants

Priority: explicit rejection. Catalog compression permits broad context visibility cheaply. It does not justify broad execution authority. Keep grants exact and agent/workspace scoped. Use the post-grant catalog for search. Recheck on every invocation.

## Proposed architecture for us

Keep `AgentTool` as the executable unit. Add a stable identity and catalog projection without removing the current contract. Conceptually:

```ts
interface CatalogTool {
  canonicalId: string
  namespace: string
  aliasPath: string[]
  name: string
  description: string
  parameters: JSONSchema
  outputSchema?: JSONSchema
  ui?: ToolUiMetadata
  execute(params: unknown, ctx: ToolExecContext): Promise<ToolResult>
}
```

Build it after readiness and MCP grant filtering. Validate exact canonical IDs and alias uniqueness. Partition it into:

- provider-native tools;
- searchable long-tail tools;
- optionally code-orchestratable tools.

Expose a small native `search_tools` tool first. Its result should return canonical callable IDs plus TypeScript-like signatures. For the first iteration, expose a native `call_tool` dispatcher:

```ts
call_tool({ id: string, input: unknown })
```

The dispatcher should create a child `ToolPart` using the underlying tool identity. It should pass through the underlying `ToolResult` unchanged. That preserves `details.ui` immediately. It also lets us test retrieval independently of code generation. Only after that should we consider `execute({code})`. If added, `execute` should call the same dispatcher and emit the same child events. Thus search, dispatch, authorization, UI, and optional interpretation remain separable layers.

## Acceptance tests before shipping

### Catalog and retrieval

- 10,000 granted tools do not expand provider tool schemas linearly.
- Namespace summaries and catalog remain within the configured budget.
- Exact ID lookup is perfect.
- Alias collisions fail closed.
- Search is deterministic across process restarts.
- Paging is stable.
- Singular/plural behavior has tests.
- Malicious descriptions cannot inject executable catalog instructions without delimiting/escaping.

### Authorization

- An ungranted tool never enters search results.
- A revoked grant fails at invocation even if the path remains in conversation history.
- Workspace and agent scope are rechecked at execution.
- Search itself does not reveal ungranted server or tool names.
- Nested approvals identify the actual child tool.
- Script catch blocks cannot suppress the audit record.

### UI and replay

- Each child call selects the same renderer as a direct call.
- `output.details.ui.rendererId` survives dispatch.
- Child attachments remain child-scoped.
- Child progress updates render live.
- Child errors remain visible even when orchestration continues.
- Replaying a session reconstructs child cards without re-execution.
- Unknown renderers use the existing generic fallback.
- Parent and child usage are not double-counted.

### Runtime, if Code Mode is adopted

- wall-clock timeout is mandatory;
- maximum tool calls is mandatory;
- maximum output characters is mandatory;
- concurrency is bounded;
- recursion/interpreter depth is bounded;
- abort interrupts outstanding child calls;
- unsupported syntax gives a useful diagnostic;
- raw JSON Schema arguments are validated before reaching a connector;
- no ambient filesystem, process, module, timer, or network authority exists;
- interpreter escapes receive dedicated security tests.

## Final recommendation

Steal the catalog, lexical search, and host-resident dispatch model now. Do not steal the full interpreter yet. Preserve default-deny grants and apply them before catalog construction and again at dispatch. Treat stable canonical identity as separate from model-facing names. Reject collisions rather than inheriting OpenCode's silent overwrite. Most importantly, make nested child calls lossless first-class UI events. Without that requirement, Code Mode trades away one of our clearest differentiators for context savings. With that requirement, we can get the context benefit while retaining renderer identity, structured results, approvals, progress, and auditability. The simplest first experiment is not `execute({code})`. It is a budgeted `search_tools` plus exact `call_tool` dispatcher over the post-grant catalog. That isolates retrieval quality, quantifies context savings, and preserves our existing rendering contract before we assume the cost and risk of a 4,000-plus-line interpreter.

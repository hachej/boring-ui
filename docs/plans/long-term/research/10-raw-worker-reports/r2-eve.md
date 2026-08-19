# 1. Filesystem convention

## Discovery root and identity

- Analysis target is npm/GitHub release `eve@0.31.3`, published from commit `8e0bd60` on 2026-08-07; launch date was 2026-06-17. [0.31.3 release](https://github.com/vercel/eve/releases/tag/eve%400.31.3) [Launch blog](https://vercel.com/blog/introducing-eve)
- Eve compiles an agent by walking `agent/`; authored identity comes from paths, not a `name` or `id` property. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- Root-agent name is `package.json.name`; if absent, it is the application-root directory name. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- Subagent name is its directory name under `subagents/`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- `agent/tools/get_weather.ts` resolves to tool `get_weather`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- `agent/connections/linear.ts` resolves to connection `linear`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- `agent/skills/summarize.md` resolves to skill `summarize`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- `agent/subagents/researcher/agent.ts` resolves to subagent `researcher`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- Path identity is build-time validation: duplicate/colliding authored names fail discovery rather than receiving runtime renames. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)

## Complete authored tree

| Path | Required export/content | Naming and scope |
|---|---|---|
| `agent/agent.ts` | Default `defineAgent({...})` | Optional for root; required for a declared subagent; runtime configuration. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md) |
| `agent/instructions.md` | Markdown system instructions | Root needs an instruction source; subagent may omit it. [Instructions](https://github.com/vercel/eve/blob/main/docs/instructions.mdx) |
| `agent/instructions.ts` | Default `defineInstructions(...)` or dynamic definition | Alternative flat TypeScript instruction source. [Instructions](https://github.com/vercel/eve/blob/main/docs/instructions.mdx) |
| `agent/instructions/**/*.md` | Markdown fragments | Directory form composes fragments at build time; path ordering is deterministic. [Instructions](https://github.com/vercel/eve/blob/main/docs/instructions.mdx) |
| `agent/instructions/**/*.ts` | Default instruction definition | May be static or `defineDynamic(...)`; runtime resolution is event-scoped. [Dynamic capabilities](https://github.com/vercel/eve/blob/main/docs/guides/dynamic-capabilities.md) |
| `agent/instrumentation.ts` | Default `defineInstrumentation({...})` | Root-only server-startup OTel setup. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md) |
| `agent/channels/<name>.ts` | Default channel definition/factory result | Root-only; basename is channel ID. [Channels](https://github.com/vercel/eve/blob/main/docs/channels/overview.mdx) |
| `agent/connections/<name>.ts` | Default MCP or OpenAPI connection definition | Basename is connection name; generated tools use `<connection>__<tool>`. [Connections](https://github.com/vercel/eve/blob/main/docs/connections/overview.mdx) |
| `agent/hooks/<path>.ts` | Default `defineHook({events:{...}})` | Recursive; `hooks/auth/load-profile.ts` becomes `auth/load-profile`. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md) |
| `agent/skills/<name>.md` | Markdown skill | Flat skill; basename is ID; description may be inferred. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx) |
| `agent/skills/<name>.ts` | Default `defineSkill({...})` or dynamic definition | Module-backed skill; basename is ID. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx) |
| `agent/skills/<name>/SKILL.md` | Agent Skills package manifest/body | Directory name is ID; supporting files remain relative to this file. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx) |
| `agent/skills/<name>/references/**` | Arbitrary reference files | Loaded lazily by skill/model workflow. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx) |
| `agent/skills/<name>/assets/**` | Arbitrary assets | Copied into packaged skill filesystem. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx) |
| `agent/skills/<name>/scripts/**` | Executable/support scripts | Require a real sandbox backend to run. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx) |
| `agent/lib/**` | Ordinary imported code; no special export | Import-only; never mounted into sandbox `/workspace`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md) |
| `agent/sandbox.ts` | Default `defineSandbox({...})` | Flat sandbox configuration. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx) |
| `agent/sandbox/sandbox.ts` | Default `defineSandbox({...})` | Directory form; wins if flat and directory forms both exist. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx) |
| `agent/sandbox/workspace/**` | Seed files; no export | Mirrored to `/workspace/**` at session bootstrap. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md) |
| `agent/tools/<name>.ts` | Default `defineTool({...})`, dynamic tool, or `disableTool()` | Module-only; basename is model-facing name. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx) |
| `agent/schedules/<name>.ts` | Default `defineSchedule({...})` | Root-only; recursive paths supported. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx) |
| `agent/schedules/<name>.md` | Frontmatter `cron:` plus prompt body | Root-only task schedule; path is schedule ID. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx) |
| `agent/subagents/<id>/agent.ts` | Default `defineAgent({description,...})` | Required declaration; description is required. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx) |
| `agent/subagents/<id>/instructions*` | Same forms as root | Optional; does not inherit root instructions. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx) |
| `agent/subagents/<id>/{tools,connections,hooks,skills,sandbox,subagents}/**` | Same contracts as root slots | Own isolated authored surface; nested subagents supported. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx) |
| `agent/extensions/<mount>.ts` | Default extension mount handle | Mount name prefixes contributions as `<mount>__...`. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md) |
| `agent/extensions/<mount>/extension.ts` | Default extension mount handle | Directory form permits same-name overrides beside it. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md) |
| `agent/extensions/<mount>/{tools,connections,skills}/**` | Matching override or `disableTool()` | Consumer override wins within reserved mount namespace. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md) |
| `evals/**/*.eval.ts` | Default `defineEval({...})` | App-root sibling of `agent/`; recursive discovery. [Eval cases](https://github.com/vercel/eve/blob/main/docs/evals/cases.mdx) |
| `evals.config.ts` | Default `defineEvalConfig({...})` | Exactly one app-level eval runner configuration. [Evals](https://github.com/vercel/eve/blob/main/docs/evals/overview.mdx) |

## Root/subagent restrictions

- `channels/`, `schedules/`, and `instrumentation.ts` are root-only. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- Subagents may author `agent.ts`, instructions, tools, connections, hooks, skills, sandbox, and further subagents. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Declared subagents inherit none of the root authored surface. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- A copied-root child created by the built-in `agent` tool is different: it inherits root instructions/tools/connections/hooks/extensions and shares the root sandbox. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- `lib/` never becomes a capability and is never copied into sandbox storage. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- Eve does not mount the whole project tree; only `sandbox/workspace/**` and packaged skill files cross into the sandbox-facing filesystem. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)

## Extension-package convention

- Extension source root is normally `extension/`, with `extension.ts`, `tools/`, `connections/`, `skills/`, `instructions*`, `hooks/`, and `lib/`. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- Extension `extension.ts` default-exports `defineExtension()` or `defineExtension({config: StandardSchema})`; config validation must be synchronous. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- Extensions cannot contribute agent config, sandboxes, schedules, or nested extensions. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- `eve extension build` emits an agent-shaped `dist/extension`, declarations, copied skill assets, exports, and compatibility metadata. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- Package metadata uses `eve.extension.source` and `eve.extension.dist`; runtime compatibility is checked against generated capability metadata, not only the peer range. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- Extension state from `defineState` is automatically scoped to the extension package. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)

# 2. Agent definition

## Declaration

```ts
import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  description: "Research specialist",
  reasoning: "medium",
  compaction: { thresholdPercent: 0.9 },
  limits: {
    maxInputTokensPerSession: 1_000_000,
    maxOutputTokensPerSession: 100_000,
    sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
  },
});
```

- A present `agent.ts` must default-export `defineAgent(...)`; `model` is required when the file exists. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- Root `agent.ts` may be omitted; a declared subagent must have it. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- Current `main` docs say omitted root config defaults to `anthropic/claude-sonnet-5`; the exact 0.31.3 default is **UNVERIFIED** because tagged source was inaccessible and current docs postdate the release. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- `description` is optional for root and required for declared subagents. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)

## Model surface

- `model` accepts a Vercel AI Gateway model-ID string or an AI SDK `LanguageModel` object. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- String IDs require Vercel project OIDC on Vercel or `AI_GATEWAY_API_KEY` elsewhere. [Deployment overview](https://github.com/vercel/eve/blob/main/docs/guides/deployment/overview.md)
- Direct provider objects require the provider's AI SDK package and credentials. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- `modelOptions` supplies provider-specific options. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- `reasoning` accepts `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- Dynamic selection uses `defineDynamic({fallback, events})`. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- Dynamic model events are `session.started`, `turn.started`, and `step.started`; precedence is step, then turn, then session, then fallback. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- A resolver returns a model string or `{model, modelContextWindowTokens?, modelOptions?}`. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- Live `LanguageModel` objects are allowed only at step scope; session/turn choices must serialize as strings. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- Resolver failure is logged and leaves that scope unset rather than terminating model selection. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)

## Context and limits

- Instructions come from `instructions.md`, `instructions.ts`, or composed `instructions/` fragments, not an inline config string. [Instructions](https://github.com/vercel/eve/blob/main/docs/instructions.mdx)
- `compaction.thresholdPercent` defaults to `0.9`. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- `limits.sessionTimeoutMs` defaults to 30 days; `false` disables the deadline. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- At timeout Eve lets an active turn settle, emits `session.completed`, releases channel continuation, and does not delete stored data. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- `maxInputTokensPerSession` and `maxOutputTokensPerSession` are cumulative session budgets checked after a provider call, so one call can exceed the nominal cap. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)
- `build.externalDependencies` keeps selected packages external for native/runtime dependencies. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- `experimental.workflow.world` selects a Workflow world package. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Other exact 0.31.3 `build` and `experimental` keys are **UNVERIFIED**. [Agent config](https://github.com/vercel/eve/blob/main/docs/agent-config.md)

# 3. Tools

## Signature

```ts
defineTool({
  description: string,
  inputSchema: StandardSchema | JSONSchema,
  outputSchema?: StandardSchema | JSONSchema,
  approval?: ApprovalPolicy,
  execute(input, ctx): Output | Promise<Output> | AsyncGenerator<Output>,
  toModelOutput?: (output) => ToolModelOutput,
});
```

- Tool files default-export `defineTool`; filename is the model-facing slug. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- `inputSchema` is required; use `z.object({})` for no arguments. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Schemas may be Zod, any Standard Schema implementation, or JSON Schema; Eve is not Zod-only. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Optional `outputSchema` uses the same schema families. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Outputs must be JSON-serializable; convert `Date`, `Map`, `Set`, `NaN`, and cyclic values explicitly. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)

## Execution and errors

- Authored tool code runs in the trusted app runtime with full process environment access, not inside the agent sandbox. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Shell/file built-ins execute in app code but proxy effects into the sandbox. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- `ctx` includes session context, `callId`, `toolName`, `abortSignal`, `getSandbox()`, `getSkill()`, `getToken()`, and `requireAuth()`. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- A thrown tool error becomes an error result visible to the model; the exact 0.31.3 error normalization/code mapping is **UNVERIFIED**. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Completed durable steps are journaled and not executed again after recovery. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- A tool interrupted inside an uncommitted step may execute again; side effects therefore require idempotency keys or approval. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- `disableTool()` in a matching slot removes a built-in; an unknown target fails discovery. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- A same-slug authored tool overrides the framework default. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)

## Streaming/progress

- `execute` may be an async generator; each `yield` is a complete snapshot, not a delta. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Each yield emits `action.partial`; a later partial for the same `callId` replaces the prior snapshot. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- The runtime may coalesce adjacent partials and retain only the newest snapshot for that call. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Only the generator's final value becomes `action.result` and enters model history/`toModelOutput`. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- A retried uncommitted step can replay overlapping partial sequences with new event IDs. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Provider tool progress and MCP progress notifications are not projected as `action.partial`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)

## Model projection and cancellation

- `toModelOutput` can return text, JSON, or content via `toolOutput`/`toolOutputPart`. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- File content must be base64; payloads above 3 MiB produce a warning. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Tool payloads remain in persisted model history until compaction; compaction replaces file data with a stub. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- Cancellation is cooperative through `ctx.abortSignal`; sandbox calls are automatically bound to it. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- `POST .../cancel` durably queues cancellation, recursively requests child cancellation, and confirms actual settlement only through `turn.cancelled` then `session.waiting`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)

## Framework tool set

| Built-in | Availability and boundary |
|---|---|
| `bash` | Shell inside sandbox. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `read_file` | Line-numbered sandbox text read; participates in read-before-write checks. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `write_file` | Complete sandbox-file write with stale-read detection. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `glob` | Sandbox path glob. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `grep` | Sandbox regex content search. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `web_fetch` | URL fetch in trusted app runtime, not sandbox. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `web_search` | Provider-managed search; present only for supported model providers. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `todo` | Durable per-session todo state in app runtime. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `ask_question` | Durable user-input pause; only when channel/session can request input. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `agent` | Root-only copied-agent delegation. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `load_skill` | Present only when skills exist; adds selected instructions. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |
| `connection_search` | Present only when connections exist; discovers qualified remote tools. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md) |

- Importable wrappers in `eve/tools/defaults` include `bash`, `readFile`, `writeFile`, `glob`, `grep`, `webFetch`, `webSearch`, `todo`, and `loadSkill`. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- The advertised built-in set is resolved per agent/session rather than being unconditional. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- `web_search` has no local executor; overriding its slug supplies an authored implementation. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)

# 4. Skills

- Eve skills follow the Agent Skills format and are intended to port from agentskills.io-compatible packages unchanged. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Progressive disclosure advertises only skill name/description initially. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- The model invokes built-in `load_skill`; Eve then adds the full skill body to context. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- Loading a skill adds instructions, not execution authority; scripts still depend on already-available sandbox/tools. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- Flat Markdown skills may omit description; Eve infers the first nonempty, non-code line and strips leading `#`, `>`, `*`, or `-`. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- If inference fails, description becomes `Instructions for the <name> skill.` [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Directory skills require `<name>/SKILL.md` with description frontmatter. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Recognized frontmatter includes description, optional license, and string metadata; other fields are no-ops. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- TypeScript form is `defineSkill({description, markdown, files})`; Eve generates the package `SKILL.md`. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- `references/`, `assets/`, and `scripts/` are supporting files relative to `SKILL.md`. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Static instruction-only skills do not need a sandbox; dynamic skills and supporting-file access do. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Runtime skill files are materialized under `$HOME/.agents/skills/<skill>/`; fallback is `/workspace/skills/<skill>/`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- `ctx.getSkill(identifier).file(path).text()` performs lazy supporting-file reads. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Skills are scoped to one agent; Eve documents no root-to-subagent shared-skill namespace. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Dynamic skills use `defineDynamic` and may resolve by auth/session/event context. [Dynamic capabilities](https://github.com/vercel/eve/blob/main/docs/guides/dynamic-capabilities.md)

# 5. MCP

## Outbound client

```ts
export default defineMcpClientConnection({
  url: "https://mcp.example.com/mcp",
  description: "Service tools",
  auth?,
  headers?,
  tools?: { allow: string[] } | { block: string[] },
  approval?,
  toolCall?: { providedArguments?: (...) => Record<string, unknown> },
});
```

- Eve is an outbound MCP client; documented transports are remote Streamable HTTP and SSE. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- No stdio MCP transport is documented. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- Remote tools are qualified `<connection>__<tool>` and discovered on demand through `connection_search`. [Connections](https://github.com/vercel/eve/blob/main/docs/connections/overview.mdx)
- A filter must use exactly one of `tools.allow` or `tools.block`. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- 0.31.3 added `toolCall.providedArguments`: application-owned keys are removed from the model schema, resolved before execution, and override model values. [0.31.3 release](https://github.com/vercel/eve/releases/tag/eve%400.31.3)
- Approval evaluates only model-authored arguments, before provided arguments and authentication. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)

## Authentication

- Public/local MCP can omit `auth`; authenticated connections accept noninteractive or interactive authorization definitions. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- Noninteractive `getToken` returns `{token, expiresAt?}` and is cached per Workflow step. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- Default principal scope is application; `principalType: "user"` requires an authenticated user principal. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Static or async `headers` may use runtime context. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- `@vercel/connect/eve` supplies user- or app-scoped OAuth with encrypted token storage and refresh outside Eve history. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- User OAuth emits `authorization.required`, parks without compute, and resumes through a durable callback. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- Self-hosters can implement `defineInteractiveAuthorization({getToken,startAuthorization,completeAuthorization})`. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- Interactive challenges may contain `url`, `userCode`, `expiresAt`, `instructions`, and display name. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Failure classes include `ConnectionAuthorizationRequiredError` and `ConnectionAuthorizationFailedError`; the latter carries `reason` and `retryable` (default true). [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- Approval state survives an OAuth park; approval happens before sign-in. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)

## Inbound/server support

- No inbound MCP server factory appears in documented public APIs; Eve's default HTTP API is not MCP. [TypeScript API](https://github.com/vercel/eve/blob/main/docs/reference/typescript-api.md)
- No built-in MCP server route is documented under `/eve/`. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Source-wide absence of an undocumented inbound MCP server is **UNVERIFIED** because the exact 0.31.3 package archive could not be fetched in this environment. [0.31.3 package](https://github.com/vercel/eve/blob/eve%400.31.3/packages/eve/package.json)

# 6. Durability

## Unit of durability

- Session contains turns; turn contains model/tool steps. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- Each turn is a durable Workflow run. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- A step is the checkpoint boundary encompassing model generation and requested tool work. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- Completed steps are journaled with their result and never re-execute during replay. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- An interrupted/uncommitted step re-executes from its step input. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Eve runs each durable step up to four total attempts. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Retry restores `turnId`, `stepIndex`, and `sequence`, but new attempt events receive new event IDs. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- No stream field identifies which attempt ultimately committed. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Durable model history keeps only the completed attempt; event stream keeps emissions from abandoned and completed attempts. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md)

## Submission and settlement contract

- `POST /eve/v1/session` accepts a first message and immediately returns durable `sessionId` in JSON and `x-eve-session-id`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- A follow-up posts to `/eve/v1/session/:sessionId`; the ID is fixed and never follows/creates a replacement. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- The authoritative settlement boundary is stream lifecycle: `turn.completed`, `turn.failed`, or `turn.cancelled`; resumable state follows as `session.waiting`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- A terminal session emits `session.completed` or `session.failed`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Cancellation HTTP `202 accepted` means only that the request was durably queued, not that cancellation settled. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- `200 no_active_turn` covers unknown, terminal, or absent active work. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- While approval is pending, unrelated text is held and replayed after approval rather than implicitly denying. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Multiple concurrent deliveries can coalesce best-effort; Eve advises one follow-up at a time and waiting for `session.waiting`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- There is no documented exactly-once external side-effect guarantee; authored actions/hooks must be idempotent. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md)
- Hooks are at-least-once across retried steps. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md)

## Crash survival

- Committed step results, durable conversation history, session state, pending HITL/auth waits, stream events, and session identity survive a process crash when the Workflow world storage survives. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- Partial output already written to the event stream survives even when its attempt later retries. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Uncommitted local variables and in-flight tool side effects do not receive rollback; the step body may rerun. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- Parked HITL/OAuth work consumes no compute and survives process restart. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
- Sandbox filesystem survival is backend-specific, not part of the Workflow commit guarantee. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)

## Storage and adapter

- Local default Workflow state is `.eve/.workflow-data`; it must be on persistent storage to survive container replacement. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Vercel deployment uses Vercel Workflow with optimistic replay preconditions. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)
- Self-hosting can select `experimental.workflow.world: "@scope/package"`. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- The package must default-export a factory or export `createWorld()`. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- The world backs run state, queues, hooks, and streams; Eve rejects an incompatible `@workflow/*` protocol line. [Execution model](https://github.com/vercel/eve/blob/main/docs/concepts/execution-model-and-durability.mdx)
- 0.31.3's documented Workflow line is `5.0.0-beta`. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- There is no smaller Eve-specific persistence adapter resembling CRUD session storage; portability is through the broader Workflow World contract. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)

# 7. Sandboxing

## Boundary and providers

- Eve creates one sandbox per agent session, exposing bash and a `/workspace` filesystem. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Authored tools remain trusted app-runtime code outside the sandbox; only shell/file effects proxy into it. [Tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx)
- On Vercel, `defaultBackend()` selects Vercel Sandbox. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)
- Vercel Sandbox uses Firecracker microVMs with an isolated filesystem and network. [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)
- Vercel's image is Amazon Linux 2023 and commands run as the sandbox user. [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)
- Local selection order is Docker, microsandbox, then just-bash when available. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- `docker()` is a container boundary, not a microVM; default image is `ghcr.io/vercel/eve:latest`. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- `microsandbox()` is a lightweight VM backend with snapshot-backed instances. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- `justbash()` is a JavaScript simulation with virtual files: no daemon, real binaries, or network isolation. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Therefore “isolated VMs by default” is true for hosted Vercel, but not universally true for self-host/local fallback. [Deployment overview](https://github.com/vercel/eve/blob/main/docs/guides/deployment/overview.md)

## API and filesystem

- Sandbox context supports `run`, `spawn`, text/binary/stream file I/O, path removal/resolution, and network policy updates. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Spawned processes expose byte-stream stdout/stderr, `wait()`, and idempotent `kill()`. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Seed files from `agent/sandbox/workspace/**` appear under `/workspace/**`. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- Skills materialize separately under `$HOME/.agents/skills`, with `/workspace/skills` fallback. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- `justbash` persists its virtual filesystem in `.eve/sandbox-cache/`. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Docker uses a long-lived per-session container; Vercel/microsandbox may reattach backend state. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)

## Lifecycle

- `bootstrap()` builds/prewarms a template once; `onSession()` runs once for a new or replaced session sandbox. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- `revalidationKey` forces replacement when authored seed/setup semantics change. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- On Vercel, default inactivity teardown is 30 minutes; filesystem can persist and restart for the session. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Server shutdown stops compute; later reattachment depends on backend support. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Custom backend contract is `{name, create, prewarm?}` returning session operations plus `shutdown()`. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)

## Network and credentials

- Default network policy is allow-all. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Deny-all also blocks DNS; policies may allow domains/subnets. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Vercel and microsandbox support domain allowlists and a credential broker; Docker supports allow/deny but not brokered injection. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- `justbash` rejects network-policy operations because it has no real network boundary. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Brokered credentials are inserted at the firewall/proxy boundary and need not exist inside the VM filesystem/environment. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Framework bootstrap may briefly egress before authored factory policy is fully applied. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)

## Cost

- Current Vercel list pricing is $0.128/vCPU-hour active CPU, $0.0212/GB-hour provisioned memory, $0.60/million creations, $0.15/GB network, and $0.08/GB-month snapshots. [Vercel pricing](https://vercel.com/pricing)
- CPU is billed while executing; provisioned memory is billed for session wall time in one-minute increments. [Vercel Sandbox pricing](https://vercel.com/docs/vercel-sandbox/pricing)
- Non-Vercel backends incur operator infrastructure costs; Eve documents no separate sandbox meter. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)

# 8. Human-in-the-loop approvals

- Tool `approval` policies are `never()` (default), `once()` (first use per session), `always()` (every call), or an async custom function. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
- Approval context is `{session, toolName, toolInput, approvedTools, callId}`. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
- Policy result is `user-approval`, `not-applicable`, `approved`, `denied`, `{type:"approved"|"denied",reason}`, or legacy boolean. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
- Approval runs after schema validation and before executor/provider authentication. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- A denied call never executes; its reason is returned to the model. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
- Required approval emits `input.requested` with structured requests, then `session.waiting`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Clients answer with structured `inputResponses` keyed by `requestId`, or a matching textual approve/deny reply. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
- Stale approval responses become ordinary user messages and never authorize the old call. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Built-in `ask_question` uses `{prompt, options?, allowFreeform?}` and has no executor. [Harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- Approval and question pauses are durably journaled; no in-memory process must remain alive. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
- Native channel buttons/selects render provider-specific controls where supported. [Channels](https://github.com/vercel/eve/blob/main/docs/channels/overview.mdx)
- Approval is a gate, not resource authorization; executors must still enforce tenant/resource permissions. [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md)

# 9. Subagents

## Copied-root delegation

- Root sessions receive built-in `agent`; child input is `{message, outputSchema?}` plus experimental `agentId?`. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Child receives no parent conversation history; the delegation message must carry all context. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- It inherits root instructions, tools, connections, auth, hooks, extensions, and shares the same sandbox. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- It starts with fresh state and history. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- It cannot call built-in `agent` or Workflow tools. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Multiple `agent` calls requested in one model response run concurrently. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Shared-sandbox writes become immediately visible, so parallel children must avoid overlapping files. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)

## Declared specialists

- `subagents/<id>/agent.ts` requires `description`; its ID is directory-derived. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Each declared subagent has its own instructions/capabilities/state/history and its own sandbox. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Declared subagents inherit nothing from root and cannot use root-only channels/schedules/instrumentation. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- The parent sees each declared specialist as a bare tool with the same delegation input shape. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Tool/subagent name collisions fail compilation. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Nested declared subagents are supported; no separate depth limit is documented. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)

## Durable child work

- Each child has its own durable session and event stream. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Parent emits `subagent.called` with `childSessionId` and `subagent.completed` on success. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- A client attaches to the child stream for detailed progress; parent only exposes boundary events. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- HITL and auth challenges are proxied through parent coordination while child state remains isolated. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Parent cancellation recursively requests cancellation of adopted descendants. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Cancelled child emits its own cancellation boundary; parent emits no synthetic completion result. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Transient child model failures get up to three fresh model-call attempts for the current uncommitted call; other recoverable errors use Workflow step retry. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Experimental persistent child sessions park and resume via `agentId`; errors include `AGENT_MISMATCH` and `AGENT_BUSY`. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Persistent handles are scoped to parent lifetime; remote parked-child teardown is a documented gap. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)

# 10. Channels

## Common model

- Channel adapters normalize inbound events, map a platform address to the current durable session, and deliver outbound responses. [Channels](https://github.com/vercel/eve/blob/main/docs/channels/overview.mdx)
- Platform continuation tokens remain channel-local and are never accepted/returned by the ID-addressed Eve HTTP API. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Root channel files default-export a channel definition; filename is channel ID. [Channels](https://github.com/vercel/eve/blob/main/docs/channels/overview.mdx)

| Provider | Inbound/session mapping | Verification and outbound |
|---|---|---|
| Eve HTTP/web | Explicit `sessionId`; create then ID-addressed follow-ups | Ordered route auth; NDJSON output. [Eve channel](https://github.com/vercel/eve/blob/main/docs/channels/eve.mdx) |
| Slack | Mentions/DMs; Slack thread anchors a session | Connect verifies webhook and supplies bot token; thread replies and native controls. [Slack](https://github.com/vercel/eve/blob/main/docs/channels/slack.mdx) |
| Discord | Interactions, commands, components, modals | Signature verification; acknowledges within 3 seconds then continues in background. [Discord](https://github.com/vercel/eve/blob/main/docs/channels/discord.mdx) |
| Microsoft Teams | Bot Framework Activity conversation | Verifies Bot Connector JWT; replies via Connector API/Adaptive Cards. [Teams](https://github.com/vercel/eve/blob/main/docs/channels/teams.mdx) |
| Telegram | Private or addressed group message; chat plus forum topic | Secret-header verification; inline keyboard; `sendMessage`; splits at 4,096 chars. [Telegram](https://github.com/vercel/eve/blob/main/docs/channels/telegram.mdx) |
| Twilio | `From:To` address; SMS and speech transcript share session | Validates `X-Twilio-Signature`; `allowFrom` required; no native HITL; sends SMS. [Twilio](https://github.com/vercel/eve/blob/main/docs/channels/twilio.mdx) |
| GitHub | Issue/PR/review comment invocation token | GitHub App signature/token via Connect; native comment replies and repository context. [GitHub](https://github.com/vercel/eve/blob/main/docs/channels/github.mdx) |
| Linear | Linear Agent Session | `/eve/v1/linear`; Connect webhook verification; native activities. [Linear](https://github.com/vercel/eve/blob/main/docs/channels/linear.mdx) |
| Photon/iMessage | Same iMessage conversation | `/eve/v1/photon`; same-project Vercel OIDC by default; new message steers/cancels active turn. [Photon](https://github.com/vercel/eve/blob/main/docs/channels/photon.mdx) |
| Chat SDK | Adapter/state-store-defined thread address | Application adapter owns verification/auth/delivery; Eve owns session, stream, HITL. [Chat SDK](https://github.com/vercel/eve/blob/main/docs/channels/chat-sdk.mdx) |
| Custom | `defineChannel` address and continuation logic | Author owns routes, verification, durable state projection, and reply transport. [Custom channel](https://github.com/vercel/eve/blob/main/docs/channels/custom.mdx) |

- Built-in human-addressed channels attach a user principal for sender by default. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Channel verification authenticates the platform request; application membership/resource authorization remains application-owned. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)

# 11. Schedules

```ts
interface ScheduleDefinition {
  cron: string;
  markdown?: string;
  run?: (args: ScheduleHandlerArgs) => Promise<void> | void;
}
interface ScheduleHandlerArgs {
  to: ScheduleToFn;
  waitUntil: (task: Promise<unknown>) => void;
  appAuth: SessionAuthContext;
}
```

- Exactly one of `markdown` or `run` is allowed. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Markdown form uses `cron:` frontmatter plus prompt body. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Cron uses standard five fields with minute granularity; Vercel evaluates in UTC. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Schedule names derive from recursive paths; schedules are root-only. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Task-mode markdown starts an app-principal agent turn, discards final output, and cannot park for HITL/OAuth. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Handler mode can call `to(...).send(...)`, extend lifetime with `waitUntil`, and use `appAuth`. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- A channel delivery created by a handler may park because it has a channel continuation surface. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- `eve dev` does not fire cron automatically; dev-only unauthenticated `POST /eve/v1/dev/schedules/:id` triggers one. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Vercel build emits Build Output cron configuration; self-host `eve start` starts Nitro scheduling. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Vercel Cron does not retry failed invocations, can overlap slow runs, and may deliver duplicate events; idempotency/locking is application-owned. [Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- Eve documents no missed-fire catch-up guarantee: **UNVERIFIED** for both hosted and Nitro runners. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Eve documents no overlap lock or singleton schedule option. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- Hobby timing may be hourly-imprecise; Pro/Enterprise support per-minute schedules. [Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)

# 12. Evals/testing

## Definition and runner

```ts
export default defineEval({
  description?, judge?, tags?, metadata?, timeoutMs?, reporters?,
  async test(t) { /* drive HTTP agent and assert */ },
});
```

- Evals run against a real HTTP server/target through the same session surface as users. [Evals](https://github.com/vercel/eve/blob/main/docs/evals/overview.mdx)
- `test(t)` is the only required case field. [Eval cases](https://github.com/vercel/eve/blob/main/docs/evals/cases.mdx)
- Default concurrency is 8. [Running evals](https://github.com/vercel/eve/blob/main/docs/evals/running.mdx)
- `mockModel` provides deterministic scripted model behavior. [Eval targets](https://github.com/vercel/eve/blob/main/docs/evals/targets.mdx)
- Targets may be local or remote Eve deployments. [Eval targets](https://github.com/vercel/eve/blob/main/docs/evals/targets.mdx)

## Built-in assertions

- Lifecycle: `succeeded`, `parked`. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Text/result: `messageIncludes`, `outputEquals`, `outputMatches`. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Tools: `calledTool`, `notCalledTool`, `toolOrder`, `usedNoTools`, `maxToolCalls`, `noFailedActions`. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Skills/subagents: `loadedSkill`, `calledSubagent`. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Events: `event`, `notEvent`, `eventOrder`, `eventsSatisfy`. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Generic checks: `includes`, `equals`, `matches`, `similarity`, `satisfies`. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Lifecycle matchers can select `completed` (default), `pending`, `failed`, or `rejected`, plus exact count/predicate. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Judge helpers include factuality, summary quality, closed QA, and SQL evaluation from `autoevals`. [Judge](https://github.com/vercel/eve/blob/main/docs/evals/judge.mdx)
- Gate assertions fail normally; soft assertions fail the process only in strict mode. [Assertions](https://github.com/vercel/eve/blob/main/docs/evals/assertions.mdx)
- Exit codes are 0 pass, 1 eval failure, 2 runner/configuration error. [Running evals](https://github.com/vercel/eve/blob/main/docs/evals/running.mdx)
- Artifacts land in `.eve/evals/<timestamp>/`: `summary.json`, `results.jsonl`, and per-eval events/logs. [Running evals](https://github.com/vercel/eve/blob/main/docs/evals/running.mdx)
- Reporters include console/default, JUnit, and Braintrust integrations. [Reporters](https://github.com/vercel/eve/blob/main/docs/evals/reporters.mdx)

# 13. Deployment & runtime

## Portable core

- Filesystem agent configuration, model/provider objects, tools, skills, hooks, channels, HTTP protocol, and Workflow-world selection are portable Node application concepts. [Deployment overview](https://github.com/vercel/eve/blob/main/docs/guides/deployment/overview.md)
- Runtime requires Node 24 or newer. [Extensions package example](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- `eve build` always writes `.eve/` compiler artifacts. [Deployment overview](https://github.com/vercel/eve/blob/main/docs/guides/deployment/overview.md)
- Non-Vercel builds emit a Nitro Node server under `.output/`; start with `eve start --host ...`. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Reverse proxies must forward `/eve/` and `/.well-known/workflow/`; omitting callbacks starts then stalls runs. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Self-hosters own TLS, scaling, restart policy, log collection, durable volume, scheduler, Workflow world, and sandbox backend. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Frontends may be Next.js, Nuxt, SvelteKit, or independent clients; Eve is frontend-agnostic. [Deployment overview](https://github.com/vercel/eve/blob/main/docs/guides/deployment/overview.md)

## Vercel-managed path

- Vercel builds emit `.vercel/output`. [Deployment overview](https://github.com/vercel/eve/blob/main/docs/guides/deployment/overview.md)
- `eve deploy` installs dependencies, runs `vercel deploy --prod`, then pulls environment. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)
- Hosted services are web runtime, Vercel Workflow, Vercel Cron, Vercel Sandbox, AI Gateway/OIDC, and optional Agent Runs observability. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)
- Sandbox templates are created/reused during build when bootstrap/seed files exist; prewarm failure fails deployment. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)
- Vercel OIDC provides zero-key AI Gateway and same-project service auth. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)
- Vercel Connect token custody, Agent Runs UI, Vercel Sandbox templates, Vercel Workflow hosting, and Cron integration are Vercel-specific. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)

## “Run anywhere” assessment

- The claim is credible only if the operator supplies a compatible Workflow World, persistent storage, Node/Nitro hosting, scheduler, and sandbox adapter. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Default local world is single-path filesystem state, unsuitable for horizontally scaled ephemeral containers without replacement storage. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Direct models avoid AI Gateway lock-in; custom route auth avoids Vercel OIDC; custom interactive OAuth avoids Vercel Connect. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Managed parity is not automatic: self-hosting is source-portable but operationally incomplete until these services are chosen. [Deployment overview](https://github.com/vercel/eve/blob/main/docs/guides/deployment/overview.md)

# 14. Observability

- Durable NDJSON stream is the canonical application event log. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Hooks subscribe to typed events or `*` after each event is durably recorded. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md)
- Hooks are observe-oriented but exceptions propagate: a throwing hook can fail a turn/session. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md)
- `agent/instrumentation.ts` default-exports `defineInstrumentation`; its presence enables authored telemetry setup. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- `setup({agentName})` registers any OTel-compatible exporter/provider. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Documented exporters/backends include Braintrust, PostHog, Raindrop, Arize, Honeycomb, Datadog, and Jaeger. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- `recordInputs` and `recordOutputs` both default true; `functionId` defaults to agent name. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- `events["step.started"]` can add AI SDK `runtimeContext` attributes per model call. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Framework span attributes include Eve version/environment, session/turn/step, and channel kind. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Turn traces parent AI SDK model/tool spans under `ai.eve.turn`. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- `traceChannelRequests` defaults false; when true it emits low-cardinality HTTP SERVER spans and honors `traceparent`. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Automatic Workflow tags are `$eve.type`, `$eve.parent`, `$eve.root`, `$eve.subagent`, `$eve.trigger`, `$eve.title`, `$eve.model`, token counts, and `$eve.tool_count`. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Tag writes are best-effort and swallowed after one per-process log; they cannot break an agent. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Without authored instrumentation, `eve dev` stores local traces viewable in TUI `/traces` or `eve traces`. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Writing `instrumentation.ts` replaces local disk tracing. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- Agent Runs is Vercel-only and currently team-gated. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)

# 15. HTTP/wire surface

## Routes

| Method/path | Contract |
|---|---|
| `GET /eve/v1/health` | Always public health probe. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) |
| `GET /eve/v1/info` | Validated inspection snapshot; uses Eve-channel auth/default auth. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `POST /eve/v1/session` | Create session with first message; returns JSON and `x-eve-session-id`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `POST /eve/v1/session/:sessionId` | Submit follow-up/input response to fixed session. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `GET /eve/v1/session/:sessionId/stream` | Durable NDJSON stream. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `POST /eve/v1/session/:sessionId/cancel` | Queue optional turn-scoped cancellation. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `POST /eve/v1/session/:sessionId/compact` | Summarize model context. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `POST /eve/v1/session/:sessionId/clear` | Remove model-message history in place. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `POST /eve/v1/session/:sessionId/reset` | Terminally retire ID; never creates replacement. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `POST /eve/v1/dev/schedules/:id` | Local-development schedule trigger. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx) |
| `/.well-known/workflow/**` | Workflow callbacks; exact subroutes are internal/UNVERIFIED. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md) |

## Stream protocol

- Content is NDJSON, one event per line. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Event vocabulary includes session/turn/step lifecycle, messages, reasoning, actions/partials/results, input/auth, subagents, compaction, and structured result completion. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Envelope is `{type,data,meta:{id,at}}`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- `meta.id` is an `evt_`-prefixed ULID, stable for a persisted event and broadly time-ordered. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- It is not a total-order cursor across processes; exact order is stream index. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Stream versions before 20 may replay legacy events without `meta.id`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- `startIndex=N` is absolute consumed-event count; `0` rewinds; negative values address relative to current tail. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- `includeTailIndex=1` returns `x-eve-stream-tail-index`, with `-1` before any event. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Reconnection/replay returns the same persisted event IDs; retried steps emit new IDs. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Adjacent text/reasoning deltas may coalesce but remain source-ordered; other event types are ordering barriers. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)

## Event vocabulary

| Event | Exact role |
|---|---|
| `session.started` | Durable session created. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `turn.started` | New inbound turn began. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `message.received` | Accepted user text plus structured text/file parts. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `step.started` | Model/tool step began. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `actions.requested` | Model requested action calls before execution. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `action.partial` | Complete preliminary generator snapshot. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `action.result` | Final tool result/error. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `input.requested` | Approval/question/session-limit input wait with `requests`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `subagent.called` | Child dispatched; carries `childSessionId`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `subagent.completed` | Delegated child successfully finished. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `reasoning.appended` | Incremental reasoning delta plus cumulative block. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `reasoning.completed` | Final reasoning block. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `message.appended` | Incremental assistant delta plus cumulative block. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `message.completed` | Final assistant block; may occur multiple times per turn. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `result.completed` | Structured-schema result in `data.result`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `compaction.requested` | Compaction began with model/session/turn/token metadata. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `compaction.completed` | Compaction checkpoint committed. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `authorization.required` | OAuth challenge; may include URL/code/instructions/expiry. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `authorization.completed` | Outcome: authorized, declined, failed, or timed-out. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `step.completed` | Step finish reason and token usage. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `step.failed` | Step `{code,message,details?}`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `turn.completed` | Turn settled successfully. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `turn.failed` | Turn settled with `{code,message,details?}`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `turn.cancelled` | Non-failure cancellation; always followed by `session.waiting`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `session.waiting` | Parked/resumable and ready for next delivery/input. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `session.failed` | Terminal session failure. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |
| `session.completed` | Terminal normal session end. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md) |

- `message.completed.data.finishReason` distinguishes interim tool-call narration from terminal text. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- `step.completed.data.finishReason` mirrors step outcome; usage belongs on `step.completed`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Reasoning events may contain sensitive model reasoning; display/storage policy is application-owned. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)

## SDK client

- `Client` is exported from `eve/client`; config binds `host`, auth, headers, redirect, and fetch behavior. [Client](https://github.com/vercel/eve/blob/main/docs/guides/client/overview.mdx)
- Auth supports dynamic bearer, Basic, and Vercel OIDC credentials resolved before every request/reconnect. [Client](https://github.com/vercel/eve/blob/main/docs/guides/client/overview.mdx)
- Non-2xx throws `ClientError` with HTTP `status` and response `body`. [Client](https://github.com/vercel/eve/blob/main/docs/guides/client/overview.mdx)
- `client.sessions.create(...)` returns `{session,response}`; `attach(id)` performs no I/O. [Client](https://github.com/vercel/eve/blob/main/docs/guides/client/overview.mdx)
- Session handle exposes `send`, `stream`, `cancel`, `compact`, `clear`, and `reset`. [Client](https://github.com/vercel/eve/blob/main/docs/guides/client/overview.mdx)
- The client stores only session ID and stream cursor; terminal/unknown IDs fail instead of replacing themselves. [Client](https://github.com/vercel/eve/blob/main/docs/guides/client/overview.mdx)
- `stream({follow:false})` uses bounded tail-index catch-up. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- React/Vue/Svelte clients use `useEveAgent`; exact framework-hook signatures are outside this wire analysis. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)

# 16. Auth/tenancy

## Direct answer

- Eve has inbound authentication primitives but **no built-in multi-tenant authorization model**. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- It has no tenant registry, organization/workspace entity, membership table, role/permission store, policy engine, row-level security, or per-agent ACL in the documented runtime. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md)
- It has **no per-session ownership ACL** layered on route auth. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Route authentication does not prove that the authenticated caller owns `:sessionId`. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- If multiple users/tenants can reach one Eve route, the application must enforce user/tenant/session authorization itself. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Consequence: a caller who passes route auth and learns another valid session ID is not rejected by an Eve-native ownership check. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)

## Inbound route authentication

- Route auth is configured on `agent/channels/eve.ts` via `eveChannel({auth})`. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- It protects create, follow-up, controls, stream, and info; health is always public. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Production fails closed unless an authenticator accepts; anonymous access requires explicit `none()`. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Ordered `AuthFn` returns `SessionAuthContext` to accept, nullish to skip, or throws to reject. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- If all skip, response is `401` with applicable `WWW-Authenticate` challenges. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Helpers are `localDev`, `vercelOidc`, `none`, `httpBasic`, `jwtHmac`, `jwtEcdsa`, and generic `oidc`. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Low-level JWT/OIDC verifiers accept issuer, audiences, signing material, and optional subject/claim matchers. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- `createIpAllowList`/`isIpAllowed` can reject network sources before auth/model work. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Scaffolded/default `[vercelOidc(),localDev(),placeholderAuth()]` rejects unconfigured production browser traffic. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)

## Principal model

- Accepted identity is `SessionAuthContext` with `principalId`, `principalType`, authenticator/issuer/subject, and application-defined attributes. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- `ctx.session.auth.current` is the active-turn caller; `initiator` is the session creator. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- A follow-up from another authenticated caller replaces `current` but leaves `initiator` pinned. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Eve does not require `current.principalId === initiator.principalId`. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Multi-tenant examples put `tenantId` and roles in attributes after application membership verification. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md)
- The membership check and credential store remain application code. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md)
- Dynamic tools/skills/instructions and executors can inspect the principal, but this is an author hook, not a framework policy. [Dynamic capabilities](https://github.com/vercel/eve/blob/main/docs/guides/dynamic-capabilities.md)

## Outbound scope and delegation

- User-scoped connection tokens key cache/grants by issuer and principal ID; app-scoped tokens represent the agent. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Tenant credential selection should derive tenant from verified context, never prompt/tool arguments. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md)
- Custom async approval can consult an external tenant policy service, but approval is not authorization and storage remains external. [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md)
- Remote-agent `forwardPrincipal` is denied by default. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Receiver must author `trustedForwarders(forwarder)`; it authorizes the verified asserting service, not the asserted user. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Accepted forwarding copies principal metadata only, never credentials, and stamps `eve:forwarded-by`. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Malformed forwarding is `400`; untrusted assertion is `403`. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)

## Required production design

- Put application authentication/membership verification before Eve run creation. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md)
- Add an authorization gateway or custom channel route that binds `(principal, tenant, sessionId)` before every follow-up, stream, and control request. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Recheck tenant/resource authorization inside every side-effecting tool; never rely on approval alone. [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md)
- Store tenant-scoped state/memory in application databases keyed by verified tenant attributes. [Multi-tenant memory](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-memory.md)
- Treat session IDs as addresses, not authorization capabilities. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)

## Authorization responsibility matrix

| Concern | Eve provides | Application must provide |
|---|---|---|
| Request identity | Ordered authenticator and normalized principal. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) | Identity-provider/session/API-key integration and account lifecycle. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) |
| Tenant selection | Arbitrary verified principal attributes. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md) | Membership verification and allowed active-tenant selection. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md) |
| Session ownership | Nothing beyond route auth. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) | Bind session ID to user/tenant on create/read/write/control. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) |
| Agent authorization | Route policy can distinguish callers. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) | Which users/roles may invoke which deployed agent. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md) |
| Tool authorization | Async approval policy and runtime principal. [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md) | Resource/action policy and executor-side enforcement. [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md) |
| Outbound credentials | User/app principal scopes and hidden token resolution. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) | Tenant credential database or Vercel Connect configuration. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md) |
| Data isolation | Session context and author-defined state keys. [State](https://github.com/vercel/eve/blob/main/docs/guides/state.md) | Tenant-keyed database queries, encryption, retention, deletion, and audit controls. [Multi-tenant memory](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-memory.md) |
| Delegation identity | Deny-by-default forwarded principal plus trusted-forwarder predicate. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) | Precise service trust and end-user authorization at receiver. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md) |

- Route auth executes independently on every create/continue/control/stream request; principal snapshots then flow into the turn. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- A changing `current` principal makes cross-user session continuation possible by design; applications needing pinned tenancy must compare `current` and `initiator`. [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md)
- The documented tenant-approval pattern explicitly denies when current and initiating tenant IDs differ. [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md)

# Mechanisms worth copying

1. Path-derived capability identity makes the complete agent surface inspectable and rejects naming drift at build time. [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
2. Durable step journaling plus explicit retry semantics makes crash recovery understandable without pretending external side effects are exactly once. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
3. Human input as a durable `input.requested` pause unifies approvals, questions, and OAuth without holding compute. [Human input](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md)
4. Stable event IDs plus index cursors make NDJSON replay practical while correctly distinguishing replay duplicates from retry emissions. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
5. Agent Skills progressive disclosure keeps rare procedures and assets out of the default context. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
6. Model-hidden provided arguments prevent the model from selecting tenant/resource routing values for MCP/OpenAPI calls. [0.31.3 release](https://github.com/vercel/eve/releases/tag/eve%400.31.3)
7. A small sandbox backend contract separates agent semantics from Firecracker, Docker, microsandbox, or custom isolation. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
8. Child-session IDs and independent streams preserve context isolation while allowing detailed subagent observability. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
9. Ordered route-auth functions with fail-closed defaults compose service, user, local-dev, and anonymous policies cleanly. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
10. Evals driving the real HTTP/event surface reduce divergence between tests and production execution. [Evals](https://github.com/vercel/eve/blob/main/docs/evals/overview.mdx)

# Where eve is weak

- No built-in session-ownership authorization: authenticated callers are not automatically restricted to their own sessions. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- No tenant, organization, membership, RBAC/ABAC, policy-store, or per-agent ACL model; examples delegate all of it to application code. [Multi-tenant auth](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md)
- “Isolated VMs by default” overstates local/self-host behavior because Docker is not a VM and just-bash is not an isolation boundary. [Sandbox](https://github.com/vercel/eve/blob/main/docs/sandbox.mdx)
- Retry streams preserve abandoned-attempt events but expose no attempt number or committed-attempt marker, complicating analytics and audit reconstruction. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Hooks are at-least-once and a hook exception can fail the agent turn, making observability side effects unusually coupled to execution. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md)
- No exactly-once side-effect facility, transactional outbox, or first-class idempotency-key contract for authored tools. [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md)
- Message delivery is not documented as strict durable FIFO; clients are told to serialize sends around `session.waiting`. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Schedules lack documented missed-fire catch-up, overlap locks, and framework retries. [Schedules](https://github.com/vercel/eve/blob/main/docs/schedules.mdx)
- No documented inbound MCP server surface and no documented stdio MCP client transport. [MCP](https://github.com/vercel/eve/blob/main/docs/connections/mcp.mdx)
- Self-hosting requires operators to assemble Workflow storage, callbacks, sandboxing, scheduling, TLS, scaling, and log collection; “run anywhere” is code portability, not service parity. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- The default local filesystem Workflow world is not sufficient for horizontally scaled ephemeral production. [Self-hosting](https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md)
- Vercel Connect token custody, Agent Runs, Workflow hosting, Cron, and Firecracker sandbox integration are not portable components. [Vercel deployment](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)
- Provider/MCP progress is not normalized into tool partial events, so progress UX differs by tool origin. [Sessions](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- Skills are agent-scoped with no documented shared root/subagent skill layer. [Skills](https://github.com/vercel/eve/blob/main/docs/skills.mdx)
- Copied-root parallel subagents share one writable sandbox without filesystem transaction/locking semantics. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- Persistent subagent sessions remain experimental and remote parked-child teardown is a known gap. [Subagents](https://github.com/vercel/eve/blob/main/docs/subagents.mdx)
- OTel defaults record full inputs and outputs, creating an easy confidentiality footgun unless explicitly disabled. [Instrumentation](https://github.com/vercel/eve/blob/main/docs/guides/instrumentation.md)
- `GET /health` is unconditionally public and has no framework switch for private health metadata. [Auth](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- Node 24 minimum narrows compatibility with older enterprise runtimes. [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md)
- Exact 0.31.3 source-level verification was hindered by inaccessible tagged package contents; facts tied only to current `main` docs are explicitly marked where version drift matters. [0.31.3 release](https://github.com/vercel/eve/releases/tag/eve%400.31.3)

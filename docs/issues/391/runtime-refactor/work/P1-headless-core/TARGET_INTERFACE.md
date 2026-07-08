# P1 target interface — simple declarative-agent shape

> Purpose: define the simplest target interface for #391 pluggable agents. This is the north star P1 must not block; P1 does not implement the whole compiler/resolver.

## One idea

An agent definition is declarative intent. The host resolves that intent into attached environments and catalogs.

```txt
agents/<id>/ or agent.yaml
  -> AgentDefinitionManifest          # import-free intent
  -> host/plugin/environment resolver # policy + provider facts + readiness
  -> ResolvedAgentComposition         # environments + catalogs
  -> createAgent() + surface adapters # execution + routes/UI/channels
```

`createAgent()` is the execution primitive. The declarative compiler is the authoring abstraction.

## Inspiration distilled

- **Anthropic Managed Agents:** Agent config is model + prompt + tools + MCP + skills; Environment is separate; Session binds them.
- **Flue:** a `SessionEnv` is the seam for fs/exec/tools; avoid mode-specific core logic.
- **eve:** directory slots (`instructions`, `tools`, `skills`, `subagents`, `channels`, `sandbox`) compile into a manifest before runtime code executes.

Our version: boring agents declare requirements; host composition attaches environments and catalogs; surfaces consume resolved facts.

## Declarative authoring target

Future directory shape:

```txt
agents/engagement-analyst/
  agent.yaml
  instructions.md
  tools/
  skills/
  subagents/
  channels/
  connections/
```

Example manifest/YAML:

```yaml
id: engagement-analyst
description: Analyzes client engagement material.
model: anthropic/claude-sonnet-4
instructions: ./instructions.md

requires:
  environments:
    - id: company_context
      filesystem: read
    - id: scratch
      filesystem: readwrite
      tools: [read, write, edit]

skills:
  - deck-analysis
  - financial-review

tools:
  - crm.lookup
  - slides.generate
```

Rules:

- Authored definitions declare intent/requirements only; they do not grant power.
- Discovery is import-free: paths/metadata/frontmatter first, runtime code later.
- Path-derived ids avoid drift and allow collision checks.
- Missing requirements fail closed.
- No `requires.network` in P1; add a network axis later if needed.

## Flue-inspired environment seam

We copy Flue's important abstraction, not its whole framework: one operation-bearing environment object backs filesystem, exec/bash, search/tool construction, and programmatic fs. In Flue this is `SessionEnv`; in boring it must be named and multi-environment.

Keep two layers separate:

1. **Runtime environment object** — authority-bearing object used by tools/routes/adapters. Not exposed directly on the wire.
2. **Resolved environment projection** — stable public fact for UI/surfaces/catalogs. No methods, no lifecycle.

Name note: `architecture/01-agent-core-runtime-free.md` already uses `AgentEnvironment` for session/storage config. To avoid collision, this plan calls the operation-bearing runtime object `AttachedEnvironmentRuntime`.

```ts
interface AttachedEnvironmentRuntime {
  readonly id: string
  readonly filesystem?: AttachedFilesystemRuntime
  readonly exec?: AttachedExecRuntime
  readonly tools: readonly string[]
  readonly provider?: string
  readonly label?: string
  dispose?(): Promise<void>
}

interface AttachedFilesystemRuntime {
  readonly access: 'read' | 'readwrite'
  readonly acceptsInputAssets?: boolean
  readonly defaultInputAssetSink?: boolean
  readFile(path: string): Promise<string>
  readFileBuffer(path: string): Promise<Uint8Array>
  writeFile?(path: string, content: string | Uint8Array): Promise<void>
  stat(path: string): Promise<unknown>
  readdir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

interface AttachedExecRuntime {
  exec(command: string, options?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<unknown>
}
```

Differences from Flue:

- Flue has one unnamed `SessionEnv`; boring has named `AttachedEnvironmentRuntime[]`.
- Flue cwd wrappers are convenience; boring scoped/governed environments must be provider-jailed, not only path-normalized.
- Pure/default boring agents may have `environments: []`; Flue normally creates a default environment.
- Workspace UI consumes resolved projections and route/UI contributions; it does not own the environment object.

### Relation to 09/E1

`architecture/09-environments-attachable.md` currently names the minimal core-facing injected type as `ResolvedEnvironments { bindings: RuntimeFilesystemBinding[] }`. Treat that as the landed E1-era filesystem-binding form. The Flue-inspired `AttachedEnvironmentRuntime[]` generalizes it by adding the environment id, optional exec facet, environment-bound tools, and input-asset sink policy.

```txt
RuntimeFilesystemBinding[] / ResolvedEnvironments
  -> filesystem facet of AttachedEnvironmentRuntime[]
  -> methodless ResolvedEnvironment[] projection for surfaces
```

Ownership: the runtime/projection types live in agent shared/type surfaces; boring-bash implements them and imports the types only; hosts wire values. Agent still imports neither boring-bash nor boring-sandbox by value.

## Resolved model

Keep three interfaces separate:

```txt
AgentDefinitionManifest  = authored/stable intent
ResolvedAgentCapabilities = resolved powers/catalogs
ResolvedAgentStatus       = volatile readiness/provisioning/runtime state
```

Do not put status in the definition. Do not put lifecycle methods in status. Do not require surfaces to infer readiness from capabilities alone.

Keep the public resolved model small.

**Amendment (2026-07-08):** `ResolvedAgentCapabilities` includes resolved
`plugins[]`; plugin-contributed tools/skills/MCP servers appear in the same
projection as built-in contributions after per-agent plugin composition.

```ts
interface ResolvedAgentComposition {
  readonly definition: AgentDefinitionManifest
  readonly capabilities: ResolvedAgentCapabilities
  readonly status: ResolvedAgentStatus
  /** Concrete objects consumed by createAgent() and adapters; not necessarily exposed on the wire. */
  readonly bundles: ResolvedAgentBundles
}

/** Stable-ish resolved powers/catalogs. This answers: what is this agent allowed/equipped to use? */
interface ResolvedAgentCapabilities {
  readonly agentId?: string
  /** Diagnostic only. Consumers MUST NOT branch on this for behavior. */
  readonly runtimeMode?: string
  /** Host-populated runtime projection; image ref/digest are non-secret identity facts. */
  readonly runtime?: {
    /** Optional: absent when the image came from provider default instead of a profile. */
    readonly profileId?: string
    readonly image?: { readonly ref: string; readonly digest: string }
    readonly provider: string
  }

  /** Source of truth for filesystem/bash/environment authority. */
  readonly environments: readonly ResolvedEnvironment[]

  /** Flat post-resolution projections for display/diagnostics/catalogs. */
  readonly tools: readonly string[]
  readonly skills: readonly string[]
  readonly mcpServers: readonly string[]
  /** Resolved plugin ids this agent carries. */
  readonly plugins: readonly string[]

  /** Optional wire-schema version for future P2/P3 projection changes. */
  readonly v?: 1
}

interface ResolvedEnvironment {
  /** Model/manifest-visible id, e.g. user, company_context, scratch. Projection of AttachedEnvironmentRuntime, not the runtime object. */
  readonly id: string

  /** Omitted means this environment has no filesystem authority. */
  readonly filesystem?: {
    readonly access: 'read' | 'readwrite'
    /** May user input assets be persisted here? */
    readonly acceptsInputAssets?: boolean
    /** Required when multiple writable accepting environments exist. */
    readonly defaultInputAssetSink?: boolean
  }

  /** Environment-bound tools exposed by this environment, e.g. read/write/bash. */
  readonly tools: readonly string[]

  /** Diagnostics only; never feature switches. */
  readonly provider?: string
  readonly label?: string
}

/** Volatile operational state. This answers: is it ready now, and what failed? */
interface ResolvedAgentStatus {
  readonly state: 'preparing' | 'ready' | 'degraded' | 'failed'
  readonly environments?: Readonly<Record<string, EnvironmentStatus>>
  readonly tools?: Readonly<Record<string, ToolStatus>>
}

interface EnvironmentStatus {
  readonly state: 'preparing' | 'ready' | 'degraded' | 'failed'
  readonly changed?: boolean
  readonly fingerprint?: string
  readonly errorCode?: string
  readonly message?: string
  readonly retryable?: boolean
}

interface ToolStatus {
  readonly state: 'absent' | 'preparing' | 'ready' | 'degraded' | 'failed'
  readonly errorCode?: string
  readonly message?: string
}

interface ResolvedAgentBundles {
  readonly tools: readonly AgentTool[]
  readonly skills: readonly SkillContribution[]
  readonly promptFragments: readonly PromptFragment[]
  readonly mcpServers: readonly McpServerContribution[]
  readonly routes: readonly RouteContribution[]
  readonly uiAffordances: readonly UiAffordanceContribution[]
  readonly toolRenderers: readonly ToolRendererContribution[]
  readonly composerProviders: readonly ComposerProviderContribution[]
}
```

P1 does **not** need all bundle contribution types. They are vocabulary for P3/P4/P6.

## Derived vocabulary, not stored scalar facts

Do not store scalar `filesystem`, `shell`, or `attachments` as capability truth. They hide the real source and invite lazy branching.

Use helpers derived from `environments[]`:

```ts
const hasFilesystem = (c) => c.environments.some((e) => e.filesystem)
const hasWritableFilesystem = (c) => c.environments.some((e) => e.filesystem?.access === 'readwrite')
const isFilesystemless = (c) => !hasFilesystem(c)
const isBashless = (c) => !c.environments.some((e) => e.tools.includes('bash'))
const environmentForTool = (c, toolName) => c.environments.find((e) => e.tools.includes(toolName))
```

Human terms:

- **filesystemless:** no environment has `filesystem`.
- **bashless:** no attached environment exposes a bash/exec tool.
- **headless:** no workspace UI/control-plane surface attached. This is a surface state, not an agent capability.

## Input assets, not attachments

Remove `attachments` from the core capability model. User-supplied files/images/blobs are **input assets**. Intake is derived from environments, provider support, and host policy.

Default strategy:

```txt
1. Persist to the single/default writable environment with acceptsInputAssets.
2. Else pass direct to model if host policy and provider support direct assets.
3. Else reject with a stable error.
```

Rules:

- If exactly one writable environment has `acceptsInputAssets`, use it.
- If multiple do, exactly one must have `defaultInputAssetSink`; otherwise resolver error.
- Direct-to-model support is a provider/host fact, not an agent capability.
- No `workspace` attachment terminology; in this project, workspace means UI/control plane.

## Prompt, skills, routes, UI are residue

A capability is not just a tool name. Environment attachment/removal controls the whole residue bundle:

```txt
environment capability bundle = environment-bound tools
                              + prompt fragments
                              + skills
                              + MCP projections
                              + routes
                              + UI affordances/renderers/composer providers
                              + status/readiness reported separately
```

Examples:

- No environments => no filesystem/bash prompt text, no file/bash tools, no file routes/UI/renderers/composer providers, no filesystem MCP projection.
- Readonly environment => read/search/tree affordances only; mutation tools/routes/prompt guidance absent or fail before mutation.
- Bashless environment => no bash/exec tool or bash guidance, even if filesystem read/write tools exist.

## Surface separation

Surfaces consume resolved facts; they do not define them.

- Workspace UI/control plane decides which panels/renderers/composer affordances to show from `capabilities.environments` and bundles.
- Slack/CLI/MCP use the same facts without workspace UI names.
- `AgentRouteBindingProfile` is only Fastify lowering output.
- `runtimeMode` is logging/diagnostic only.

## Subagents

Each declared subagent resolves its own composition.

```ts
interface SubagentManifest {
  readonly id: string
  readonly description: string
  readonly requires?: CapabilityRequirement
}
```

Rules:

- Declared subagents inherit no environments/tools/skills by accident.
- Self/copy subagents may explicitly share parent composition.
- Environment sharing is explicit policy, never cwd inheritance.
- Tool/skill/subagent names are collision-checked.

## P1 minimum

P1 lands the execution seam and the minimal projection. It does not implement the declarative compiler or full resolver.

Pure/default core path (no environment attachment):

```ts
{
  v: 1,
  runtimeMode: 'none', // diagnostic only; adapter shim during migration
  environments: [],
  tools: [...actualRegisteredToolNames],
  skills: [],
  mcpServers: [],
}
```

Existing coding modes may expose a coarse compatibility projection:

```ts
{
  v: 1,
  runtimeMode: resolvedMode,
  environments: [
    {
      id: 'user',
      filesystem: {
        access: 'readwrite',
        acceptsInputAssets: true,
        defaultInputAssetSink: true,
      },
      tools: ['read', 'write', 'edit', 'find', 'grep', 'ls', 'bash'],
      provider: resolvedMode,
    },
  ],
  tools: [...actualRegisteredToolNames],
  skills: [],
  mcpServers: [],
}
```

The projection is intentionally coarse until P2/P3 move runtime/tool bundles into boring-bash. New consumers must target `environments[]`, not `runtimeMode`.

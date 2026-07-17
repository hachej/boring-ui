> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# P1 research — Anthropic Managed Agents, Flue, eve

> Purpose: condense the external/reference-model research that shapes the #391 pluggable-agent capability design.

## Executive summary

All three reference models converge on the same lesson: an agent capability is not a single tool flag. It is the combination of agent definition, prompt, tools, skills, MCP/connections, environment/session binding, permissions, and surface projection.

The boring-ui design should therefore be:

```txt
agent definition declares requirements
host/environment/plugin policy resolves them
resolved composition produces capability bundles
surfaces render/register from semantic facts
```

Do not use `runtimeMode`, route profiles, or workspace UI names as long-term capability truth.

## Anthropic Managed Agents

### What the model is

Anthropic Managed Agents are organized around four concepts:

| Concept | Meaning |
| --- | --- |
| Agent | model, system prompt, tools, MCP servers, skills |
| Environment | where sessions run: cloud sandbox or self-hosted sandbox |
| Session | running agent instance bound to an environment |
| Events | user turns, tool calls/results, status updates |

This is important because Anthropic does **not** treat tools as the full agent. Agent identity includes the prompt, skills, MCP servers, and model configuration.

### Tools

Anthropic's built-in toolset includes bash, read, write, edit, glob, grep, web fetch, and web search. Tools can be enabled/disabled individually. Permission policies control whether enabled tools auto-run or require approval.

Implications for boring-ui:

- Tool presence and execution permission are different axes.
- A capability can be present-but-gated by approval/readiness.
- Tool names are diagnostics/projections, not the capability source of truth.
- Bash and filesystem tools must be detachable as a coherent bundle.

### Skills

Managed Agents attach skills to the Agent definition. Skills are reusable, filesystem-based instruction/resources bundles. They load on demand and are counted/attached as part of the agent configuration.

Implications:

- Skills must be filtered by the same resolved capabilities as tools.
- A skill requiring filesystem/bash must disappear in pure mode.
- Prompt/tool removal without skill removal still leaks capability residue.

### MCP

Managed Agents treat MCP servers/toolsets as agent-scoped. MCP toolsets have their own permission defaults and can expose new tools over time.

Implications:

- MCP servers must be part of resolved capability projection.
- New MCP tools must not silently widen authority; manifests/policy must fail closed or require approval.
- MCP projection for boring environments should enforce the same filesystem policy as in-process tools/routes.

### Environments and sessions

Anthropic Environments are separate from Agents. Multiple sessions may reference the same environment configuration, but each session gets its own isolated sandbox instance. Environment state/config and session state are distinct.

Implications:

- Boring agent definitions must not bake in concrete environment handles.
- Session-time environment attachment is the right seam.
- Durable conversation/session state does not imply durable filesystem state.

### Memory/resources

Anthropic memory stores/resources can attach to sessions under distinct mounts. Each store has read-only/read-write access. Mount guidance is added to the system prompt. Multiple stores per session are supported.

Implications:

- Multiple filesystem-like attachments are normal.
- Scalar `filesystem: readwrite` is only an aggregate convenience.
- The source of truth should be named environment attachments; each environment may expose filesystem policy and environment-bound tools.
- Prompt fragments must be generated per mount/access mode.
- Writable memory/context is risky under prompt injection; write access must be explicit.

### Multi-agent sessions

Anthropic multi-agent sessions let a coordinator delegate to other agents. Agents may share the sandbox/filesystem, but each agent/thread has its own conversation history, model, system prompt, tools, MCP servers, and skills. Referenced agents are version-pinned.

Implications:

- Subagents need their own resolved capability facts.
- Shared environment is possible but must be explicit policy.
- Declared subagent definitions should be snapshotted/versioned.
- Critical events/permission requests from subagents need a parent-visible event path.

## Flue

### What to steal

Flue has `defineAgent()` and `defineAgentProfile()` for reusable behavior packs. Agent config includes model, instructions, tools, skills, subagents, compaction, durability, cwd, and sandbox.

Flue's key seam is `SessionEnv`: one universal interface for exec, file operations, cwd resolution, and cleanup. All sandbox modes implement it.

```ts
interface SessionEnv {
  exec(command, options): Promise<ShellResult>
  readFile(path): Promise<string>
  writeFile(path, content): Promise<void>
  readdir(path): Promise<string[]>
  cwd: string
  resolvePath(path): string
  cleanup(): Promise<void>
}
```

Implications:

- File tools, search/routes, programmatic fs, and shell should point at one operation-bearing environment view.
- Avoid split brain between host paths, sandbox paths, model cwd, and UI file tree.
- `boring-bash` should be the package that owns this environment implementation.

### Tools, skills, scoped calls

Flue supports agent-wide tools/skills and per-call prompt/skill/task tools. Subagent profiles are self-contained for instructions/tools/skills/subagents; some model settings may inherit.

Implications:

- Later call-scoped tools/skills must still pass through capability resolution.
- `tools[]` projection should distinguish actual registered tool catalog from authored allow-list.
- Subagents should not accidentally inherit the parent's broad tool surface.

### Durability

Flue durability covers sessions, submissions, turn journals, events, and recovery decisions. It does not automatically mean sandbox filesystem durability.

Implications:

- Session storage root and workspace/environment storage root must remain separate.
- Durable event stream work (T1, the #391 durable indexed event-stream phase) should not be conflated with filesystem persistence.
- Environment reconnection needs stable environment/session identity.

### What to avoid

Flue defaults are not runtime-free: default tools and cwd/context discovery assume an environment. Boring-agent must default to none.

Avoid:

- default file/bash power;
- cwd discovery in the agent core;
- mode-specific branching in core logic;
- treating profile names as stable runtime agent identity.

## eve

### What to steal

eve is filesystem-first. An `agent/` directory is discovered and compiled into an agent. Slots include:

| Slot | Meaning |
| --- | --- |
| `agent.ts` | runtime config |
| `instructions.md` / `instructions.ts` | base system prompt |
| `tools/` | typed executable integrations |
| `skills/` | on-demand procedures/resources |
| `connections/` | external connections/MCP/OpenAPI |
| `channels/` | entrypoints |
| `sandbox.ts` / `sandbox/workspace/**` | sandbox definition and seed files |
| `subagents/` | declared child agents |

Identity is path-derived. Tool/skill/subagent names come from filenames/directories, avoiding drift.

Implications:

- Declarative authoring should compile to manifests/requirements before executing code.
- Path-derived names and collision checks are worth copying.
- Slots map naturally to our capability bundles: prompt, tools, skills, connections/MCP, channels, sandbox/environment.

### Subagents

eve has two kinds:

1. built-in copy subagent: copy of current agent, shares sandbox/tools;
2. declared subagent: own directory, own instructions/tools/skills/sandbox, inherits nothing from root slots.

Implications:

- Boring should model copy/self and declared subagents separately.
- Declared subagents resolve their own capabilities.
- Environment sharing is explicit.
- Tool/skill/subagent names share a namespace and must be collision-checked.

### Sandbox/workspace

eve seeds `sandbox/workspace/**` into `/workspace`. Skills are materialized separately. Model-facing file tools require absolute `/workspace/...` paths and include safety patterns such as read-before-write/stale-write stamps.

Implications:

- Boring can use model-visible environment ids/namespaces, but must support multiple mounted environments and partial scopes.
- Read-before-write/stale-write stamps are required for mutating file tools.
- We must not hardcode one `/workspace` as the only possible environment forever.

### What to avoid

eve assumes an agent has a sandbox by default and framework tools exist unless disabled. For boring-ui:

- pure/headless default must be no filesystem, no sandbox, no cwd, no bash;
- provider fallback must be policy-driven, not silent degradation;
- backend labels are insufficient — capability facts must describe real filesystem/exec/isolation/persistence properties.

## Cross-model synthesis

### Adopted vocabulary

```txt
Definition     authored requirements + prompt/tools/skills/slots, no power grant
Environment    attachable resource/bundle with filesystem policy, environment tools, status
Session        running instance that binds definition + resolved environments
Capability     semantic fact: environments plus tool/skill/MCP catalogs
Bundle         concrete residue: tools/routes/UI/renderers/prompt/skills/MCP/readiness/status
Surface        workspace UI, Slack, CLI, MCP, HTTP; consumes facts only
```

### Hard design conclusions

1. `environments[]` is source of truth for filesystem/bash/environment authority.
2. Do not store scalar `filesystem`, `shell`, or `attachments` as capability truth; derive helper answers from environments.
3. Input assets are intake flow, not an attachment capability: persist to a writable accepting environment, else direct-to-model if provider/host allow, else reject.
4. Prompt and skills are part of capability residue.
5. MCP servers/toolsets are part of capability residue.
6. Subagents have their own resolved composition.
7. Declarative authoring compiles requirements/manifests first, then runtime code attaches later.
8. Route profiles and UI plugin names are adapter/surface details, not capability truth.

## Direct impact on P1

P1 should not implement the full universe. It should define the target vocabulary and land the minimum projection for pure mode:

```ts
{
  v: 1,
  runtimeMode: 'none',
  environments: [],
  tools: [...actualRegisteredToolNames],
  skills: [],
  mcpServers: [],
}
```

Everything later should extend this model rather than reintroducing `runtimeMode === 'none'`, workspace UI plugin names, or route profile flags as the source of truth.

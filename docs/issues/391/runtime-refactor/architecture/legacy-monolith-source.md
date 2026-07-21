> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# NON-CANONICAL HISTORICAL SNAPSHOT — DO NOT IMPLEMENT

This file preserves the pre-v2 monolith source analysis only. The canonical runtime-refactor contracts are [`../INDEX.md`](../INDEX.md), [`00-global-isa.md`](00-global-isa.md), the area subplans `01`–`05` and `07`–`10`, and the phase work orders under [`../work/`](../work/). If this file conflicts with those sources, they win.

# Boring Bash agent/runtime refactor plan

## Goal

Make `@hachej/boring-agent` a true agent harness that can run with **no filesystem at all**, while extracting the files + bash working environment into a first-class package named `@hachej/boring-bash`.

`boring-bash` is the optional feature that gives an agent a place to work:

- filesystem API
- exec/bash API
- runtime cwd/location semantics
- path validation and containment
- file watch/search
- file/tree/search HTTP routes
- agent tools (`read`, `write`, `edit`, `ls`, `find`, `grep`, `bash`, `execute_isolated_code`, upload/runtime artifact tools where applicable)
- Boring UI file tree, editor/viewer panes, and `workspace.open.path` surface resolver

A pure headless agent must be valid without `boring-bash`.

## Current problem

The current package boundaries are close but not clean enough:

- `@hachej/boring-agent` still assumes a `RuntimeBundle` with `Workspace + Sandbox + FileSearch`.
- `direct` mode means no isolation, **not** no filesystem.
- File routes and file/bash/upload tools are still composed inside `createAgentApp()` / `registerAgentRoutes()`.
- The filesystem front UI is plugin-shaped, but its server/API/tool half is still in agent.
- Multiple chat panes exist, but they are panes over one backend agent/session namespace.
- Headless Slack/email/Telegram agents would need to fake browser chat calls rather than use a clean runner/channel API.
- Runtime provisioning already exists, but it is workspace-scoped and aggregate; future agents/plugins need explicit per-requirement bash capability validation/readiness.

## Current seams already in place

This is not greenfield. The migration must reuse and extend these seams instead of creating parallel systems:

- `disableDefaultFileTools` already removes the six filesystem tools from the default catalog; bash/harness tools are currently separate.
- `buildHarnessAgentTools()` registers `bash` plus `execute_isolated_code` when the runtime supports it.
- `buildFilesystemAgentTools()` registers `read`, `write`, `edit`, `find`, `grep`, and `ls`.
- `buildUploadAgentTools()` is also bound to the runtime bundle and must move or be consciously kept out of `boring-bash`.
- UI control is already workspace-owned: `/api/v1/ui/*`, `exec_ui`, `get_ui_state`, `WorkspaceBridge`, and workspace UI-control routes live outside the agent core composition.
- Runtime modes already advertise `workspaceFsCapability`; `RuntimeBundle` already separates host storage root, workspace root, sandbox provider, and `runtimeCwd` via `getRuntimeBundleStorageRoot()` / `WorkspaceRuntimeContext`.
- `provisionWorkspaceRuntime()` already accepts structural provisioning contributions, merges by stable `id`, fingerprints/skips unchanged work, and returns `WorkspaceProvisioningResult.changed`.
- Existing storage-primary/sandbox-primary seams exist in `getRuntimeBundleStorageRoot()` and current git/file route wiring; the refactor should reuse those decisions instead of re-deriving storage roots.
- `RuntimeDependencyReadiness`, `ReadyStatusTracker`, and `mergeTools({ checkReadiness })` already gate tools on readiness keys such as `runtime-dependencies`, `workspace-fs`, `sandbox-exec`, and `runtime:<id>`.
- `registerCapabilitiesContributor` already lets composition add runtime capability context.

Required posture: **extend these seams; do not duplicate them under new names.**

## Cloned framework findings

Sources were cloned into `/tmp/boring-agent-frameworks.*` and inspected directly:

- Flue: `withastro/flue`, especially `packages/runtime/src/*`, `packages/cli/src/lib/build.ts`, and `examples/*`.
- eve: `vercel/eve`, especially `packages/eve/src/discover/*`, `packages/eve/src/compiler/*`, `packages/eve/src/runtime/*`, `packages/eve/src/execution/*`, and `e2e/fixtures/*`.

### Flue patterns to steal

- `defineAgent()` returns an opaque initializer; file/module discovery gives addressable identity. See `packages/runtime/src/agent-definition.ts` and `packages/cli/src/lib/build.ts`.
- `defineAgentProfile()` is a reusable behavior pack. Profiles merge into root agents, and named profiles become `session.task({ agent })` subagents.
- Subagent profiles are **self-contained** for instructions/tools/skills/subagents, while model/thinking/compaction can inherit. See `Harness.createTaskSession()` in `packages/runtime/src/harness.ts`.
- Durable direct/dispatch submissions are explicit and separate from the normal prompt API. Flue tracks attempts, journals turn phases, repairs/retries where safe, and terminalizes uncertain interruptions. See `runtime/agent-submissions.ts`, `cloudflare/agent-coordinator.ts`, and `node/agent-coordinator.ts`.
- `SandboxFactory` is the key seam: it returns a `SessionEnv` with fs + exec, and may replace the model-visible tool list via `tools`. This is the exact shape we need for predefined/limited bash tool profiles.
- Flue’s `SessionEnv` is the single backing environment for model tools, programmatic `harness.fs`, `session.fs`, and shell calls. That reinforces the boring-bash invariant: file routes/tools/search and exec must point at one workspace view.
- Flue separates transcript semantics: `session.shell()` records a synthetic bash tool exchange in conversation history, while `session.fs`/`harness.fs` are out-of-band. Boring-bash should make explicit which operations are agent-visible history versus host plumbing.
- Flue durability covers sessions, submission queues, turn journals, event streams, and recovery decisions, but not sandbox filesystem snapshots. A durable agent that mutates files needs boring-bash to reconnect by stable `(workspaceId, agentId/session/run, plan fingerprint)` or to persist the file view separately.
- Flue proves files and bash do not have to be identical capabilities: `examples/cloudflare/src/sandboxes/cloudflare-shell.ts` provides a durable filesystem and a custom `code` tool, while `exec()` throws and default bash tools are replaced.

### Flue patterns to avoid

- The default harness is not runtime-free: default tools include `read/write/edit/bash/grep/glob/task`, and the default env provides fs/exec unless an adapter overrides tools.
- `cwd` and workspace context discovery are baked into the core harness. For boring-ui, those must live behind `boring-bash`, not `boring-agent`.
- Subagent profiles cannot declare durability and normally share the parent environment. That is too weak for our desired “one subagent gets a different sandbox/provider/mount set” requirement.
- Flue top-level agent identity comes from discovered module filenames, while profile names are behavior-pack names only. For boring-ui, keep agent IDs explicit and stable; avoid treating reusable profiles as addressable runtime agents.

### eve patterns to steal

- Filesystem slot discovery is strong DX. `agent/agent.ts`, `instructions.md`, `tools/*.ts`, `skills/*`, `subagents/*`, `channels/*`, `connections/*`, `sandbox.ts`, and `sandbox/workspace/**` compile into a manifest. See `packages/eve/src/discover/discover-agent.ts` and `docs/reference/project-layout.md`.
- Discovery is intentionally import-free; compile/lowering later reattaches live authored exports through a generated module map. For boring-ui, this is the right trust boundary: validate/package manifests before executing plugin or agent code.
- Identity is path-derived. Tools do not author `name`; `tools/billing/refund.ts` becomes `billing-refund`. This avoids name drift and duplicate config. See `compiler/normalize-tool.ts` and `public/definitions/tool.ts`.
- Authored tools can override framework tools by filename, and `disableTool()` can remove framework defaults. `disableRoute()` applies the same idea to channel routes. This is the cleanest precedent for per-agent tool/channel profiles.
- Dynamic tools/skills/instructions are lifecycle-scoped (`session.started`, `turn.started`, `step.started`) and durable metadata is carried in session/context state rather than live process memory. This maps to our need for per-session plugin tools and readiness-gated command tools.
- Each runtime agent node owns exactly one sandbox registry. Declared subagents are separate nodes with their own tools/skills/sandbox; they do **not** inherit by default. See `runtime/resolve-agent-graph.ts` and `runtime/sandbox/registry.ts`.
- eve has two subagent forms: declared subagents get their own sandbox; the built-in `agent` tool delegates to a fresh copy of the current agent and intentionally shares parent sandbox state. See `execution/subagent-tool.ts`.
- Sandbox lifecycle separates template prewarm from live session create. `bootstrap()` writes reusable template state; `onSession()` runs per live session; template keys include backend, node id, session id, source hash, seed content hash, source graph hash, framework contract version, and revalidation key. See `runtime/sandbox/template-plan.ts`, `runtime/sandbox/keys.ts`, and `execution/sandbox/prewarm.ts`.
- Seeded files are mounted into `/workspace` from `agent/sandbox/workspace/**`; skills are also materialized into the sandbox resource tree. See `compiler/workspace-resources.ts` and `runtime/workspace/seed-files.ts`.
- Model-facing file tools require absolute `/workspace/...` paths and enforce read-before-write/stale-write stamps. That is a good safety pattern for boring-bash write/edit tools, but host/runtime tools can bypass it unless the adapter enforces lower-level policy.
- Backend names do not imply equal capability: eve `just-bash` is a file-backed JS shell with no real binaries and weak network isolation, while Docker/Vercel provide real Bash/filesystems. Boring-bash providers must advertise a capability matrix, not just `exec: true`.
- Durability is workflow-owned. The long-lived workflow driver owns the event stream and parks on hooks; each turn runs as a child workflow; durable session snapshots include history, state, dynamic tool metadata, authorization state, read stamps, and sandbox reconnect state. See `execution/workflow-entry.ts`, `turn-workflow.ts`, and `durable-session-store.ts`.

### eve patterns to avoid

- eve assumes every agent has one sandbox by default. For boring-ui, `sandbox: none` must be the default for pure/headless agents.
- eve framework tools always exist unless disabled. For boring-ui, file/bash tools should not even be registered unless `boring-bash` is active and ready.
- eve hardcodes `/workspace` as the user-visible root and requires absolute paths for model file tools. We can use a similar virtual root, but must support workspace-scoped partial mounts and multiple agents per workspace.
- eve default backends fall back from Vercel → Docker → microsandbox → just-bash. For boring-ui, provider fallback must be policy-driven; silently dropping to a less-isolated or less-capable provider is dangerous.

## Target vocabulary

| Package | Owns | Does not own |
| --- | --- | --- |
| `@hachej/boring-agent` | model loop, sessions, runner API, tool registry, channel-neutral event stream | filesystem, file routes, bash, file UI |
| `@hachej/boring-bash` | optional agent working environment: fs + exec + file UI/routes/tools/provisioning | LLM harness, auth, workspace membership, Slack/email transport |
| `@hachej/boring-workspace` | UI shell, layout, plugin host, UI bridge/RPC | agent harness, bash substrate |
| `@hachej/boring-core` | auth, DB, workspaces, billing, agent-instance registry | concrete bash providers except via config/composition |

## Non-negotiable compatibility constraints

1. **Agent without files is first-class.** `createAgent*` must support no `Workspace`, no `Sandbox`, no cwd exposed to the model, no file routes, no bash tools.
2. **`boring-bash` is optional.** Hosts/plugins must declare whether they require it.
3. **No value import cycle.** `@hachej/boring-agent` must have zero value imports from `@hachej/boring-bash`; bash/runtime features are injected by the host/CLI/composition layer.
4. **UI bridge/RPC remains workspace-owned.** Existing `/api/v1/ui/*`, `exec_ui`, `get_ui_state`, `WorkspaceBridge`, and runtime plugin gateway `/api/v1/plugins/:pluginId/*` must keep working.
5. **No split brain.** When `boring-bash` provides both fs and exec, they are one paired environment with the same model-visible cwd.
6. **Provisioning is declarative and scoped.** Agent packages and plugins declare bash requirements; the host extends `provisionWorkspaceRuntime()` to resolve, fingerprint, provision, gate tools, and report readiness.
7. **Custom SDKs are provisioning inputs, not ad-hoc host paths.** SDKs are packed/copied into the bash environment with stable runtime paths and no host path leakage.

## Proposed public shapes

### Agent: runtime-free runner

```ts
interface AgentEnvironment {
  sessionStorageRoot: string
  workspaceId?: string
  agentId?: string
  featureGrants?: Record<string, unknown>
}

interface AgentFeature {
  id: string
  tools?(ctx: AgentFeatureContext): AgentTool[] | Promise<AgentTool[]>
  systemPrompt?(ctx: AgentFeatureContext): string | undefined | Promise<string | undefined>
  readinessRequirements?: string[]
}

interface AgentServerFeature extends AgentFeature {
  routes?(ctx: AgentFeatureContext): FastifyPluginAsync | undefined
}

interface AgentFeatureContext {
  agentId: string
  workspaceId?: string
  environment: AgentEnvironment
  getGrant<T>(id: string): T | undefined
}
```

`@hachej/boring-agent` should create an agent with only storage/session state by default. Features add tools/routes/prompt context.

### Boring Bash: one package, layered exports

```txt
@hachej/boring-bash/shared
  BashEnvironment, BashFs, BashExec, BashCapability, BashRequirement

@hachej/boring-bash/server
  createBashEnvironment, file routes, fs event routes, search routes

@hachej/boring-bash/agent
  createBashAgentFeature() -> read/write/edit/ls/find/grep/bash tools

@hachej/boring-bash/plugin
  createBashFrontPlugin() -> file tree, editors/viewers, surface resolver

@hachej/boring-bash/providers
  direct, bwrap, vercel-sandbox, remote-worker, readonly, none
```

Internal layering is allowed; product vocabulary stays one package: `boring-bash`.

### Bash environment

```ts
interface BashEnvironment {
  id: string
  provider: 'direct' | 'bwrap' | 'vercel-sandbox' | 'remote-worker' | string
  runtimeCwd: string
  fs?: BashFs
  exec?: BashExec
  search?: BashSearch
  watch?: BashWatch
  provisioning?: BashProvisioningRuntime
  capabilities: {
    fs: 'none' | 'readonly' | 'readwrite'
    exec: boolean
    realBash?: boolean
    realBinaries?: boolean
    networkIsolation?: 'none' | 'process' | 'container' | 'microvm' | 'provider'
    watch: boolean
    search: boolean
  }
}
```

`none` is valid for agent core, but `boring-bash` itself should no-op if no fs/exec capability exists.

### Runtime mode vs bash provider taxonomy

Do not collapse these names:

| Current runtime mode | Current sandbox provider | Boring-bash provider | Notes |
| --- | --- | --- | --- |
| `direct` | `direct` | `direct` | Trusted host mode; lexical path safety only, no isolation. |
| `local` | `bwrap` | `bwrap` | Linux bubblewrap mode; mode id differs from provider id. |
| `vercel-sandbox` | `vercel-sandbox` | `vercel-sandbox` | Remote sandbox; browser file API and bash must delegate to same provider view. |
| remote-worker adapter | `remote-worker` | `remote-worker` | Worker server/client split must stay explicit. |
| pure/headless | none | none | No workspace/fs/bash/cwd at all. |
| readonly files | provider-specific | `readonly` facade | Optional facade over fs/search without exec. |

Avoid overloaded words:

- use `featureGrants`, not generic `capabilities`, for agent feature grants;
- use `sessionStorageRoot` for transcript/session storage;
- keep `RuntimeBundle.storageRoot` / `getRuntimeBundleStorageRoot()` for host file roots until moved into boring-bash;
- keep current `AgentRuntimeCapabilities` (`nativeFollowUp`, `aiSdkOwnsHistory`) separate from bash provider capabilities.

Provider capability matrix must be explicit, for example:

| Boring-bash provider | FS | Exec | Real Bash | Real binaries | Network isolation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | none | no | no | no | n/a | Pure/headless agent. |
| `readonly` facade | readonly | no | no | no | n/a | File tree/search/viewer without shell. |
| `direct` | readwrite | yes | host-dependent | host-dependent | none | Trusted developer/CI only. |
| `bwrap` | readwrite | yes | host-dependent | host-dependent | process/container-ish | Linux-only; mode id is `local`. |
| `vercel-sandbox` | readwrite | yes | yes | provider image | provider | Remote sandbox/source of truth for sandbox-primary workspaces. |
| `remote-worker` | readwrite | yes | worker-dependent | worker-dependent | worker-dependent | Must report its own matrix through handshake. |

## Bash, files, and storage model

The right abstraction is not “bash implies whole workspace”. It is:

```txt
WorkspaceStorage     durable app/project data
  -> BashVolumeView  selected files, mode, overlays, virtual root
    -> BashSession   optional live process/sandbox over that view
      -> BashTools   model-visible tools backed by that session/view
```

Rules:

1. **Files can exist without bash.** Read-only docs, DB/R2-backed workspaces, file viewers, search, and review agents may need fs/search but no shell.
2. **Bash cannot be separated from a file view.** If `exec` is enabled, it must run against the same virtual file view exposed by fs/search/watch tools. No split brain.
3. **Partial workspace access must be physical for untrusted exec.** API-level path filters are insufficient once a shell exists. For sandbox providers, seed/copy/mount only the allowed subset; for direct mode, mark partial mounts as advisory or disallow untrusted use.
4. **Storage lifetime and sandbox lifetime are different.** The durable workspace may outlive any sandbox. Sandbox templates/sessions are cached projections of a normalized plan.
5. **Recovery needs a stable environment key.** If an interrupted durable session resumes, the bash adapter must either reconnect to the same file view or explicitly surface that file state is gone; conversation durability alone is not enough.
6. **Mutable work should use overlays by default.** A coding agent can get a writable overlay/branch, while a reviewer can get read-only source plus scratch.

### Volume view shape

V1 must still present **one coherent model-visible namespace**. The current documented invariant says file tree root, shell cwd, model-visible cwd, and `BORING_AGENT_WORKSPACE_ROOT` correspond. Phase 0 must either refine/supersede that ADR/runtime-doc invariant or defer multi-mount overlays to v2. Multiple mounts may be implementation details only if they materialize under one `/workspace` view that file routes, search, watch, and exec all share.

```ts
interface BashVolumeView {
  id: string
  workspaceId?: string
  root: '/workspace'
  mounts: BashMount[]
  overlay?: {
    mode: 'none' | 'scratch' | 'branch' | 'persistent'
    persistAs?: 'workspace-patch' | 'artifact' | 'discard'
  }
}

interface BashMount {
  id: string
  source: 'workspace' | 'template' | 'artifact' | 'sdk' | 'scratch'
  target: string // virtual absolute path, usually under /workspace
  mode: 'readonly' | 'readwrite'
  include?: string[]
  exclude?: string[]
}
```

### Sandbox policy shape

```ts
interface BashSandboxPolicy {
  provider: 'none' | 'direct' | 'bwrap' | 'vercel-sandbox' | 'remote-worker' | string
  volume: BashVolumeView
  exec?: {
    enabled: boolean
    rawBash?: boolean
    predefinedTools?: string[]
    commandPolicy?: BashCommandPolicy
    timeoutMs?: number
  }
  network?: 'disabled' | 'allowlisted' | 'allow-all'
  env?: Record<string, string>
  secrets?: string[] // names only; host exposes status/grants, never raw values to browser/model
  services?: BashManagedServiceRequirement[] // long-lived dev servers, ports, iframe/proxy grants
  provision?: BashRequirement['provisioning']
}
```

This policy can be declared at app, child-app, workspace, agent, subagent, session, or plugin level. The effective runtime is an intersection, not a union of powers:

```txt
effective = backend capabilities ∩ app defaults ∩ childApp/workspaceKind policy ∩ workspace max policy ∩ agent policy ∩ session/user grants ∩ plugin/tool requirement
```

Resolution order should be explicit:

```txt
app defaults < childApp/workspaceKind policy < workspace policy < agent policy < subagent policy < session/user grants < plugin/tool requirement
```

The resolver must reject impossible merges instead of silently widening access.

### Storage-primary vs sandbox-primary

Every workspace runtime must choose one source-of-truth model:

| Model | Source of truth | Use when |
| --- | --- | --- |
| sandbox-primary | live sandbox `/workspace` | remote coding sessions where file API/tree/search/bash should all delegate to the sandbox |
| storage-primary | host/object/git storage; sandbox is materialized view/overlay | disposable sandboxes, review agents, patch workflows, restricted file exposure |

Forbidden split-brain states:

- file tree reads host `/data/workspaces/<id>` while bash edits remote `/workspace`;
- git/branch/status routes read a different source of truth than file routes and bash;
- `read_file` hides files but raw bash can still access them;
- session durability is treated as file durability, or vice versa.

## Declarative agent model

We should support both a TypeScript API and manifest/layout-driven declarations.

### TypeScript API

```ts
const codingAgent = defineBoringAgent({
  id: 'coding',
  model: 'anthropic/claude-sonnet-4-6',
  instructions: './instructions.md',
  features: [uiBridgeFeature()],
  bash: {
    provider: 'vercel-sandbox',
    volume: {
      root: '/workspace',
      mounts: [{ id: 'repo', source: 'workspace', target: '/workspace', mode: 'readwrite' }],
      overlay: { mode: 'branch', persistAs: 'workspace-patch' },
    },
    exec: {
      enabled: true,
      rawBash: false,
      predefinedTools: ['git_diff', 'run_tests', 'apply_patch'],
    },
  },
})
```

### Package/layout API

Eve’s slot model is worth copying for authored agent packages:

```txt
agent/
  agent.ts              runtime config
  instructions.md       base prompt
  tools/*.ts            authored tools, path-derived names
  skills/*              on-demand procedures
  subagents/*           child agents
  channels/*            Slack/email/HTTP/etc.
  bash.ts               sandbox policy, provider, mounts, bootstrap
  bash/workspace/**     files seeded into /workspace
```

For boring-ui plugins, keep package manifests, but use the same concepts:

```jsonc
{
  "boring": {
    "requires": ["boring-bash"]
  },
  "bash": {
    "capabilities": { "fs": "readonly", "exec": false },
    "mounts": [{ "source": "workspace", "include": ["docs/**"] }]
  }
}
```

### Framework tool registration

Borrow eve’s override/disable rule and Flue’s adapter tool-factory seam, but reconcile it with the existing boring-ui tool families:

- core agent registers only model/session/channel tools;
- `boring-bash` contributes default file/bash/upload tools only when active;
- move or explicitly keep out of scope the true current inventory:
  - `buildHarnessAgentTools()`: `bash`, `execute_isolated_code`;
  - `buildFilesystemAgentTools()`: `read`, `write`, `edit`, `find`, `grep`, `ls`;
  - `buildUploadAgentTools()`: upload/runtime artifact tools bound to the runtime bundle;
- preserve existing readiness tags/contracts (`workspace-fs`, `sandbox-exec`, `runtime-dependencies`, `runtime:<id>`);
- unify with `disableDefaultFileTools` instead of adding a parallel disable path; decide separately whether bash/harness tools get their own disable flag;
- agent/plugin declarations may disable defaults (`read`, `write`, `bash`) or replace them by name;
- a sandbox policy can expose predefined command tools without exposing raw `bash`;
- reserved framework names (`task`, `finish`, `exec_ui`, etc.) remain protected.

## Plugin and agent bash requirements

Plugins and agent packages need to say whether they require `boring-bash` and what must be installed into it.

### Requirement shape

```ts
interface BashRequirement {
  id: string
  source: 'agent' | 'plugin' | 'app'
  optional?: boolean
  capabilities?: {
    fs?: 'readonly' | 'readwrite'
    exec?: boolean
  }
  provisioning?: {
    templateDirs?: RuntimeTemplateContribution[]
    nodePackages?: RuntimeNodePackageSpec[]
    python?: RuntimePythonSpec[]
    sdkArchives?: BashSdkArchiveSpec[]
    env?: Record<string, string>
    pathEntries?: string[]
  }
  readiness?: {
    timeoutMs?: number
    healthCheck?: BashHealthCheckSpec
  }
  services?: BashManagedServiceRequirement[]
}

interface BashManagedServiceRequirement {
  id: string
  command: string | string[]
  cwd?: string
  ports?: Array<{ port: number; purpose: 'iframe' | 'api' | 'preview'; public?: boolean }>
  healthCheck?: BashHealthCheckSpec
  teardown?: 'kill-process-tree' | 'provider-default'
}
```

### Manifest-level declaration

Add a boring manifest field for runtime needs. Validation must be import-free: hosts should be able to inspect `boring.requires` and `bash` capability/provisioning blocks before executing plugin or workspace-authored agent code.

```jsonc
{
  "boring": {
    "front": "front/index.tsx",
    "server": "server/index.ts",
    "requires": ["boring-bash"]
  },
  "bash": {
    "capabilities": { "fs": "readwrite", "exec": true },
    "nodePackages": [{ "id": "my-cli", "packageName": "my-cli" }],
    "python": [{ "id": "my-sdk", "projectFile": "sdk/pyproject.toml" }]
  }
}
```

Rules:

- `requires: ["boring-bash"]` means the plugin should not activate unless the host enables the bash package/capability.
- A front-only viewer can require only fs readonly.
- A tool/plugin that runs commands must request exec.
- Optional requirements degrade gracefully and surface diagnostics.

## Smarter provisioning model

Current provisioning (`ProvisionWorkspaceRuntimeOptions` / `provisionWorkspaceRuntime()`) should evolve, not be thrown away.

### Extend the existing resolver

Do not create a parallel `resolveBashProvisioningPlan()` path unless it is a thin normalization layer feeding `provisionWorkspaceRuntime()`. The real delta is:

```ts
resolveBashProvisioningRequirements({
  workspaceId,
  agentId,
  enabledPlugins,
  agentDefinition,
  appDefaults,
  provider,
}) -> ProvisionWorkspaceRuntimeOptions
```

It should:

1. collect requirements from app, agent definition, and plugins;
2. validate capability needs against the selected bash provider before provisioning;
3. merge into the existing structural provisioning contribution model by stable `id`;
4. reject conflicting definitions for the same `id` unless a resolver is explicit;
5. keep the existing fingerprint/`WorkspaceProvisioningResult.changed` skip behavior;
6. preserve existing readiness keys used by `mergeTools({ checkReadiness })`;
7. extend readiness from current aggregate states (`not-started`, `preparing`, `ready`, `failed`) to per-requirement states, adding `optional_failed` only as a compatible extension;
8. add optional `healthCheck` / SDK archive support without bypassing pack-artifact rules.

### Scoping

Provisioning must support these scopes:

| Scope | Use case |
| --- | --- |
| workspace | shared project files/CLIs used by all agents |
| agent | agent-specific SDKs, prompts, tools, channel adapters |
| plugin | plugin-specific CLIs/SDKs/assets |

The physical layout can still be under `.boring-agent/` initially, but the metadata must know who requested each piece.

### Custom SDKs

Custom SDKs should enter the sandbox through declared provisioning, not arbitrary host paths:

- local npm/Python packages are packed into tarballs for sandbox providers;
- static SDK assets are copied via `templateDirs` / `sdkArchives`;
- runtime env values that point at files are rewritten to sandbox-visible paths;
- secrets are declared by name only and injected by the host, never written into plan files;
- SDK health checks can gate related tools.

This preserves the existing pack-artifact rule for sandbox modes and avoids leaking `/home/...` or app-private paths into the model.

## UI bridge and runtime plugin RPC compatibility

`boring-bash` must not swallow or replace the workspace bridge.

Keep these workspace-owned surfaces stable:

- `UiBridge.postCommand()`
- `/api/v1/ui/state`
- `/api/v1/ui/commands`
- `/api/v1/ui/commands/next`
- `exec_ui` / `get_ui_state` tools from workspace server composition
- `WorkspaceBridge` front API
- runtime plugin gateway `/api/v1/plugins/:pluginId/*`

`boring-bash/plugin` contributes a `workspace.open.path` surface resolver and file panes. Agents still open files through `openSurface`/`openFile` commands. If the bash plugin is not enabled, those panels/resolvers simply are not registered and UI tools report missing panels/capabilities.

Runtime plugin RPC should gain capability context, not a new route family:

```ts
interface RuntimePluginContext {
  pluginId: string
  workspaceId?: string
  availableFeatures: {
    bash?: BashEnvironmentSummary
    uiBridge?: boolean
  }
}
```

Generated/runtime plugin backends that require bash should declare it in manifest. The runtime backend registry should skip or diagnose them when `boring-bash` is not active.

## Multi-agent workspace model

A workspace should be able to compose several agents with different bash needs:

```ts
agents: [
  { id: 'coding', package: '@hachej/coding-agent', features: ['boring-bash'] },
  { id: 'reviewer', package: '@hachej/review-agent', features: ['boring-bash'], bash: { fs: 'readonly', exec: false } },
  { id: 'concierge', package: '@hachej/email-agent', features: [] },
]
```

Required namespace additions:

- routes: `/api/v1/agents/:agentId/...` or header-scoped equivalent;
- bindings: include `agentId` in the existing binding scope key alongside mode, workspace id, root, template path, pi flag, and session namespace;
- sessions: include `agentId` in `sessionNamespace` and the session-root layout, preserving the AGENTS.md rule that transcripts live on the host durable session volume (`BORING_AGENT_SESSION_ROOT`, not workspace/container home);
- tool catalog: per agent;
- provisioning: per `(workspaceId, agentId, bashPlanFingerprint)`;
- bridge commands: include `agentId` where useful for attribution, but keep workspace UI state shared.

Required isolation test: two agents in one workspace with same `sessionId` must not share harness bindings, tool catalogs, or transcripts.

### Agent node vs subagent profile

Use two distinct concepts, because Flue and eve prove they solve different problems:

| Concept | Environment | Best for |
| --- | --- | --- |
| `AgentProfile` | Same parent bash environment, optionally narrower cwd/view | cheap delegated tasks, same workspace/tool trust |
| `AgentNode` | Own config, tools, channels, sandbox policy, durability | specialist agents with different provider/mount/tool/network policy |

Defaults should be conservative:

- declared child agents inherit **nothing** unless explicitly configured;
- “copy of current agent” delegation may share parent sandbox state, but must be explicit;
- narrower child views are allowed; wider child views require owner approval or workspace policy;
- delegation depth must be capped;
- shared-sandbox copy agents need non-overlapping write scopes or stale-write detection before concurrent writes are allowed.

### User as an agent?

Do **not** model the human user as an autonomous agent with max powers.

Model the user as a **Principal / Supervisor / Approval Channel**:

- principals own capabilities (`workspace.owner`, `bash.grant`, `secret.grant`, `merge.approve`);
- agents request capabilities through explicit gates;
- UI/HITL channels carry user decisions into the session;
- audit logs attribute every escalation to the user/principal, not to a model persona.

It is useful to render the user as a node in an orchestration graph, but dangerous to make “user” a model-callable super-agent. If we later build a personal assistant with broad powers, it is still just an agent with a declared policy, not magic root authority.

## Open issue coverage check

A sweep of the current open GitHub issues says this abstraction covers the core runtime/package-boundary tracks, but it should not claim to cover the whole backlog.

### Directly covered or materially advanced

- Runtime-free agent / package boundary / harness pluggability: #391, #12, #242.
- Bash/runtime provider abstraction and sandbox source-of-truth: #16, #223.
- File API/UI ownership by boring-bash: #26, #220, #221.
- Plugin/runtime capability declarations and remote-safe diagnostics: #357, #254, #256.
- Multi-agent/session scoping foundation: #243, #211.

### Indirectly helped, but requires explicit extra abstractions

These are **not automatically solved** by boring-bash; the plan must leave hooks for them:

1. **External harness review/question hooks (#380).** Add a channel-neutral hook ingestion API with source harness/session ids, auth, redaction, routing, and approval/HITL mapping.
2. **Session history search (#379).** Add a session index/search API independent of bash, scoped by `workspaceId` + `agentId`, with Pi title/name/content parity and deep-link tests.
3. **Child-app platform (#376).** Add `childAppId` / `workspaceKind` into the effective policy stack between app defaults and workspace policy. Auth, billing, domains, and Stripe products stay separate.
4. **Remote-worker hardening (#307).** Remote-worker provider handshake must report concrete isolation claims: gVisor/seccomp status, per-workspace network isolation, private metadata/CIDR egress policy, and cross-workspace boundary.
5. **Hosted external plugins and secrets (#357, #181).** Manifest validation must fail closed in remote modes before executing plugin code. Browser/plugin contexts get secret status/grant metadata only, never raw secrets.
6. **Long-lived plugin services (#328, #258).** Some plugins need more than one-shot bash: managed process lifecycle, health checks, port/iframe grants, command policy, and teardown.
7. **File tree replacement (#295).** `boring-bash/plugin` should expose a file tree data-provider boundary and optional path-list/tree-index endpoint so tree UI can change without reworking routes.
8. **Markdown collaboration/document authority (#367, #226).** `write`/`edit` tools must be overridable/routable through document coordinators such as TipTap/Yjs, with stale version/hash checks, so file tools do not bypass live collaborative state.
9. **Git/source-of-truth compatibility (#189).** Branch/status routes must use the same storage-primary or sandbox-primary source as file routes and bash.
10. **Operational commands and provider failures (#371, #228, #224).** Compaction/provider recovery and slash-command handling are agent/session concerns, not boring-bash; expose a non-bash operational-event/command seam if route composition changes.

### Out of scope for this abstraction

Keep these as separate tracks: product plugins (#381, #197), multi-project left-bar UI work (#377, #361, #363, #362), visual/theme/pane polish (#375, #358, #308, #283, #257), desktop wrapper (#318), workbench performance (#267), billing/auth/database work (#127, #51, #27), docs annotation/review UI (#122), dependency migrations (#95), core-neutral catalog routes (#21), and event-bus typing (#5).

## Migration phases

### Phase 0 — ADR, naming lock, and invariant update

- Add an ADR: `boring-agent` becomes runtime-free; `boring-bash` owns files/bash/file UI.
- Update `docs/DECISIONS.md` §7 and `packages/agent/docs/runtime.md`: mark `Workspace + Sandbox` pairing as a `boring-bash` invariant, not an agent invariant.
- Explicitly decide v1 namespace semantics: preserve one coherent model-visible `/workspace` namespace; defer arbitrary multi-mount overlays unless the ADR defines how they still materialize into one namespace.
- Lock package name as `@hachej/boring-bash`.

### Phase 1 — Dependency inversion and true no-runtime mode

- Invert dependency first: `createAgentApp()` / `registerAgentRoutes()` stop statically importing `resolveMode()` / built-in runtime modes. Runtime/features are injected by host/CLI/composition.
- Add an invariant test that `@hachej/boring-agent` has zero value imports from `@hachej/boring-bash`.
- Add feature/grant registry to agent server composition, reusing existing `registerCapabilitiesContributor` where possible.
- Add a channel-neutral external review/question hook ingestion API with source harness/session ids, auth, redaction, routing, and approval/HITL mapping.
- Add a non-bash operational-event/command seam if route composition touches slash commands, reload, compaction, or provider recovery.
- Add a `runtime: none` or `features: []` path that registers only chat/session/model routes.
- Separate `sessionStorageRoot` from workspace root/cwd and existing `RuntimeBundle.storageRoot`.
- Audit `createPiCodingAgentHarness` and pi-coding-agent resource/system-prompt loading for implicit cwd, AGENTS.md, workspace context, and file/tool assumptions. Decide whether pure headless mode can use pi or needs a non-pi harness.
- Ensure no file/tree/search/git/bash/upload routes/tools are mounted without `boring-bash`.

### Phase 2 — Create `@hachej/boring-bash`

- Create package and type-only shared contracts without introducing an agent↔bash value import cycle.
- Move shared workspace/sandbox/runtime contracts into `boring-bash/shared` only after Phase 1 injection is in place.
- Move providers/adapters: direct, bwrap, vercel-sandbox, remote-worker, preserving the mode/provider mapping table.
- Clarify the remote-worker split before moving: client/mode code currently lives under agent; worker server code currently lives in `apps/full-app`.
- Keep compatibility re-exports from `@hachej/boring-agent/server` during migration.

### Phase 3 — Move file routes and tools

- Move file/tree/search/fs-events/stat/dir routes into `boring-bash/server`.
- Move `buildFilesystemAgentTools()` (`read/write/edit/find/grep/ls`) and `buildHarnessAgentTools()` bash-related pieces (`bash`, `execute_isolated_code`) into `boring-bash/agent` or consciously split `execute_isolated_code` with a documented owner.
- Move or explicitly retain `buildUploadAgentTools()` with a documented owner.
- Preserve readiness tags and existing `disableDefaultFileTools` behavior; add a separate bash/harness disable flag only if needed.
- Replace hardwired agent registration with injected `createBashAgentFeature()`.

### Phase 4 — Move filesystem front plugin

- Move `packages/workspace/src/plugins/filesystemPlugin/front/*` to `boring-bash/plugin`.
- Preserve workspace coupling contracts: panel ids, `surfaceResolver`, file panel binding, agent file bridge/session-change integration, and fetch routes under `/api/v1/files/*` or compatibility aliases.
- Introduce a `FileTreeDataProvider` boundary plus optional path-list/tree-index route and fs-event delta contract, so file tree UI can be replaced without rerouting file APIs again.
- Support document-authority overrides: `write`/`edit` can route through editor/document coordinators (TipTap/Yjs/etc.) with stale version/hash checks when a live collaborative document owns the file.
- Keep workspace default plugin import/re-export compatibility initially.
- Preserve panel ids and surface resolver behavior.

### Phase 5 — Smarter provisioning by extending current provisioning

- Introduce `BashRequirement` and an import-free requirement normalizer that feeds `provisionWorkspaceRuntime()`.
- Convert current plugin/app provisioning into requirement sources without losing `WorkspaceProvisioningResult.changed` fingerprint skipping.
- Add readiness diagnostics per requirement while preserving current aggregate readiness keys and states.
- Add `optional_failed`, health checks, and SDK archives as compatible extensions.
- Gate tools on existing readiness keys (`runtime-dependencies`, `runtime:<id>`, `workspace-fs`, `sandbox-exec`).
- Reconcile Vercel template packaging/snapshotting with a two-phase bootstrap/on-session model.

### Phase 6 — Plugin manifest requirements

- Add import-free manifest validation for `boring.requires` and `bash` block before executing plugin/agent code.
- Runtime plugin manager reports clear diagnostics when a plugin requires missing bash capabilities.
- Runtime backend RPC receives available feature context.
- Add hosted-plugin remote-mode constraints: fail closed when a plugin requires unavailable bash/fs/exec/service/secret features.
- Add host-owned secret status/grant API; browser plugin contexts see status only, never raw values.
- Add managed service lifecycle for trusted plugins that need dev servers or previews: process supervision, health, port/iframe/proxy grants, and teardown.
- Map user approval/HITL grants to concrete tool visibility; hide approval tools when a session cannot request input.

### Phase 7 — Multi-agent routing

- Add `agentId`-scoped routes/session/catalog/provisioning.
- Thread `agentId` through binding scope key, `sessionNamespace`, and session root layout.
- Add session-history index/search API scoped by `workspaceId` + `agentId`, independent of boring-bash, with title/name/content search parity for Pi sessions.
- Preserve URL/deep-link compatibility for multi-project and multi-agent session routes.
- Update `WorkspaceAgentFront` to compose agent definitions, not one implicit agent.
- Keep one shared workspace UI bridge, with optional `agentId` attribution.

## Test plan

Minimum gates before considering the migration complete:

- pure agent server starts with no workspace, no file routes, no file tools, no bash tool, no cwd prompt leakage;
- pi no-filesystem system-prompt snapshot proves no AGENTS.md/workspace context is injected in pure mode, or pure mode uses a non-pi harness;
- import invariant: `@hachej/boring-agent` has no value imports from `@hachej/boring-bash`;
- mode/provider mapping tests cover `direct`, `local`→`bwrap`, `vercel-sandbox`, `remote-worker`, `none`, and readonly facade behavior;
- existing workspace playground still opens file tree/editor and uses read/write/bash;
- `exec_ui openFile` still opens files through the moved boring-bash panels;
- runtime plugin RPC `/api/v1/plugins/:pluginId/*` still reloads and dispatches;
- import-free plugin manifest validation diagnoses `boring-bash` requirements before executing plugin code;
- plugin requiring `boring-bash` is skipped/diagnosed when bash disabled;
- plugin requiring a custom SDK provisions it and gates tools until ready;
- readiness compatibility: existing `not-started`/`preparing`/`ready`/`failed` states and readiness tags continue to gate tools;
- `disableDefaultFileTools` parity is preserved after moving tools;
- remote-worker mode still avoids split brain: browser file API and bash see same files;
- Vercel sandbox provisioning still packs local SDKs, no symlink/host path leakage;
- core full-app can disable external plugins and still compose static boring-bash;
- multi-agent session namespaces do not collide and two agents with same session id do not share harness bindings/transcripts;
- shared-sandbox subagents enforce delegation depth cap and stale-write/non-overlapping write safeguards;
- external review/question hook creation, redaction, auth, and routing work without requiring boring-bash;
- session-history index/search returns correct results scoped by `workspaceId` + `agentId` and preserves Pi title/name parity;
- child-app/workspace-kind policy can narrow bash requirements and never widens workspace policy;
- remote-worker provider handshake reports isolation/network capability claims and fail-closed behavior;
- hosted plugin validation fails closed before executing plugin code when bash/service/secret requirements are unavailable;
- managed service plugin lifecycle covers start, health, port/iframe/proxy grant, and teardown;
- `FileTreeDataProvider` path-list/tree-index and fs-event deltas work with existing file routes;
- document-authority override routes write/edit through collaborative document coordinator when active;
- git/branch/status routes use the same source of truth as file routes and bash.

## Open decisions

1. Should bash providers live under `boring-bash/providers` or a separate private package later?
2. Route shape for multi-agent: path prefix `/api/v1/agents/:agentId` vs header-based scoping?
3. How much provisioning is workspace-shared vs agent-private by default?
4. Should readonly fs be a first-class capability in v1 or deferred?
5. Is arbitrary multi-mount/overlay support v1, or do we preserve a single `/workspace` view and defer advanced projections?
6. Is pure/headless mode implemented through pi-coding-agent with cwd disabled, or a separate non-pi harness?

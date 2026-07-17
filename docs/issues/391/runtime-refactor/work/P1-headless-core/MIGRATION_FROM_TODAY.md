> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# P1 migration — from today's code to the target interface

> **V1 migration amendment (2026-07-10).** Migrate by extracting the smallest
> environment-/Fastify-independent core boundary from the existing
> workspace-backed path. Do not use the already-present pure implementation as
> v1 product acceptance and do not make the agent binary pure-only. Workspace
> activation is the composition authority for plugins, skills, prompt
> fragments, tools, routes, UI, and runtime. The minimal `agents/<name>/`
> compiler is A1 v1; generic per-agent plugin/environment resolution and a true
> no-environment host are post-v1.

> Purpose: connect the ideal capability design to the current boring-ui codebase and define the P1/P2/P3/P4/P6 migration path.

## Current state

Thermonuclear code review verdict: **refactor/extract, do not reimplement from scratch**. A large part of P1 already exists: `createAgent()` has the nine-member API, the `./core` export exists, pure `runtime: 'none'` exists, session auth/live buffering/send locks/stable T1 stub errors are implemented and tested, and the runtime/tool/route seams already match the target lowering. A scratch rewrite would discard subtle working behavior and violate the P1 behavior-parity goal.

The current agent server already has useful seams, but they are not yet organized around resolved capability facts.

Main files:

- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/agent/src/server/createAgentApp.ts`
- `packages/agent/src/server/agentRouteBindingProfile.ts`

Existing useful seams to keep/promote:

- existing `createAgent()` / `createAgentRuntimeBridge()` session auth, live buffer, send locks, terminal-event handling, T1 stub, and dispose logic;
- `@hachej/boring-agent/core` package export and shared `Agent` / `AgentConfig` / `AgentEvent` types;
- `AgentCoreHarnessFactory` and `AgentHarness` as the harness injection seam;
- `HarnessPiChatService` as the current chat/session service adapter;
- `RuntimeModeAdapter` / `RuntimeBundle` as the runtime injection seam P2 moves out;
- `AgentRouteBindingProfile` as the Fastify-lowering seam;
- `registerCapabilitiesContributor` as the P1 capability exposure seam;
- existing createAgent/createAgentApp/registerAgentRoutes/direct-flip/prompt regression tests as behavior guards;
- `disableDefaultFileTools`
- `buildHarnessAgentTools()` for bash / harness operational tools
- `buildFilesystemAgentTools()` for read/write/edit/find/grep/ls
- `buildUploadAgentTools()`
- `RuntimeBundle.workspace`
- `RuntimeBundle.filesystemBindings`
- `RuntimeBundle.fileSearch`
- `workspaceFsCapability`
- `ReadyStatusTracker` / runtime dependency readiness
- `registerCapabilitiesContributor`
- workspace-owned UI bridge/routes already moved outside agent

Current risks / remaining blockers:

- Minimal `ResolvedAgentCapabilities` projection is not implemented yet.
- The current `@hachej/boring-agent/core` export still re-exports implementation from `src/server/createAgent.ts`; the core graph can drag server/Pi/node filesystem assumptions. The target is core implementation under `src/core/`, with Pi harness defaults injected by server adapters.
- Pure mode still materializes a real temp cwd as a sealed shim. The pi-harness audit must prove this leaks no cwd/workspace/AGENTS.md/file/skill residue, or remove it.
- `Agent.readiness` is currently not backed by the HTTP `ReadyStatusTracker`; headless readiness must become honest or explicitly injected.
- Embedded runtime-binding cache eviction must dispose live agents/bindings, not only delete map entries.
- `runtimeMode` can become a feature switch.
- `AgentRouteBindingProfile` can become the de facto capability source of truth.
- file routes/tools/prompt/skills/UI can drift independently.
- pure mode can reject tools but still leak file vocabulary elsewhere.
- scalar filesystem/shell/attachment thinking can hide the real environment bundle that grants authority.

## Target lowering

The target lowering is:

```txt
ResolvedAgentComposition
  -> legacy Fastify adapter lowering
  -> AgentRouteBindingProfile
  -> registerAgentRouteBindingProfile(app, profile)
```

During migration, we can approximate this without building the whole resolver:

```txt
current opts + mode adapter + runtime bundle + tool arrays
  -> minimal ResolvedAgentCapabilities
  -> existing AgentRouteBindingProfile
```

The important rule: new consumers should look at semantic facts, not runtime mode.

## Current-to-target mapping

P1/P2 should use a host-side strangler adapter from today's `RuntimeBundle` to
the new environment seam:

```ts
function prepareEnvironmentInputsFromBundle(bundle: RuntimeBundle): {
  facts: readonly ResolvedEnvironment[]               // agent core
  contributions: AuthGatedEnvironmentContributions    // host invokes per operation
  tools: readonly AgentTool[]
  readinessRequirements: readonly string[]
  systemPromptFragments: readonly string[]
  inputAssetHandler?: InputAssetHandler
} {
  // user environment from bundle.workspace + bundle.sandbox + bundle.fileSearch
  // additional named environments from bundle.filesystemBindings
}
```

This lets current code keep working while tools/routes/prompt migrate from
scattered `RuntimeBundle` fields to host-owned prepared attachments. Agent core
receives only the flattened inputs and methodless facts, never an
operation-bearing environment object.

| Today | Target meaning | P1 handling |
| --- | --- | --- |
| `mode: 'none'` / `PURE_RUNTIME_MODE` | no attached environments | project to `environments: []` |
| `mode: 'direct'`, `vercel-sandbox`, etc. | diagnostic runtime/provider choice | keep behavior; do not branch new code on it |
| `RuntimeBundle.workspace` | current default user environment filesystem facet | adapt to `AgentEnvironment(id: 'user').filesystem` |
| `RuntimeBundle.sandbox` / bash strategy | current exec implementation | adapt to `AgentEnvironment(id: 'user').exec` and `tools: ['bash']` when present |
| `runtimeBundle.fileSearch` | search facet for current user filesystem | keep as route/tool implementation detail behind the environment adapter |
| `runtimeBundle.filesystemBindings` | additional named filesystem bindings | fold into additional `AgentEnvironment` projections |
| `RuntimeBundle.storageRoot` | provider-private host path | never expose as capability; route/provider implementation detail only |
| `workspaceFsCapability` | provider/workspace fidelity diagnostic | keep diagnostic; not primary residue gate |
| `buildFilesystemAgentTools()` | environment filesystem tool bundle | later owned by boring-bash environment contribution |
| `buildUploadAgentTools()` | input asset persistence into writable environment | later derived from `environments[].filesystem.acceptsInputAssets` |
| `buildHarnessAgentTools()` bash parts | environment-bound bash tool bundle | later represented as `environments[].tools` including `bash` |
| `AgentRouteBindingProfile.filesystem` | Fastify file route adapter options | adapter output derived from capabilities/contributions |
| `registerCapabilitiesContributor` | existing capability exposure seam | use for minimal `ResolvedAgentCapabilities` projection |

## Refactor strategy: strangler extraction, not rewrite

Recommended implementation strategy:

1. Treat the existing `createAgentRuntimeBridge()` as the core seed.
2. Move core implementation under `src/core/`; make `server` import `core`, never the reverse.
3. Remove hidden dynamic Pi default from core; server adapters inject `createPiCodingAgentHarness` and any sealed pure cwd shim.
4. Add `ResolvedAgentCapabilities` in shared/wire schema and expose pure + compatibility projections.
5. Extract runtime-binding/profile factories from `registerAgentRoutes.ts` until Fastify code is mostly adapter wiring.
6. Preserve existing HTTP behavior and prove with current tests/e2e before moving runtime adapters in P2.

Rewrite only if the pi-harness audit proves Pi cannot run without filesystem/cwd assumptions. Current evidence does not suggest that.

## Pre-implementation unknowns and spikes

The unknowns pass found no design blocker, but it identified checks that should run before implementation is treated as mechanical:

### Known unknowns to close early

1. **Pi-harness residue audit:** can Pi run with no real cwd/workspace/file authority, or is the sealed temp-cwd shim a permanent compromise?
2. **Headless readiness:** should `Agent.readiness` be backed by a shared tracker or injected by adapters?
3. **Core graph boundary:** how much of today's `server/createAgent.ts` must move under `src/core/` for `@hachej/boring-agent/core` to be genuinely Fastify/Pi-default/node-fs free?
4. **Headless tenancy:** when `workspaceId` is absent, is `sessionStorageRoot` alone the isolation boundary, or do headless surfaces need another host-supplied namespace?
5. **Capability wire versioning:** should `ResolvedAgentCapabilities` carry a schema version before P2/P3 change coarse compatibility projections into real attachment facts?
6. **Cross-surface control:** if HTTP routes and headless core share a session/service, can one surface interrupt/stop turns started by another, and what actor checks apply?

### Spike results from code reconnaissance

1. **Core graph check:** current `@hachej/boring-agent/core` exports `createAgent` from `src/server/createAgent.ts`, which statically pulls `HarnessPiChatService` and `createPureRuntimeCwd`; `createPureRuntimeCwd` pulls `node:fs/promises`, `node:os`, and `node:path`. The default Pi harness is a dynamic import when no `harnessFactory` is supplied and pulls Pi SDK + Node modules. Fastify appears type-only on this path today, but the core graph is not clean enough. P1 must move/split implementation into `src/core/` and make Pi defaults server-injected.
2. **Pure prompt residue:** current pure mode still uses a sealed cwd and the Pi harness path. `noContextFiles` / `noSkills` reduce ambient discovery, but Boring's existing workspace-path/file-tool prompt addendum is unconditional and mentions workspace paths, sandbox, `find`/`grep`/`ls`, `read`/`edit`/`write`. P1 needs a full pure prompt residue snapshot and capability-gated prompt fragments.
3. **Pre-T1 restart/offset:** after restart, the façade live buffer is empty. `stream(sessionId, { startIndex: 0 })` can hang silently instead of throwing `ERR_NOT_IMPLEMENTED_UNTIL_T1`; `startIndex > 0` can produce `CURSOR_OUT_OF_RANGE`. P1 must fail closed with the T1 stub for stale pre-restart offsets.
4. **Runtime-binding eviction:** pure LRU eviction deletes the cache entry and calls `agent.dispose()`, but route-owned `HarnessPiChatService` streams may remain. Runtime LRU eviction only deletes map entries and does not dispose agents/services/runtime bindings. P1 needs explicit per-binding disposal semantics and app-close disposal of all cached bindings.
5. **Headless session namespace:** two pure agents sharing one explicit `sessionStorageRoot` with `workspaceId` undefined share the same unscoped session directory and can list/load/delete each other's `{}` sessions. Current model is **root-scoped sharing**, not per-agent isolation. Hosts need distinct `sessionStorageRoot` or a deliberate namespace if isolation is required.

### Spikes/tests to codify

1. **Core graph invariant:** import built `@hachej/boring-agent/core` in plain Node and forbid Fastify plus server/Pi/default-harness/node-fs edges according to the desired strictness.
2. **Full pure prompt residue snapshot:** assert the entire composed system prompt, including Pi-generated text, contains no cwd/workspace/file/bash/AGENTS.md guidance in pure mode.
3. **Pre-T1 restart/offset behavior:** start a turn, capture `startIndex`, restart process, call `stream(sessionId, { startIndex })`, and require a typed `ERR_NOT_IMPLEMENTED_UNTIL_T1` rather than hang or `CURSOR_OUT_OF_RANGE`.
4. **Runtime-binding eviction under load:** evict a binding with an active stream and assert deterministic disposal/iterator behavior without leaking producers.
5. **Headless namespace decision test:** decide whether shared `sessionStorageRoot` intentionally means shared headless history; add either a sharing regression test or an isolation/namespace test.

These findings do not change the target interface. They decide whether P1 implementation can stay a straightforward extraction or needs a scoped design decision before coding continues.

## P1 concrete changes

### 1. Define the shape

Introduce or document `ResolvedAgentCapabilities` with:

```ts
{
  v?: 1
  runtimeMode?: string
  environments: ResolvedEnvironment[]
  tools: string[]
  skills: string[]
  mcpServers: string[]
  plugins: string[]
}
```

**Amendment (2026-07-08):** `plugins[]` carries the resolved plugin ids the agent actually carries, and `tools[]`/`skills[]`/`mcpServers[]` reflect plugin-contributed capabilities after per-agent plugin resolution. Do not store scalar `filesystem`, `shell`, or `attachments` facts. Derive helper answers from `environments[]`.

P1 can keep this in server/shared types if that is the smallest low-risk step. Later phases can move/expand it into the public core contract. Workspace/front consumers should consume the JSON wire schema from `/api/v1/capabilities` or `/agents/:id/info`, not value-import agent package runtime code.

### 2. Pure-mode projection

For pure mode, expose:

```ts
{
  v: 1,
  runtimeMode: 'none',
  environments: [],
  tools: toolNames(actualRegisteredTools),
  skills: [],
  mcpServers: [],
}
```

Extra injected custom tools are allowed. They do not imply filesystem/shell.

### 3. Compatibility projection for existing coding modes

Without changing behavior, existing direct/local/vercel modes may project:

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
  tools: toolNames(actualRegisteredTools),
  skills: [],
  mcpServers: [],
}
```

This is intentionally coarse. P2/P3 will replace it with real boring-bash/environment resolution.

### 4. Keep HTTP behavior unchanged

P1 must not surprise existing routes. `createAgentApp()` and `registerAgentRoutes()` remain adapters. File routes remain for existing non-pure modes. Pure mode has no file routes/bash/file tools.

### 5. Avoid new `runtimeMode` branches

If a new check is needed, write it against capabilities:

```ts
if (capabilities.environments.length === 0) { ... }
if (capabilities.environments.some((env) => env.filesystem?.acceptsInputAssets)) { ... }
```

Do not add:

```ts
if (resolvedMode === 'none') { ... }
```

except in the compatibility shim that initially derives facts from current options.

## `createAgent()` extraction path

Target core API:

```ts
interface AgentCore {
  start(input): Promise<{ sessionId: string; startIndex: number }>
  stream(sessionId, options): AsyncIterable<AgentEvent>
  send(input): Promise<AgentSendResult>
  resolveInput(sessionId: string, requestId: string, response: AgentResolveInputResponse): Promise<void> // resolves a pending approval/input request; does not return model output
  interrupt(sessionId): Promise<void>
  stop(sessionId): Promise<void>
  sessions: AgentSessionStore
  readiness: AgentReadiness
  dispose(): Promise<void>
}
```

P1 extraction order:

1. Relocate the existing façade/bridge implementation from `src/server/createAgent.ts` into `src/core/` or split it so the published `./core` graph contains no Fastify, Pi SDK default factory, `node:fs` pure-cwd helper, env reads, or server route imports.
2. Make `AgentConfig.harnessFactory` required at the core layer, or otherwise require an explicit injected runtime/harness factory. Server adapters may provide the current Pi default.
3. Move `PiChatSessionService` interface out of the route module if core/server-neutral code needs it; routes should consume service interfaces, not define them.
4. Keep the existing session auth/live buffer/send lock/T1 stub behavior; do not reimplement it.
5. Make `createAgentApp()` / `registerAgentRoutes()` call the core façade or shared bridge internals without changing route behavior.
6. Keep durable historical replay/approvals as typed T1 stubs. T1 is the #391 durable indexed event-stream phase that replaces P1's in-memory event tail.
7. Ensure core has no Fastify imports and no ambient config reads.

## Ambient reads to remove from core

Core must not read:

- `process.env`
- `process.cwd()`
- `.pi/*`
- `workspaces.yaml`
- host session/workspace roots by default

Host/CLI/app composition passes typed values in.

Current server adapters may still perform host composition reads during migration; the new core path may not.

## Session storage migration

Today workspace roots and session storage can be entangled. Target:

- `sessionStorageRoot` is independent from workspace/environment roots.
- `SessionCtx.workspaceId` is optional for pure/headless surfaces.
- Environment attachment requires a real workspace-bound context when governed resources are attached.
- Surfaces never synthesize fake workspace ids to satisfy attachment code.

P1 acceptance:

- pure sessions can be created/listed without workspace filesystem;
- workspace-scoped storage still works for existing embedded modes.

## Prompt/resource migration

Current risk: pi harness/resource assembly may assume cwd/workspace/AGENTS.md/files.

Target:

```txt
base instructions
+ fragments from resolved bundles
+ host safety fragments
```

P1 acceptance:

- pure mode does not advertise cwd/workspace/files/bash;
- existing coding modes keep current prompt behavior;
- any unavoidable pi harness cwd assumption is sealed/faked without granting file authority.

Later:

- prompt fragments move into capability bundles;
- skills declare requirements and are filtered;
- multiple environment attachments generate explicit environment id, filesystem access, and available-tool prompt text.

## Route/tool migration

### Today

File routes and tools are composed in agent server around `RuntimeBundle`.

### Target

`boring-bash` contributes a bundle:

```txt
environments[]
environment-bound file tools
environment-bound bash tools
input asset sink policy
file routes
search/tree/fs-events/git routes
prompt fragments
workspace UI affordances/renderers/composer providers
readiness/status
```

### P1

Do not move all of this yet. Only:

- make pure mode omit file/bash tools/routes;
- expose semantic facts;
- avoid adding more mode-specific branching.

### P3

Move real file/bash/input-asset/search route/tool bundle into boring-bash and have route registration derive from resolved composition.

Conformance tests to copy/adapt from Flue's `SessionEnv` suite:

- relative path resolution against environment cwd/root;
- absolute/path escape policy explicitly enforced by boring adapters;
- `writeFile` parent-directory behavior is centralized and tested;
- exec receives cwd/env/timeout/signal and handles pre/post abort;
- grep/find/glob tools consume environment exec/filesystem facets, not runtime mode;
- pure mode has no default environment.

## Workspace UI migration

### Today

Workspace UI may still render file-tree/editor/composer affordances independent of agent capability.

### Target

Workspace UI consumes capabilities:

```ts
const fileEnvironments = capabilities.environments.filter((env) => env.filesystem)
if (fileEnvironments.length === 0) hideFileSurfaces()
if (fileEnvironments.some((env) => env.filesystem?.access === 'read')) showReadOnlyFileSurfaces()
if (fileEnvironments.some((env) => env.filesystem?.access === 'readwrite')) showMutableFileSurfacesWhenReady()
```

### P4

- Suppress file tree/editor/renderers/composer providers when no environment has `filesystem`.
- Render readonly UI for readonly environments.
- Keep UI independently composed; agent never names panel ids/plugins.

## Skills and MCP migration

### Today

Skills/resource loading may be tied to pi harness/cwd assumptions. MCP projection is not the central capability model.

### Target

- skills declare `requires`;
- resolver filters visible skills;
- `skills[]` projection reports actual visible skills;
- MCP servers/toolsets declare requirements/policies;
- tool/MCP permission policy is tracked separately from readiness: present, ready, and allowed/approval-required are different states;
- `mcpServers[]` projection reports actual attached MCP servers;
- environment MCP projection obeys same filesystem access policy.

### P6

Implement plugin manifest validation, skill filtering, prompt fragment filtering, and MCP projection against `ResolvedAgentCapabilities`.

**Amendment (2026-07-08):** P6 adds per-agent resolved plugins to the capability facts; surfaces read the resolved plugin set from facts rather than inferring workspace-global plugin state.

## Subagent migration

### Today

Subagent/delegation story is not yet the final P7 registry/control-plane model.

### Target

- self-copy subagent: explicit share of parent composition;
- declared subagent: independent manifest and independent resolution;
- no implicit cwd/environment inheritance;
- names collision-checked with tool/skill namespace;
- parent stream receives subagent lifecycle and blocking approval events.

### P7+

Agent registry exposes agent/subagent info and versioned/snapshotted definitions.

## Phase plan

### P1 — headless core

- `createAgent()` core façade.
- Pure mode with no workspace/sandbox/cwd/file routes/bash tools.
- Minimal resolved capabilities projection.
- Session storage separated from workspace root.
- No agent value imports from boring-bash/boring-sandbox.
- No new runtime-mode feature switches.

### P2 — runtime package split

- Move `resolveMode()` and concrete mode adapters into boring-bash/host composition.
- Agent keeps type contracts only.
- No compatibility shim or old-path re-export.

### P3 — routes/tools bundle

- boring-bash owns environment filesystem/bash/input-asset/search route/tool bundle.
- Fastify profile is lowered from resolved composition.
- Readonly vs readwrite behavior enforced per environment.

### P4 — file UI bundle

- workspace UI consumes capability facts.
- Zero file UI/rendering/composer residue for pure mode.
- Readonly UI exists for readonly environments.

### P5 — provisioning/secrets/readiness bridge

- P5 remains owned by the broader #391 phase index.
- For this capability model, P5 contributes provider facts, secret brokering, and readiness inputs; it does not change the semantic capability interface.

### P6 — plugin/skill/MCP validation

- plugin manifests declare requirements;
- skills filtered by requirements;
- prompt fragments filtered by bundles;
- MCP servers/toolsets projected and policy-gated.

### P7+ — registry/declarative authoring/control plane

- `/agents/:agentId/info` exposes capabilities and inspection details.
- Eve-style directories/YAML compile into manifests.
- Subagents resolve independently.
- Workspace farm UI becomes a surface/control plane over the public contracts.

## Acceptance matrix

| Scenario | Expected facts | Expected residue |
| --- | --- | --- |
| pure/headless | `environments: []` | no environment file/bash routes/tools/UI/prompt/skills/MCP |
| direct coding | one `user` environment with readwrite filesystem, input-asset sink, and `bash`/file tools | current coding behavior preserved |
| readonly context | one or more environments with `filesystem.access: read` and no mutation tools | read/search/tree allowed; mutation absent/fails before mutation |
| mixed user + context | multiple environments; writes only to environments whose filesystem is readwrite | context remains readonly; writable user/scratch receives mutations/assets |
| direct model asset fallback | no accepting writable environment, but host+provider allow direct assets | bounded direct assets only; no persisted file refs |
| declared subagent | own capability facts | no accidental parent tools/skills/env |

## First implementation steps from code review

1. **Relocate core graph:** move/split `server/createAgent.ts` into `src/core/`; server wrapper injects Pi defaults and the sealed pure cwd shim.
2. **Define/export capability facts:** add `ResolvedAgentCapabilities` and
   methodless `ResolvedEnvironment` to agent shared/type surfaces. Keep
   prepared handles behind host/boring-bash `withAuthorizedView`; expose only
   auth-gated contributions and avoid scalar filesystem/shell facts.
3. **Wire projections:** expose pure-mode facts and coarse direct/local/vercel facts through `registerCapabilitiesContributor` and app/profile composition.
4. **Run pi-harness residue audit:** assert pure prompt/config has no cwd/workspace/AGENTS.md/file/skill residue; decide whether `createPureRuntimeCwd` is an acceptable sealed shim.
5. **Fix readiness/lifecycle:** make headless readiness honest via injection/shared tracker; dispose runtime bindings on cache eviction/profile dispose; then unify tool composition on `mergeTools()` across app/plugin paths.

## Regression guard targets

Eventually tests should assert consistency across:

- route registration;
- tool catalog;
- input asset intake validation;
- prompt fragments;
- skill visibility;
- MCP projection;
- workspace UI file surfaces;
- tool renderers;
- composer providers;
- readiness reporting.

A mismatch means capability residue leaked.

## P1 exit criteria

- Pure agent starts via `createAgent()` with no runtime/environment attachment in plain Node with no Fastify; mode strings stay in the host shim.
- Pure mode has no workspace, sandbox, cwd, file routes, or bash/file tools.
- Pure-mode capability facts match the target minimal projection.
- Existing direct/local/vercel modes work unchanged via the existing server adapters; adapter relocation to host composition is P2.
- New code uses semantic capabilities, not `runtimeMode`, for feature gating.
- `AgentRouteBindingProfile` remains adapter plumbing.
- Relevant tests/typechecks run, or blockers are recorded.

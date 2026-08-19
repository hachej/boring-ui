# Extensibility and composition: eve, Flue, and Boring

## Bottom line

1. eve has the best consumer-side composition vocabulary.
2. Its mount namespace plus same-slot override is materially better than our plugin-order concatenation.
3. We should steal the vocabulary, not the execution model.
4. The safe version for us is a declarative override plan compiled into an immutable binding.
5. It should be able to disable, alias, wrap through a trusted host adapter, or replace a tool with another already-admitted tool reference.
6. It should not let authored fleet data import or define executable code.
7. It should not let a workspace-local plugin shadow an internal host tool merely by choosing the same string.
8. eve's `defineDynamic(...)` is more expressive than our binding model by a wide margin.
9. That expressiveness is bought by accepting mutable model-visible capability sets during a session.
10. Importing that model wholesale would invalidate our binding digest, generation pinning, replay assumptions, catalog inspection, and much of governance admission.
11. Flue is less packaged than eve but more composable than us inside trusted application code.
12. A Flue custom hook is a real reusable capability bundle because it can mount tools, skills, subagents, instructions, state, and lifecycle behavior together.
13. Flue's `SandboxToolFactory` is also a clean replacement seam, but only for the six sandbox-backed tools.
14. Flue's `setProvider()` is an intentionally global last-registration-wins override.
15. Neither framework has our default-deny, per-workspace/per-Agent MCP grant projection with exact tool names.
16. Neither has our governance-compiled plugin admission, immutable runtime identity, or session-to-generation pinning.
17. That does not make our plugin trust boundary broadly safe.
18. Our app/internal plugin is trusted host code and can do essentially anything the Node process can do.
19. Our generated/runtime plugin is deliberately weaker on server registration, but it is still local trusted code, not a hosted untrusted marketplace unit.
20. eve is stronger than us at consumer repair of vendored behavior, human approval as a tool property, event-driven capability choice, and extension compatibility metadata.
21. Flue is stronger than us at capability composition in ordinary TypeScript, hard conditional absence, provider substitution, and sandbox-tool substitution.
22. Our strongest differentiator is governance before execution, not extension ergonomics.
23. Preserve that.

## Evidence base and scope

- eve: [Extensions](https://github.com/vercel/eve/blob/main/docs/extensions.md). eve: [Hooks](https://github.com/vercel/eve/blob/main/docs/guides/hooks.md). eve: [Dynamic capabilities](https://github.com/vercel/eve/blob/main/docs/guides/dynamic-capabilities.md). eve: [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md).
- eve: [Public-doc safeguards](https://github.com/vercel/eve/blob/main/docs/README.md). Flue 2.0.3 offline docs: `reference/agent-hooks-api`. Flue 2.0.3 offline docs: `guide/agent-hooks`. Flue 2.0.3 offline docs: `reference/sandbox-api`.
- Flue 2.0.3 offline docs: `reference/provider-api`. Flue 2.0.3 offline docs: `guide/tools`. Ours: `origin/main:packages/workspace/docs/PLUGIN_SYSTEM.md`. Ours: `origin/main:packages/workspace/docs/PLUGIN_STRUCTURE.md`.
- Ours: `origin/main:packages/workspace/src/server/plugins/defineServerPlugin.ts`. Ours: `origin/main:packages/workspace/src/server/plugins/bootstrapServer.ts`. Ours: `origin/main:packages/workspace/src/app/server/createWorkspaceAgentServer.ts`. Ours: `origin/main:packages/agent/src/server/agent-host/buildAgentComposition.ts`.
- Ours: `origin/main:packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts`. Ours: `origin/main:packages/agent/src/server/agent-host/mcpGrants.ts`. Ours: representative first-party packages under `origin/main:plugins/*`. Deliberately omitted: the already-known Flue hook inventory and render-per-turn overview.
- Deliberately omitted: the already-known eve top-level filesystem convention. Deliberately omitted: the already-known absence of a complete tenancy model in eve and Flue.

## 1. Concrete contribution and collision models

### eve: publishing a reusable bundle

- An author creates an extension package with `extension/extension.ts`. The package may contribute `extension/tools/**`. It may contribute `extension/connections/**`. It may contribute `extension/skills/**`.
- It may contribute `extension/instructions.*` or `extension/instructions/**`. It may contribute `extension/hooks/**`. Shared implementation code goes under `extension/lib/**`. Sandboxes, schedules, nested extensions, and root agent configuration stay in the consumer.
- `extension/extension.ts` default-exports a `defineExtension(...)` handle. That handle may carry a synchronous Standard Schema for consumer configuration. Contributions import the handle and read already-validated `extension.config`. The build produces an agent-shaped `dist/extension` tree.
- It also emits compatibility metadata and declaration files. Tool definitions can be exported through the package's `./tools` subpath. The consumer installs the package normally. The consumer mounts it with `agent/extensions/<mount>.ts`.
- `<mount>` becomes a capability namespace. `tools/search.ts` mounted as `crm.ts` becomes model tool `crm__search`. `connections/api.ts` mounted as `crm.ts` becomes connection `crm__api`. The same package can be mounted under different names by different consumers.
- Configuration is per mount and therefore per consuming agent. Extension `defineState` values are automatically scoped to the extension package. That prevents a state-name collision with consumer state or another extension.

### eve: directory mounts and consumer override

- A flat mount is `agent/extensions/crm.ts`. An overridable mount is `agent/extensions/crm/extension.ts`. Consumer files beside `extension.ts` occupy the mounted extension's own slots. `agent/extensions/crm/tools/search.ts` targets the contributed `tools/search.ts` slot.
- A same-named consumer tool wins. A same-named consumer connection wins. A same-named consumer skill wins. The consumer can import the original tool from `@acme/crm/tools`.
- It can spread the original definition and alter only policy, description, schema, or execution. The documented example adds `approval: always()` without forking the package. `disableTool()` in the matching slot removes either a static or dynamic contributed tool. A consumer dynamic tool in the matching slot beats the extension's dynamic tool.
- Hooks are additive and cannot be replaced through this mechanism. Instruction fragments are additive and cannot be replaced through this mechanism. The docs expose no parallel `disableConnection()` or `disableSkill()` primitive. Connections and skills can be replaced by a same-slot definition.
- Their outright removal is not documented as a first-class sentinel. The `crm__` namespace is reserved to the directory mount. `agent/tools/crm__search.ts` is not allowed to impersonate the mount override. Another extension mount is not allowed to override it either.
- This is important: override authority is structural, not merely string equality. The override is visibly colocated with the dependency mount. Upgrading the dependency keeps the local override in place. Removing the local file restores the vendored contribution.
- No fork or copied vendored tree is required.

### eve: ordinary collision behavior

- Static capability identity comes from relative paths. Authors do not put a `name` field on ordinary `define*` calls. The mount prefix prevents most cross-extension collisions by construction. Dynamic map returns are different.
- Their keys become bare tool or skill names unless the resolver authors a prefix. A dynamic tool or skill overrides a same-named authored static capability. Two dynamic resolvers producing the same name throw as ambiguous. The extension directory override is an explicit precedence rule.
- It is not accidental package load order. Original definition identity survives namespacing for `toolResultFrom(...)`. A hook can match a typed result from `crm__search` using the unmounted exported `search` definition.

### Flue: contributing a reusable tool, skill, or connection

- A third party exports a `defineTool(...)` value from an ordinary TypeScript package. A consumer mounts it with `useTool(tool)`. A third party exports `defineSkill(...)` or a packaged `SKILL.md` reference. A consumer mounts it with `useSkill(skill)`.
- A third party exports `defineMcpConnection(...)`. A consumer mounts it with `useMcpConnection(connection)`. Per-consumer MCP narrowing is a normal object spread. Example shape: `useMcpConnection({ ...linear, tools: ['create_issue'] })`.
- The `tools` field is an exact allowlist of the remote server's tool names. MCP model names become `mcp__<server>__<tool>`. A third party can export a custom hook such as `useGitHub(options)`. That custom hook may mount multiple tools, skills, subagents, and instructions.
- It may also compose state and lifecycle hooks when those hooks are legal in the caller frame. A package can therefore ship a capability bundle without a framework-level extension manifest. The package boundary is npm/TypeScript, not a Flue extension boundary. There is no automatic package-derived namespace for custom tools or skills.
- The bundle author must choose globally sensible names.

### Flue: collisions, overrides, and disabling

- Every active custom tool name must be unique in the render's flat set. Duplicate custom tool names throw `ToolNameConflictError`. Framework-reserved names also throw on collision. Duplicate skill names throw.
- Duplicate subagent names throw. Duplicate MCP server names throw. There is no eve-like consumer-wins slot override for custom hooks. There is no generic `disableTool(original)` sentinel.
- The consumer can omit the custom hook entirely. A well-designed hook can expose options such as `{ includeWrite: false }`. The consumer can mount exported components individually if the package exposes them. The consumer cannot surgically suppress one opaque bundled tool after the hook mounted it.
- Mounting another tool with the same name is an error, not an override. A consumer can create a new definition by spreading an exported definition. It must then avoid mounting the original. That makes override a package-API convention rather than a framework composition rule.

### Flue: two special replacement seams

- `setProvider(provider)` is keyed by `provider.id`. Each call replaces the previous provider for that ID. The latest call wins. Generated built-in registration skips an ID already registered by user code.
- This makes a user `setProvider()` reliably shadow a built-in. The provider registry is module-scoped and in-memory. It is process-wide on Node. It is reconstructed in each Cloudflare isolate.
- There is no public unregister operation. This is provider substitution, not per-agent plugin composition. `SandboxFactory.tools` is the other replacement seam. A `SandboxToolFactory` replaces the six default sandbox tools as one group.
- It can re-add selected standard factories and insert native adapter tools. It does not replace custom `useTool(...)` tools. It does not replace `task`, `activate_skill`, or `read_skill_resource`. It does not waive global tool-name uniqueness.
- This is a narrow, well-bounded replacement surface.

### Ours: contributing a trusted app/internal capability

- A publishable package declares `boring.front` and optionally `boring.server`. Its server export returns `defineServerPlugin({...})`. The server plugin may contribute `agentTools`. It may contribute `skills` and `piPackages`.
- It may contribute native Pi `extensionPaths`. It may contribute `systemPrompt`. It may contribute `workspaceBridgeHandlers`. It may contribute Fastify `routes`.
- It may contribute provisioning and package resources. It may contribute static assets and reload blockers. App composition admits the package at boot. Agent fleet entries select plugins by plugin ID.
- `agentConfigContract.keys` is a fail-closed declaration of accepted per-agent config keys. An omitted contract accepts no Agent-level config. An unknown plugin ID is rejected during fleet compilation. An unknown config key is rejected before Host creation.
- A prebuilt plugin with runtime contributions must supply `contentDigest`. Directory plugin bytes are deterministically hashed. Plugin artifact order, tool contract digests, config, policy, and resource inputs feed runtime identity. Selected plugin contributions are projected per Agent.
- The legacy default Agent is an intentional catch-all exception.

### Ours: contributing a generated/runtime capability

- A workspace-local plugin lives under `.pi/extensions/<id>/`. It may declare `boring.front`. It may declare Pi packages, skills, extensions, and system prompt. It should not declare a live `boring.server` capability.
- It cannot hot-register Fastify routes or host `agentTools`. Front and Pi resources refresh at `/reload`. Server routes and static `agentTools` remain boot-time. A server-file change yields a restart warning rather than hot rewiring.
- Generated plugins are trusted local developer/workspace code. They are not a hosted untrusted marketplace plugin model.

### Ours: collisions, overrides, and disabling

- Duplicate plugin IDs are rejected. Front output IDs carry `pluginId` ownership. Cross-plugin front output collisions are rejected. Intra-plugin duplicate front outputs are rejected during capture.
- Default server plugins can be excluded by ID through `excludeDefaults`. Agent fleet bindings can omit a plugin entirely. A first-party plugin can expose its own boot option to omit one tool. `boring-automation`, for example, has `agentToolEnabled: false`.
- That option is plugin-specific and requires host restart. There is no generic consumer-owned per-contribution disable record. There is no mount-derived model-facing namespace for server tools. `bootstrapServer()` validates unique plugin IDs and then concatenates `agentTools`.
- `projectAgentSpecPluginArtifacts()` preserves selected plugin order. `buildAgentComposition()` constructs standard tools, then appends `runtimeScope.extraTools`. It performs no mount-aware override resolution. It performs no generic disable resolution.
- It does not retain tool-to-plugin ownership in the final `AgentTool[]` type. A historical/general `mergeTools()` helper supports last-wins and an error policy. The current AgentHost assembly path named by this investigation does not call it. We should not claim that helper as the mature plugin override contract.
- In the binding path, same-name behavior is at best downstream catalog behavior. It is not a documented, provenance-aware consumer override. Skills and Pi extensions similarly have inclusion, discovery, and reload behavior. They do not have eve's same-slot consumer replacement vocabulary.
- MCP is different: a grant may remove a connector or individual connector tools. That is authorization projection, not plugin override.

### Direct comparison

| Question | eve | Flue | Ours |
| --- | --- | --- | --- |
| Reusable package unit | First-class extension package | Ordinary TS package/custom hook | Boring plugin package |
| Consumer mount | `agent/extensions/<mount>` | Call hook/import definitions | App boot + fleet plugin binding |
| Automatic namespace | `<mount>__` | MCP only; no custom-tool namespace | No server-tool namespace |
| Override source | Same slot beside directory mount | Author convention; provider and sandbox special cases | Plugin options, exclusion, or host code |
| Generic tool disable | `disableTool()` in matching slot | No | No |
| Collision default | Structural namespace; explicit precedence; ambiguous dynamic throws | Flat duplicate throws | Plugin/front IDs reject; server tool seam lacks a first-class mount rule |
| Connection narrowing | Override connection slot | `tools` allowlist on MCP definition | Declared ref intersected with exact-name default-deny grant |
| Skill override | Same slot wins | Duplicate throws | No generic override |
| Hook composition | Extension hook files are additive | Custom hook calls compose declarations | Server routes/hooks are plugin-specific; no agent event-hook surface |

## 2. Applying eve's namespace and override model to ours

### What it would give us

- A stable public name for each contribution: `<pluginMount>__<localName>`. Collision avoidance without depending on package load order. Consumer-local repair of a vendored plugin. A way to add approval or narrower authorization to one tool without forking the plugin.
- A way to replace a plugin tool with an organization-specific implementation. A way to disable a tool while retaining the plugin's UI, routes, skills, and other tools. An auditable location for the deviation from upstream. Upgradeability: dependency upgrades do not overwrite the local override.
- Reversibility: deleting the override restores upstream behavior. Better provenance in the catalog and telemetry. Better diagnostics: “disabled by fleet override X” rather than “tool missing.”; A natural place to attach policy digests and review metadata.
- A clean answer to “who owns this tool name?”

### Why a literal port is wrong for us

- eve's consumer override is executable TypeScript. Our authored Agent data intentionally does not select executable code. A literal `agent/extensions/crm/tools/search.ts` would violate authored-data-not-code. Loading it after governance would create a second executable admission path.
- Allowing it to replace a host tool by string would weaken trusted-host-plugins-only. Resolving it per workspace at runtime would weaken the static fleet. Letting generated/runtime plugin code override an internal tool would cross the current trust tier. The override could silently drop readiness requirements.
- It could widen actor selection. It could bypass WorkspaceBridge capability checks. It could bypass MCP exact-name grants by replacing an admitted facade with a direct client. It could change side effects without changing the binding identity unless deeply digested.
- It could turn an innocuous dependency update into a different precedence graph.

### Safe adaptation: declarative, compiled override plans

```yaml
seats:
  - seat: support
    agentTypeId: support
    plugins:
      - name: crm
        mount: crm
        config:
          region: eu
        overrides:
          tools:
            search:
              action: replace
              with: org-crm-policy/search-readonly
            export:
              action: disable
              reason: "No bulk export in support seat"
```

```ts
type CompiledContributionOverride =
  | {
      pluginId: string
      kind: 'tool'
      localName: string
      action: 'disable'
      reason: string
    }
  | {
      pluginId: string
      kind: 'tool'
      localName: string
      action: 'replace'
      replacementRef: TrustedToolRef
    }
```

- `TrustedToolRef` must resolve only through a host-owned registry. The fleet compiler must reject unknown plugin, slot, or replacement references. The replacement must already be admitted for the same Agent and workspace policy. The compiler must check schema compatibility or force an explicit breaking override marker.
- The compiler must preserve or deliberately restate readiness requirements. The compiler must preserve per-tool grant and capability requirements. The compiled output must include source and replacement content digests. Override order must be irrelevant.
- More than one override for one slot must be an error. Model-facing names should default to `<mount>__<localName>`. Internal compatibility aliases can be emitted for legacy names during migration. Telemetry should include plugin ID, mount, local name, effective implementation ID, and policy digest.
- `/describe` should expose effective, disabled, and replaced contributions to authorized operators. Runtime code should receive only the compiled effective tool array. No workspace-authored module should be imported.

### Namespace migration concern

- Renaming existing `ask_user` to `ask-user__ask_user` is a model-visible breaking change. Saved prompts and evals may name the old tool. UI renderers may key on the old name. Tool-call replay may contain the old name.
- Metrics and grants may key on the old name. A hard namespace migration is therefore expensive. The lower-cost first step is an internal canonical identity separate from model name.

```ts
interface ToolContributionIdentity {
  pluginId: string
  mount: string
  localName: string
  modelName: string
  implementationDigest: string
}
```

- Keep `modelName: 'ask_user'` initially. Use canonical identity for override matching and policy. New plugins can opt into generated `<mount>__<localName>` names. A later major version can make namespacing universal.

## 3. Dynamic capabilities

### eve: what can change and when

- `defineDynamic(...)` can resolve the model. It can resolve subagent availability and runtime settings. It can resolve tools. It can resolve skills.
- It can resolve instructions. Model resolution supports `session.started`. It supports `turn.started`. It supports `step.started`.
- Precedence is step, then turn, then session, then model fallback. A model resolver failure degrades to the next scope. Dynamic tools support session, turn, and step events. A session tool set applies to every model call in the session.
- A turn tool set applies to every model call in the turn. A step tool set applies only to the next model call. The tool loop reads the current set immediately before each model call. A mid-turn event update is therefore visible on the next call.
- Dynamic skill resolution supports session and turn events. Dynamic subagent resolution supports session and turn events. Dynamic instructions are assembled before the prompt. Resolver inputs include session auth and channel/session context.
- A resolver may call external data sources. A resolver may return no capability. A dynamic map may produce a data-dependent number of tools. A dynamic resolver may replace an authored static tool or skill by name.
- Two dynamic resolvers emitting the same name fail. Subagent availability is rechecked when delegation begins. The docs explicitly warn that availability is not the sole authorization boundary.

### eve: how the model learns

- Dynamic tools are inserted into the native model tool set before the applicable call. Dynamic skills are advertised in the loadable skill set for the applicable caller. Dynamic instructions are included when the system prompt is assembled. A removed capability is absent from the live execution set.
- The cited dynamic-capability docs do not describe a separate natural-language delta signal. Transcript coherence therefore depends on the current tool/prompt presentation and execution checks. A capability previously mentioned in conversation may disappear later. The runtime protects execution for subagents by rechecking availability.
- Sensitive tool implementations must still authorize independently.

### Flue: what can change and when

- Tools, skills, and subagents may change per render and thus per model call. Instructions may change per render as a composed document. MCP declarations are conditional but take effect at the next submission. Model choice is read at submission start.
- Sandbox factory and `cwd` values are read at submission start. Sandbox presence can change at a turn boundary. A custom hook can encapsulate all of those declarations. Conditional absence is hard absence: an unmounted tool cannot execute.
- Resource-set changes are narrated through framework-authored resource signals. Environment attachment changes are narrated through an environment signal. Custom tool changes also rewrite the provider-native tools array. Flue explicitly warns that this can invalidate prompt caches.
- MCP auth functions can resolve credentials per request even though the declaration is submission-scoped.

### Ours: what changes today

- Trusted server plugin selection is fleet-compiled. Static `agentTools` are projected into `runtimeScope.extraTools`. `buildAgentComposition()` appends them when constructing the binding. The binding exposes the same `composition.tools` thereafter.
- A session is pinned to a published runtime generation. A changed runtime identity requires restart rather than in-place mutation. Plugin server routes and static tools require process restart. Pi system prompt, extensions, packages, and skill resources can refresh at `/reload`.
- The resource registry uses immutable generation snapshots during a read. Front outputs can hot-reload independently. MCP grants are resolved per authorized projection request. The declared MCP refs remain fleet data.
- Connector admission is default-deny. Tool names are intersected with the connector catalog. This grant lookup is dynamic authorization around a static declaration. It is not a general per-step capability resolver.
- There is no model-facing capability delta protocol owned by our Host. The catalog route reports the binding's static `tools` array. Staticity avoids a transcript/catalog/replay mismatch by construction.

### What we would gain from dynamic resolution

- Per-principal tool availability without compiling one fleet seat per cohort. Feature-flagged capabilities without rebuilding the fleet. Per-tenant schemas such as one tool per warehouse table. Approval-unlocked tools that become callable immediately after approval.
- Incident-response revocation before the next model call. Plan-tier skills and instructions selected from authenticated attributes. Temporary subagent exposure for one turn. Model routing by step complexity or policy.
- Lower baseline prompt/tool payload for sparse users. A way to reveal write tools only after a read or verification step. More precise least privilege over time, if authorization is independent and correct.

### What dynamic resolution would break or force us to redesign

- A binding digest would no longer fully identify model-visible behavior. `toolContractDigests` captured at fleet compilation would be incomplete. `/describe` and `/tools` would need principal, session, turn, and perhaps step coordinates. Session generation pinning would no longer imply a stable capability set.
- Replay would need the resolved capability snapshot for every model call. Recovery could not safely rerun external resolvers and assume the same set. Dynamic resolver code and captured closures would need durable serialization rules. Model request auditing would need the exact effective tool schemas, not just names.
- Prompt cache behavior would become workload-dependent. A tool disappearing after the model planned to call it would need a coherent error contract. Grants would need to be evaluated against dynamically generated tool names. Wildcard grants would be unacceptable under our exact-name model.
- New dynamic names would otherwise be denied, which is safe but surprising. Governance would need to admit the resolver's output domain, not merely the resolver package. Resource quotas would be needed to prevent a resolver from generating thousands of tools. Two resolvers would need deterministic conflict semantics.
- A resolver reading external state creates a new availability dependency in the model loop. Step-level resolution adds latency before every model call. External data used in resolution becomes policy-critical input and must be authenticated. The resolver event and output must be included in telemetry and billing evidence.
- Model changes mid-session would invalidate provider caches and complicate cost forecasts. Dynamic instructions could smuggle principal data into durable transcript or traces. Dynamic replacement could bypass an originally reviewed tool contract.

### The viable subset for us

- Dynamic denial is safer than dynamic invention. Start with a runtime revocation mask over precompiled contributions. The mask may only remove already-admitted tools. It may not add a new name, schema, implementation, connection, or credential path.
- Evaluate it at session or turn boundaries, not every step. Persist the effective mask with the model-call record. Tell the model with one factual capability-change signal when the mask changes. Keep the binding identity stable because its maximum capability envelope is unchanged.
- Treat revocation state as a separately versioned authorization input. This still violates pure static-fleet behavior. It does not violate authored-data-not-code if masks are data. It does not violate trusted-host-plugins-only if only the Host applies masks.

## 4. Trust model

### eve: what contributed code can do

- An extension is executable npm package code. Its mount factory reads consumer configuration and environment values. A tool executor can call arbitrary imported SDKs and network clients. A dynamic resolver can query external systems.
- A hook can perform arbitrary side effects after durable stream events. A hook can write audit records, send alerts, or mutate an external database. A hook receives session context helpers. It can obtain and stop the current sandbox.
- A connection can carry auth and expose remote MCP or OpenAPI actions. Instructions and skills can influence the model even when they cannot directly execute. A malicious extension can execute during module evaluation unless separately sandboxed by the deployment. The mount namespace prevents name confusion.
- It does not sandbox package code.

### eve: what stops it

- The consumer explicitly installs and mounts the dependency. The extension configuration schema validates synchronously. Build-time compatibility metadata rejects unsupported capability contracts. Filesystem slots constrain which contribution kinds are discovered.
- Extension mount overrides let the consumer harden or disable a tool. Tool definitions can require human approval. `always()`, `once()`, and `never()` are explicit approval policies. Connection and tool implementations can call `requireAuth(...)`.
- Dynamic resolution can inspect authenticated principal attributes. Route/session authorization remains the deployer's responsibility. Tool implementations remain responsible for resource-level authorization. Subagent availability is rechecked at execution.
- Hooks are observe-only with respect to model context. Hook return values are ignored. Hooks run after the event is durably recorded. None of this is a package sandbox or default-deny capability grant system.
- eve's own safeguards state that omitted approvals may be permissive. Its docs also state sandbox network egress is not deny-all by default. The deployer must configure the safety boundary.

### Flue: what contributed code can do

- A third-party custom hook is ordinary imported TypeScript. It runs in the application process during agent render. It can mount arbitrary tool executors. A tool executor is ordinary application code.
- It can call external systems through captured SDKs or credentials. A `harness: true` tool can access the live sandbox and run nested model work. A sandbox factory can provision or attach arbitrary environments. A sandbox adapter can expose a native surface beyond the generic API.
- A `SandboxToolFactory` can replace default file/shell tools. `setProvider()` can redirect every model call for a provider ID. A custom MCP definition can provide arbitrary fetch, headers, and auth resolution. Module-scope package code is outside the model sandbox.

### Flue: what stops it

- The application explicitly imports and calls the code. Tool schemas validate model-supplied arguments. Duplicate and reserved names fail closed. Conditional unmount makes a capability uncallable.
- MCP definitions support exact tool allowlists. Trusted code is expected to bind customer and credential identity in closures. The tools guide explicitly says model arguments are not an authorization boundary. Sandbox isolation depends on the selected adapter.
- The sandbox API is an abstraction, not a security policy. A local adapter may expose the host filesystem. Custom tools are not constrained to `harness.sandbox`. There is no cross-package admission compiler.
- There is no default-deny per-Agent grant store for arbitrary contributions. There is no provenance tier comparable to our internal versus generated distinction.

### Ours: what contributed code can do

- An app/internal server plugin runs in the trusted Node host. Its `agentTools.execute()` bypass the sandbox by design. It can register Fastify routes. It can register WorkspaceBridge handlers.
- It can access host-injected trusted services. It can provision runtime assets and dependencies. It can contribute Pi extension paths and package resources. Its front code runs as native React in the host tree.
- A generated/runtime plugin can run native front code in the local trusted context. Its Pi extension code is reloadable code, not inert authored data. Runtime/generated plugins are prevented from hot-registering `boring.server` routes and tools. Hosted untrusted plugin JavaScript is explicitly not implemented.

### Ours: what stops it

- Only trusted app/internal packages enter the server plugin path. Fleet bindings select from preflighted plugin artifacts. Duplicate artifact and plugin IDs fail. Unknown plugin bindings fail before Host creation.
- Unknown config keys fail through `agentConfigContract`. Executable/resource content contributes to a deterministic identity. Authored Agent definitions cannot select executable paths, packages, commands, models, or plugin code outside the host registry. Runtime bindings are scoped to verified workspace and subject claims.
- Sessions pin to a binding generation. Mutating effects pass through Gateway admission when configured. MCP refs resolve only through per-workspace, per-Agent grants. No matching MCP grant means no connector.
- A connector grant does not imply all tools. Allowed tool names are exact and reject glob metacharacters. Unknown connectors fail closed when a catalog is present. Unknown granted tool names are dropped with diagnostics.
- Agent A cannot see Agent B's grant rows in the same workspace. WorkspaceBridge operations can declare caller classes and required capabilities. Generated plugins do not receive trusted dispatcher and raw host bindings.

### Where they are weaker than us

- Neither framework compiles plugin selection against a governance-owned fleet. Neither fingerprints the whole admitted contribution into a runtime binding identity. Neither pins sessions to an immutable capability generation as ours does. Neither has our exact-name, per-Agent, per-workspace default-deny MCP grant seam.
- Neither distinguishes authored declarative Agent data from host-admitted executable plugins as sharply. eve extension override authority is based on filesystem placement, not organizational governance. Flue custom hooks can mount capabilities with no central admission step. Both trust imported package code before any model-facing permission logic runs.
- Both can be made safe by application code, but safety is not the default composition invariant.

### Where they are honestly stronger than us

- eve lets a consumer add approval to a vendored tool without forking it. eve has a first-class human-approval policy on tools and connections. eve can condition capability presence on authenticated principal data. eve rechecks dynamic subagent availability at dispatch.
- eve scopes extension state automatically. eve records extension capability compatibility metadata at build time. eve hooks consume a durable event stream with defined ordering and retry caveats. Flue makes conditional absence a runtime invariant, not a prompt instruction.
- Flue makes duplicate names an immediate hard error in the live set. Flue MCP declarations have an exact per-mount tool allowlist. Flue's sandbox tool replacement is explicit and narrow. Flue's provider replacement rule is simple and deterministic.
- Both make third-party capability composition much easier for a trusted application developer. Our internal plugin code still has full host power once admitted. Our governance boundary reduces who can add such code; it does not confine what admitted code can do. Our plugin-specific disable switches are inconsistent and not centrally inspectable.
- We do not have a cross-cutting tool approval surface comparable to eve's. We do not let a consumer harden a vendored tool contract without upstream cooperation.

## 5. Composition mechanisms with no real equivalent in ours

1. eve's consumer-chosen mount namespace.
2. eve's reserved override directory tied to that mount.
3. eve's same-slot tool, connection, and skill replacement.
4. eve's generic `disableTool()` sentinel.
5. eve's extension-scoped state names.
6. eve's typed original-definition identity surviving model-name namespacing.
7. eve's build-time extension capability compatibility metadata.
8. eve's package source rebuild with last-successful generation retained in development.
9. eve's event-keyed dynamic model resolution.
10. eve's event-keyed dynamic tool generation with map returns.
11. eve's event-keyed dynamic skill and instruction resolution.
12. eve's event stream hook package surface with typed and wildcard handlers.
13. eve's defined ordering: durable emit, hooks, then dynamic tool resolvers.
14. eve's per-tool human approval policies as a composition property.
15. Flue custom hooks as plain reusable bundles of multiple agent declarations.
16. Flue's process/isolate-wide provider shadowing through `setProvider()`.
17. Flue's narrow replacement of only the sandbox-backed six-tool group.
18. Flue's standard per-tool factories for reconstructing a replacement sandbox set.
19. Flue's ability to add operation-local tools to `harness.prompt()`.
20. Flue's live conditional resource declarations with hard absence.

## Ranked ideas

### Rank 1 — Declarative mount-local overrides compiled by governance

**Recommendation:** build this.

**Mechanism**

- Give every plugin binding a consumer mount ID. Give every contribution a local slot identity independent of its model-facing name. Add declarative `disable` and `replace-with-trusted-ref` operations. Resolve the final graph in `createValidatingAgentFleetCompiler(...)`.
- Include the resolution and all source digests in runtime identity. Reject ambiguity before Host creation.

**API sketch**

```ts
interface AgentPluginBindingV2 {
  name: string
  mount?: string
  config?: Readonly<Record<string, unknown>>
  overrides?: readonly (
    | { kind: 'tool'; slot: string; action: 'disable'; reason: string }
    | { kind: 'tool'; slot: string; action: 'replace'; with: TrustedToolRef }
  )[]
}
```

**What it costs**

- Add contribution ownership to server plugin definitions. Add a trusted tool registry and stable tool references. Add schema/readiness/capability compatibility validation. Add effective-contribution inspection and diagnostics.
- Extend binding identity and tests. Decide legacy model-name migration. Update first-party plugins to declare stable local slots.

**What it breaks**

- It need not break static fleet. It need not break trusted-host-plugins-only. It need not break authored-data-not-code. It does break the assumption that plugin selection alone determines inclusion.
- It breaks any code that treats a flat `AgentTool[]` as sufficient provenance. A universal model-facing namespace would break prompts, renderers, evals, replay, and metrics. Therefore separate canonical identity from model name first.

**Blunt constraint verdict**

- Static fleet: preserved if compilation is boot-time and immutable. Trusted-host-plugins-only: preserved if replacements resolve only to admitted host refs. Authored-data-not-code: preserved if override files are data only.

### Rank 2 — Generic compiled disable masks for every contribution kind

**Recommendation:** build after Rank 1.

**Mechanism**

- Generalize `excludeDefaults` and plugin-specific `agentToolEnabled` into one compiler-owned mask. Support tools first. Later support skills, instructions, connections, routes, and bridge handlers where semantics are clear. Record why and by whom a slot was disabled.

**API sketch**

```yaml
plugins:
  - name: boring-automation
    disable:
      tools: [automation]
```

```ts
interface EffectiveContribution {
  ownerPluginId: string
  kind: 'tool' | 'skill' | 'connection' | 'instruction'
  slot: string
  status: 'active' | 'disabled' | 'replaced'
  reason?: string
}
```

**What it costs**

- Stable slots for all contributed resources. Per-kind disable semantics. Catalog and operator UI changes. Tests proving a disabled resource cannot leak through another loader.
- Migration away from bespoke plugin flags.

**What it breaks**

- Additive-only prompt composition no longer holds. Some plugins currently assume their prompt remains when their tool is absent. Route disabling may break front code expecting its backend. Skill removal may leave instructions pointing at it.
- Cross-resource dependency validation becomes necessary.

**Blunt constraint verdict**

- Static fleet: preserved. Trusted-host-plugins-only: preserved. Authored-data-not-code: preserved.

### Rank 3 — Effective capability provenance as a first-class catalog

**Recommendation:** prerequisite infrastructure, even if user-facing overrides wait.

**Mechanism**

- Stop flattening provenance away at `AgentTool[]` assembly. Carry owner, slot, implementation digest, grant requirements, readiness, and effective status. Flatten only at the final harness adapter. Make `/describe` report the effective graph to authorized operators.

**API sketch**

```ts
interface CompiledToolContribution {
  identity: ToolContributionIdentity
  tool: AgentTool
  requiredCapabilities: readonly string[]
  readinessRequirements: readonly ToolReadinessRequirement[]
  source: 'host-plugin' | 'host-standard' | 'mcp-facade'
}
```

**What it costs**

- Thread a richer type through plugin projection and composition. Update catalog routes and tests. Define redaction for implementation metadata. Preserve compatibility at the harness boundary.

**What it breaks**

- Internal APIs expecting naked arrays need migration. Equality and test fixtures become more explicit. Nothing about the external model contract must change.

**Blunt constraint verdict**

- Static fleet: strengthened. Trusted-host-plugins-only: strengthened. Authored-data-not-code: unaffected.

### Rank 4 — Runtime revocation of precompiled tools only

**Recommendation:** consider for incident response, not general composition.

**Mechanism**

- Compile a maximum capability envelope. Permit a Host-owned policy service to remove entries at session or turn boundaries. Never allow runtime addition or replacement. Persist the effective mask with each model call.
- Narrate changes to the model. Recheck the mask immediately before execution.

**API sketch**

```ts
interface RuntimeCapabilityMaskResolver {
  resolve(input: {
    bindingId: string
    workspaceId: string
    agentTypeId: string
    userId: string
    sessionId: string
  }): Promise<{ revision: string; disabledToolIds: readonly string[] }>
}
```

**What it costs**

- Per-turn policy lookup and caching. Durable recording of mask revisions. A model-facing change signal. Execution-time recheck.
- Catalog APIs with session/principal scope. Failure policy for an unavailable mask service.

**What it breaks**

- Pure static-fleet semantics. The statement that a binding alone determines callable tools. Cache predictability. Existing catalog routes that are not session-addressed.
- It complicates replay, though much less than dynamic invention.

**Blunt constraint verdict**

- Static fleet: violated in the narrow sense; maximum envelope remains static. Trusted-host-plugins-only: preserved. Authored-data-not-code: preserved.

### Rank 5 — A trusted host `defineCapabilityBundle()` helper inspired by Flue custom hooks

**Recommendation:** useful internal authoring improvement.

**Mechanism**

- Let trusted packages build coherent tools, skills, prompt fragments, and handlers from one validated config. Keep the result as ordinary `WorkspaceServerPlugin` data. Do not execute it from authored fleet files. Make dependencies between contributed slots explicit.

**API sketch**

```ts
export const crmBundle = defineCapabilityBundle({
  id: 'crm',
  config: CrmConfigSchema,
  build(config, host) {
    return {
      tools: [createSearchTool(config, host.actorResolver)],
      skills: [crmTriageSkill],
      systemPrompt: crmPrompt,
      dependencies: [{ from: 'instruction:usage', to: 'tool:search' }],
    }
  },
})
```

**What it costs**

- Mostly type and validation design. A dependency graph and stable slot naming. Migration is optional and incremental.

**What it breaks**

- Nothing if it compiles to the existing plugin contract. It becomes dangerous if exposed as an authored runtime import. It does not by itself add consumer override semantics.

**Blunt constraint verdict**

- Static fleet: preserved. Trusted-host-plugins-only: preserved. Authored-data-not-code: preserved only if host packages call it.

### Rank 6 — Narrow sandbox tool-set replacement seam

**Recommendation:** adopt only if we need multiple sandbox backends with different safe tool surfaces.

**Mechanism**

- Copy Flue's bounded idea: one adapter may replace only the standard filesystem/shell group. Export standard per-tool factories so an adapter can recompose the group. Keep plugin tools and framework tools outside the replacement. Make collision policy `error` in compiled Agent composition.

**API sketch**

```ts
interface RuntimeToolProvider {
  buildStandardTools(input: {
    runtimeBundle: RuntimeBundle
    filesystemPolicy: CompiledFilesystemPolicy
  }): readonly AgentTool[]
}
```

**What it costs**

- Split `buildHarnessAgentTools()` and `buildFilesystemAgentTools()` into stable factories. Define which tools belong to the replaceable group. Validate security properties and readiness requirements. Test every runtime backend.

**What it breaks**

- Adapters can no longer assume one canonical standard set. Tool-name and behavior parity across runtime modes may diverge. An unsafe provider could omit policy-enforcing wrappers unless validation is strong.

**Blunt constraint verdict**

- Static fleet: preserved. Trusted-host-plugins-only: preserved if providers are host-admitted. Authored-data-not-code: preserved.

### Rank 7 — Provider ID shadowing like Flue `setProvider()`

**Recommendation:** do not expose as an unconstrained global mutation.

**Mechanism**

- If needed, support a boot-time provider registry compiled per Host. Reject duplicates unless an explicit trusted override is declared. Include provider implementation and model catalog digests in binding identity. Do not use untracked last-call-wins mutation.

**API sketch**

```ts
registerTrustedModelProvider({
  id: 'openai',
  mode: 'replace-built-in',
  provider,
  contentDigest,
})
```

**What it costs**

- Provider provenance, lifecycle, credential, and catalog contracts. Multi-Agent scoping decisions. Isolation tests across workspaces and runtime modes.

**What it breaks**

- A process-global mutable registry conflicts with per-binding identity. Last-call-wins makes import order security-relevant. Replacement can redirect credentials and prompts to another endpoint. This is much more dangerous for us than a tool override.

**Blunt constraint verdict**

- Static fleet: preserved only with boot-time compilation. Trusted-host-plugins-only: must be enforced. Authored-data-not-code: violated if authored config can point at executable providers or arbitrary endpoints.

### Rank 8 — Durable event hooks as a governed plugin surface

**Recommendation:** valuable, but separate from tool composition.

**Mechanism**

- Define typed Host events and explicit post-record ordering. Let trusted plugins subscribe declaratively at boot. State delivery semantics and retry identity. Separate observe-only handlers from control/admission handlers.
- Never let an observe hook silently mutate the model context.

**API sketch**

```ts
defineServerPlugin({
  id: 'audit',
  agentEventHooks: [{
    events: ['tool.result', 'session.finished'],
    delivery: 'at-least-once',
    handle: auditHandler,
  }],
})
```

**What it costs**

- Stable event vocabulary and versioning. Durable cursor or idempotency guidance. Failure isolation. Tenant-safe payload redaction.
- Backpressure and shutdown behavior.

**What it breaks**

- A fail-closed hook can make observability an availability dependency. A fail-open hook can silently lose audit evidence. Host events may expose sensitive prompts or tool inputs to plugins. Governance must admit event scopes separately from tool scopes.

**Blunt constraint verdict**

- Static fleet: preserved. Trusted-host-plugins-only: preserved. Authored-data-not-code: preserved.

### Rank 9 — Full eve-style `defineDynamic(...)`

**Recommendation:** do not adopt under the current architecture.

**Mechanism**

- Arbitrary trusted resolvers generate models, tools, skills, subagents, and instructions from session events. Step-level tool resolution can alter the set before every model call. Resolver output shadows static contributions.

**API sketch**

```ts
defineDynamicTools({
  onStep: async (ctx) => buildToolsForPrincipalAndData(ctx),
})
```

**What it costs**

- A new durable capability-snapshot protocol. Replay-safe resolver packaging. Per-call schema storage and audit. Dynamic grant evaluation.
- Catalog scoping. Conflict resolution. Cache and latency management. A much larger governance language.

**What it breaks**

- Static fleet. Stable per-binding tool identity. Current session-generation meaning. Current `/describe` and `/tools` semantics.
- Deterministic replay unless every resolved snapshot is stored. Authored-data-not-code if authored projects can supply resolver modules. Trusted-host-plugins-only if runtime/generated plugins can participate.

**Blunt constraint verdict**

- Static fleet: directly violated. Trusted-host-plugins-only: easily violated unless severely restricted. Authored-data-not-code: directly violated in eve's executable form.

### Rank 10 — Literal eve directory overrides in workspace-authored code

**Recommendation:** reject.

**Mechanism**

- Load `.agents/.../extensions/<mount>/tools/<slot>.ts` after a plugin package. Let the workspace file replace or disable the vendored tool.

**What it costs**

- A runtime TypeScript loader. Package import resolution in workspace scope. A second plugin admission and signature system. Sandboxing or a new trust tier.
- Hot-reload generation management. Tool schema and policy revalidation.

**What it breaks**

- Authored-data-not-code, immediately. Trusted-host-plugins-only, immediately. Static fleet if hot-loaded. MCP and WorkspaceBridge governance if replacements can call direct clients.
- Binding identity unless every file and dependency is captured. The current distinction between runtime/generated and internal server plugins.

**Blunt constraint verdict**

- Static fleet: violated. Trusted-host-plugins-only: violated. Authored-data-not-code: violated. The ergonomics are excellent; the architecture fit is not.

## Recommended sequence

1. Introduce canonical contribution identity and provenance without changing model names.
2. Make collision policy explicit and fail closed in the actual `buildAgentComposition()` path.
3. Add compiler-owned generic disable records for tools.
4. Add replacement only through trusted, pre-admitted tool references.
5. Include the effective graph in the binding digest and authorized inspection APIs.
6. Migrate plugin-specific switches such as `agentToolEnabled` onto the generic mechanism.
7. Consider runtime removal-only masks for emergency revocation.
8. Keep arbitrary runtime capability invention out of scope.
9. Keep workspace-authored executable override files out of scope.
10. Treat provider replacement and event hooks as separate security designs, not incidental plugin features.

## Final decision table

| Idea | Value | Cost | Static fleet | Trusted-host-only | Authored data, not code | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical contribution provenance | High | Medium | Strengthens | Strengthens | Preserves | Do now |
| Declarative compiled disable | High | Medium | Preserves | Preserves | Preserves | Do next |
| Declarative trusted replacement | Very high | High | Preserves | Preserves | Preserves | Build carefully |
| Model-facing mount namespace | Medium | High migration | Preserves | Preserves | Preserves | Stage behind canonical IDs |
| Trusted capability-bundle helper | Medium | Low | Preserves | Preserves | Preserves | Good internal API |
| Sandbox standard-tool replacement | Medium | Medium | Preserves | Preserves | Preserves | Only with backend need |
| Runtime removal-only mask | High incident value | High | Weakens | Preserves | Preserves | Narrow exception |
| Durable observe hooks | High operational value | High | Preserves | Preserves | Preserves | Separate project |
| Provider ID override | Medium | High security risk | Conditional | Conditional | Conditional | Boot-only if ever |
| Full dynamic capabilities | Very high flexibility | Very high | Breaks | Risks | Risks/breaks | Reject for current model |
| Workspace executable overrides | High ergonomics | Extreme security cost | Breaks | Breaks | Breaks | Reject |

## One-sentence architecture position

Adopt eve's explicit ownership, namespace, override, and disable semantics as governance-compiled declarative data; retain our immutable admitted binding as the execution boundary, and do not import eve's workspace-executable or per-step dynamic composition model.

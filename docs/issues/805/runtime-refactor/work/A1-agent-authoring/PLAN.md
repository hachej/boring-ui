---
github: https://github.com/hachej/boring-ui/issues/805
issue: 805
state: ready-for-human
updated: 2026-07-20
track: owner
flag: not-needed
---

# A1 — Declarative agent definitions composed through the regular plugin server

## Authority and revision status

This is the canonical replacement plan for A1 under #805.

It records the owner clarification made during review on 2026-07-19:

> An authored agent definition is declarative identity plus instructions. Tools,
> skills, prompt addenda, Pi resources, provisioning, routes, and future MCP
> integrations are trusted host contributions delivered through the existing
> plugin and regular workspace-agent-server interfaces. Development and
> production use the same behavior composer beneath their regular host shells.
> `agent dev` is a launcher, not a different app or behavior model.

This supersedes the previous A1 plan sections that introduced:

- an authored per-agent tool catalog;
- runtime `toolRefs` resolution inside the authored-directory materializer;
- `MaterializedAgentSourceV1.tools` and `declaredToolRefs`;
- a separate `createMaterializedAgentDevApp()` factory;
- dev-only disabling of otherwise standard plugin/skill contribution surfaces;
- A1-specific runtime-mode policy and `--allow-direct` behavior.

The exact repository status as of 2026-07-20 is:

| State | PRs | Consequence |
| --- | --- | --- |
| Merged to Boring `main` | #813 source loader, #814 authored tool catalog, #815 validate CLI | Corrective migration starts from `origin/main`; these are real code, not abandoned branch experiments. |
| Branch-only in Boring | #816 separate dev-app factory, #817 dev CLI/combined tail | Do not merge. Replace with a clean stack. |
| Feature-branch-only merge | #821 merged into #817's branch | Historical evidence only; it did not reach `main`. |
| Open in Seneca | Seneca #16 at `cc62abb` | Do not merge. Replace after the Boring contract is corrected. |

R0 must re-verify this table with `gh pr view` and
`git merge-base --is-ancestor <merge-commit> origin/main`; no planning status
may be inferred from a stale worktree branch.

The latest published Agent package is `0.1.89` from 2026-07-17. #813/#814/#815
merged after that publication, so their new source/catalog/validate APIs are not
in the latest npm cohort. The older shared `AgentDefinition` reference fields
are published and remain a compatibility concern. R1a records this evidence and
checks repository/external consumers before removing any exported symbol.

A corrective clean stack will simplify merged code and supersede branch-only
work. It will not force-rewrite published or remote history.

## Product outcome

A developer authors a focused agent as data:

```text
agents/<agent-type-id>/
  agent.json
  instructions.md
```

Example:

```json
{
  "schemaVersion": 1,
  "definitionId": "claims-agent",
  "version": "1.0.0",
  "label": "Claims agent",
  "instructionsRef": "instructions.md"
}
```

The host binds that definition to trusted plugin behavior through one shared
normalized behavior input. Standalone/local hosts pass it through
`createWorkspaceAgentServer()`; Core/full-app resolves the same input only after
authentication and membership, then passes it through its existing
`registerAgentRoutes()` path. The top-level Fastify factories remain different
host shells, but behavior normalization is identical.

```ts
const behavior = composeAgentBehavior({
  agentSource,
  behaviorPlugins: [claimsPlugin, documentPlugin],
})
```

The same normalized behavior contract is used by:

- the local CLI and `agent dev`;
- standalone `createWorkspaceAgentServer()` consumers;
- Core/full-app's request-scoped authorized route binding;
- Step 1A's domain → workspace type → one behavior binding;
- Seneca's production application.

`composeAgentBehavior` is a placeholder name for the existing plugin bootstrap
normalization evolved to retain scope/provenance. It is not a second runtime
composer and does not create Workspace, Sandbox, routes, or sessions.

The agent definition does not select executable modules. Trusted app/internal
plugins contribute behavior implementations:

```ts
export default defineServerPlugin({
  id: "claims",
  systemPrompt: "Use claims tools for policy and claim questions.",
  agentTools: [claimsLookupTool, claimsAddNoteTool],
  skills: [claimsResearchSkill],
  piPackages: [claimsPiPackage],
})
```

`agent dev` may use the same plugins, skills, tools, packages, extensions,
provisioning, and prompt contributions as any regular server. A1 does not create
a reduced dev-only behavior surface.

## Product thesis

A focused agent product is the composition of two different ownership layers:

```text
Declarative authored source                 Trusted host composition
──────────────────────────                 ────────────────────────
identity                                    enabled app/internal plugins
version/label metadata                     tools
instructions                               skills
                                             plugin prompt addenda
                                             Pi packages/extensions
                                             provisioning/routes/preserved UI
                                             host-global build asset metadata
                                             host runtime/workspace policy
                                             future MCP contributions
```

The authored side is portable data. The host side is trusted application code
and configuration. They meet only at the shared behavior normalizer consumed by the existing
regular host shells.

This split is simpler and safer than making the authored directory a second
plugin/package system:

- agent authors do not name executable paths;
- tool/skill implementations have one contribution mechanism;
- dev and production cannot drift into separate behavior composers;
- workspace type bindings remain static host configuration under Decision 26;
- plugin provenance and lifecycle rules remain the existing source of truth.

## Decision 26 alignment

A Step 1A host declaration conceptually binds:

```text
workspaceTypeId
  → agentTypeId
  → authored agent source
  → enabled trusted plugin set / existing server options
```

This binding is deployment-static and server-owned. It is not persisted on the
workspace and does not grant membership. Authentication and workspace
membership remain prerequisites before the binding is selected.

A1 supplies the declarative source seam and local proof. #391 Step 1A still owns:

- persisted immutable `workspaceTypeId`;
- exact domain → workspace type routing;
- membership-first authorization;
- the host declaration mapping type to source/plugins;
- production session identity, observability, release, and rollback.

No digest, compiled bundle, hostname, plugin ID, agent ID, or workspace type is
a substitute for workspace authorization.

## Exact host/composer topology

"Same interface" means the same normalized behavior contract and contribution
semantics, not one top-level Fastify factory for every deployment shape.

| Host | Top-level lifecycle | Behavior timing | Required A1 path |
| --- | --- | --- | --- |
| Standalone regular app | `createWorkspaceAgentServer()` once for its configured local workspace root | Static source/plugin options at app creation | Normalize source + trusted plugin behavior, then use the existing Agent path. |
| `agent dev` | Calls the same `createWorkspaceAgentServer()`; one-shot does not listen, serve does | Same normalized options as the regular standalone fixture | No dev app/factory or dev-only contribution policy. |
| Core/full-app | `createCoreWorkspaceAgentServer()` once; `registerAgentRoutes()` resolves an authorized workspace per request | Authenticate and verify membership first, then resolve `workspaceTypeId` to a static behavior binding | Consume the same normalized behavior input through a request-scoped resolver; never instantiate a standalone server per request. |
| Seneca production | Core/full-app topology with exact domain/type declarations | Domain narrows expected type; membership authorizes workspace; type selects behavior | Same Core resolver and normalized input. |

The canonical shared seam belongs below the two top-level app shells. R2a defines
one frozen `AgentBehaviorInputV1` (name subject to API review) consumed by the
existing Agent route/harness composition. Both `createWorkspaceAgentServer()`
and Core's authorized `registerAgentRoutes()` path adapt to it. Neither shell is
removed; neither duplicates prompt/tool/skill composition.

A1 proves the standalone/dev path. #391 1A.6a/1A.6b owns Core's membership-first
request-scoped resolver and production migration. A1 cannot claim production
parity until that Step 1A slice consumes the same normalized fixture and passes
a cross-host conformance test.

## Contribution scope matrix

Trusted app/internal plugins are boot-loaded by the host. Static type bindings
select only behavior-scoped contributions; authored files never select plugin
IDs.

| Contribution | Scope | Selection/enforcement |
| --- | --- | --- |
| `agentTools`, `systemPrompt`, `skills`, `piPackages`, `extensionPaths` | Workspace-type behavior | The static type binding selects trusted plugin IDs after membership. The behavior normalizer preserves plugin provenance and includes only that subset. |
| Product/workspace creation provisioning | Workspace type at authenticated creation/retry | #391 1A.4 selects provider provisioning from the trusted type declaration and owns idempotency. This is not `WorkspaceServerPlugin.provisioning`. |
| Plugin runtime dependency provisioning | Workspace-type behavior at runtime bind/reload | Only selected plugins' `WorkspaceServerPlugin.provisioning` reaches the runtime binding. |
| Boot-time `WorkspaceServerPlugin.routes` | Host-global registration, membership/type-gated invocation | Register each plugin inside a host-owned scope whose `onRequest` gate is installed before plugin-owned hooks, body parsing, route-schema validation, and handlers (Fastify routing/query parsing already occurred). The gate verifies workspace target, membership, persisted type, and plugin enablement; handlers still enforce resource authorization. Generic plugin routes are membership-scoped. |
| Bridge handlers | Host-global registration, type-gated workspace invocation | Browser calls re-run membership/type/plugin resolution. Runtime calls require verified workspace-bound runtime claims and re-check current type/plugin enablement. Handlers still enforce resource authorization. |
| Preserved UI state | Host-global application surface | Loaded by trusted host configuration. Product UI must gate by authorized type where required. |
| `WorkspaceServerPlugin.assets` | Trusted host-global build packaging | `scripts/copy-plugin-assets.mts` consumes it at build time; R2g aligns that inventory/namespace with canonical runtime contribution IDs. Runtime bootstrap and standalone/Core hosts do not inspect, load, or serve assets. A1 adds no runtime delivery or capability semantics. |
| Runtime/generated Pi and brokered backend resources | Standalone external-source scope | Workspace `.pi` records carry the current standalone source-scope tag (`workspaceId` is populated with `workspaceRoot` today and the gateway uses the same default); this is not logical workspace authorization. User-global/Pi-settings sources may be host-global and untagged. All server modules execute in the standalone host process. A1 adds no Core, membership, actor, session, type, or cross-source isolation claim. |

Every trusted contribution receives one canonical `contributionId`. A prebuilt
plugin uses its host-declared `WorkspaceServerPlugin.id`. A directory/package
entry uses the effective manifest ID (`boring.id` or normalized package name)
as an immutable host provenance ID for all of that entry's manifest Pi/front and
loaded server contributions. The server plugin's internal `id` may be retained
as `implementationId` for diagnostics but is not a second selection key.
Duplicate canonical IDs fail boot with stable
`WORKSPACE_SERVER_PLUGIN_ID_DUPLICATE` diagnostics naming only safe IDs/source
kinds. Type bindings use only canonical contribution IDs.

The normalized plugin bootstrap must retain contributions by canonical ID until
authorized selection; flattening the union before type selection is forbidden
in Core. R2b proves deterministic grouping/selection for behavior surfaces. R2d
proves authorized prompt/tool/skill/Pi/runtime-provisioning isolation; R2f proves
route and bridge invocation isolation.
Build-packaging asset metadata is not an agent runtime capability or delivery
mechanism.

## Terminology

### Authored agent definition

The contents of `agent.json` and `instructions.md`. It is untrusted declarative
data and contains no executable implementation path.

### Authored agent source

The small frozen server-only value produced after the directory is compiled and
product-valid:

```ts
declare const authoredAgentSourceBrand: unique symbol

type AuthoredAgentSourceV1 = Readonly<{
  schemaVersion: 1
  agentTypeId: string
  version: string
  label?: string
  instructions: string
  readonly [authoredAgentSourceBrand]: true
}>
```

This is an opaque server-only value, not a structural public object. The loader
and an explicit `defineAuthoredAgentSource()` in-memory constructor validate,
copy, freeze, and register the value in a private runtime brand/`WeakSet`; the
brand token is not exported. `createWorkspaceAgentServer()` accepts only a
value produced by that package instance and checks membership before any server
side effect. A forged object or Proxy around a genuine source is not a member
and is rejected without reading attacker-controlled properties. This avoids the
unimplementable claim that JavaScript can generally detect arbitrary Proxies.
All later work uses the frozen branded snapshot.

The final public name is fixed in R1a. The important semantic rule is no tools,
catalogs, plugin handles, paths, digests, runtime objects, or deployment
references are present.

### Trusted app/internal plugin

A host-installed, boot-composed package or object using the existing
`WorkspaceServerPlugin` contract. It may contribute server routes, agent tools,
static prompt context, skills, Pi resources, provisioning, preserved UI state,
bridge handlers, and trusted build-packaging asset metadata. Its server code runs in
the host process and requires restart/redeploy
to change.

### Runtime/generated plugin

External `.pi/extensions` sources under the existing standalone trust model.
Workspace sources carry the current standalone source-scope tag
(`workspaceId = workspaceRoot` today); user-global and Pi-settings sources may
be host-global and untagged. This tag is not logical workspace authorization. They may contribute front/
Pi resources and hot-reloaded brokered `RuntimeServerPlugin.routes` through the
runtime-backend gateway. They cannot contribute trusted boot-time
`WorkspaceServerPlugin.routes`, static host-process `agentTools`, or privileged
host bridge handlers. Every runtime server module is imported into the
standalone host process with no Core, membership, actor, workspace-type, or
per-session isolation. This is not a marketplace/untrusted-tenant sandbox.

### Agent binding

Trusted static host configuration selecting one authored source and the regular
server/plugin options for one agent type. It is not a deployment record or
mutable registry.

## Declarative A1 v1 contract

### Directory layout

```text
agents/<agent-type-id>/
  agent.json
  instructions.md
```

The generic compiler reads only declared data assets. It never discovers or
imports sibling `.ts`, `.js`, `.mjs`, executable, plugin, skill, or MCP files.

A host repository may organize trusted plugins near agent directories, but that
filesystem proximity has no generic A1 semantics.

### Product-valid fields

A1 v1 product authoring uses:

- `schemaVersion`, exactly `1`;
- `definitionId`;
- `version`, opaque author-declared metadata using the existing non-empty
  `OpaqueRef` grammar (maximum 256 characters), not a SemVer or immutability
  promise; host release configuration owns pinning outside A1;
- optional `label`, maximum 256 Unicode scalar values with no control
  characters;
- `instructionsRef`, exactly `instructions.md`.

`definitionId` must match:

```text
^[a-z][a-z0-9-]{0,62}$
```

The following remain invalid authoring fields:

- workspace ID/type, hostname, domain, membership, auth, credentials;
- runtime mode, sandbox, provider, model, roots, mounts, exposure;
- plugin package/path, skill path, executable path, MCP URL/command/token;
- deployment, publication, registry, CAS, digest, pricing, release data.

### Compatibility reference fields

The currently published/shared `AgentDefinition` schema already includes:

- `capabilityRequirements`;
- `toolRefs`;
- `skillRefs`;
- `mcpServerRefs`.

A1 does not create new runtime meaning for them. For this product contract,
non-empty values are unsupported and fail product validation rather than being
silently ignored.

They remain parseable legacy/reserved fields in the published shared
`AgentDefinition` schema, but the A1 product loader and `agent validate` apply
this exact table:

| Input per reference field | Product result | CLI result |
| --- | --- | --- |
| Absent | Valid | Exit 0; field omitted from success JSON. |
| Empty array | Valid compatibility spelling | Exit 0; field omitted from success JSON. |
| Non-empty schema-valid array | Unsupported | Exit 1; `AGENT_DEFINITION_UNSUPPORTED_FIELD`, exact field path, no warning-only mode. |
| Wrong type, duplicate, or invalid item | Invalid schema first | Exit 1; `AGENT_DEFINITION_INVALID`, exact field path; schema validation precedes product unsupported-field checks. |

No catalog or resolver preserves runtime meaning for these names. A later schema
version may add declarative requirements only for a named product need and an
approved host contribution seam. R1a still confirms registry versions, exports,
and external consumers, but the approved A1 behavior above is no longer
conditional on that audit.

### Instructions

`instructions.md` is the sole agent-authored behavior payload in A1 v1. It must
contain at least one non-whitespace Unicode scalar and is limited to 256 KiB of
UTF-8. `agent.json` is limited to 64 KiB of UTF-8 before JSON parsing. Both
files must be regular non-symlink files inside the declared source root; all
symlinks are rejected, not only escapes. Size checks and bounded reads use the
same opened file descriptor: `fstat`, read at most cap + 1 bytes, then decode.
A pre-stat followed by unbounded `readFile()` is forbidden. Oversize or empty
input uses
`AGENT_DEFINITION_INVALID` with `field: "agent.json"` or
`field: "instructionsRef"` and fixed non-content-bearing messages.

It composes through the regular server prompt pipeline. The static order is:

1. Pi base prompt; ambient system-prompt files only in standalone `ambient`
   resource mode;
2. Boring harness workspace-path and runtime guidance;
3. Workspace context;
4. plugin-authoring guidance when that regular option is enabled;
5. explicit host `systemPromptAppend` configured before the source;
6. authored `agentSource.instructions`;
7. selected trusted boot-plugin `systemPrompt` contributions in normalized
   plugin order;
8. static plugin-package Pi `systemPrompt` contributions.

Existing workspace/runtime plugin prompt contributions may append at the
`before_agent_start` hook after this static prompt. Dev and production use this
same order. Prompt order is not an authorization boundary: authored
instructions can fully influence the model, enabled tools are the capability
boundary, and every sensitive tool/route validates arguments and authorization
independently.

Tests may capture section IDs, provenance IDs, order, and UTF-8 byte counts.
Production logs may emit only `{sectionId, provenanceId, order, utf8Bytes}` and
must never emit prompt text, instruction text, parameters, credentials, or
absolute source paths.

### No authored executable selection

These are forbidden:

```json
{ "toolRefs": ["./tools/run.ts"] }
{ "skillRefs": ["./skills/research"] }
{ "mcpServerRefs": ["stdio:node server.js"] }
```

Trusted plugins may import implementation files because the host installed and
enabled those plugins:

```ts
import { runAnalysisTool } from "./tools/runAnalysis"

export default defineServerPlugin({
  id: "analysis",
  agentTools: [runAnalysisTool],
})
```

The trust distinction is provenance, not filename syntax.

## Plugin-first behavior contributions

### Existing contract is authoritative

A1 reuses `WorkspaceServerPlugin` and `bootstrapServer()` rather than creating
an authored catalog. Existing app/internal plugins can already contribute:

- `systemPrompt`;
- `agentTools`;
- `skills`;
- `piPackages`;
- `extensionPaths`;
- provisioning;
- routes;
- workspace bridge handlers;
- trusted `assets` build metadata consumed only by
  `scripts/copy-plugin-assets.mts`, not runtime bootstrap/hosts;
- preserved UI state.

The regular `createWorkspaceAgentServer()` already gathers the active runtime
surfaces above. `assets` is the explicit build-time exception: the packager, not
runtime bootstrap/hosts, consumes it. A1 adds the authored source and preserves/
scopes existing active runtime contributions without adding asset semantics.

### Tool ownership

Tools come from:

- core Agent/Workspace tools;
- explicit host `extraTools` where already supported;
- trusted app/internal plugin `agentTools`.

They do not come from `agent.json` in A1 v1.

Current `main` has shell drift: Core's `registerAgentRoutes()` uses
`mergeTools()`, while standalone `createAgentApp()` concatenates arrays and
Workspace flattens trusted plugin tools into `extraTools`. R2a must establish one
final Agent-level `mergeTools()` seam used by both Agent entry points; plugin
bootstrap only groups/provenances contributions and never merges names.

The selected unified order is:

1. standard Agent tools, including upload and diagnostics when enabled;
2. static host `extraTools`;
3. trusted app/internal plugin tools in canonical normalized plugin order;
4. authorized request/workspace caller, bridge, and UI tools;
5. dynamically discovered Pi plugin tools in existing discovery order.

Duplicate names are last-registered-wins. Each override after the standard group
logs one redacted warning with group and safe winner provenance; the catalog
exposes one winner in final map order. Duplicate standard-tool names retain
Core's internal last-wins/no-warning behavior. Trusted/dynamic plugin tools that
omit readiness metadata receive `workspace-fs`; request/host tools retain their
declared metadata; every winner receives the existing readiness wrapper.

This is Core-compatible but not identical to either current shell: trusted
plugin tools are currently flattened as host tools, request/bridge/UI placement
differs by shell, and standalone does not use `mergeTools()`. Defaulting trusted
plugin readiness and moving those groups are deliberate compatibility
migrations. R2a owns fixed-actor tests for every group, collisions/warning
provenance/final order/readiness/catalog output in both shells. No `error`
collision mode is selected by A1.

Source loading contributes no tools and cannot collide. R1a audits #814's new
`toolCollisionPolicy` and coupled authored error code; R1b removes them unless a
named, separately accepted non-A1 owner exists. No second tool merge occurs in
source loading, plugin bootstrap, or `agent dev`.

### Skill ownership

Skills come through existing trusted plugin and Pi resource contributions:

- `WorkspaceServerPlugin.skills`;
- plugin `piPackages` / package `pi.skills`;
- host `additionalSkillPaths` where already supported;
- runtime/generated plugin Pi resources under their existing source trust
  scope (workspace-tagged or user/global-settings host scope).

`agent dev` does not disable these because it is development. It receives the
same configured contributions as the regular server it launches.

### Prompt ownership

The authored instructions are the agent-specific source. Plugins may still add
trusted domain/use guidance through `WorkspaceServerPlugin.systemPrompt` and
existing Pi prompt contributions. Prompt provenance/order must be observable in
tests and logs without disclosing prompt content in public metadata.

### Plugin selection and least privilege

Decision 26's static workspace-type binding selects the plugin set. A1 does not
invent a plugin registry or allow the authored definition to enable packages.

For the standalone binary, enabled plugins come from the same CLI default
package resolver, explicit trusted server options, and existing external Pi
plugin sources as the normal standalone server. Embedded hosts may pass a frozen
`Omit<CreateWorkspaceAgentServerOptions, "workspaceRoot" | "agentSource">`
through `RunCliAgentDevOptions.serverOptions`; the launcher supplies the selected
root and loaded source and rejects attempts to override them. This is a
host-owned adapter to the regular options, not a dev behavior composer or an
authored plugin selector.

Standalone CLI defaults are not claimed to reproduce a product host's private
plugins magically. The parity guarantee is exact: identical normalized
`CreateWorkspaceAgentServerOptions` plus the same source bytes produce the same
behavior; one-shot versus serve changes only ingress/listen/close handling. A
host that needs a smaller capability set passes a smaller trusted plugin set.

### Generated/runtime plugin boundary

The plan does not promote generated plugins into host-process code:

- app/internal plugin `agentTools` remain boot-time trusted server code;
- runtime/generated plugins cannot contribute trusted boot-time
  `WorkspaceServerPlugin.routes`, static host-process `agentTools`, or privileged
  bridge handlers; their existing standalone-only brokered
  `RuntimeServerPlugin.routes` and Pi resources keep current external-source
  hot-reload behavior, with no new Core/membership/actor/session/type isolation;
- runtime plugin Pi skills/extensions/packages keep current hot-reload behavior;
- hosted/marketplace plugin provenance and sandboxed execution remain future work.

## MCP boundary

### Current A1

MCP server configuration is host responsibility and outside authored A1 v1.
The host owns:

- URL/process transport;
- credentials and secret lookup;
- workspace/user authorization;
- connection lifecycle and health;
- exposed tool filtering;
- audit and error policy.

This is distinct from #391 Step 1B, where authenticated external MCP is an
ingress client reaching our authorized workspace/agent.

### Future trusted plugin contribution

A future approved plan may extend `WorkspaceServerPlugin` with an MCP
contribution such as:

```ts
defineServerPlugin({
  id: "github-integration",
  mcpServers: [githubMcpContribution],
})
```

That seam must keep credentials and authorization host-owned. Enabling the
plugin permits the host contribution; authored data does not supply a URL,
command, token, or arbitrary process definition.

A1 does not add this field now. It records the direction so a future MCP plan
extends the plugin system rather than the authored directory.

## One regular behavior interface

### Normalized behavior input

The shared server-only value is conceptually:

```ts
declare const trustedPiResourcesBrand: unique symbol

type TrustedPiResourcesV1 = Readonly<{
  additionalSkillPaths: readonly string[]
  packages: readonly PiPackage[]
  extensionPaths: readonly string[]
  extensionFactories: readonly PiExtensionFactory[]
  readonly [trustedPiResourcesBrand]: true
}>

type AgentBehaviorInputV1 = Readonly<{
  agentSource?: AuthoredAgentSourceV1
  promptSections: readonly AgentPromptSection[]
  extraTools: readonly AgentTool[] // explicit host tools only
  pluginTools: readonly Readonly<{
    contributionId: string
    tools: readonly AgentTool[]
  }>[]
  pi: TrustedPiResourcesV1
  provenance: readonly AgentBehaviorContributionProvenance[]
}>
```

This is an in-process trusted composition value, not a persisted or serializable
runtime artifact. It may carry tool/extension implementations from trusted
plugins. The normalizer freezes containers and records source/plugin/host
provenance; explicit host tools and plugin tool registrations remain separate.
`TrustedPiResourcesV1` is opaque and issued only by trusted plugin/host
normalization; it can contain explicit selected paths/factories but no ambient
settings loader or hot-resource callback. It does not execute tools, merge
names, create routes, or own a Workspace/Sandbox/Agent. The unified final Agent
seam remains the only runtime tool merge.

Standalone constructs this once at boot. Core separates static behavior from
its existing authorized request-scoped overlays:

```ts
type AgentBehaviorBindingV1 = Readonly<{
  bindingKey: string // trusted host declaration key; cache identity only
  workspaceTypeId: string
  agentTypeId: string
  enabledContributionIds: readonly string[]
  behavior: AgentBehaviorInputV1
  runtimeProvisioning: readonly RuntimeProvisioningContribution[]
}>

type GetAgentBehaviorV1 = (ctx: Readonly<{
  workspaceId: string
  workspaceTypeId: string
}>) => Promise<AgentBehaviorBindingV1>

type AgentOverlayContributionsV1 = Readonly<{
  extraTools: readonly AgentTool[]
  pi?: TrustedPiResourcesV1
  runtimeScopeContribution?: RuntimeScopeContribution
}>

type GetActorAgentOverlayV1 = (ctx: Readonly<{
  workspace: Workspace
  actor: VerifiedActorAuthorizationSnapshot
  bindingKey: string
  actorOverlayRevision: string
}>) => Promise<AgentOverlayContributionsV1>

type GetRequestAgentOverlayV1 = (ctx: Readonly<{
  request: FastifyRequest
  workspace: Workspace
  actor: VerifiedActorAuthorizationSnapshot
  bindingKey: string
}>) => Promise<AgentOverlayContributionsV1>
```

Core authenticates, verifies membership, resolves persisted type, and confirms
the domain/type constraint before `getAgentBehavior`. It resolves static behavior
before creating or leasing a Workspace/Sandbox-backed runtime. It then resolves
the Workspace adapter, actor overlay, and optional request overlay before lease.
Existing `getExtraTools`, `getPi`, and `getRuntimeScopeContribution` callers are
classified into the actor-only slot only when their inputs are request-free;
request-aware callers use the uncached slot. One HTTP/bridge request memoizes its
own static-binding + overlay snapshots; there is no cross-request atomic claim.

`bindingKey` is server-stamped static configuration identity (type + behavior
config version), neither authored nor persisted authority. All binding-scoped
prompt/tool/Pi/runtime contributions belong in static `behavior`. Overlay values
do not choose cache scope or keys.

Core configuration exposes separate actor-only and request-aware resolver slots.
The actor resolver receives no request object. Core constructs its cache identity
from `workspaceId + bindingKey + verified actor subject +
authorizationVersion + actorOverlayRevision`; callers supply none of those
identity components.
`authorizationVersion` is derived from the verified membership/role/capability
snapshot and changes when entitlement changes. The host-stamped overlay revision
changes on static overlay code/config deployment. Actor overlay output must be
deterministic for that supplied snapshot. If a request-aware resolver is
configured or contributes values, the effective runtime binding bypasses the
shared cache and retires after handler/transport lease completion.

Overlay values are frozen contribution snapshots that may contain trusted
functions but own no opened Workspace/Sandbox/runtime handles and have no
`dispose`. Exact-once disposal applies to resulting runtime bindings on request
retirement, replacement, eviction, failure, and shutdown. Before every cached
lease, Core repeats request authorization, static behavior resolution, and
actor-overlay resolution against the current authorization snapshot. User/
request auth state is never embedded in static behavior. Product/workspace
creation provisioning remains outside this contract under #391 1A.4.

### Standard standalone server input

The regular workspace-agent server gains one declarative source input:

```ts
type WorkspaceAgentResourcePolicy =
  | { kind?: "ambient"; pi?: PiHarnessOptions }
  | { kind: "explicit"; resources: TrustedPiResourcesV1; pi?: never }

interface CreateWorkspaceAgentServerOptions {
  agentSource?: AuthoredAgentSourceV1
  resourcePolicy?: WorkspaceAgentResourcePolicy
  // Existing trusted contribution/policy surfaces remain:
  plugins?: WorkspaceServerPlugin[]
  extraTools?: AgentTool[]
  systemPromptAppend?: string
  // workspace/runtime/provisioning/etc. remain unchanged
}
```

The final exact shape must avoid ambiguous double configuration. Rules:

1. `agentSource.instructions` occupies the documented agent-specific prompt
   position in the existing composition order.
2. Plugin and host prompt contributions remain additive through the current
   pipeline.
3. Plugin tools/skills/Pi resources remain independent contributions.
4. `agentSource` alone never changes discovery defaults or runtime mode.
   Standalone defaults to `ambient`; typed Core requires `explicit`. Embedded
   dev uses the same chosen policy as its regular host fixture.
5. `agentSource.agentTypeId` is behavior identity, not workspace membership or
   session identity.
6. The server remains the sole Workspace/Sandbox/Agent lifecycle owner.
7. No overload creates a second composer or accepts a directory/catalog directly.

`explicit` resource mode is a harness-level fence, not merely
`externalPlugins: false`: it skips project/user/global Pi settings, ambient
system-prompt files, `.agents/skills`, ambient extension/plugin scans, and
hot-resource callbacks. It accepts only branded selected plugin/host resources,
selected runtime-provisioning skill paths, and Core-built trusted bridge
factories. Raw `PiHarnessOptions`, raw paths/factories, `getPi`, and
`externalPlugins: true` are runtime-rejected in typed Core composition.

### Remove the dev-app factory

`createMaterializedAgentDevApp()` is rejected. Its configuration mapping belongs
in the standard server input and caller options.

The corrective implementation removes:

- the factory and export;
- `MaterializedAgentDevWorkspaceInput`;
- `MaterializedAgentDevRuntimePolicy`;
- `MaterializedAgentDevTrustedLocalOptIn`;
- tests asserting dev-specific plugin/skill suppression.

Valuable lifecycle/capture tests move to the regular server and CLI public seams.
No behavior is deleted merely to reduce file count.

## `agent dev` as a regular server launcher

### Invocation forms

`agent dev` retains two local invocation forms:

```text
boring-ui [--mode local|local-sandbox] agent dev <dir> --prompt <text>
boring-ui [--mode local|local-sandbox] agent dev <dir> --serve
```

- `--prompt` creates the regular server, sends one turn through its dispatcher,
  then closes it.
- `--serve` creates the same regular server and listens without an automatic
  turn.

The distinction is process ingress/lifetime only. It is not a different app,
behavior source, plugin model, prompt policy, tool model, or sandbox composer.

### Standard workspace/runtime/plugin options

`agent dev`:

1. loads and snapshots the declarative source;
2. uses `BORING_AGENT_WORKSPACE_ROOT` when set, otherwise the current directory,
   through the same regular CLI workspace/root normalizer;
3. calls `createWorkspaceAgentServer()` directly;
4. accepts the existing global `--mode` before `agent` and uses the same
   `parseArgs`/mode adapter path as the regular CLI; no A1 mode taxonomy exists;
5. uses the same normalized app/default/internal plugin and external Pi/plugin
   source inputs as the regular server fixture;
6. does not force `externalPlugins`, skills, extensions, packages, or system
   prompt files off merely because the command is named `dev`;
7. removes #817's A1-specific `--allow-direct` gate and hidden mode fallback;
8. binds `--serve` to loopback only (`127.0.0.1`/`::1`) in v1. Operators needing
   non-loopback exposure use the normal authenticated server command, not
   `agent dev`;
9. reports redacted identity and disposes the regular server exactly once.

Any future CLI mode/config improvement is regular CLI work, not an A1-only
escape hatch.

### Capture proof

The CLI conformance harness must prove, through the regular server:

- authored instructions reach the model-facing prompt;
- app/internal plugin tools are callable;
- plugin skills/Pi resources are present when included;
- removing plugin X from normalized trusted `plugins/defaultPluginPackages`
  before server creation removes X's behavior contributions;
- one-shot, serve, and a regular-server fixture capture equal source fields,
  prompt section text/order/provenance, ordered tool names + implementation
  identity, normalized Pi path/package descriptors + factory identity, and a
  fixed workspace/plugin/environment snapshot;
- no authored sibling executable file is imported.

## Source loader contract

A small server-only source loader remains useful because the regular server
should receive verified data rather than filesystem paths:

```ts
async function loadAuthoredAgentDirectory(input: {
  directory: string
  expectedAgentTypeId?: string
}): Promise<AuthoredAgentSourceV1>
```

Because `materializeAgentDirectory` / `MaterializedAgentSourceV1` merged after
the latest published package, R1a verifies they have no external supported
consumer and then replaces them directly before the next release. Do not retain
a misleading `V1` alias whose fields or semantics changed. If the audit finds a
real supported external consumer despite the registry evidence, stop R1b and
obtain an explicit package-major/deprecation decision; do not emulate the
catalog contract.

Required behavior:

- open each declared file once without following symlinks, `fstat` that file
  descriptor, and read at most 64 KiB + 1 for the manifest or 256 KiB + 1 for
  instructions before decode/parse;
- use `compileAgentDirectory()` only for those bounded, contained, import-free
  reads;
- validate product-safe ID/version/label/instruction grammar and optional
  expected ID;
- reject non-empty legacy reference families under the exact compatibility
  table;
- extract verified non-whitespace `instructions.md` content;
- return one newly allocated deep-frozen value with
  identity/version/label/instructions only;
- no tool catalog, tool implementation validation, plugin loading, MCP, runtime,
  Workspace, Sandbox, session, route, or digest authority;
- no browser/shared value export;
- stable compiler/product diagnostics without absolute path, input value, or
  prompt leakage.

The deterministic compiler digest may remain compiler/test evidence. It is not
returned by the source loader or consumed by runtime selection.

## Validation CLI

`boring-ui agent validate <dir>` remains valuable, but its contract aligns with
the declarative product schema.

On success it reports only agent type ID, version, optional label, and
instruction UTF-8 byte length. Success JSON remains `schemaVersion: 1` because
#815's envelope is not yet published, but removes the `refs` member before first
release. Human output removes the declared-ref count block.

Legacy absent/empty arrays succeed silently; non-empty arrays are errors under
the compatibility table, never warnings. The command does not claim
tool/skill/MCP resolvability, inspect plugins, import code, or print
deployment/digest authority. Plugin conformance is validated through plugin and
server tests, not authored-directory validation.

Human and JSON errors retain the current `{schemaVersion: 1, ok: false,
error: {code, field?, message}}` envelope and remain redacted.

## Seneca consumption

Seneca's static product binding becomes conceptually:

```ts
const claimsAgent = {
  source: await loadAuthoredAgentDirectory({
    directory: "agents/claims",
    expectedAgentTypeId: "claims-agent",
  }),
  plugins: [claimsPlugin, documentPlugin],
}
```

Seneca agent directories contain declarative identity/instructions only.
Trusted tools and skills move to normal app/internal plugin packages or existing
trusted server modules composed as plugins.

Seneca's current unbound tool candidate under an authored agent directory must
not be taught as generic A1 layout. The corrective companion plan chooses one
of:

- move it into a trusted Seneca app/internal plugin; or
- retain it as explicitly host-owned code outside the generic agent-directory
  contract until that plugin exists.

Seneca continues to own domains, workspace types, auth, secrets, deployment,
observability, release pins, and rollback.

## Security model

### Untrusted authored data

- JSON and Markdown only;
- path-contained compiler reads;
- no executable import;
- no plugin/package selection;
- no credentials, URLs, commands, roots, runtime handles, or workspace grants;
- stable redacted errors.

### Trusted plugin code

- app/internal plugins are installed and enabled by the host;
- server routes/tools execute with current host-process trust and therefore
  require the existing provenance/restart boundary;
- generated/runtime modules retain their current standalone external-source
  trust model, including host-global untagged sources;
- plugin enablement is static host/workspace configuration, never authored data;
- plugin identity does not grant workspace membership.

### Authorization

Core authentication and workspace membership precede behavior binding. The
source, plugin set, workspace type, domain, and agent type narrow behavior only;
they do not authorize access.

## Stable errors after simplification

The source loader needs only product/source errors:

- existing compiler JSON/schema/path/UTF-8 errors;
- `AUTHORED_AGENT_ID_INVALID`;
- `AUTHORED_AGENT_TYPE_MISMATCH`;
- shared `AGENT_DEFINITION_UNSUPPORTED_FIELD` for non-empty reserved fields;
- internal invariant failure if a successfully compiled instruction asset is
  missing.

The corrective implementation removes authored-catalog/tool errors that have no
remaining source-loader path:

- `AUTHORED_AGENT_CATALOG_REQUIRED`;
- `AUTHORED_AGENT_CATALOG_INVALID`;
- `AUTHORED_AGENT_REFERENCE_UNKNOWN` for tool lookup;
- `AUTHORED_AGENT_REFERENCE_UNSUPPORTED` from the unpublished product loader;
- `AUTHORED_AGENT_TOOL_INVALID`;
- `AUTHORED_AGENT_TOOL_COLLISION` as an authored-source error.

Regular plugin validation remains at its current boundary; R2a deliberately
standardizes both Agent entry points on the documented Core tool baseline.
#814's catalog/tool codes merged after the latest npm release; R1a verifies no
supported consumer and R1b removes them. If contrary consumer evidence appears,
stop for an explicit package-major/deprecation decision rather than preserving
false authored semantics.

`AUTHORED_AGENT_DEV_USAGE_INVALID` remains only for malformed CLI invocation
forms if the command keeps the current error taxonomy.

## Migration from the current A1 stack

### Preserve

- import-free deterministic directory compiler;
- product-safe ID and expected-ID validation;
- frozen server-only declarative source;
- `agent validate` human/JSON process boundary;
- useful CLI one-shot/serve lifecycle and redaction tests;
- exact package-cohort proof;
- standard server lifecycle/resource ownership fixes that are independently
  valid;
- generic Pi harness controls that are useful regular-server options.

The #814 collision-policy addition is not presumed useful. R1a records its
owner/disposition and R1b removes it with the catalog unless a separate non-A1
owner is accepted. It does not block A1.

### Remove or replace

- authored tool catalog and resolver;
- deep hostile-catalog/tool proxy validation whose only caller was that catalog;
- tools and declared tool refs in the authored source;
- authored tool example/reference fixtures;
- separate materialized dev-app factory;
- dev-only plugin/skill/extension suppression;
- trusted CLI catalog adapter and package embedding seam for it;
- Seneca docs/guards that teach tool refs as A1 behavior;
- A1-specific runtime-mode policy that differs from the regular CLI.

### PR disposition

After this plan is approved:

1. Treat merged #814 as corrective migration input on `origin/main`; do not try
   to revert its merge history or describe it as unmerged.
2. Leave #816, #817, and Seneca #16 unmerged and create a clean corrective stack
   from current `origin/main`; do not force-push reviewed branches.
3. Reuse/cherry-pick only hunks that match this plan and are easier to review
   than reimplementation.
4. Close branch-only PRs as superseded only after replacement PR links and proof
   exist; link #814 to the corrective PR instead of closing history.
5. Record #821's feature-branch-only merge as historical evidence, not a main
   merge or accepted architecture.

## Implementation slices

### R0 — Decision, canonical-doc cutover, and graph replacement

**Delivers**

- this plan plus rewritten A1 `HANDOFF.md` and `TODO.md`;
- accepted Decision 26 clarification for declarative source, trusted plugin
  contributions, host-owned MCP, and shared behavior normalization;
- corrected status/ancestry table for #813–#817/#821/Seneca #16;
- rewritten #391 `plan.md` 1A.6a–1A.6e/1A.9/1A.10a,
  `ROADMAP-ALIGNMENT.md`,
  `FORWARD-PLAN.md`, `INDEX.md`, `proof.md`, and #805 `plan.md`;
- corrected `packages/agent/docs/agent-authoring.md` and related tool/plugin
  cross-links as their APIs change;
- historical/non-dispatchable banners on `C0U7-BORING-CONFORMANCE.md` and any
  retained catalog-plan evidence;
- corrected `packages/workspace/docs/PLUGIN_SYSTEM.md` runtime-backend trust and
  route facts plus the canonical host-assigned contribution-ID rule;
- replacement Beads for R1a–R6 and recut #391 1A.6a–1A.6e, with old children
  explicitly superseded.

**Blocked by:** owner approval of this plan.

**Proof:** `gh`/merge-ancestry evidence; cross-link search for stale catalog and
dev-app dispatch language; `br lint`; `br dep cycles`; `bv --robot-insights`;
`pnpm check:golden-path`; adversarial architecture/API review; `git diff --check`.

**Boundary:** docs/tracker only, target under 1,200 changed lines excluding
mechanically updated navigator data. **Review budget:** 30–45 minutes.

### R1a — Published-consumer and export disposition audit

**Delivers:** a checked artifact covering npm versions/timestamps, package export
history, repository/Seneca consumers, JSON CLI envelope, and every merged #814
catalog/collision error/type. It confirms the default disposition: keep published
legacy reference fields parseable-but-product-rejected; replace unpublished
`MaterializedAgentSourceV1`, catalog APIs, and validate success `refs` directly.
Contrary supported-consumer evidence stops R1b for explicit semver approval.

**Blocked by:** R0. **Proof:** registry output, `git tag`/merge ancestry, `rg` and
packed-consumer inventory, named owner for every retained generic API.

**Boundary:** evidence/doc/tests only, no runtime behavior; target under 400
changed lines. **Review budget:** 20–30 minutes package/API review. This is the
first implementation-ready Bead after R0 approval.

### R1b — Declarative Agent source/schema cleanup

**Delivers:** opaque branded `AuthoredAgentSourceV1`,
`loadAuthoredAgentDirectory`, and `defineAuthoredAgentSource`; validated frozen
snapshots; 64 KiB/256 KiB limits; regular-file containment; ID/version/
label/instruction rules; non-empty legacy-ref rejection; removal of unpublished
catalog/materialized types, resolver code, tool payloads, and catalog-only errors.
No Workspace/plugin/CLI behavior changes.

**Blocked by:** R1a accepted disposition.

**Proof:** valid/empty/oversize/symlink/traversal/UTF-8/ID mismatch/ref matrix;
constructor accessor/error tests plus private brand assertion rejecting forged,
mutable, and Proxy-wrapped values without property reads; sibling executable
sentinel; frozen/null-leak-free output; Agent build/typecheck/tests
and packed Agent export smoke.

**Boundary:** Agent package only; target under 650 changed production/test lines
excluding deleted catalog tests. **Review budget:** 30–45 minutes plus package
API review.

### R1c — Validate CLI migration

**Delivers:** validate uses the R1b loader contract; schema-v1 success omits
`refs`; exact legacy-field result table; size/path/redaction behavior; removal of
catalog validation dependencies. No dev command changes.

**Blocked by:** R1b.

**Proof:** human/JSON golden tests, every legacy field state, exit codes,
terminal-control/absolute-path/content redaction, installed packed CLI smoke.

**Boundary:** CLI validate files/tests only; target under 400 changed lines.
**Review budget:** 20–30 minutes.

### R2a — Shared behavior input and standalone regular-server consumption

**Delivers:** frozen `AgentBehaviorInputV1`; `agentSource` on
`createWorkspaceAgentServer()`; opaque source-brand check before side effects;
exact prompt order/provenance metadata; current plugin tool/skill/Pi
contributions preserved; one final Agent tool seam for standalone and Core; no
`createMaterializedAgentDevApp()` implementation/export from branch-only #816 is
introduced.

**Blocked by:** R1b.

**Proof:** regular server with/without source; forged/mutable/Proxy-wrapped
source fails before property reads or Workspace/Sandbox creation; authored +
host + plugin + static/dynamic Pi
prompt order; plugin tool invocation and skill/Pi presence; removing plugin X
from normalized inputs removes X behavior; no second merge/lifecycle; exact
standard/static-host/trusted-plugin/request-bridge-UI/dynamic-plugin order,
winner, warning provenance, catalog, and readiness behavior in both Agent entry
points with a fixed actor; Workspace/Agent gates.

**Boundary:** shared Agent behavior input plus Workspace standalone adapter;
target under 750 changed lines. **Review budget:** 30–45 minutes with mandatory
architecture/security review.

### R2b — Preserve plugin provenance and behavior scoping

**Delivers:** bootstrap normalization assigns canonical contribution IDs,
rejects duplicate canonical IDs and retains contributions by ID. Only selected
behavior and runtime-provisioning surfaces flatten. Routes and bridge handlers
remain provenance-grouped for invocation-time selection. R2b implements no
domain/auth/workspace-type enforcement.

**Blocked by:** R2a.

**Proof:** deterministic grouping/provenance and A/B selection for prompt/tools/
skills/Pi descriptors; duplicate canonical-ID and differing internal-ID
fixtures; grouped route/bridge/runtime-provisioning provenance available to
Core; existing single-plugin
compatibility; no mutable plugin registry. Authenticated behavior/runtime
isolation is R2d proof and route/bridge isolation is R2f proof, not R2b proof.

**Boundary:** Workspace plugin bootstrap/types/tests only; target under 700
changed lines. **Review budget:** 30–45 minutes with mandatory security review.

### R2c — Sealed explicit Pi resource mode

**Delivers:** opaque `TrustedPiResourcesV1`; ambient/explicit resource-policy
discriminant; harness explicit mode that bypasses project/user/global settings,
ambient prompt/skill/extension discovery, `.agents/skills`, and hot-resource
callbacks; trusted plugin/host/resource-provisioning normalization only. Raw Pi
options and arbitrary resource callbacks cannot enter typed composition.

**Blocked by:** R2b.

**Proof:** ambient standalone compatibility; explicit selected plugin skills/
packages/extensions/prompts work; malicious workspace/global settings, skills,
extensions, prompts, factories, and hot callbacks are present but never read or
invoked; forged branded resources rejected before runtime effects; packed
Agent/Workspace proof.

**Boundary:** Agent harness + Workspace resource normalizer only, target under
650 changed lines. **Review budget:** 30–45 minutes with security review.

### R2d — #391 Core authorized behavior resolver interlock

**Delivers:** recut #391 1A.6a/1A.6b adapts Core's existing
`createCoreWorkspaceAgentServer()`/`registerAgentRoutes()` path to
`GetAgentBehaviorV1`: auth + membership + persisted type first; static behavior
before Workspace/runtime creation; authorized request overlay before lease. It
includes static and overlay keys/scopes in cache identity, preserves existing
`getExtraTools`/`getPi`/`getRuntimeScopeContribution` semantics and runtime
binding disposal, re-resolves authorization before lease, and passes only
selected plugin runtime provisioning to bind/reload. When typed/domain routing
is enabled, Core requires R2c `explicit` resources, forces
`externalPlugins: false`, and runtime-rejects explicit `true`, raw `pi`/`getPi`,
and ambient resource callbacks; branded selected `piPackages`/`extensionPaths`
remain allowed. Typed routing
disabled preserves the current full-app compatibility setting. It does not create
a standalone server per request or flatten all plugins into every agent.

**Blocked by:** R2c and #391 1A.5.

**Proof:** standalone and Core capture the same prompt section text/order/
provenance, ordered tool names + implementation identity, normalized Pi path/
package descriptors + factory identity, and fixed plugin/environment snapshot;
two-type tool/prompt/skill/Pi/runtime-provisioning cross-leak negatives;
static binding-key and actor/request overlay-key changes, Core-built actor
identity and non-sharing, same-actor/two-workspaces/same-type cache separation,
request-scope shared-cache bypass/retirement, exact-once runtime binding disposal,
and authorization recheck; malicious
workspace/global external sources present but never scanned/imported/registered
and no Core runtime-backend gateway; spoof denial; one Workspace/Sandbox
lifecycle per effective binding; default/primary compatibility.

**Boundary:** separate #391 Core PR/Bead, target under 700 changed lines.
**Review budget:** 30–45 minutes with auth/security review.

### R2e — Explicit non-member service-ingress migration

**Delivers:** non-member ingress uses an explicit host route with independent
service auth, never generic membership-scoped `WorkspaceServerPlugin.routes`.
Move `/api/v1/boring-automation/due/hosted` to full-app host registration. After
service auth and the due-work scan, verify every candidate workspace's persisted
type and automation-plugin enablement immediately before that candidate's
effect; one ingress-level target check is insufficient.

**Blocked by:** R2d.

**Proof:** unauthorized service requests cause no scan/effect; mixed candidate
batch proves enabled-type success and per-candidate disabled/mismatched-type
skip/denial; retry/idempotency behavior remains; existing hosted automation
success and full-app compatibility remain green.

**Boundary:** separate automation/full-app PR/Bead, target under 450 changed
lines. **Review budget:** 20–30 minutes with auth/security review.

### R2f — #391 1A.6d/1A.6e Core host-global plugin invocation gates

**Delivers:** preserve canonical plugin provenance for routes/bridge handlers.
Every generic `WorkspaceServerPlugin.routes` registration is enclosed by a
host-owned `onRequest` membership/type/plugin gate installed before plugin-owned
hooks, body parsing, route-schema validation, and handlers; Fastify routing and
query parsing have already occurred. An `onRoute` inventory requires unique
method + URL across all host-installed generic plugins and fails boot with
stable `WORKSPACE_SERVER_PLUGIN_ROUTE_DUPLICATE` plus both safe contribution
IDs. Browser bridge calls re-run membership/type selection. Runtime bridge calls
validate workspace-bound runtime claims and re-check current type/plugin
enablement. Resource-level handler authorization remains mandatory. Build asset
metadata is not activated at runtime.

**Blocked by:** R2e.

**Proof:** counters prove unauthorized requests execute no plugin hook/parser/
validator/handler; two-type route and browser/runtime bridge cross-leak
negatives; invalid/expired/runtime-wrong-workspace claims; generic route method +
URL collision; foreign/mismatched workspace denial; enabled success; handler
resource auth still executes; full-app default compatibility.

**Boundary:** separate Core route/bridge PR/Bead, target under 650 changed lines.
**Review budget:** 30–45 minutes with mandatory auth/security review.

### R2g — Canonical build/runtime plugin asset inventory

**Delivers:** replace full-app's disconnected `serverPlugins` build export with
one static host plugin declaration inventory that drives both runtime loading and
build packaging. Each direct/default-package/governance contribution has one
canonical `contributionId`, runtime loader/package declaration, and build asset
metadata (possibly empty). `copy-plugin-assets.mts` namespaces by
`contributionId`, rejects missing/extra/duplicate declarations, and emits an
inventory artifact. Production boot fails closed with stable
`WORKSPACE_PLUGIN_BUILD_INVENTORY_MISMATCH` if the enabled canonical runtime set
or declared asset targets differ from the built inventory. The build path never
executes runtime plugin factories or loads secrets.

**Blocked by:** R2b.

**Proof:** full-app MCP/governance/default-package inventory equality; internal
plugin ID differing from canonical ID still copies under canonical ID; missing/
extra/duplicate runtime or build entries, missing source, unsafe target, and
stale inventory all fail; successful production boot sees the exact built set;
asset-free plugins remain explicit inventory entries.

**Boundary:** Workspace build script + full-app static plugin declarations/tests,
target under 600 changed lines. **Review budget:** 30–45 minutes with build/
supply-chain review.

### R3 — Recut `agent dev` as a regular-server launcher

**Delivers:** CLI calls `createWorkspaceAgentServer()` directly; global standard
`--mode` parsing; regular root/session/plugin option normalization; trusted
embedded `serverOptions`; one-shot/serve ingress only; loopback-only serve;
no catalog adapter/dev-app seam/ambient suppression/`--allow-direct` from
branch-only #817 is introduced; exact-once cleanup and redacted output.

**Blocked by:** R1c and R2a.

**Proof:** one-shot, serve, and regular fixtures share a fixed workspace/plugin/
environment snapshot and capture equal source fields, prompt section text/order/
provenance, ordered tool names + implementation identity, and Pi path/package
descriptors + factory identity; included app plugin tool/skill/Pi resources work;
workspace runtime resources retain current reload behavior; both standard
modes use normal resolver; malformed usage and malicious source fail before
server effects; ephemeral port/readiness, signal/listen failure, loopback denial,
and close-once; no authored executable import.

**Boundary:** CLI launcher files/tests only; target under 650 changed lines.
**Review budget:** 30–45 minutes with security/process-lifecycle review.

### R4 — Boring package conformance and docs

**Delivers:** minimal declarative example; exact-cohort Agent/Workspace/CLI packed
consumer; validate → load → regular server → dev proof; server/shared/front
export checks; source, plugin, runtime-backend, CLI, and rollback docs aligned.
Package docs changed by R1–R3 must land with those API slices; R4 verifies and
closes gaps rather than tolerating knowingly false docs.

**Blocked by:** R2c, R2g, and R3.

**Proof:** packed installed validate/dev smoke; captured instructions plus plugin
tools/skills/Pi resources; executable sentinel; full-app compatibility,
invariants, golden path, package tarball allowlist, build/runtime plugin inventory
match, and independent
Standards/Spec/Thermo review.

**Boundary:** conformance scripts/examples/docs only; target under 600 changed
lines. **Review budget:** 30–45 minutes.

### R5 — Seneca plugin-first companion

**Delivers:** replace Seneca #16 from current Seneca `main`; declarative agent
sources; trusted Seneca app/internal plugins for behavior; no authored catalogs;
static two-product binding through the R2d–R2f Core/host contract; exact package pins and rollback
record. No production domain enablement occurs in this slice.

**Blocked by:** R4 and R2f. Production enablement remains additionally blocked
by #391 release qualification.

**Proof:** Seneca compile/validate, plugin behavior/isolation fixtures,
typecheck/tests/build, packed Boring cohort, no import from authored agent
siblings, and companion architecture review.

**Boundary:** separate Seneca PR, target under 700 changed lines. **Review
budget:** 30–45 minutes plus product review.

### R6 — Cross-host closeout and dispatch handoff

**Delivers:** one exact-cohort report tying R1–R5 to R2c–R2g; standalone/Core
behavior equivalence; A/B global-surface isolation; final docs/Bead/PR
supersession; explicit release and #391 handoff. Only R6 may mark A1 complete.

**Blocked by:** R2f, R4, and R5.

**Proof:** all Acceptance items mapped to commands/artifacts; Core/full-app and
Seneca package pins; independent final architecture/security/spec review; no
open P0/P1 findings; `br`/`bv` graph clean.

**Boundary:** evidence/tracker/docs only, target under 400 changed lines.
**Review budget:** 20–30 minutes.

## Replacement dependency graph

The current `wt-391-forward-c0u` implementation children are historical and
must not remain dispatch authority after approval. R0 will create replacement
children with explicit supersession notes.

```text
R0 → R1a → R1b
R1b → R1c
R1b → R2a
R2a → R3
R2a → R2b
R2b → R2c
R2b → R2g
R3 + R2c + R2g → R4
#391 through 1A.5 + R2c → R2d → R2e → R2f
R4 + R2f → R5
R4 + R2f + R5 → R6
R6 → sessions / release / production proof
```

No A1 slice blocks Step 1A database/auth/domain work. R2c–R2f are the explicit
resource/Core/host production interlocks; R5 cannot claim production parity or
enable domains. A1 remains open until R6 has R2f, R4, and R5 evidence.

## Acceptance

A1 is complete when:

1. an authored directory contains declarative identity/metadata/instructions and
   no executable implementation selection;
2. one small frozen server-only source is produced without tools, catalogs,
   plugins, digests, paths, deployments, or runtime handles;
3. legacy reference fields follow the exact absent/empty/non-empty/invalid
   result table, and success validation output contains no reference catalog;
4. standalone and Core host shells consume the same frozen behavior input below
   their distinct server/auth lifecycles;
5. trusted app/internal plugins remain the standard contribution mechanism for
   tools, skills, prompt addenda, Pi resources, provisioning, routes, and
   preserved UI state; trusted asset metadata remains plugin-owned build-
   packaging input, uses the same canonical inventory as runtime composition,
   and gains no A1 runtime semantics;
6. contribution scope follows the matrix: product A receives none of B's prompt,
   tool, skill, Pi, or runtime-provisioning inputs and cannot execute B's guarded
   route or bridge behavior;
7. generated/runtime plugins retain the current standalone host-process,
   external-source trust/lifecycle (including untagged host-global sources)
   without gaining Core authorization or boot-time trusted surfaces;
8. `agent dev` calls the regular server directly with equivalent normalized
   options; one-shot versus serve changes only ingress/lifetime;
9. no authored tool catalog, separate dev app, second runtime composer,
   AgentHost, CAS, or mutable registry is added; published digest/deployment
   evidence APIs may remain compatibility-only, but no A1 or Step 1A runtime
   path consumes them as behavior or deployment authority;
10. MCP configuration remains host-owned; future plugin MCP contribution is
    documented but not implemented by A1;
11. A1 introduces no authored collision mechanism; both Agent entry points use
    the exact documented Core-compatible last-wins/warning/readiness baseline;
12. validate/dev/package/Seneca proof demonstrates authored instructions plus
    selected plugin behavior through the shared behavior contract;
13. merged #814 is corrected and open #816/#817/Seneca #16 are replaced before
    they are closed as superseded;
14. Agent/Workspace/CLI/Core/full-app gates, invariants, golden path, packed
    consumer, cross-product negatives, and independent reviews pass.

## Out of scope

- implementing plugin-contributed MCP servers;
- authenticated external MCP ingress from Step 1B;
- same-workspace multiple selectable agents from Step 2;
- durable A2A/tasks/events from Step 3;
- hosted/marketplace plugin signing, permissions, or sandboxed server code;
- changing the current standalone brokered runtime-backend trust model or adding
  that gateway to Core/multi-workspace production;
- dynamic hot-registration of app/internal server routes/tools;
- authored plugin/package selection;
- model/provider policy in the agent definition;
- runtime mutation, deployment registries, CAS, AgentHost, or publication state;
- changing workspace membership/authorization semantics.

## Rollout and rollback

The corrective stack removes unreleased superseded APIs before qualification.

- Merged #814 is migration input; open #816/#817/Seneca #16 do not merge.
- R1a confirms the documented publication evidence before R1b removes catalog
  APIs; contrary external-consumer evidence stops for explicit semver approval.
- The public server option is `agentSource`, distinguishing the loaded frozen
  value from raw `agent.json`; the shared normalized value is
  `AgentBehaviorInputV1` unless API review finds an existing non-ambiguous name.
- R2a/R3 remove catalog/dev-app paths before any A1 release qualification.
- R2b can roll back to one host-wide plugin set while typed domains stay dark;
  it may not expose the union to a typed product as a substitute.
- R2c rollback retains typed authorization and restores the last known-good
  static type binding; it never maps a non-default type to `primary`.
- Plugin rollback uses normal deployment/package pins, not authored-directory
  mutation or a new control plane.
- `agent dev` uses the regular global mode resolver and normalized plugin/root
  inputs defined above; there are no remaining owner-open runtime-policy
  questions in A1.

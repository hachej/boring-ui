# R0 authority, publication, and consumer audit

> **Retained evidence, not current dispatch authority.** Decision 28 supersedes
> this audit's Decision 26 topology, `WorkspaceAgentHost`, typed policy, and
> next-Bead conclusions. F0b refreshes its publication/consumer/runtime facts
> against current main for the fleet/Environment plan.

- Bead: `wt-391-forward-step1a-current-xn9.1.1`
- Authority merge: PR #846, `085836f530dce5d88f36601a02f1813274a9310d`
- Graph merge: PR #864, `7669483c12fea4e0bfddd97269e2ec8409d21cf6`
- Audited baseline: `origin/main` at `7669483c1`
- Date: 2026-07-20
- Machine-readable facts: [`R0-EVIDENCE.json`](R0-EVIDENCE.json)

This is evidence and dispatch input. It changes no runtime behavior.

## Outcome

1. PR #846 and the replacement graph are on `main`; the old catalog/dev-app and
   singular-agent graphs are historical only.
2. R1 may begin with `wt-391-forward-step1a-current-xn9.1.2.1`.
3. Core C1 (`wt-391-forward-step1a-current-xn9.2.1`) is independently ready for
   a non-overlapping writer.
4. The #813–#815 authored materializer, catalog types/errors, and validate CLI
   shipped publicly in the `0.1.90` registry cohort. They are not unpublished
   implementation details.
5. **Owner decision, 2026-07-20:** there are no consumers to support. Make the
   correction in one separately reviewed R4 follow-up PR, with no compatibility
   window and no dedicated `0.2.0` release boundary. Migrate repository callers
   atomically; Seneca #16 remains superseded.
6. Gate `wt-391-forward-step1a-current-xn9.1.6.3` is resolved. I0 still owns the
   eventual coordinated package version and human-approved publication.

The corrective PR removes catalog/tool-selector authority and simplifies the
validator. It preserves `AUTHORED_AGENT_TOOL_COLLISION` while the normal tool
composer uses it and preserves adjacent compiler/digest/deployment exports that
are not made obsolete by the correction. Rollback is a normal revert before I0;
`0.1.90` remains the last already-published catalog-shaped cohort.

## 1. PR and ancestry evidence

| Work | GitHub state/base | Merge/head evidence | `main` ancestry | Dispatch result |
| --- | --- | --- | --- | --- |
| #813 materialized source | merged to `main` | merge `6c32d16e4` | yes | corrective input |
| #814 trusted catalog | merged to `main` | merge `54c10b64b` | yes | corrective migration input; product direction superseded |
| #815 validate CLI | merged to `main` | merge `7a21d3580` | yes | retain, then simplify under approved migration |
| #816 dev app | open; base `feat/805-a1-tool-catalog` | head `7039ad95b` | no | must not merge |
| #817 dev CLI | open; stacked on #816 | head `e836ce896` | no | must not merge |
| #821 conformance/docs | merged into `feat/805-a1-dev-cli`, **not `main`** | merge `15c7a7a5a` | no | branch evidence only |
| #844 persisted `workspaceTypeId` | merged to `main` | merge `e3494d4d2` | yes | completed migration input |
| #846 ownership/A1 recut | merged to `main` | merge `085836f53` | yes | current authority |
| #864 replacement graph | merged to `main` | merge `7669483c1` | yes | current dispatch graph |
| Seneca #16 | open PR against Seneca `main` | `docs/a1-authoring-contract` | not merged | must be replaced from current Seneca `main` |

Additional ancestry facts:

- #816 is the base of #817 (`7039ad95b` is an ancestor of #817 head).
- #821's base is the #817 branch, so GitHub's `MERGED` state does not mean its
  pack script/docs reached `main`.
- `scripts/a1-pack-consumer-smoke.mjs`,
  `packages/agent/docs/agent-authoring.md`, and
  `C0U7-BORING-CONFORMANCE.md` are absent from current `main`.
- Seneca #16 still describes future `materializeAgentDirectory()`, trusted
  catalog refs, and `agent dev`; that direction is superseded even though its
  temporary conformance guard rejects non-empty refs.

## 2. Registry publication evidence

Release `v0.1.90` (`d423a68c9`) was cut after #846 and contains the already
merged #813–#815/#814 code. The public cohort is:

| Package | Version | Registry SHA-1 |
| --- | --- | --- |
| `@hachej/boring-agent` | `0.1.90` | `b0ed8ff38b35c79ccbfd6c61c5f28cade2d46f07` |
| `@hachej/boring-workspace` | `0.1.90` | `24cfe57a9f39f919cdaa85d54e2e5feacccb7411` |
| `@hachej/boring-core` | `0.1.90` | `9ea0287fecda3c5f53e8b8dabd65665971a9eaa0` |
| `@hachej/boring-ui-cli` | `0.1.90` | `ce5f2195d8448c92cddff587f23784c564e3f4f2` |
| `@hachej/boring-ui-plugin-cli` | `0.1.90` | `527809fd0ef156e05cf9667364e91518a7bc0cf4` |

The downloaded `@hachej/boring-agent@0.1.90` declaration for the public
`./server` export contains all of:

- `materializeAgentDirectory()`;
- `AuthoredAgentMaterializationError` and its code type;
- `MaterializedAgentSourceV1`;
- `MaterializeAgentDirectoryInput`;
- `AuthoredAgentToolCatalog`;
- `compileAgentDirectory()` and the older deployment resolver types.

Its public `./shared` declaration contains `AgentCliErrorV1` and the authored
error literals. The downloaded `@hachej/boring-ui-cli@0.1.90` bundle contains
`boring-ui agent validate <dir>`, the human success text, schema-v1 JSON fields,
and authored-ID validation.

Implication: repository grep showing no production caller is not permission to
break the registry contract. Unknown external npm consumers remain possible.

## 3. #813–#815 public surface matrix

### 3.1 Agent server exports

| Surface | Current/public shape | Migration concern |
| --- | --- | --- |
| `materializeAgentDirectory(input)` | returns `Promise<MaterializedAgentSourceV1>` | function and behavior are public |
| `MaterializeAgentDirectoryInput.directory` | host path string | keep contained/bounded loader behavior |
| `.expectedAgentTypeId?` | exact product ID check | keep; new host `agentTypeId` must equal authored ID |
| `.toolCatalog?` | `ReadonlyMap<string, AgentTool>` | published executable catalog seam; conflicts with new authored-source rule |
| `MaterializedAgentSourceV1.schemaVersion` | literal `1` | cannot silently repurpose |
| `.agentTypeId`, `.version`, `.label?`, `.instructions` | safe/declarative data except missing description | desired direction, with exact ID equality |
| `.tools` | executable `readonly AgentTool[]` | must leave authored source under approved break/migration |
| `.declaredToolRefs` | authored refs | must leave authored source under approved break/migration |
| `AuthoredAgentToolCatalog` | public type alias | published in #814 |
| `AuthoredAgentMaterializationError` | public class with `code`, optional `field` | callers may branch on class/code/field |
| `AuthoredAgentMaterializationErrorCode` | exact public union/export name for eight authored errors | version with the class/error migration |
| `AgentCliErrorV1` | shared schema-v1 error envelope | validate CLI contract |

### 3.2 Stable authored errors

#813 added seven public `ErrorCode` values; #814 added the eighth:

- `AUTHORED_AGENT_ID_INVALID`
- `AUTHORED_AGENT_TYPE_MISMATCH`
- `AUTHORED_AGENT_CATALOG_REQUIRED`
- `AUTHORED_AGENT_CATALOG_INVALID`
- `AUTHORED_AGENT_REFERENCE_UNKNOWN`
- `AUTHORED_AGENT_REFERENCE_UNSUPPORTED`
- `AUTHORED_AGENT_TOOL_INVALID`
- `AUTHORED_AGENT_TOOL_COLLISION`

`packages/agent/docs/ERROR_CODES.md` labels them stable trusted-API errors.
R4 must explicitly decide which remain, deprecate, or move at the approved
version boundary.

### 3.3 Underlying authored definition fields

The public `AgentDefinition`/compiler contract currently accepts:

```text
schemaVersion, definitionId, version, label, instructionsRef,
capabilityRequirements, toolRefs, skillRefs, mcpServerRefs
```

The materializer rejects non-empty capability/skill/MCP refs, but #814 resolves
non-empty `toolRefs` through the trusted catalog. The validate CLI calls the
compiler—not the materializer—so it currently accepts and reports every ref
family without claiming resolution.

The older public compiler/digest/deployment exports predate #813 but share these
fields and are affected consumers of any schema removal. They cannot be omitted
from the R4 migration decision.

### 3.4 Validate CLI fields and process behavior

Command:

```text
boring-ui agent validate <dir> [--json]
```

Exact JSON success envelope:

```text
schemaVersion: 1
ok: true
agent.agentTypeId
agent.version
agent.label?
agent.instructions.present
agent.instructions.byteLength
agent.refs.tools
agent.refs.capabilities
agent.refs.skills
agent.refs.mcpServers
```

Exact JSON error envelope (`AgentCliErrorV1`):

```text
schemaVersion: 1
ok: false
error.code
error.field?
error.message
```

Other compatibility facts:

- success is stdout with exit `0`; failure is stderr with exit `1`;
- exact `--json` is accepted before/between/after command tokens;
- unsupported options/extra positionals use `CONFIG_INVALID`;
- compiler failures expose a field and exactly one of:
  `AGENT_DIRECTORY_NOT_FOUND`, `AGENT_DIRECTORY_NOT_DIRECTORY`,
  `AGENT_MANIFEST_NOT_FOUND`, `AGENT_MANIFEST_NOT_FILE`,
  `AGENT_MANIFEST_INVALID_UTF8`, `AGENT_MANIFEST_INVALID_JSON`,
  `AGENT_ASSET_NOT_FOUND`, `AGENT_ASSET_NOT_FILE`,
  `AGENT_ASSET_INVALID_UTF8`, `AGENT_PATH_SYMLINK_ESCAPE`,
  `AGENT_PATH_CHANGED_DURING_READ`, or `AGENT_DIRECTORY_IO_FAILED`;
- schema failures expose `AGENT_DEFINITION_INVALID` or
  `AGENT_DEFINITION_UNSUPPORTED_FIELD`;
- invalid product ID exposes `AUTHORED_AGENT_ID_INVALID`;
- an unclassified failure is redacted to `INTERNAL_ERROR` with message
  `agent validation failed`;
- prompt contents and absolute paths stay redacted;
- human success labels are exactly `Authored agent directory is valid.`, `id`,
  `version`, optional `label`, `instructions: <n> bytes`, `declared refs`,
  `tools`, `capabilities`, `skills`, and `mcpServers`; an empty ref list renders
  `<label>: 0`, while a non-empty list renders `<label>: <n> (<comma-list>)`;
- human failures are `<code> [JSON-escaped field]: <JSON-escaped message>`;
- human output escapes terminal/bidi/C1 controls.

The direct contract tests are
`packages/cli/src/__tests__/cli.integration.test.ts`,
`packages/agent/src/shared/__tests__/agent-cli-error.test.ts`, and the
materializer/compiler/error-code tests under
`packages/agent/src/{server/agentDefinition,shared}/__tests__`. The generic
`INTERNAL_ERROR` fallback was observed in implementation but has no direct CLI
regression test; R4.2 must freeze its redacted code/message/stdout/stderr/exit
behavior before changing the validator.

R4.2 must version or preserve these fields intentionally. It may not simply
remove `refs` from a schema-v1 response.

### 3.5 Adjacent published compiler/digest/deployment contracts

Definition-shape migration also reaches these exact `0.1.90` public exports;
R4.0 must mark each **preserve unchanged** or define its versioned migration:

- server: `AgentDirectoryCompilerError`, `AgentDirectoryCompilerErrorCode`,
  `AgentDirectoryCompilerPublicErrorCode`, and `compileAgentDirectory`;
- compiler class data: outer public `code`
  (`CONFIG_INVALID | PATH_NOT_FOUND | PATH_SYMLINK_ESCAPE`), detailed
  `compilerCode`, `field`, redacted `message`, and optional `cause` behavior;
- shared error registries: `AgentDefinitionErrorCode`,
  `AgentDeploymentErrorCode`, `ErrorCode`, and `ERROR_CODES`;
- shared definition data: `AgentDefinition`, `AgentDefinitionDigestAsset`,
  `AgentDefinitionReference`, `CompiledAgentDefinition`, `CompiledAgentBundle`,
  `AgentDeployment`, `AgentSchemaIssue`, `AgentSchemaValidationResult`, and
  `Sha256Digest`;
- shared validation/digest values: `AgentDefinitionValidationError`,
  `AgentDeploymentValidationError`, `OpaqueRefSchema`, `Sha256DigestSchema`,
  `validateAgentDefinition`, `validateAgentDeployment`,
  `createAgentAssetDigest`, `createAgentDefinitionDigest`, and
  `createAgentDeploymentDigest`;
- server deployment values: `resolveAgentDeployment`, `createResolvedAgentDigest`,
  `ResolvedAgentDigestInput`, and `ResolvedAgent`.

Although deployment/controller authority is retired from the active product
path, registry consumers can still import these names. The live normal tool
composer `packages/agent/src/server/catalog/mergeTools.ts` and its tests also
consume `AUTHORED_AGENT_TOOL_COLLISION`; that literal cannot be removed merely
because the authored catalog goes away.

## 4. Consumer inventory

### 4.1 Current Boring repository

| Consumer | Current use | R-slice owner |
| --- | --- | --- |
| `packages/agent/src/server/agentDefinition/materializeAgentDirectory.ts` | only live implementation of the materializer/catalog | owner-approved R4 corrective follow-up |
| materializer/catalog tests | exhaustive trust-boundary and collision behavior | R4 correction/migration tests |
| `packages/agent/src/server/index.ts` | public server exports | R4.1 exact removal/preservation matrix |
| `packages/agent/src/shared/{agent-definition,error-codes,index}.ts` | public schema, refs, validation/digest/deployment values, error strings, CLI envelope | R4.1/R4.2 atomic repository migration |
| `packages/agent/src/server/catalog/mergeTools.ts` + tests | normal final tool composer uses `AUTHORED_AGENT_TOOL_COLLISION` | preserve or separately migrate the shared collision code |
| `packages/cli/src/server/cli.ts` + integration tests | validate calls `compileAgentDirectory`, reports ref arrays, and locks human/JSON/exit behavior | R4.2 |
| `scripts/golden-path-timing.mjs` | compiles ref-bearing sample and times old deployment resolver | R4.1 or separate golden-path migration |
| runtime hosts | **no current production host calls `materializeAgentDirectory`** | R3/R4 will bind current declarative source to host policy |
| `createAgentApp`, Core, Workspace, CLI workspaces mode | consume runtime/harness/plugin APIs, not A1 materializer | R1–R3 |

#821's packed consumer is branch-only and absent from `main`; it is useful test
input, not a passing current-main proof.

### 4.2 Seneca

Current Seneca `main` still carries ref-bearing dummy authored data and docs
around `compileAgentDirectory`. The dirty canonical Seneca checkout was treated
as read-only during this audit.

Open Seneca PR #16:

- pins the old `0.1.89` cohort;
- documents future materializer/catalog binding;
- documents `agent dev` one-shot/serve commands from the superseded branch;
- adds temporary local conformance around empty refs;
- is not a current declarative-plugin integration.

It must not merge. R6 starts from then-current Seneca `main` and registry-installs
the I0 cohort.

### 4.3 External/packed consumers

The registry is public evidence of a supported surface; external consumers
cannot be enumerated from this repository. R4.0 therefore owns the uncertainty.
The future packed proof must install from tarballs/registry in an empty external
fixture and prohibit workspace/source fallbacks.

## 5. Current runtime ownership topology

There are currently two Agent runtime construction paths, plus three host
composition owners:

```text
standalone createAgentApp
  -> creates Workspace/Sandbox/runtime/tools/harness directly
  -> registers an AgentRouteBindingProfile

embedded registerAgentRoutes
  -> owns RuntimeBinding lifecycle/cache
  -> creates Workspace/Sandbox/runtime/tools/harness per scope

createWorkspaceAgentServer
  -> owns bridge, plugin collection, asset manager, backend registry,
     provisioning and reload
  -> calls createAgentApp (standalone path)

createCoreWorkspaceAgentServer
  -> owns auth, plugin collection, bridge, adapter/provider, per-root Pi cache,
     provisioning and trusted dispatcher proxy
  -> calls registerAgentRoutes (embedded path)

CLI workspaces mode
  -> owns per-workspace bridges, plugin managers/backend registries,
     Pi snapshots, provisioning cache, automation stores and disposal
  -> calls registerAgentRoutes directly
```

Other direct shells are `packages/agent/src/{dev,bin/boring-agent}.ts`,
`apps/agent-playground`, Workspace playground/eval apps, and plugin playgrounds.
R1 must retain those supported shapes while routing production shells through
one embeddable `WorkspaceAgentHost`; it must not create an exported compatibility
adapter or a third path.

### 5.1 Exact current runtime cache key

`registerAgentRoutes.resolveRuntimeScope()` serializes this array:

```text
[
  resolvedMode,
  workspaceId,
  resolved workspace root,
  resolved template path or null,
  resolved/defaulted Pi options,
  normalized session namespace or null,
  extra-tools auth subject or null,
  runtime-scope contribution identity or null
]
```

Request-scoped runtime mode is enabled when any of these exist:

- `getWorkspaceId`
- `getWorkspaceRoot`
- `getTemplatePath`
- `getPi`
- `getExtraTools`
- `getSessionNamespace`
- `getSystemPromptDynamic`
- `getRuntimeScopeContribution`
- `getTrustedWorkspaceRoot`

This explains the current actor-keyed binding: `getExtraTools` inserts the
trusted/request auth subject into the key. `JSON.stringify(pi)` is also lossy:
function-valued `extensionFactories`, `getHotReloadableResources`, and any other
callback-valued Pi policy are omitted, so distinct configurations can alias the
same current key.

R1 must split the combined key into an explicit deep-frozen
`WorkspaceRuntimeDescriptor` and a synthetic-primary behavior descriptor.
Executable Pi contributions belong to behavior—not runtime identity—and receive
stable host/plugin provenance IDs there; callback-scoped hot-resource readers
point only at the current committed generation and are not compared by function
identity. Runtime descriptor drift or primary-behavior descriptor drift fails
rather than aliasing a binding or creating a second runtime. R2a moves actor/
session values out of singleton identity entirely.

## 6. Legacy option-to-owner mapping

### 6.1 Shared runtime descriptor or lifecycle

| Current option/input | New owner |
| --- | --- |
| `workspaceRoot`, `getWorkspaceRoot`, `getTrustedWorkspaceRoot` | Workspace authorized root resolution; canonical result in the WorkspaceRuntime descriptor |
| `sessionId` when used as static Workspace ID; `getWorkspaceId` | host/Workspace scope resolution, never agent behavior |
| `mode`, `runtimeModeAdapter.id`, adapter/provider identity | WorkspaceRuntime descriptor |
| `runtimeModeAdapter`, `runtimeHost` | WorkspaceRuntime factory/lifecycle |
| `templatePath`, `getTemplatePath` | resolved workspace-static descriptor/provisioning input |
| `runtimeEnvContributions` | WorkspaceRuntime construction |
| `provisionWorkspace`, `provisionRuntime`, standalone `runtimeProvisioner` | Workspace generation coordinator/provisioning union |
| adapter health check, cache capacity, eviction/dispose | WorkspaceRuntime lifecycle |
| `shareEntryStore` | Workspace-level route service; route remains self-authorizing |

### 6.2 Agent behavior binding

| Current option/input | New owner |
| --- | --- |
| `harnessFactory` | Agent factory for one requested type |
| `pi`, `getPi` | normalized host/agent resource policy; no ambient actor capture |
| `extraTools` | standard/host/plugin behavior composition |
| `systemPromptAppend` | authored instructions + trusted per-agent plugin view |
| `systemPromptDynamic`, `getSystemPromptDynamic` | per-operation/binding prompt callback |
| `getRuntimeScopeContribution.identity/loadSystemPromptAppend` | stable trusted behavior identity plus callback; not runtime identity |
| `externalPlugins` | host policy normalization (`primary` compatibility versus explicit policy) |
| `disableDefaultFileTools` | standalone compatibility decision; configured Workspace agents retain standard tools |
| standalone `runtimeProvisioning`/`getRuntimeProvisioning` | binding reads current committed Workspace generation |

### 6.3 Invocation/session services

| Current option/input | New owner |
| --- | --- |
| `getExtraTools.authSubject` | per-operation actor authorization/tool context; removed from binding key |
| `sessionNamespace`, `getSessionNamespace`, `sessionDir`, `sessionRoot` | Workspace actor-multiplexing session router and host durable session root |
| `getFilesystemBindings(request,user,session,requestId)` | fresh operation context |
| `filterModels(request)` | existing request/model policy |
| `admitEffect` | operation-target authorization consumption |
| `metering` | per-run actor/session service |
| `telemetry` | host service; no authority |
| `beforeReload` | Workspace generation transaction plus requesting-session reload |
| `getPluginDiagnostics` | generation/agent-scoped diagnostics read |
| `onWorkspaceAgentDispatcher` | replaced/narrowed to fresh invocation facade in R2b |

### 6.4 `CreateWorkspaceAgentServerOptions`-specific mapping

These rows complete the inherited `CreateAgentAppOptions` mapping above.

| Exported option | New owner |
| --- | --- |
| `defaults`, `excludeDefaults`, `plugins` | host startup policy; canonical plugin records feed per-agent views and the Workspace union |
| `defaultPluginPackages`, `appRoot` | shell package discovery; resolved canonical plugin IDs/records become startup policy |
| `additionalBoringPluginDirs` | host plugin discovery input; static policy/generation source, never agent-authored data |
| `installPluginAuthoring` | host policy affecting explicit Pi/skill/provisioning resources; normalized before serving |
| `provisionWorkspace` | Workspace generation/provisioning enablement |
| `workspaceProvisioning.force` | one requested Workspace provisioning generation; not a second runtime |
| `validateUiPaths` | Workspace/UI-tool compatibility derived from filesystem capability; no actor capture |
| `workspaceBridge.registry` | Workspace-scoped bridge registry owned by the shared runtime/host |
| `workspaceBridge.handlers` | trusted host-global handler records; self-authorizing, part of the Workspace union |
| `workspaceBridge.runtimeTokenSecret`, `.runtimeRefreshTokenSecret` | shell secret inputs; issuers stay host-owned and values never enter descriptors/logs |
| `workspaceBridge.browserAuthPolicy`, `.allowInsecureLocalCliBrowserAuth` | shell ingress/auth policy; insecure policy remains explicit local-only compatibility |
| `workspaceBridge.runtimeEnv` | Workspace runtime env contribution with stable descriptor identity |
| `boringPluginFrontTargetResolver` | Workspace asset/front generation service |
| `externalPlugins` | host policy switch for ambient discovery; omitted-policy compatibility only, explicit policy remains sealed |

### 6.5 `CreateCoreWorkspaceAgentServerOptions`-specific mapping

These rows complete the inherited `RegisterAgentRoutesOptions` mapping above.

| Exported option | New owner |
| --- | --- |
| `appRoot`, `config`, `loadConfigOptions` | Core shell/config boot only |
| `plugins`, `excludeDefaults`, `defaultPluginPackages`, `installPluginAuthoring` | host startup policy; Core may load trusted package records but Workspace owns agent/plugin views |
| `workspaceBridge.handlers` | trusted host-global handlers in the Workspace union; handlers self-authorize |
| `workspaceBridge.runtimeTokenSecret`, `.runtimeRefreshTokenSecret`, `.runtimeEnv` | shell secrets plus Workspace runtime env issuer/contribution; no Core agent composition |
| `getWorkspaceBridgeExtraTools` | per-operation trusted bridge tools for the selected AgentBinding; actor/request context is not retained |
| `getWorkspaceBridgePi` | Workspace/Agent resource callback read through the current committed generation |
| `hotReload` | Core shell compatibility invariant (`false` only); static policy changes require restart |
| `forceProvisioning` | requests one Workspace generation; never creates another runtime |
| `trustedPluginActorResolver` | request/background authorization issuer input; R2b replaces ambient resolver use with fresh operations |
| `requestScopeResolver` | Core C1/C2 request/product authorization compatibility seam; never runtime/agent identity |
| `frontendRootHandler`, `serveFrontend` | Core HTTP/frontend shell only |
| `sandboxHandleStore` | WorkspaceRuntime provider lifecycle/descriptor input |
| `telemetry` | shell service; no authority or identity |
| Core `extraTools`, `systemPromptAppend`, inherited `pi/getPi` | synthetic-primary behavior until explicit policy; then trusted per-agent view/current generation |

### 6.6 Remaining shell-only compatibility

`version`, `logger`, `authToken`, `registerHealthRoute`, static frontend options,
CLI listen/registry options, and the `RunCliOptions.publicDir/argv` process inputs
remain shell concerns. They do not create a second runtime policy path. Every
exported Agent/Workspace/Core option is otherwise assigned above to the runtime
descriptor/lifecycle, synthetic-primary/typed behavior, invocation/session
services, generation/plugin ownership, or shell compatibility.

### 6.7 Nested contract completeness matrix

This field-level matrix prevents the grouped host options above from hiding
lifetime or authorization differences.

| Nested contract/field | Preserve/move/drop ruling |
| --- | --- |
| `WorkspaceServerPlugin.id` | preserve as canonical global plugin identity/provenance |
| `.label` | preserve as safe host metadata |
| `.systemPrompt`, `.skills`, `.agentTools`, `.piPackages`, `.extensionPaths` | move into the assigned agent's trusted behavior/Pi-resource view; never Workspace isolation or authored authority |
| `.provisioning` | move into the deterministic effective Workspace plugin union and generation coordinator |
| `.routes`, `.workspaceBridgeHandlers`, `.assets`, `.preservedUiStateKeys` | preserve as host-global/Workspace-level surfaces derived from the effective union; routes/handlers self-authorize |
| `DirPluginEntry.dir` | shell loader input resolved to one canonical plugin record at startup |
| `.options` | static trusted factory configuration; validate/freeze before serving and never infer enablement from the plugin |
| `.hotReload` | standalone compatibility/reload input; Core remains `false`, and policy membership still requires restart |
| `.trust` | preserve as the host authorization gate for privileged bridge-handler registration, not agent behavior selection |
| `WorkspaceAgentPiOptions.noContextFiles`, `.noSkills` | explicit per-agent resource policy; configured multi-agent hosts must not inherit ambient resources accidentally |
| `.additionalSkillPaths`, `.packages`, `.extensionPaths`, `.extensionFactories` | trusted per-agent Pi-resource view with plugin provenance; provisioned roots are generation-namespaced |
| `WorkspaceBridgeRuntimeEnvOptions.enabled`, `.bridgeUrl`, `.allowInsecureHttp` | shell transport policy; remote endpoints fail closed to HTTPS/non-localhost rules |
| `.capabilities` | explicit runtime-token grants consumed by operation authorization; handlers still enforce resource scope |
| `.sessionId`, `.tokenTtlMs`, `.refreshTokenTtlMs` | short-lived invocation/session claims and expiry policy; never singleton identity or persisted authority |
| `BridgeAuthPolicy.resolve.input.callerClass/definition/workspaceId/sessionId/pluginId/requiredCapabilities` | one target-bound bridge authorization request |
| `.request/.body` | ephemeral request evidence; never retained by WorkspaceRuntime/AgentBinding |
| `BridgeAuthResolution.context/effectiveCapabilities/resourceScope/principal` | callback-scoped invocation authority/attribution only |
| `RuntimeModeAdapter.id`, `.workspaceFsCapability` | stable WorkspaceRuntime descriptor/capability facts |
| `.runtimeHost`, `.create`, `.getRuntimeLayoutRoot` | shared WorkspaceRuntime provider construction/lifecycle |
| `.readiness`, `.cachedBindingHealthCheck` | shared readiness and health/recreate policy under tracked leases |
| `RuntimeModeAdapter.evictCachedRuntime({workspaceId})` | per-Workspace provider-cache eviction after that Workspace's leases drain |
| `RuntimeBundle.disposeRuntime()` | exact-once release of one acquired Workspace + Sandbox pair during rollback/retirement |
| `RuntimeModeAdapter.dispose()` | adapter/provider-wide shutdown only after the host has retired **all** Workspace scopes; never one-Workspace retirement |
| `LoadConfigOptions.tomlPath`, `.env`, `.allowMissingSecrets` | Core shell/config loading only; values/secrets never enter agent definitions |
| `CoreRequestScope.bindingId/workspaceId/defaultDeploymentId/activeRevision/resolvedDigest` | retired deployment-scope payload; C1 replaces it with agent-agnostic product type/create scope, never maps it into WorkspaceRuntime |
| `CoreWorkspaceBridgeExtraToolsContext.workspaceId/workspaceRoot` | authorized operation target facts |
| `.callAsRuntime(request, {sessionId, signal})` | one callback-scoped bridge operation/cancellation; no retained bridge/Workspace authority |
| `SandboxHandleStore.get/put/delete/list` and `SandboxHandleRecord` fields | preserve behind WorkspaceRuntime provider lifecycle; validate workspace key, persist provider handle metadata, and fence delete/list through retirement policy |

Completeness source set: `RegisterAgentRoutesOptions`, `CreateAgentAppOptions`,
`CreateWorkspaceAgentServerOptions`, `CreateCoreWorkspaceAgentServerOptions`,
`WorkspaceServerPlugin`, `DirPluginEntry`, `WorkspaceAgentPiOptions`,
`WorkspaceBridgeRuntimeEnvOptions`, `BridgeAuthPolicy`, `RuntimeModeAdapter`,
`LoadConfigOptions`, `CoreRequestScopeResolver`,
`CoreWorkspaceBridgeExtraToolsContext`, and `SandboxHandleStore`.

## 7. Actor/request-sensitive callback inventory

The following callbacks must not be retained inside the actor-neutral singleton:

- request Workspace/root/type resolution;
- `getExtraTools` and its auth subject;
- filesystem binding resolution with user/session/request identity;
- session namespace resolution;
- model filtering and effect admission;
- trusted plugin `actorResolver`/`actorVerifier`;
- managed MCP source/connector/tool calls;
- automation manual/scheduled/hosted execution;
- ask-user session/question reads and mutations;
- metering reservation/settlement;
- bridge calls and runtime tokens;
- queued/retry/auto-follow-up producers.

Workspace-static or behavior callbacks that still require stable snapshotting are
`getTemplatePath`, `getPi`, runtime-scope contribution identity, provisioning,
hot-resource loaders, plugin prompt loaders, diagnostics, and reload hooks. R1
records their stable descriptor identity; R2/R3 expose only callback-scoped
leases and current committed generations.

## 8. Raw authority and session consumers

| Surface | Current consumers | Required migration |
| --- | --- | --- |
| `WorkspaceAgentDispatcherResolver.resolveWithWorkspace()` returns dispatcher **and raw Workspace** | Core proxy; full-app managed MCP; smoke/tests | R2b operation facade; no retained raw Workspace |
| dispatcher with caller `{workspaceId,userId}` | automation manual/hosted due runs; trusted plugin context | short-lived subject issuer and one token per operation/target |
| raw Agent/harness/session stores | Agent route binding, commands, system prompt, reload, diagnostics, Pi chat service | R2a narrow AgentBinding + Workspace session router |
| `SessionStore`/`PiSessionStore` | harness and Agent core/service | preserve storage; add typed metadata/actor-multiplexing router, no Core table |
| Core trusted plugin context | dispatcher resolver, actor resolver/verifier, SQL, trigger token | retain host-only inputs but expose fresh operations, not ambient Workspace authority |
| Agent MCP delegate/share/artifact controllers | request contexts, runners, artifact stores | R2b revalidation per start/status/result/artifact/cancel/stop |

Public `createAgentApp`, `createAgent`, harness factories, and session interfaces
are also registry exports. The Workspace-hosted object graph may narrow them but
R4 does not authorize removing them; its owner approval is limited to the
catalog/materializer/validate surface explicitly inventoried above.

## 9. Stateful trusted-plugin inventory

| Plugin/surface | Boot-captured or persistent state today | Migration requirement |
| --- | --- | --- |
| ask-user | file store rooted at boot Workspace; runtime waiters/rate buckets; publisher hints keyed by raw session; tool session callback | composite app/Workspace/actor/agent/session keys and operation handles; history delete cleans scoped state |
| boring-automation | file/Postgres stores; retained dispatcher and actor resolver; scheduled/hosted services | stable subjects/receipts only; reauthorize every operation and retry |
| boring-mcp | actor/workspace source records; tool catalog and transport caches; rate buckets; managed connector sessions | preserve actor-qualified keys, remove retained authority, revalidate source/tool operation |
| boring-governance | user/run reservation cache; company-context mutation/provision queues; request filesystem bindings | keep actor/run qualification; use explicit one-shot seeding and fresh operation context |
| ccusage-dashboard Pi extension | resolves ambient `BORING_AGENT_WORKSPACE_ROOT`/cwd and persists usage/quota JSON under `.pi/data` (plus legacy extension path) | bind file operations to the supplied Workspace resource/generation; no process-global root or cross-Workspace file state |
| github-pr-tracker Pi extension/server | resolves ambient Workspace cwd, shells to `gh`, builds transient maps, and writes tracker JSON under the Workspace | bind cwd/files/shell to the operation's Workspace; preserve transient per-call maps only; never capture actor credentials in singleton state |
| tasks | boot registry/source runtimes and optional Workspace root | route authorization plus explicit Workspace operation/root context |
| diagram, data-bridge, bi-dashboard, data-catalog, generated-pane | boot-captured Workspace root or route/service closures | do not capture one actor; adapt root/service use to the shared Workspace scope or self-authorized route context |
| Workspace standalone plugin runtime | asset manager, backend registry, hot snapshots, bridges and rebuild closures | Workspace generation participant and one effective plugin union |
| CLI workspaces mode | maps for bridges, bridge cores, plugin managers/backends, Pi snapshots, provisioning and automation stores | move under WorkspaceAgentHost; key/retire by workspace ID + stable descriptor |
| Core host | per-root Pi cache, bridge, plugin collection, trusted resolver proxy | Workspace owns agent orchestration; Core supplies authorized facts only |

Plugin IDs and behavior contributions are static host inputs. Routes/bridges stay
host-global and must continue self-authorizing in this shipment.

## 10. Capabilities contract inventory

Current Core `CapabilitiesResponse.agent` is unversioned:

```text
agent.runtimeMode
agent.tools: string[]
agent.modelProviders: string[]
```

`registerAgentRoutes` registers it at Core startup/onReady. For request-scoped
runtime it reports standard tool names plus static `extraTools`; it cannot safely
represent dynamic `getExtraTools` or an arbitrary non-default agent. Frontend
`useCapabilities`, Core route tests, and public `/api/v1/capabilities` consume
this shape.

R3 must choose exactly the approved locked migration:

- omitted-policy compatibility keeps this unversioned primary shape; or
- explicit policy returns schema version 2 with
  `catalogScope: "authorized-workspace-default"` after authorization.

No global union of every allowed agent's tools and no public type selector.

Exact consumers that must migrate in one R3 cohort:

- DTO/export: `packages/core/src/shared/{types,index}.ts`;
- contributor/cache/route: `packages/core/src/server/app/{types,capabilities}.ts`;
- browser client: `packages/core/src/front/hooks/useCapabilities.ts` and its
  hook tests;
- Core route/contributor/cache tests:
  `packages/core/src/server/app/__tests__/{capabilities,routes}.test.ts`;
- Agent registration/static-versus-request-scoped catalog tests in
  `packages/agent/src/server/__tests__/{registerAgentRoutes,createAgentApp}.test.ts`;
- deployed consumer: `apps/full-app/scripts/post-deploy-smoke.ts`.

## 11. Authority and graph state

- Decision 26, #391 plan/vision/modes/alignment/ownership, #805 plan, A1
  PLAN/HANDOFF/TODO, and P3 supersession all point to the same ownership split.
- P3's catalog/custom-tool plan is explicitly non-dispatchable pending recut.
- `wt-391-forward-c0u` and stale `wt-391-forward-o0b` active children are closed
  with `historical`/`superseded` labels; history was not deleted.
- Current root is `wt-391-forward-step1a-current-xn9`.
- Deferred follow-ups are related, not parent-child completion blockers.
- R2b deletion work is split into policy/fences, replica/drain, and durable data
  cleanup/finalization.
- I0 depends on both R5 and C4 and registry-verifies the joint cohort before R6.
- R4.1 depends on decision gate
  `wt-391-forward-step1a-current-xn9.1.6.3`; the owner has now closed that gate
  with the corrective-follow-up strategy recorded above.

## 12. Proof commands

The commands actually run from the isolated R0 worktree were:

```bash
for n in 813 814 815 816 817 821 844 846 864; do
  gh pr view "$n" --repo hachej/boring-ui \
    --json number,title,state,baseRefName,headRefName,headRefOid,mergeCommit,files
done

for pair in \
  '813 6c32d16e43eac2cebf4327ed123b439dc9da7a46' \
  '814 54c10b64bcca86bc6e6d4e526aa66734d7e4b5e2' \
  '815 7a21d3580e1f7b3e06b40e39483ae6b5f803f1c4' \
  '821 15c7a7a5ac913787d92da33e7cf4524958a96d8a' \
  '844 e3494d4d2b66d062ebb1e631ec936d0118ac34a7' \
  '846 085836f530dce5d88f36601a02f1813274a9310d' \
  '864 7669483c12fea4e0bfddd97269e2ec8409d21cf6'; do
  set -- $pair; git merge-base --is-ancestor "$2" HEAD; echo "#$1=$?"
done

gh pr view 16 --repo hachej/seneca \
  --json number,title,state,baseRefName,headRefName,files

for p in @hachej/boring-agent @hachej/boring-workspace \
  @hachej/boring-core @hachej/boring-ui-cli \
  @hachej/boring-ui-plugin-cli; do
  npm view "$p@0.1.90" name version dist.integrity dist.shasum --json
done

npm pack @hachej/boring-agent@0.1.90 --pack-destination /tmp/r0-npm-pack-agent --json
npm pack @hachej/boring-ui-cli@0.1.90 --pack-destination /tmp/r0-npm-pack-cli --json
tar -xOf /tmp/r0-npm-pack-agent/hachej-boring-agent-0.1.90.tgz \
  package/dist/server/index.d.ts
tar -xOf /tmp/r0-npm-pack-cli/hachej-boring-ui-cli-0.1.90.tgz \
  package/dist/server/cli.js

find packages apps plugins scripts -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.mjs' \) \
  -print0 | xargs -0 grep -nHE \
  'materializeAgentDirectory|registerAgentRoutes|WorkspaceAgentDispatcherResolver|SessionStore'

br graph wt-391-forward-step1a-current-xn9 --json > /tmp/r0-current-graph.json
IDS=$(jq -r '.nodes[].id' /tmp/r0-current-graph.json | tr '\n' ' ')
br lint $IDS --json
br dep cycles
bv --robot-insights
bv --robot-next
pnpm check:golden-path
git diff --check
```

Recorded results:

- PR/ancestry and registry values match
  [`R0-EVIDENCE.json`](R0-EVIDENCE.json); notably #821 returns non-ancestor
  status because its base was #817, not `main`.
- packed Agent declarations contain the six authored exports listed in §2/§3;
  packed CLI code contains the schema-v1 validate command/labels.
- graph lint returned zero findings; `br dep cycles` returned no cycles;
  the root graph contained 46 nodes/83 edges after the semver gate; robot-next
  remained R0 while it was in progress.
- `pnpm check:golden-path` passed all seven checks.
- `git diff --check` passed.

After R0 closed, R1.1 and Core C1 remained code paths. The owner subsequently
resolved R4.0: use one corrective follow-up PR, no compatibility window, and no
dedicated `0.2.0` boundary because the published surface has no consumers.

## 13. Resolved decision and exact next action

### R4 corrective strategy

R4.1/R4.2 may remove or reshape the unused catalog/materializer/validate surface
atomically in one reviewed follow-up. Preserve unrelated adjacent exports and the
live normal-composer collision code; migrate repository callers in the same PR.
I0 chooses and publishes the later joint package cohort. Roll back by reverting
the corrective PR before publication.

### First implementation

```text
/exec wt-391-forward-step1a-current-xn9.1.2.1
```

That slice extracts the WorkspaceRuntime primitive, stable descriptor,
workspaceId-only cache, Agent factory input, and transactional rollback. It must
not implement R4 or Core C1 implicitly.

# Slice 3 proof — application-owned runtime and provisioning seam census

Bead: `factory-plugin-owner-runtime-identity-prefix-8pdn.3`

## Outcome

An application can own the IDs `ecs-local-efs`, `agentcore-remote-efs`, and
`aws-agentcore`, build its provider, pass it to
`createProviderRuntimeModeAdapter`, and inject that adapter into Workspace or
Core without adding an entry to `BuiltinRuntimeModeId` or any builtin factory.
The census found two closed type seams: provider IDs and provisioning mode IDs.
Those types are now extensible. No provider, AWS client, handle store, or
builtin selection behavior was added.

## Public composition path

1. `@hachej/boring-sandbox/shared` exports `SandboxProviderV1`,
   `SandboxProviderIdV1`, `SandboxProviderCreateContextV1`,
   `WorkspaceSandboxPairV1`, and `SandboxProvisioningOperationsV1`.
   `SandboxProviderV1.create(ModeContext-compatible input)` owns acquisition and
   returns the paired `Workspace`, `Sandbox`, optional provisioning operations,
   and idempotent `dispose`.
2. `@hachej/boring-agent/server` exports `RuntimeModeId`, `ModeContext`,
   `RuntimeModeAdapter`, `WorkspaceProvisioningAdapter`, and
   `createProviderRuntimeModeAdapter` from its documented `./server` export.
   The adapter options bind an application ID, provider, runtime-host
   operations, filesystem/bash strategies, optional host `storageRoot`, and
   optional provisioning conversion.
3. `createProviderRuntimeModeAdapter.create(context)` calls provider
   `create(context)`, preserves the returned pair, and projects
   `pair.provisioning` to `RuntimeBundle.provisioningAdapter` unless the host
   supplies an explicit conversion. Pair disposal, invalidation, health, and
   runtime projection remain provider-owned.
4. Standalone injection is
   `createWorkspaceAgentServer({ runtimeModeAdapter })` (Workspace) or
   `createStandaloneAgentHostApp({ runtimeModeAdapter })` (Agent). Core injection
   is `createCoreWorkspaceAgentServer({ runtimeModeAdapter })`. In Core,
   `selectedMode` is computed first from `options.mode`,
   `BORING_AGENT_MODE`, or auto-detection, and that selection may construct a
   builtin Blaxel/Vercel handle store. Only afterward does
   `options.runtimeModeAdapter` take execution precedence over the remote-worker
   and builtin adapters. The builtin store is passed only to the builtin adapter
   factory; it is not injected into the custom adapter.

## Exact type findings and decisions

| Seam | Before | Decision |
| --- | --- | --- |
| Agent `RuntimeModeId` | Already `BuiltinRuntimeModeId | (string & {})` | Leave open; do not expand `BuiltinRuntimeModeId`. |
| Adapter factory | Already publicly exported from `@hachej/boring-agent/server` | Leave unchanged. |
| `ModeContext` | Carries host workspace root, session, optional workspace/template/request/telemetry | Leave unchanged; sufficient provider acquisition coordinates. Host-specific tenant authority stays in the application provider closure. |
| `SandboxProviderV1.providerId` | Closed `ExtractedSandboxProviderIdV1` builtin/extracted union | Open via exported `SandboxProviderIdV1`; retain the builtin union as inventory. This is required for application-owned `aws-agentcore`. |
| Sandbox provisioning `mode` | Closed builtin union (excluding `remote-worker`) | Open this provisioning-only type to application-owned IDs; keep `SandboxRuntimeModeIdV1` closed because it selects the static builtin provider map. |
| Agent `WorkspaceProvisioningAdapter.mode` | Independently duplicated closed builtin union | Open as `string`; provisioning logic records but does not dispatch on this application-owned value. Avoid a runtime/provisioning declaration cycle. |
| Core composition | Public `runtimeModeAdapter?: RuntimeModeAdapter` already present | Leave unchanged. |
| Workspace composition | Public `runtimeModeAdapter?: RuntimeModeAdapter` already present | Leave unchanged. |

The compile/runtime fixture in
`packages/agent/src/server/runtime/modes/__tests__/providerAdapter.test.ts`
uses application-owned mode/provider IDs and a custom provisioning object. It
would not typecheck against the prior closed provider/provisioning unions. At
runtime it proves the EFS host storage root (`/mnt/efs/...`) remains distinct
from and paired with the runtime cwd/root (`/efs/...`) and provisioning exec
receives runtime coordinates.

## Host-extension trust selection

Core's `addressedAgentRuntimeScope.ts` allowlists only `direct` and `local` for
ambient/static host extensions. Every custom ID therefore fails closed as an
isolated mode. Trusted, addressed `getAgentPi` composition may grant explicit
absolute extension paths; relative paths and ambient/static/hot extensions are
rejected. Slice 5 should keep `agentcore-remote-efs` isolated. If
`ecs-local-efs` needs host extensions, use the existing explicit trusted
addressed path; do not add the custom ID to the ambient allowlist merely because
its Workspace is host-visible.

## Runtime cwd/root pairing

The adapter has three deliberately separate coordinates:

- `ModeContext.workspaceRoot`: host/application coordinate (the ECS-mounted EFS
  path);
- `provider.resolveRuntimeRoot(context)` and returned `Workspace.root` /
  `runtimeContext.runtimeCwd`: runtime coordinate used by Sandbox exec and
  provisioning;
- optional adapter `storageRoot(context)`: host mirror for host-filesystem
  tools.

Slice 5 must validate that ECS and AgentCore map the same authorized EFS
namespace, while never substituting `storageRoot` for agent-visible cwd. The
provider must return `Workspace.root` consistent with `resolveRuntimeRoot`.

## Handle-store census and slice 4 decision

The generic seams expose only provider lifecycle (`create`, `invalidate`,
`close`) and pair lifecycle (`dispose`, optional health/projection). They do not
store or expose opaque provider handles. Core may construct an existing
`WorkspaceRuntimeSandboxHandleStore` when its independently resolved
`selectedMode` is builtin Blaxel/Vercel, even when a custom
`options.runtimeModeAdapter` later takes execution precedence. That store is
passed only to the builtin adapter factory and is not injected into the custom
adapter; in either case, it is not a suitable authority for an
application-owned AgentCore protocol.

Slice 4 should therefore define a **host-owned store contract outside Agent and
boring-sandbox**, keyed by host scope + workspace + provider + mode. The
application provider closure consumes it and implements transactional
claim/renew/update/release/delete fencing. Do not add handle fields to
`ModeContext`, `SandboxProviderV1`, or `RuntimeBundle`; do not make Core choose a
custom store by mode string. Slice 4's reference fixture may live with the host
application/domain that owns encryption and persistence.

## Slice 5 fixture decision

Compose two application adapters, both outside builtin registries:

- `ecs-local-efs`: host-visible strong Workspace and local execution over the
  authorized EFS mount;
- `agentcore-remote-efs`: AgentCore provider returning a remote-exec Sandbox and
  a Workspace rooted at the matching runtime EFS path, backed by slice 4's
  fenced store.

Use `createProviderRuntimeModeAdapter` for both and inject the selected adapter
through Core. The qualification fixture must assert namespace mapping,
`storageRoot`/runtime-root distinction, provisioning cwd, restart/resume, and
stale-fence rejection. It must not claim live AWS qualification without
infrastructure evidence.

## Considered seams left closed

- `BuiltinRuntimeModeId`, auto-detection, `resolveMode`, static sandbox provider
  maps, and CLI builtin mode selection.
- `ModeContext` authority/tenant fields and generic provider handle fields.
- Core's builtin handle-store selection and persistence schema.
- Host-extension ambient allowlist.
- Provider/store implementations, AWS SDKs, IAM/EFS/KMS configuration, and live
  qualification.

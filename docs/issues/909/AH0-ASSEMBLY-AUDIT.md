# AH0 assembly audit (#909)

Checkpoint A inventory, recorded before implementation on 2026-07-23 against
`CreateAgentAppOptions`, `RegisterAgentRoutesOptions`, and the Core production
mount at `createCoreWorkspaceAgentServer.ts:840-1135`.

The disposition vocabulary is exhaustive:

- **Host** — owned by `createAgentHost()` / `buildAgentComposition()`.
- **Normalized resolver** — app input normalized into `resolveRuntimeScope`.
- **Compatibility wrapper** — retained only by `createAgentApp` or
  `registerAgentRoutes` while those signatures remain supported.
- **App-side** — remains in Core/Workspace/standalone application composition.

No row is unclassified. The named regression proof is the test file that
currently exercises the behavior; focused AH0 tests extend these seams without
changing the disposition.

## `CreateAgentAppOptions`

Source: `packages/agent/src/server/createAgentApp.ts:51-138`.

| Option | Current assembly role / ordering constraint | Disposition | Regression proof |
| --- | --- | --- | --- |
| `workspaceRoot` | Runtime root, tool workdir, plugin scan root, file/git/skills workspace. Resolve before mode creation. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (workspace root and filesystem routes) |
| `sessionId` | Runtime session/workspace identifier and command/reload default. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (session context/default session) |
| `templatePath` | Template passed to mode creation. Explicit option precedes environment fallback. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (template path precedence) |
| `mode` | Built-in mode selection when no adapter is supplied. | Compatibility wrapper | `src/server/__tests__/createAgentApp.direct-flip.test.ts` |
| `runtimeModeAdapter` | Explicit adapter precedes `mode`/auto-detection and owns create/dispose. | Host | `src/server/__tests__/createAgentApp.test.ts` (runtime adapter/host precedence and cleanup) |
| `runtimeHost` | Explicit host operations override adapter/bundle host operations. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (`stamps the explicit caller runtime host`) |
| `authToken` | Standalone Fastify auth middleware; health/readiness remain public. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (auth middleware) |
| `version` | Standalone health response version. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (health route) |
| `logger` | Standalone Fastify logger switch; 16 MiB body limit is paired wrapper policy. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (standalone app construction) |
| `extraTools` | Added after built-in tools and before external diagnostics. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (custom tool catalog) |
| `disableDefaultFileTools` | Omits read/write/edit/find/grep/ls only. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (default file-tool opt-out) |
| `systemPromptAppend` | Static append passed into the bridge/harness. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (system prompt append) |
| `harnessFactory` | Overrides Pi harness construction after tools/runtime are assembled. | Host | `src/server/__tests__/createAgentApp.test.ts` (custom harness factory) |
| `pi` | Pi harness knobs; canonical defaults applied before harness and skills use. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (Pi options/skills) |
| `runtimeProvisioning` | Static generated env/PATH/skills contribution. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (runtime provisioning) |
| `getRuntimeProvisioning` | Dynamic generated env/PATH/skills source read by tools/reload. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (dynamic provisioning) |
| `sessionNamespace` | Stable legacy session storage namespace. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (session namespace) |
| `telemetry` | Best-effort harness/tool/runtime telemetry. | Host | `src/server/__tests__/createAgentApp.test.ts` (telemetry propagation) |
| `metering` | Pi usage reserve/settle/release sink. | Host | `src/server/pi-chat/__tests__/metering.test.ts` |
| `getFilesystemBindings` | Request/run-aware file authority; must be evaluated per operation, after request auth. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (filesystem binding context) |
| `runtimeEnvContributions` | Host-provided env overlay applied after mode creation and before tools/harness. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (runtime env contribution) |
| `runtimeProvisioner` | Runs after Workspace/Sandbox creation and env contributions, before tools/harness. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (provisioner ordering) |
| `sessionDir` | Explicit legacy transcript directory; must not gain an Agent segment. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (explicit session directory) |
| `sessionRoot` | Legacy transcript root and bridge storage root. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (session root/namespace layout) |
| `externalPlugins` | Standalone `.pi`/home discovery switch; scan only on strong workspace FS. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (external plugin enable/disable) |
| `beforeReload` | Runs immediately before harness reload; warnings/diagnostics preserved. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (reload hook result) |
| `systemPromptDynamic` | Dynamic append invoked by harness prompt construction/reload. | Normalized resolver | `src/server/__tests__/createAgentApp.test.ts` (dynamic prompt) |
| `getPluginDiagnostics` | App-owned diagnostic source projected into the diagnostics tool. | Normalized resolver | `src/server/tools/__tests__/pluginDiagnostics.test.ts` |
| `onWorkspaceAgentDispatcher` | Publishes trusted in-process legacy dispatcher only after bridge/runtime exists. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (dispatcher resolver) |

## `RegisterAgentRoutesOptions`

Source: `packages/agent/src/server/registerAgentRoutes.ts:309-445`.

| Option | Current assembly role / ordering constraint | Disposition | Regression proof |
| --- | --- | --- | --- |
| `workspaceRoot` | Static root and fallback for requestless/static bindings. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (workspace-root routes) |
| `sessionId` | Static workspace/default command/reload session ID. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (static workspace session) |
| `templatePath` | Static template path, after explicit option and before env fallback. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (template path) |
| `getTemplatePath` | Request-scoped template resolver; makes bindings lazy/scoped. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (request-scoped runtime options) |
| `mode` | Built-in mode selection fallback. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (mode selection) |
| `runtimeModeAdapter` | Explicit shared adapter; create is lazy where scope varies, dispose after all bindings. | Host | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts` |
| `runtimeHost` | Explicit operations override adapter host. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (`stamps the explicit caller runtime host`) |
| `version` | Optional legacy health version. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (health route) |
| `extraTools` | Static trusted tools merged with standard/scoped/plugin tools. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (tool merge/catalog) |
| `getExtraTools` | Actor/workspace/runtime-aware trusted tools; actor enters runtime key. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (request-scoped tools/actor isolation) |
| `systemPromptAppend` | Static host prompt addendum. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (system prompt append) |
| `systemPromptDynamic` | Static-composition dynamic prompt callback. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (dynamic prompt) |
| `getSystemPromptDynamic` | Workspace-root-scoped dynamic prompt callback. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (scoped dynamic prompt) |
| `getRuntimeScopeContribution` | Immutable app contribution identity plus lazy prompt append; identity enters runtime key. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (runtime contribution identity) |
| `harnessFactory` | Overrides default harness after binding tools/runtime resolve. | Host | `src/server/__tests__/registerAgentRoutes.test.ts` (custom harness factory) |
| `pi` | Static Pi configuration, defaulted before harness/skills. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (Pi/skills options) |
| `getPi` | Request-scoped Pi configuration; makes binding lazy/scoped. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (request-scoped Pi) |
| `sessionNamespace` | Static legacy transcript namespace. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (session namespace) |
| `sessionRoot` | Legacy file-backed transcript root. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (session-root isolation) |
| `telemetry` | Runtime/provisioning/harness telemetry. | Host | `src/server/__tests__/registerAgentRoutes.test.ts` (telemetry context) |
| `admitEffect` | Legacy `(workspaceId, requestId)` at-most-once callback immediately before mutation. | Compatibility wrapper | `src/server/http/routes/__tests__/piChat.test.ts` (admission ordering/error projection) |
| `filterModels` | Request-aware model projection only. | App-side | `src/server/__tests__/registerAgentRoutes.test.ts` (model filtering) |
| `getFilesystemBindings` | Per-request/per-run file authority, never cached as a root decision. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (filesystem actor/request context) |
| `metering` | Pi usage reserve/settle/release. | Host | `src/server/pi-chat/__tests__/metering.test.ts` |
| `externalPlugins` | Legacy local plugin discovery switch. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (external plugins) |
| `getSessionNamespace` | Request/actor-aware legacy transcript namespace. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (scoped session namespace) |
| `registerHealthRoute` | Mount/omit legacy `/health` and `/ready`. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (health opt-out) |
| `shareEntryStore` | Mounts app-owned membership-gated `/a/:id`; not Gateway surface. | App-side | `src/server/mcp/__tests__/shareEntryResources.test.ts` |
| `getWorkspaceId` | Derives trusted request workspace scope before route handling. | App-side | `src/server/__tests__/registerAgentRoutes.test.ts` (workspace auth/scope failure) |
| `getWorkspaceRoot` | Maps authorized workspace to root for HTTP requests. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (multi-workspace root isolation) |
| `getTrustedWorkspaceRoot` | Root mapping for trusted requestless dispatcher resolution. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (requestless dispatcher trust) |
| `runtimeEnvContributions` | Applies app env values after adapter creation and before tools/harness. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (runtime env contribution) |
| `provisionRuntime` | App-owned discovery/reconciliation hook; Host consumes only result. Runs after Environment creation and before readiness. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (background provisioning/reload) |
| `provisionWorkspace` | Enables/disables runtime provisioning. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (provisioning opt-out) |
| `beforeReload` | App hook after reprovision and before harness reload. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (reload ordering/diagnostics) |
| `getPluginDiagnostics` | App diagnostic callback projected into agent tool. | Normalized resolver | `src/server/tools/__tests__/pluginDiagnostics.test.ts` |
| `onWorkspaceAgentDispatcher` | Publishes legacy trusted dispatcher after static binding or lazy resolver setup. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (dispatcher resolver) |

## Construction sequence and lifecycle edges

| Existing edge / ordering | Disposition | Regression proof |
| --- | --- | --- |
| Resolve mode → create Runtime Environment → apply env contributions → provision → build tools → create harness/bridge → obtain Pi chat service/session store. | Host (`buildAgentComposition` is the sole sequence) | `src/server/__tests__/createAgentApp.test.ts`; `src/server/__tests__/registerAgentRoutes.test.ts` |
| Runtime identity includes mode, workspace scope/root, template, Pi config, session namespace, actor when tools vary, and app contribution identity. | Normalized resolver | `src/server/__tests__/registerAgentRoutes.test.ts` (binding reuse/isolation) |
| Runtime bindings are lazy when any request-scoped resolver exists; static otherwise. | Host | `src/server/__tests__/registerAgentRoutes.test.ts` (lazy runtime) |
| One in-flight binding creation per key; request/operation leases prevent retirement while used. | Host | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts` |
| Provisioning starts after Environment creation, is abortable, and drains before provider disposal. | Host | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts` (`binding retirement aborts and drains provisioning`) |
| `preClose` fences new binding admission before teardown. | Host | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts` |
| `onClose` retires bindings/runtime pairs before disposing the mode adapter, once. | Host | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts` |
| Construction failure closes Fastify, bridge/runtime pair, then mode adapter best-effort while preserving the original error. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` (construction cleanup) |
| Legacy dispatcher streams/commands hold operation leases and cannot bypass request context checks. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts`; `src/server/__tests__/workspaceAgentDispatcher.test.ts` |
| Request workspace scope is established before all scoped agent routes; workspace-agnostic health/readiness/model exceptions remain exact. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` (workspace routing and scope errors) |

## Route inventory and registration order

`createAgentApp` and `registerAgentRoutes` expose the same legacy route families.
Ordering is significant because authorization/scope hooks must precede route
handlers, binding disposal must be registered before close, file transport
leases must remain active until transport close, and frontend catch-all routes
must be last.

| Order | Route/hook surface | Disposition | Regression proof |
| ---: | --- | --- | --- |
| 1 | Standalone `onRequest` token auth with public `/health`, `/ready`, `/api/v1/ready-status`. | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts` |
| 2 | Embedded `onRequest` maps authenticated user plus authorized workspace onto `workspaceContext`; promotes raw-file query workspace ID into the canonical header path. | App-side / compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 3 | Optional health/readiness (`/health`, `/ready`). | Compatibility wrapper | `src/server/__tests__/createAgentApp.test.ts`; `src/server/__tests__/registerAgentRoutes.test.ts` |
| 4 | File routes (`/api/v1/files/*`) and FS event stream. | App-side | `src/server/__tests__/registerAgentRoutes.test.ts`; `src/server/__tests__/searchRoute.integration.test.ts` |
| 5 | Tree/search routes. | App-side | `src/server/__tests__/searchRoute.integration.test.ts` |
| 6 | Optional share deep link `GET /a/:id`. | App-side | `src/server/mcp/__tests__/shareEntryResources.test.ts` |
| 7 | Git routes. | App-side | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 8 | Complete legacy Pi chat family under `/api/v1/agent/pi-chat`: session list/create/delete, state, attachment bytes, events NDJSON, prompt, follow-up, queue clear, interrupt, stop. | Compatibility wrapper over Host gateway projection | `src/server/http/routes/__tests__/piChat.test.ts` |
| 9 | System prompt route. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 10 | Models route/filter. | App-side | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 11 | Skills routes. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 12 | Session-change routes. | Compatibility wrapper | `src/server/http/__tests__/sessionChangesTracker.test.ts` |
| 13 | `POST /api/v1/agent/reload`: admit → reprovision → app hook → harness reload → diagnostics. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 14 | Tool catalog route. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 15 | Command routes with admission/metering. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` |
| 16 | Ready-status route, retaining request lease until transport closes. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts` |
| 17 | `preClose` starts drain and cancels/fences new work; `onClose` disposes bindings then adapter. | Host | `src/server/__tests__/registerAgentRoutes.lifecycle.test.ts` |

## Core production mount (`createCoreWorkspaceAgentServer.ts:840-1135`)

| Order / concern | Required preserved behavior | Disposition | Regression proof |
| --- | --- | --- | --- |
| Core routes and optional frontend auth pages are registered before agent composition. | Core membership/settings/auth pages exist before agent projection. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |
| Auth proxy is registered before plugin and agent routes. | Authentication and trusted proxy rules bind requests before Host authorization. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |
| Default plugin package paths and Pi/runtime metadata are read before server plugin resolution. | App owns package discovery and static policy. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.plugins.test.ts` |
| Resolve every plugin entry, using trusted context only for internal entries, then assert bridge-handler trust. | Untrusted plugin code cannot receive trusted stores/bridge handlers. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.plugins.test.ts` |
| Canonical plugin-ID preflight runs during app resolver before `collectWorkspaceAgentServerPlugins`. | No descriptor/contribution registers under a mismatched ID; one resolver/loading machinery. | App-side | `packages/workspace/src/server/agentPlugins/__tests__/canonicalPluginId.test.ts` (AH0) |
| Collect workspace plugin contributions once for app root and reuse the same resolved artifacts for per-root agent options. | Activation filtering does not duplicate discovery/loading. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.plugins.test.ts` |
| Build trusted actor resolver and dispatcher proxy before plugin resolution, but publish the real dispatcher only after Host binding exists. | Plugin calls fail closed until agent composition is ready. | App-side / compatibility wrapper | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.plugins.test.ts` |
| Build Core bridge from app-owned stores/auth, add `preHandler` session-owner memory before agent routes. | Core retains membership, storage, bridge, DB, and UI ownership. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |
| Resolve remote-worker or sandbox runtime adapter after plugin collection; explicit adapter wins. | Workspace + Sandbox remain one runtime pair. | Normalized resolver | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |
| Resolve runtime host with explicit option → adapter host → sandbox host fallback. | Host filesystem/runtime operations match selected mode. | Normalized resolver | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |
| Build per-root Pi options from the already-resolved plugin set; remote-worker mode does not scan stale public-host roots. | No split-brain plugin discovery. | App-side / normalized resolver | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.plugins.test.ts` |
| Mount `GET /api/v1/workspace/meta` before agent routes. | Workspace metadata remains Core-owned and authorization-gated. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |
| Normalize session namespace (`options` override, otherwise workspace ID) without moving transcripts. | All legacy transcript paths remain byte-identical. | Compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts`; `src/server/agent-host/__tests__/legacyTranscriptCompatibility.test.ts` (AH0) |
| Await the agent route plugin with all app resolvers, contributions, tools, provisioning, telemetry, metering, bindings, and legacy admission. | No route serves before construction/compilation completes. | Host + normalized resolver + compatibility wrapper | `src/server/__tests__/registerAgentRoutes.test.ts` |
| Runtime provisioning uses the collected runtime plugins; direct mode omits plugin-authoring provisioning; Host consumes only the normalized result. | Discovery/trust stays app-owned and provisioning precedes readiness. | Normalized resolver | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.plugins.test.ts` |
| UI routes mount after agent routes; Core bridge HTTP routes follow UI routes. | UI/bridge remain control-plane surfaces and see initialized agent dispatcher. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |
| Plugin route contributions mount after Core bridge routes. | Plugins receive fully constructed trusted dependencies and cannot shadow earlier core/agent routes. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.plugins.test.ts` |
| Frontend fallback mounts last. | SPA catch-all cannot intercept API/plugin routes. | App-side | `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` |

## Naming inventory

`BORING_AGENT_HOST_ID` is not renamed by AH0. Repository consumers at audit
head:

- `packages/core/src/server/config/loadConfig.ts`: presence-only trusted-proxy
  compatibility sentinel.
- configuration/tests/docs that set or clear the same sentinel.

The new stable logical Host identity is supplied by `CreateAgentHostOptions.hostId`
or the durable `.agent-host-id` file. It does not reinterpret the legacy
environment variable.

## Audit result

- `CreateAgentAppOptions`: 29/29 fields classified.
- `RegisterAgentRoutesOptions`: 37/37 fields classified.
- Legacy route/hook families: all classified in registration order.
- Core production mount (`840-1135`): all construction and ordering edges
  classified.
- Unclassified rows: **0**.

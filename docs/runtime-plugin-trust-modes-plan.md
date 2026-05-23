# Runtime Plugin Trust Modes Plan

## Status

Ready for bead conversion. This version integrates multi-model review feedback
from xAI Grok 4.3, Claude Opus 4.7, and GPT-5.5, plus Julien's follow-up
product decisions, with a bias toward a robust but simple first implementation.

Review synthesis: [`runtime-plugin-trust-modes-plan-review-synthesis.md`](runtime-plugin-trust-modes-plan-review-synthesis.md)

Focused agent-generation/runtime authoring plan:
[`runtime-plugin-agent-generation-plan.md`](runtime-plugin-agent-generation-plan.md)

## Final decisions

1. **Local CLI plugin-dev is default-on.**
   - `.pi/extensions` are trusted local workspace source.
   - Native frontend hot reload should work by default in CLI local workspaces.
   - Provide `--no-plugin-dev` as an escape hatch and show a trust banner/status.

2. **Generated/external plugins never define backend routes.**
   - No generated `server/index.ts`.
   - No generated `boring.server`.
   - Backend routes are app/internal or promoted-plugin only and load at process boot.
   - Regular routes are fine for trusted app modules such as Macro data/SDK APIs.
   - Route changes require restart/redeploy; there is no route hot reload.

3. **Generated plugin hot reload covers only:**
   - frontend UI
   - agent/sandbox tools
   - skills/prompts/metadata
   - manifest/runtime registry state

4. **Generated tools use command-proxy execution.**
   - Manifest declares `pi.sandboxTools` with JSON schema and argv command.
   - Local CLI proxies tool calls to local workspace exec.
   - Hosted proxies tool calls to sandbox/remote exec.
   - Hosted never imports generated `agent/index.ts` into the host backend.

5. **Frontend runtime splits by host trust.**
   - Local CLI: native plugin front, embedded Vite middleware first.
   - Hosted: iframe pane renderer built in sandbox/build-worker and served as an immutable artifact.
   - Host still owns file-tree routing, command registration, DockView panel creation, permissions, and lifecycle.
   - Iframe owns only pane content rendering and calls a narrow bridge.

6. **Runtime paths matter.**
   - Plugin build/tool execution must use runtime workspace paths (`/workspace` in sandbox), not host paths.
   - Build outputs and active registry live under `.boring-agent/`.

## One-line thesis

Local CLI workspace plugins are trusted developer code and should behave like
native runtime plugins for authoring; hosted/sandbox external plugins are
untrusted and must run through iframe frontends plus sandbox-proxied tools,
never arbitrary host backend routes or host-imported Pi extensions. App/internal
plugins are trusted app modules composed at boot; they may still use regular
routes for domain APIs.

## Goals

1. Make `boring-ui` CLI a first-class plugin authoring environment.
   - Agent-created `.pi/extensions/<name>/front/index.tsx` should render like an
     internal plugin panel.
   - `/reload` should refresh native frontend plugin code in CLI mode.
   - Local plugin authors should be able to use normal React/DockView APIs.
   - Local plugin-dev should be powerful, but visible and explicitly explained.

2. Keep hosted environments safe.
   - External plugin frontend code should not run in the host React tree by
     default.
   - External plugin backend/agent code should not be imported into the host
     backend process.
   - External plugin tools should be host-registered proxy tools whose
     implementation runs inside the sandbox.
   - External plugin capabilities should be explicit, permissioned, audited, and
     revocable.

3. Preserve app/internal plugin power.
   - App-owned/default packages can still register host server routes, native
     panels, tools, providers, catalogs, bridge integrations, and domain data APIs at boot.
   - Macro-shaped DB/SDK routes are valid app/internal routes, not generated-plugin patterns.
   - Marketplace or generated plugins can be promoted to app/internal only by an app
     owner/admin through an explicit deploy-time/install-time action.

## Non-goals

- Do not let hosted external plugins call `app.register(...)`, add arbitrary
  Fastify routes, or import untrusted `server/index.ts` in the host process.
- Do not let hosted external `agent/index.ts` load as a normal host Pi extension
  while the harness lives in the backend process.
- Do not solve fully arbitrary npm dependency loading for native plugin fronts in
  the first pass.
- Do not silently downgrade/upgrade trust modes. The host policy decides and the
  UI must explain the result.
- Do not require marketplace signatures/attestation before local CLI plugin-dev.
  Provenance is important for marketplace, but should not block the local authoring
  path.

## Non-negotiable invariants

These are the rules implementation and tests should enforce.

1. **Host policy wins.** Plugin manifests request capabilities; the host resolves
   the effective runtime mode.
2. **Hosted external executable code never imports into the host backend process.**
   No external `server/index.ts`; no external direct Pi extension import.
3. **Hosted external frontend code never runs in the host React tree by default.**
   It runs in iframe mode unless an admin promotes the plugin.
4. **Host-process routes are app/internal-only.** External runtime installs cannot add
   arbitrary Fastify routes. Trusted app modules may use normal routes for reviewed domain APIs.
5. **Hosted external tools are proxies.** The host registers schema/tool metadata;
   execution happens inside the sandbox via `sandbox.exec` or a future sandbox MCP
   server.
6. **All plugin bridge/RPC/tool calls are bounded and validated.** Check plugin id,
   permission grant, schema, path safety, timeout, output size, and result shape.
7. **Promotion is explicit.** A marketplace/generated plugin becomes internal only
   through an app-owner/admin action, with pinned version/provenance and app restart
   or redeploy.

## Mental model

Avoid treating plugin trust as one enum. Effective runtime is a resolved tuple:

```ts
export type PluginProvenance =
  | "internal"          // app-owned package composed at boot
  | "local-generated"   // .pi/extensions in local CLI/plugin-dev
  | "marketplace"       // installed from registry/marketplace
  | "uploaded"          // copied/imported external package

export type FrontRuntime = "native" | "iframe" | "disabled"
export type ToolRuntime = "host" | "sandbox-proxy" | "disabled"
export type ServerRuntime = "host-boot" | "disabled"
export type CapabilityGrantMode = "implicit-local" | "prompted" | "admin-approved" | "disabled"

export interface EffectivePluginRuntime {
  provenance: PluginProvenance
  front: FrontRuntime
  tools: ToolRuntime
  server: ServerRuntime
  grants: CapabilityGrantMode
  reason: string
}
```

Simple host presets can still exist:

```ts
export type ExternalPluginPolicyPreset =
  | "trusted-native"      // local CLI / developer-owned workspace
  | "sandboxed-iframe"    // hosted default
  | "reject"              // strict hosted/admin policy
```

But the preset should resolve to the tuple above so every capability is explicit.

## Trust classes

### App/internal plugin

A trusted app module installed by the app developer and composed at boot through
plugin contribution APIs. It is a plugin implementation-wise, but conceptually it
is product/app code rather than runtime user extensibility.

Examples:

- `@hachej/boring-ask-user`
- `boring-macro`
- first-party filesystem/data plugins
- app-owned data catalog plugins

Properties:

- trusted by app owner
- may run in host React tree
- may register host Fastify routes at boot
- may expose regular domain data/SDK routes such as Macro's `/api/macro/*`
- may contribute host-side tools/providers/catalogs
- generally requires process restart/redeploy to change server behavior

Effective runtime:

```ts
{
  provenance: "internal",
  front: "native",
  tools: "host",
  server: "host-boot",
  grants: "admin-approved",
  reason: "app-composed package",
}
```

### Local generated plugin

A plugin created under a developer/user workspace:

```txt
.pi/extensions/<name>/
  package.json
  front/index.tsx
  agent/index.ts        # optional in local trusted mode
  skills/...            # optional
```

Properties in local CLI mode:

- trusted as local workspace code
- can run native frontend panels
- can be transformed/hot-reloaded by the CLI dev host
- can load Pi extensions directly because the user owns the process/workspace
- should display a trust banner/status so users understand local code is trusted

Effective runtime in local plugin-dev:

```ts
{
  provenance: "local-generated",
  front: "native",
  tools: "host",
  server: "disabled", // or local-dev-only later; not part of hosted external model
  grants: "implicit-local",
  reason: "local CLI plugin-dev trusted workspace",
}
```

### Hosted external plugin

A plugin installed or generated in a hosted/sandbox workspace where the backend
harness lives in the host process and the workspace lives in a sandbox.

Properties:

- untrusted by default
- frontend runs in iframe by default
- agent/backend logic runs only as sandbox-proxied commands/tools, not host imports
- capabilities are permission-gated
- host rejects native/server requests with diagnostics unless plugin is promoted

Effective runtime:

```ts
{
  provenance: "marketplace", // or uploaded/local-generated-in-hosted
  front: "iframe",
  tools: "sandbox-proxy",
  server: "disabled",
  grants: "prompted",
  reason: "hosted external plugin",
}
```

### Promoted plugin

A marketplace/generated plugin that an app owner explicitly installs as an
internal app plugin. Promotion changes trust class; it is not a runtime accident.

Properties:

- version/provenance pinned
- reviewed/admin-approved
- activated at boot/redeploy
- may use internal native/server capabilities after promotion

## PluginHost abstraction

Add an execution seam so policy checks are centralized instead of scattered across
scan, reload, bridge, and route code.

```ts
export interface PluginHost {
  readonly kind: "native-trusted" | "iframe-sandbox" | "internal-boot"

  load(plugin: ResolvedPluginManifest): Promise<LoadedPlugin>
  reload(pluginId: string): Promise<PluginReloadResult>
  unload(pluginId: string): Promise<void>
  getHealth(pluginId: string): PluginHealth
}
```

Initial implementations:

- `InternalBootPluginHost` — app-composed packages, server/native at boot.
- `LocalTrustedPluginHost` — local CLI `.pi/extensions`, native front + direct Pi
  extension support.
- `HostedSandboxPluginHost` — iframe front + sandbox-proxy tools/RPC, no host code
  import.

The first implementation does not need an elaborate class hierarchy; it can be a
small resolver plus functions. The key is that all execution paths receive an
`EffectivePluginRuntime` and enforce the same invariants.

## Manifest additions

Proposed manifest extensions:

```json
{
  "name": "csv-pro",
  "version": "0.1.0",
  "boring": {
    "front": "front/index.tsx",
    "frontMode": "native",
    "label": "CSV Pro",
    "permissions": ["files:read", "ui:open-panel"],
    "rpc": []
  },
  "pi": {
    "extensions": ["agent/index.ts"],
    "sandboxTools": []
  }
}
```

Important rules:

- `boring.frontMode` is a request, not a guarantee.
- Hosted policy may force `frontMode: "iframe"` or reject.
- `pi.extensions` is allowed for local/internal trusted modes only.
- `pi.sandboxTools` is the hosted-safe tool mechanism.
- `boring.server` remains app/internal or promoted-only.

## Frontend execution modes

### Native front mode

Used for internal app plugins and local CLI plugin-dev.

Plugin exports a normal front factory:

```tsx
import { definePlugin, WORKSPACE_OPEN_PATH_SURFACE_KIND } from "@hachej/boring-workspace/plugin"

export default definePlugin({
  id: "csv-viewer",
  panels: [{ id: "csv-viewer.panel", label: "CSV", component: CsvPane }],
  surfaceResolvers: [...],
})
```

Benefits:

- full DockView integration
- direct `PaneProps`
- commands, surface resolvers, catalogs, providers
- feels internal

Risks:

- React singleton must be preserved
- arbitrary dependencies complicate static CLI
- unsuitable for untrusted hosted external code

### Iframe front mode

Used for hosted external plugins and dependency-heavy marketplace plugins.

Plugin manifest:

```json
{
  "boring": {
    "front": "front/index.tsx",
    "frontMode": "iframe",
    "label": "CSV Pro",
    "permissions": ["files:read", "ui:open-panel"]
  }
}
```

Host serves an iframe entry:

```txt
/api/v1/agent-plugins/:pluginId/iframe.html?v=<revision-or-content-hash>
```

Panel renders a sandboxed iframe:

```tsx
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  src={iframeUrl}
/>
```

The iframe talks to host via a versioned message bridge only.

Benefits:

- plugin may bundle its own React/dependencies
- CSS isolation
- crash isolation
- clearer security boundary

Costs:

- no direct host React context
- all integration goes through bridge
- theme/auth/state must be bridged explicitly

## Iframe bridge protocol

Keep the first bridge small but structured. Do not use ad hoc method strings
without an envelope.

Handshake:

1. Host creates iframe with `pluginId`, `frameId`, and nonce/capability token.
2. Iframe sends `ready` with protocol version.
3. Host transfers a `MessagePort` or accepts messages only from the known iframe
   window and expected origin.
4. All later calls include envelope metadata and are schema-validated.

Envelope:

```ts
export interface PluginBridgeEnvelope<T = unknown> {
  v: 1
  pluginId: string
  frameId: string
  requestId: string
  capabilityToken: string
  op: string
  payload: T
}
```

Initial bridge ops should be narrow:

- `files.read`
- `ui.openPanel`
- `ui.emitUiEffect`
- `theme.get`
- `plugin.rpc` (later phase)

Every op checks:

- plugin installed/enabled
- effective runtime is iframe/sandboxed
- token/nonce valid
- permission granted
- payload schema valid
- path validation where relevant

## CLI plugin-dev plan

### Desired user workflow

```bash
boring-ui
# or explicit:
boring-ui --plugin-dev
```

Agent creates:

```bash
boring-ui scaffold-plugin csv-viewer "$BORING_AGENT_WORKSPACE_ROOT"
```

User or agent edits `front/index.tsx`, then runs `/reload`.

Expected behavior:

- frontend plugin is transformed and imported
- browser banner reports front module load success/failure
- native panel opens through commands/surface resolvers
- generated plugin behaves like app-internal plugin during local development
- UI shows a clear local trust banner/status

### UX choice: default-on local plugin-dev

Final decision: local CLI enables plugin-dev by default.

- `.pi/extensions` run as trusted local workspace code.
- The CLI shows a clear trust banner/status.
- Provide `--no-plugin-dev` for users who want static/no-plugin execution.

```txt
Local plugin-dev enabled: .pi/extensions run as trusted workspace code.
Frontend and tool changes hot-reload with /reload. Backend routes are app/internal-only and boot-composed.
```

### Transform strategy

There are two viable implementations.

#### Option A — embedded Vite middleware

CLI starts Vite in middleware/custom mode for runtime plugin fronts.

Pros:

- closest to current playground behavior
- best TSX/CSS/dependency handling
- React plugin/dedupe patterns already understood
- likely best user experience for local trusted plugin-dev

Cons:

- heavier CLI runtime
- more dev-server behavior in packaged CLI

#### Option B — server-side esbuild native transform endpoint

CLI exposes:

```txt
GET /api/v1/agent-plugins/:pluginId/front-module.js?v=<revision>
```

The endpoint:

1. reads `.pi/extensions/<id>/front/index.tsx`
2. validates path and manifest
3. transforms/bundles with esbuild
4. externalizes React/workspace singletons
5. rewrites allowed bare imports to host runtime shim URLs
6. returns browser ESM

MVP allowed imports:

- `react`
- `react-dom`
- `react/jsx-runtime`
- `react/jsx-dev-runtime`
- `@hachej/boring-workspace/plugin`
- relative files inside the plugin root

MVP forbidden imports:

- arbitrary npm packages
- Node builtins
- root `@hachej/boring-workspace`
- `@hachej/boring-workspace/server`

Pros:

- works in static CLI without full Vite
- follows old `WORKSPACE_V2_PLAN.md` dynamic-pane decision
- easier to reuse as a production-like transform contract later

Cons:

- dependency story must be phased
- CSS/assets need explicit support later
- host runtime shim must be correct or hooks break

### Recommendation for first implementation

For **local CLI plugin-dev**, use embedded Vite middleware first if the priority is
fast, native, dependency-friendly authoring.

For **hosted external iframe**, do not rely on host Vite. Bundle/build iframe
artifacts in the sandbox or use a constrained host-owned bundler that never
executes plugin code in the host process.

## Hosted iframe artifact model

For hosted external plugin fronts, prefer immutable artifacts:

1. Build/bundle the iframe app inside the sandbox or a constrained build worker.
2. Emit content-addressed files, e.g. `sha256-.../iframe.html` and assets.
3. Host serves bytes as static assets; it does not import plugin code.
4. Iframe URL includes content hash/revision.

This gives:

- cacheability
- rollback
- clear health diagnostics
- no plugin code execution in host process

MVP can start simpler by serving sandbox-built output from a controlled directory,
but the plan should move toward content-addressed artifacts before marketplace.

## Hosted sandbox external plugin tool model

### Problem

The current agent/Pi harness lives in the backend host process. Therefore hosted
external plugin `agent/index.ts` must **not** be imported as a normal Pi extension
by the host. That would execute untrusted workspace code in the host backend.

### Solution: host-registered proxy tools, sandbox-executed commands

External plugin declares sandbox tools in its manifest:

```json
{
  "pi": {
    "sandboxTools": [
      {
        "name": "csv_summarize",
        "description": "Summarize a CSV file",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string" }
          },
          "required": ["path"]
        },
        "command": ["node", ".pi/extensions/csv-pro/tools/summarize.js"],
        "timeoutMs": 30000,
        "concurrency": 2,
        "permissions": ["files:read"]
      }
    ]
  }
}
```

Use argv arrays, not shell strings. This avoids shell injection and makes command
validation simpler.

Host registers a proxy tool with Pi:

```ts
registerTool({
  name: "csv_summarize",
  description,
  parameters,
  async execute(args, signal) {
    assertPluginInstalled(pluginId)
    assertPluginPermission(pluginId, "files:read")
    validateArgs(parameters, args)
    validateCommandPathInsidePluginRoot(command)

    const result = await sandbox.exec(command, {
      cwd: workspaceRoot,
      stdin: JSON.stringify(args),
      signal,
      timeoutMs: 30_000,
      maxStdoutBytes: 1_000_000,
      maxStderrBytes: 64_000,
      env: {},
    })

    return parseAndValidateToolResult(result.stdout)
  },
})
```

The plugin command runs inside the sandbox filesystem/process:

```txt
sandbox:/workspace/.pi/extensions/csv-pro/tools/summarize.js
```

It does not run in:

```txt
host backend process
```

### Tool command contract

A sandbox tool command:

- receives JSON args on stdin
- writes exactly one JSON tool result to stdout
- writes logs/errors to stderr
- exits non-zero on failure
- must not require host secrets
- must finish within timeout
- must respect cancellation where possible

Example command:

```js
import fs from "node:fs/promises"

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"))

// Runs in sandbox, can read sandbox files according to sandbox permissions.
const text = await fs.readFile(input.path, "utf8")

process.stdout.write(JSON.stringify({
  content: [{ type: "text", text: `Rows: ${text.split("\n").length}` }]
}))
```

### Why this is safe enough

- Host imports only manifest/schema, not executable plugin code.
- Host owns the Pi tool registration.
- Host validates args and permissions before execution.
- Plugin code executes inside sandbox limits.
- Host validates result shape before returning to the agent.
- Timeouts/output caps prevent runaway commands from wedging the host.

### Future option: sandbox MCP server

A richer version can use MCP:

```txt
.pi/extensions/csv-pro/mcp/server.js
```

Host starts/connects to the MCP server inside the sandbox and registers proxy
MCP tools. This is better for long-running tools, streaming, resources, and
multi-tool plugins, but the command-tool contract is the smaller first step.

## Hosted plugin RPC model

Iframe frontend sometimes needs backend-like behavior directly, without waiting
for an agent turn.

Do not expose arbitrary method strings. Use manifest-declared RPC operations:

```json
{
  "boring": {
    "rpc": [
      {
        "op": "csv.summarize",
        "inputSchema": {
          "type": "object",
          "properties": { "path": { "type": "string" } },
          "required": ["path"]
        },
        "outputSchema": {
          "type": "object",
          "properties": { "rows": { "type": "number" } },
          "required": ["rows"]
        },
        "command": ["node", ".pi/extensions/csv-pro/rpc/summarize.js"],
        "permissions": ["files:read"]
      }
    ]
  }
}
```

Endpoint:

```txt
POST /api/v1/agent-plugins/:pluginId/rpc
```

Request:

```json
{
  "op": "csv.summarize",
  "params": { "path": "data/sales.csv" }
}
```

Host behavior:

1. authenticate user/session
2. verify plugin is installed and enabled in workspace
3. check permission grant
4. validate op and params against manifest schema
5. forward to sandbox command/MCP worker
6. validate response shape
7. return JSON

Important: this endpoint does not import plugin `server/index.ts` or register
plugin-defined routes. It is a single host-owned tunnel with permission checks.

## Permission model

Start with coarse permissions, but allow scoping so the model can evolve without
breaking manifests.

```ts
type PluginPermission =
  | { kind: "files:read"; scope?: { roots?: string[]; globs?: string[] } }
  | { kind: "files:write"; scope?: { roots?: string[]; globs?: string[] } }
  | { kind: "ui:open-panel" }
  | { kind: "ui:read-state" }
  | { kind: "agent:tool"; tool?: string }
  | { kind: "network:fetch"; hosts?: string[] }
```

Hosted external plugins must declare permissions. Host must show them before
enable/install.

Local CLI may show a warning instead of strict permission prompts:

> Local plugin-dev enabled. Workspace plugins run as trusted code and can access
> this workspace through the local process.

## Plugin lifecycle and health

Add lifecycle states before marketplace work:

```ts
export type PluginLifecycleState =
  | "discovered"
  | "installed"
  | "enabled"
  | "disabled"
  | "error"
  | "quarantined"
  | "revoked"
  | "uninstalled"
```

Add health surface:

```ts
export interface PluginHealth {
  pluginId: string
  state: PluginLifecycleState
  effectiveRuntime: EffectivePluginRuntime
  revision: number
  lastReloadAt?: string
  lastError?: { code: string; message: string }
  front?: { status: "ok" | "error" | "disabled"; message?: string }
  tools?: { status: "ok" | "error" | "disabled"; message?: string }
}
```

Use this health state for:

- `/reload` diagnostics
- plugin management UI
- chat reload banner
- hosted quarantine/revoke
- CI/invariant tests

## Provenance and lockfile

Before marketplace install, add a lockfile:

```txt
.pi/plugins.lock.json
```

Track:

- plugin id/package id
- version
- source URL/registry
- integrity hash
- installed revision
- effective runtime mode
- permissions granted
- lifecycle state
- promotion status

Local generated plugins may have lightweight provenance (`source: "local"`).
Marketplace plugins should have pinned version/integrity before enable.

## Marketplace install model

### Local CLI

```bash
boring-ui plugins install @market/csv-pro
```

Writes/copies package into:

```txt
.pi/extensions/csv-pro/
```

Shows:

```txt
CSV Pro will run as trusted local workspace code in CLI plugin-dev mode.
It may execute frontend code in your browser and local tool code in this
workspace. Continue? [y/N]
```

### Hosted

Install stores plugin in workspace/plugin registry and enables iframe mode by
policy.

Shows:

```txt
CSV Pro requests:
- files:read
- ui:open-panel
- agent:tool csv_summarize

It will run in an iframe and execute tool code only inside the sandbox.
Allow? [y/N]
```

### Promotion

Admin/app owner can promote a plugin to internal:

```ts
createWorkspaceAgentServer({
  defaultPluginPackages: ["@market/csv-pro"],
})
```

Promotion permits native/server capabilities at app boot. It is an admin action,
not a user runtime install.

Promotion should require:

- pinned package version/integrity
- app-owner/admin approval
- deploy/restart boundary
- clear UI/log event noting trust class changed

## Implementation phases

### Phase 0 — contracts, invariants, and docs

- Add/merge this plan.
- Add manifest type proposal for:
  - `boring.frontMode`
  - `boring.permissions`
  - `boring.rpc`
  - `pi.sandboxTools`
- Document trust-mode matrix and invariants.
- Update plugin authoring guidance to distinguish local CLI from hosted sandbox.

Acceptance:

- Docs explain why hosted external plugins cannot use host Pi extensions/server routes.
- Existing PR behavior remains unchanged.

### Phase 1 — effective runtime resolver + lifecycle model

- Add `EffectivePluginRuntime` types and resolver utilities.
- Teach plugin scan to record desired mode and host-resolved effective mode.
- Add basic `PluginHealth` model.
- Surface diagnostics when a plugin asks for unsupported capabilities.

Acceptance:

- Tests cover local trusted-native, hosted sandboxed-iframe, and rejected server routes/direct Pi extensions.

### Phase 2 — CLI trusted native plugin-dev

- Add `--plugin-dev` or config flag.
- Enable native front hot reload in CLI plugin-dev.
- Use embedded Vite middleware or equivalent transform.
- Ensure React singleton/dedupe.
- Show trust banner.
- Preserve static CLI mode for non-plugin-dev.

Acceptance:

- Run `boring-ui --plugin-dev`, create plugin, `/reload`, native panel updates without browser restart.
- File visualizer opens through surface resolver.
- Browser reload banner reports front success/failure.

### Phase 3 — hosted iframe frontend runtime

- Add iframe panel wrapper.
- Add versioned iframe bridge envelope.
- Add nonce/token handshake.
- Add theme/state handshake.
- Add permission checks for bridge calls.

Acceptance:

- Hosted external plugin renders in iframe.
- Iframe can request allowed file read and open UI commands.
- Denied permission returns structured error.

### Phase 4 — hosted iframe artifact build/serve

- Define where iframe bundles are produced.
- Prefer sandbox/build-worker output, served by host as immutable content-addressed assets.
- Add health diagnostics for build errors.

Acceptance:

- Host serves iframe artifact without importing plugin code.
- Broken frontend build marks plugin health `error` and preserves previous good artifact where possible.

### Phase 5 — sandbox proxy tools

- Extend manifest with `pi.sandboxTools`.
- Scan hosted external plugins for tool declarations.
- Register host proxy tools with Pi.
- Execute commands through `sandbox.exec` with stdin JSON.
- Validate stdout tool result.

Acceptance:

- Agent sees `csv_summarize` tool.
- Tool execution runs inside sandbox, not host process.
- Bad command path, missing permission, timeout, cancellation, and malformed result all produce stable errors.

### Phase 6 — declarative plugin RPC

- Add `boring.rpc` manifest entries.
- Add `POST /api/v1/agent-plugins/:pluginId/rpc`.
- Route to sandbox command/MCP worker only.
- Reuse permission and schema validation.

Acceptance:

- Iframe frontend can call plugin RPC for immediate interactions.
- Host never imports plugin server code.

### Phase 7 — marketplace/promote flow

- Add install metadata and permission prompt plumbing.
- Add `.pi/plugins.lock.json`.
- Add admin promotion docs/API.
- Keep marketplace plugins iframe/sandboxed by default.

Acceptance:

- Local install explains trusted mode.
- Hosted install explains iframe/sandbox permissions.
- Promotion path is explicit and auditable.

## Risks and mitigations

### Risk: local CLI native mode gives too much power

Mitigation: local CLI already grants workspace code execution. Require/announce
`--plugin-dev`, show a trust banner, and keep hosted defaults strict.

### Risk: iframe bridge becomes too broad

Mitigation: all bridge methods are host-owned, schema-validated, permissioned,
versioned, nonce-bound, and logged. No generic `eval` or arbitrary fetch-by-default.

### Risk: proxy tools become route execution by another name

Mitigation: host registers only schema/argv proxy wrappers. Commands execute
inside sandbox with timeout/output caps and no host imports.

### Risk: users expect dependencies in native CLI transform

Mitigation: Vite middleware path for plugin-dev can support local deps. If using
esbuild MVP, error clearly on unsupported bare imports and recommend plugin-dev
with dependency install or iframe mode.

### Risk: marketplace plugin wants server routes

Mitigation: require promotion to internal app plugin. Hosted runtime install
rejects `boring.server` with diagnostic.

### Risk: plan gets overbuilt

Mitigation: phase aggressively. First ship contracts + local plugin-dev; then
iframe bridge; then sandbox tools. Keep MCP, signatures, and advanced dependency
resolution as later upgrades.

## Decisions from follow-up review

1. **CLI plugin-dev is default-on in local CLI.**
   - Local CLI treats `.pi/extensions` as trusted workspace source code.
   - Provide `--no-plugin-dev` as an escape hatch.
   - Show a clear trust banner/status.

2. **Generated/external plugins do not use backend routes.**
   - `boring.server` is app/internal or promoted-only.
   - App/internal plugin routes load at boot only and are not hot-reloaded.
   - Regular routes remain valid for trusted app modules such as Macro data/SDK APIs.
   - Generated plugin hot reload covers frontend, tools, skills, prompts, and metadata.

3. **Generated tools use sandboxTools command proxy with remote/local exec.**
   - Local CLI proxy executes through local workspace exec.
   - Hosted proxy executes through sandbox/remote exec.
   - MCP remains a later upgrade.

4. **CLI frontend transform should optimize for local dev UX.**
   - Use embedded Vite middleware first for local trusted native plugin-dev because it matches the playground and handles TSX/CSS/deps best.
   - Keep esbuild endpoint as a later production-like/native transform option if needed.

5. **Hosted iframe artifacts should be sandbox/build-worker produced before marketplace.**
   - For early hosted MVP, a constrained host esbuild transform may be acceptable only if it never executes plugin code and has no install scripts.
   - Marketplace-ready path should build in sandbox/build worker and serve immutable artifacts.

See focused plan: [`runtime-plugin-agent-generation-plan.md`](runtime-plugin-agent-generation-plan.md).

## Suggested first beads

1. `docs(plugin): codify runtime plugin trust modes`
2. `feat(workspace): add effective plugin runtime resolver`
3. `feat(workspace): add plugin lifecycle and health model`
4. `feat(cli): add trusted plugin-dev frontend transform`
5. `feat(workspace): add iframe plugin panel runtime`
6. `feat(workspace): add versioned iframe bridge protocol`
7. `feat(agent): register sandbox-proxied plugin tools`
8. `feat(workspace): add declarative plugin RPC tunnel`

# Runtime Plugin Runtime Architecture and Agent Generation Plan

## Status

Canonical plan for the next plugin-system phase. Ready for bead conversion.

This plan synthesizes:

- current PR learnings around `.pi/extensions`, `/reload`, Vite front hot reload,
  Pi resource reload, workspace-local CLI provisioning, and file visualizers;
- multi-model plan review feedback from xAI Grok 4.3, Claude Opus 4.7, and GPT-5.5;
- Julien's final product decisions on internal vs external plugins, hosted
  sandbox safety, local CLI authoring UX, and backend routes.

Review synthesis:
[`runtime-plugin-trust-modes-plan-review-synthesis.md`](runtime-plugin-trust-modes-plan-review-synthesis.md)

Related high-level trust plan:
[`runtime-plugin-trust-modes-plan.md`](runtime-plugin-trust-modes-plan.md)

## One-line thesis

Boring uses plugin APIs as a **composition primitive**, but not every composed
package is the same product class. **App/internal plugins** are trusted app
modules composed at boot and may use normal backend routes for domain APIs.
**Runtime/generated plugins** are user/agent/marketplace extensions: they hot
reload frontend pane content, agent/sandbox tools, skills/prompts, metadata, and
registry state, but never define host backend routes. Local CLI treats generated
plugins as trusted native source; hosted sandbox treats them as iframe pane
renderers plus sandbox-executed tools.

## Final decisions

1. **Two plugin classes matter most:**
   - **App/internal plugins:** app-owner trusted product modules composed at
     boot. They may use regular Fastify routes for domain APIs, DB-backed data,
     SDK transport, app-specific auth, and other reviewed server behavior.
   - **Runtime/generated plugins:** user/agent/marketplace extensions under the
     workspace plugin root. They get hot-reloadable front/tools/skills/metadata,
     but no host backend routes.

2. **Backend routes are app/internal-only, not a generated-plugin feature.**
   - Regular routes are fine for trusted app modules like Macro; this plan does
     not require rewriting those routes into RPC just because they are composed
     through plugin APIs.
   - No generated `server/index.ts`.
   - No generated `boring.server`.
   - App/internal route changes require process restart/redeploy.
   - There is no route hot reload.

3. **Local CLI plugin-dev is default-on.**
   - `.pi/extensions` are trusted local workspace source.
   - Native frontend hot reload should work by default in CLI local workspaces.
   - Provide `--no-plugin-dev` as an escape hatch.
   - Show a trust banner/status.

4. **Hosted external frontend runs in iframe.**
   - The iframe customizes pane content only.
   - Host/core owns file tree, command registry, file-open routing, DockView panel
     creation, permissions, lifecycle, and health.
   - Hosted external iframe content must never run same-origin and unsandboxed
     with the host app. Use an isolated plugin origin or opaque sandboxed iframe,
     no ambient host cookies/storage, restrictive CSP, and strict message
     source/origin checks.
   - Hosted dev authoring should use sandbox Vite + iframe HMR.
   - Hosted stable runtime should use sandbox-built content-hash iframe artifacts.

5. **Generated tools use proxy execution.**
   - Manifest declares `pi.sandboxTools` with JSON schema and handler descriptor.
   - Local CLI proxies tool calls to local workspace exec.
   - Hosted proxies tool calls to sandbox/remote exec.
   - Hosted never imports generated `agent/index.ts` into the host backend.

6. **Runtime paths, not host paths.**
   - Plugin build/tool execution happens from runtime workspace root.
   - In sandbox this is typically `/workspace`.
   - Use `WorkspacePathMapping` to translate only at host-owned boundaries.
   - Runtime artifacts and active plugin registry live under `.boring-agent/`.
   - `.boring-agent/` is runtime-owned: hide it from normal plugin authoring, exclude it from plugin file-open routing, and do not let generated plugin code write it except through host-owned build/registry commands.
   - In hosted mode this must be enforceable: generated tool/RPC/frontend code must not receive a writable view of `.boring-agent/`. Use read-only/hidden mounts, a filtered workspace view, or store host-owned registry/artifacts outside the writable sandbox workspace.

7. **Hosted stable artifacts come before hosted live HMR in implementation.**
   - Live sandbox Vite HMR is the best hosted authoring end-state.
   - Stable content-hash iframe artifacts are simpler and should land first because they define the artifact, registry, rollback, and iframe serving model that live-dev also needs.

8. **Authoring is AI-led first.**
   - Chat/agent creates and iterates plugins.
   - Files remain visible/editable for humans.
   - Full hosted browser IDE/WebContainers are not MVP.

## Definitions

### App/internal plugin

An app-owner trusted product module installed/composed at app boot through the
plugin contribution APIs. It is a "plugin" implementation-wise, but conceptually
it is app code, not user/runtime extensibility.

Examples:

- `@hachej/boring-ask-user`
- `boring-macro`
- app-owned data catalog
- first-party/core workspace integrations

Allowed:

- native frontend components in host React tree
- host-side tools/providers/catalogs
- host Fastify routes at boot
- domain DB/data-service access owned by the app
- SDK transport routes when the app owns the server contract
- app DB/auth integrations if app owner coded them

Not hot-reloaded by plugin `/reload`:

- backend routes
- host process server integration

### Promoted plugin

A generated/marketplace plugin explicitly promoted by an app owner/admin into the
app/internal trust class. Promotion is deploy-time/install-time, pinned,
auditable, and generally requires restart/redeploy.

### Generated/external plugin

A plugin created by the agent, user, or marketplace at runtime under the
workspace plugin root.

Source layout:

```txt
$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<plugin-id>/
  package.json
  front/
    index.tsx
  tools/
    <tool>.js
  skills/
    SKILL.md
  README.md
```

Allowed:

- frontend pane content
- manifest-declared panels/commands/file-open rules
- agent/sandbox tool handlers
- declarative RPC handlers
- skills/prompts/metadata

Not allowed:

- host backend routes
- direct host imports in hosted mode
- arbitrary host process code
- global workbench mutation outside declared surfaces

## Plugin frontier: what belongs where

Core/workspace is the plugin operating system. Plugins are feature packages at
the edge.

### Core/workspace owns

- auth/session/user identity
- DB/persistence and tenant/workspace lifecycle
- filesystem abstraction and path validation
- runtime/sandbox adapters and `WorkspacePathMapping`
- DockView/workbench shell
- file tree and file-open dispatch
- command palette registration plumbing
- surface routing and resolver arbitration
- plugin registry/lifecycle/health
- permission enforcement and audit logs
- iframe wrapper and bridge validation
- runtime-plugin RPC/tool proxy endpoints
- `/reload` orchestration
- theme/tokens
- marketplace install/promotion policy

### Plugins own

- pane content rendering
- file visualizer rendering
- command declarations
- optional catalog content/views
- agent/sandbox tool handlers
- small declarative RPC handlers for generated/runtime plugins
- regular domain data routes only when the plugin is app/internal trusted
- domain-specific parsing/analysis
- prompt/skill guidance for tools
- UI descriptors/tool-result renderers

### Plugins do not own

- auth/session logic
- DB migrations
- tenant isolation
- arbitrary Fastify routes unless app/internal or promoted
- global file tree implementation
- global workbench shell/layout implementation
- core bridge dispatch
- unbounded filesystem/network access
- plugin lifecycle/reload machinery

### Frontier test

For any capability, ask:

> If this breaks or is malicious, can it compromise the app, tenant, host
> process, or another workspace?

If yes, it belongs in core or internal/promoted app code. If no, it can be a
plugin capability behind manifest permissions.

| Capability | Core/internal only | Generated plugin allowed | Notes |
|---|---:|---:|---|
| Auth/session | yes | no | Core invariant |
| DB migrations | yes | no | Internal app only |
| Fastify routes | app/internal or promoted only | no | Regular routes are OK for trusted app modules; boot-only, no route hot reload |
| Dock/workbench shell | yes | no | Plugins declare surfaces only |
| Panel content | wrapper/mount | yes | Hosted external = iframe content only |
| File tree | yes | no | Plugins declare `fileOpen` rules |
| File visualizer | routing/permissions | renderer | Manifest declares extensions/mime |
| Commands | registry plumbing | declarations | Host registers from manifest |
| Tools | proxy registration | handler command | local exec or sandbox exec |
| RPC | endpoint/proxy | declared op handler | schema + permissions |
| Theme | token source | consume | bridge/native props |
| Marketplace policy | yes | no | install/promote/revoke |
| Path translation | yes | no | `WorkspacePathMapping` is host/runtime adapter logic |
| Runtime artifacts | yes | no | `.boring-agent/` is runtime-owned |

## Effective runtime matrix

| Environment | Frontend runtime | Tool runtime | Server routes | Hot reload mechanism |
|---|---|---|---|---|
| Local CLI generated plugin | native trusted | local command proxy | no | embedded Vite + `/reload`; commands execute fresh |
| Hosted generated plugin dev | iframe | sandbox command proxy | no | sandbox Vite dev server + iframe HMR through authenticated proxy |
| Hosted generated plugin stable | iframe | sandbox command proxy | no | sandbox build -> content-hash artifact -> iframe reload/swap |
| App/internal plugin | native | host/internal | boot-only yes | regular routes OK; app dev server/build; route changes restart/redeploy |
| Promoted plugin | native/internal by app choice | host/internal by app choice | boot-only yes | regular routes OK after promotion; deploy/restart boundary |

## Generative UI modes

Boring should support three GenUI levels, but not confuse them:

1. **Static/component registry GenUI**
   - Agent chooses from built-in/core components and supplies props.
   - Safest; useful for chat/tool rendering.

2. **Declarative UI spec GenUI**
   - Agent emits JSON UI descriptors rendered by a design-system renderer.
   - Good future middle ground for hosted environments.

3. **Open-ended plugin GenUI**
   - Agent writes plugin code.
   - This plan focuses on this mode.

For open-ended plugins:

- local CLI runs native trusted plugin-dev for maximum authoring speed;
- hosted sandbox runs iframe pane renderers plus sandbox/remote-exec tools;
- core still owns routing/permissions/registry.

## Runtime path and artifact model

Plugin source remains under the existing runtime plugin root:

```txt
$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<plugin-id>/
```

Runtime-owned artifacts go under `.boring-agent/`:

```txt
$BORING_AGENT_WORKSPACE_ROOT/.boring-agent/plugins/<plugin-id>/<content-hash>/
  iframe.html
  assets/...
  manifest.resolved.json
```

Active registry state:

```txt
$BORING_AGENT_WORKSPACE_ROOT/.boring-agent/state/plugin-registry.json
```

Example:

```json
{
  "active": {
    "csv-viewer": {
      "hash": "sha256-abc123",
      "bundle": ".boring-agent/plugins/csv-viewer/sha256-abc123",
      "manifest": ".pi/extensions/csv-viewer/package.json",
      "frontRuntime": "iframe",
      "toolRuntime": "sandbox-proxy"
    }
  }
}
```

Hot reload should swap active hashes atomically and keep the previous good
artifact available when a new build fails.

Registry updates must be transactional:

1. build into a new temp/hash directory;
2. validate manifest, artifact shape, and optional smoke checks;
3. acquire plugin registry lock;
4. write new registry file atomically;
5. broadcast update;
6. keep previous active hash for rollback.

Registry write authority:

- Local CLI: CLI host process owns `.boring-agent/state/plugin-registry.lock` and is the sole writer of `plugin-registry.json`. Build steps produce artifacts only.
- Hosted: core host process is the sole registry writer. Sandbox build workers return artifact paths/hashes; host validates and commits. A workspace-scoped DB/Redis advisory lock replaces the filesystem lock when multiple host replicas exist.

## Workspace path contract

All plugin-facing paths are workspace-relative unless explicitly documented.

Rules:

- Generated manifests may refer only to plugin-relative paths or workspace-relative user paths.
- Host/runtime adapters resolve paths through `WorkspacePathMapping`.
- Path validation rejects absolute user paths, `..`, null bytes, symlink escapes, and access to `.boring-agent/` except through host-owned build/registry commands.
- Permission scope globs are evaluated after stripping `.boring-agent/**` from the matchable set. Verifier rejects generated manifests that explicitly target `.boring-agent/`.
- Hosted bridge/RPC/tool proxy validates paths at execution time before forwarding requests; validation must account for symlinks and filesystem changes, not only manifest parse time.
- Hosted generated tool/RPC execution must not receive a broad readable/writable workspace view by default. It must run in a permission-scoped exec envelope:
  - `.boring-agent/` is absent or read-only and never writable;
  - file visibility/writability is limited to the operation's declared `files:read`/`files:write` permission globs;
  - symlink escapes are checked at execution time;
  - network egress is default-deny unless an explicit enforceable network permission/allowlist exists.
- If the hosted platform cannot provide this permission-scoped exec envelope for an operation, host must not enable that hosted generated tool/RPC operation and must return `PLUGIN_CAPABILITY_DENIED` with a stable diagnostic.
- Tool commands receive the runtime workspace cwd and should treat input paths as workspace-relative.

## Manifest-first generated plugin contract

Generated plugins should be manifest-first. Host reads manifest metadata to
register surfaces without importing plugin frontend/server code.

```json
{
  "name": "csv-viewer",
  "version": "0.1.0",
  "boring": {
    "label": "CSV Viewer",
    "front": {
      "native": "front/native.tsx",
      "iframe": "front/iframe.tsx",
      "shared": "front/CsvPane.tsx"
    },
    "frontMode": "auto",
    "permissions": [
      { "kind": "files:read", "scope": { "globs": ["**/*.csv"] } },
      { "kind": "ui:open-panel" }
    ],
    "ui": {
      "panels": [
        { "id": "csv-viewer.panel", "title": "CSV Viewer" }
      ],
      "commands": [
        { "id": "csv-viewer.open", "title": "Open CSV Viewer", "panelId": "csv-viewer.panel" }
      ],
      "fileOpen": [
        { "extensions": [".csv"], "panelId": "csv-viewer.panel", "score": 200 }
      ]
    },
    "rpc": []
  },
  "pi": {
    "systemPrompt": "Use csv_summarize for CSV summaries. CSV files open in the CSV Viewer panel.",
    "sandboxTools": [
      {
        "name": "csv_summarize",
        "description": "Summarize a CSV file in the workspace.",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string" }
          },
          "required": ["path"]
        },
        "handler": { "runtime": "node", "entry": "tools/summarize.js" },
        "timeoutMs": 30000,
        "permissions": [
          { "kind": "files:read", "scope": { "globs": ["**/*.csv"] } }
        ]
      }
    ]
  }
}
```

Rules:

- `boring.frontMode` is one of `"auto" | "native" | "iframe"`.
  - `"auto"` (default): host chooses by environment. Local CLI with plugin-dev
    enabled picks native when `boring.front.native` exists, else iframe. Hosted
    always picks iframe.
  - `"native"`: loadable only in local CLI/internal contexts. Hosted refuses with
    a stable diagnostic.
  - `"iframe"`: always iframe, useful for parity testing.
- A generated plugin missing `boring.front.iframe` is not loadable in hosted mode;
  verifier warns when only one front entry is declared.
- `boring.front` may provide separate native and iframe wrappers around shared
  pane code. This avoids pretending one entry can both export a native plugin
  factory and mount an iframe app.
- `boring.ui` is declarative and host-readable.
- `pi.sandboxTools` is the default generated-tool mechanism in both local and
  hosted modes.
- Generated scaffold uses `handler` descriptors instead of arbitrary shell
  commands. The host maps handlers to local/sandbox exec argv.
- `boring.server` is absent for generated/external plugins.
- `pi.systemPrompt` from generated plugins is scoped in the composed agent prompt with plugin id and effective runtime, so stale/disabled/quarantined plugin guidance can be removed cleanly.
- `pi.extensions` can remain for internal/local advanced usage, but scaffolded
  generated plugins should prefer `pi.sandboxTools` for portability. Verifier warns, not errors, on direct `pi.extensions` in local generated plugins; hosted rejects direct host Pi extension loading for external plugins.

## Plugin surfaces

Generated plugins can declare these surfaces.

### Panels

A plugin may declare one or more panel ids. In local native mode, the panel maps
to a React component exported through `front/native.tsx`. In hosted iframe mode,
the panel maps to a core-owned iframe wrapper that loads the plugin iframe app.

### Commands

A plugin may declare command palette entries that open panels with params.

Host registers commands from manifest. Plugin code does not imperatively mutate
the command registry in hosted mode.

### File-open routing

A plugin may declare `boring.ui.fileOpen` rules.

Example:

```json
{ "extensions": [".csv"], "panelId": "csv-viewer.panel", "score": 200 }
```

Host uses this to register surface resolvers. File-tree clicks remain host-owned.

### Left tabs

Left tabs are opt-in only. Generated file visualizers and one-off tools should not
create sidebar tabs by default.

Allowed when user explicitly asks for persistent navigation/catalog behavior.

### Catalogs/providers/global bindings

Generated/external hosted plugins should not start with global providers or broad
bindings. Internal/promoted plugins can use the full workspace plugin API at boot.

Generated plugins should use panels, commands, file-open, tools, and RPC first.

## Frontend authoring SDKs

Generated frontend code should not import broad host internals.

Native local/internal mode:

```ts
import { definePlugin, type PaneProps } from "@hachej/boring-workspace/plugin"
```

Hosted iframe mode:

```ts
import { createBoringIframeBridge } from "@hachej/boring-workspace/iframe-plugin"
```

Scaffold should hide most differences. The same manifest declares panels,
commands, and file-open routing; the frontend entry differs by effective target:

- native entry exports `definePlugin(...)` for local/internal native mode;
- iframe entry mounts an app that receives params/theme over bridge;
- shared pane modules contain renderer logic reused by both where practical.

The host should not require iframe code to import `@hachej/boring-workspace/plugin`.
That package is for native plugin authoring. Iframe plugins use the bridge SDK.

## Local CLI hot reload model

### Trust

Local CLI treats `.pi/extensions` as trusted workspace source code by default.

UI shows:

```txt
Local plugin-dev enabled: .pi/extensions run as trusted workspace code.
Frontend and tool changes hot-reload with /reload. Backend routes are app/internal-only and boot-composed.
```

Escape hatch:

```bash
boring-ui --no-plugin-dev
```

### Frontend hot reload

Local CLI uses embedded Vite middleware first.

Flow:

```txt
Agent/user edits .pi/extensions/<id>/front/native.tsx or shared pane modules
  ↓
/reload or file watcher invalidates plugin revision
  ↓
CLI Vite middleware transforms TSX/CSS/deps
  ↓
browser dynamic-imports native plugin module with cache-bust revision
  ↓
WorkspaceProvider registers native panels/commands/resolvers
  ↓
reload banner reports front success/failure
```

Why Vite first locally:

- matches current playground behavior;
- handles TSX, React transform, CSS, source maps, and local dependencies;
- avoids custom React singleton shims in the first implementation.

### Tool hot reload

Local CLI registers `pi.sandboxTools` as proxy tools that execute commands in the
local runtime workspace root.

```txt
Pi tool call -> host proxy -> local workspace exec(argv, stdin JSON)
```

Tool file changes are picked up on `/reload` by rescanning manifest/tool metadata.
The command itself is executed fresh each call, so handler code naturally updates
without host import cache issues.

### Local generated-plugin backend routes

Generated/external local plugins do **not** define backend routes, even though
local CLI is trusted. This keeps generated plugins portable to hosted mode and
prevents agents from learning the wrong pattern.

If a user needs backend-like behavior in a generated plugin, generate a tool or
runtime RPC command. If the feature is really app-owned domain infrastructure
like Macro, promote it to app/internal code and compose it at boot with regular
routes.

## Hosted/sandbox hot reload model

Hosted has two runtime modes for external/generated plugins.

### Hosted dev mode: sandbox Vite + iframe HMR

This is the best hosted authoring UX.

Flow:

```txt
Agent/user edits .pi/extensions/<id>/front/iframe.tsx or shared pane modules
  ↓
Host writes/syncs file into sandbox runtime workspace (/workspace)
  ↓
Sandbox Vite dev server watches /workspace/.pi/extensions/<id>/front
  ↓
Host iframe wrapper points to sandbox Vite dev URL through authenticated proxy
  ↓
Iframe connects to sandbox Vite HMR websocket through proxy
  ↓
React Fast Refresh updates iframe pane content
```

Properties:

- Vite runs inside sandbox/build runtime, not host process.
- Browser sees plugin inside iframe.
- HMR updates iframe content only, not host React tree.
- Plugin dependencies resolve inside sandbox.
- Host still owns panel creation, file-open routing, permissions, lifecycle, and
  bridge.

Operational requirements:

- per-sandbox dev server lifecycle;
- sandbox runtime image includes Node, Vite, and declared tool runtimes before any hosted plugin-dev session starts;
- HTTP + websocket reverse proxy;
- authenticated preview/session token bound to `(workspaceId, pluginId, sessionId, frameId)`;
- HMR websocket accepts only that preview token and closes on session/plugin disable;
- correct Vite `base` and HMR websocket config behind proxy;
- idle shutdown/restart;
- health/status reporting.

State preservation:

- rely on React Fast Refresh for normal edits;
- do not promise perfect state serialization;
- hook order/module boundary changes may remount;
- plugins can persist important pane state through bridge/RPC later.

### Hosted stable mode: sandbox-built iframe artifact

This is the normal/published runtime path.

Flow:

```txt
/reload or publish
  ↓
sandbox/build worker runs plugin build from runtime cwd
  ↓
output .boring-agent/plugins/<id>/<hash>/iframe.html + assets
  ↓
host validates/records active hash in plugin-registry.json
  ↓
host serves immutable iframe artifact bytes
  ↓
panel iframe loads content-hash artifact
```

Properties:

- no dev server required for normal use;
- cacheable and rollback-friendly;
- host never imports plugin code;
- previous good artifact remains active if build fails.

### Hosted file-tree click example

User clicks `data.csv` in host file tree.

1. File tree emits core open-path surface request.
2. Host resolver uses manifest `boring.ui.fileOpen` and picks
   `csv-viewer.panel`.
3. DockView opens core wrapper:

```tsx
<IframePluginPanel
  pluginId="csv-viewer"
  panelId="csv-viewer.panel"
  params={{ path: "data.csv" }}
/>
```

4. Wrapper loads iframe dev URL or stable artifact URL.
5. Iframe bridge handshake sends params/theme/capabilities.
6. Iframe calls `files.read` through bridge (or `plugin.rpc` after RPC phase lands).
7. Host validates permission/path and returns data.
8. Iframe renders CSV table/chart inside pane.

Important: iframe does not own file-tree routing. It only renders pane content.

## Iframe bridge

Minimum bridge envelope:

```ts
export interface PluginBridgeEnvelope<T = unknown> {
  v: 1
  pluginId: string
  sessionId: string
  frameId: string
  requestId: string
  nonce: string
  capabilityToken: string
  op: string
  payload: T
}
```

Initial bridge operations:

- `files.read`
- `ui.toast`
- `theme.get`

Possible later ops:

- `plugin.rpc`
- `ui.openPanel`
- `ui.postCommand`
- `selection.get`

Every op checks:

- plugin installed and enabled;
- iframe/frame id matches live panel;
- message `source` and `origin` match the registered iframe instance. For opaque-origin sandbox iframes, host binds checks to the concrete `WindowProxy` plus frame/session token and must not use wildcard trust;
- token/nonce valid;
- permission granted;
- payload schema valid;
- workspace path safe where relevant;
- result size bounded, initially max 2 MiB per response;
- rate limit enforced per `(pluginId, frameId)`, initially 10 requests/second;
- capability token TTL is 10 minutes and refreshable through bridge handshake;
- token is bound to `(workspaceId, pluginId, sessionId, frameId)`;
- HMR module updates do not rotate the token because the iframe document does not reload;
- full iframe document reload rotates token via re-handshake;
- panel close, plugin disable, session end, and quarantine revoke all tokens for that `(pluginId, sessionId)`.

Keep iframe v1 narrow. Do not try to make iframe plugins full workspace plugins.
They are pane content renderers.

### Hosted iframe security baseline

Generated/external hosted iframe panes must use all of:

- isolated plugin origin or opaque sandbox; never host-origin unsandboxed iframe;
- no ambient host cookies, localStorage, IndexedDB, auth headers, or bearer tokens exposed to plugin JavaScript;
- restrictive iframe `sandbox`, initially `allow-scripts` plus only the minimum additional flags required by the runtime;
- `allow-same-origin` only if iframe URL is on an isolated non-host origin with no ambient credentials;
- no `allow-top-navigation`, unsandboxed popups, or host-origin script execution for generated/external plugins;
- restrictive CSP for stable artifacts and dev proxy responses;
- no `postMessage("*")` trust. Host validates origin/source/frame/session for every message.

## Agent/sandbox tools

### Default: `pi.sandboxTools` command proxy

Generated tools use manifest-declared command handlers.

Local CLI:

```txt
Pi tool call -> host proxy -> local runtime exec(handler -> argv)
```

Hosted sandbox:

```txt
Pi tool call -> host proxy -> sandbox.exec(handler -> argv)
```

Same manifest works in both modes.

### Tool command contract

A tool command:

- receives JSON args on stdin;
- writes exactly one JSON tool result to stdout;
- writes logs/errors to stderr;
- exits non-zero on failure;
- runs with timeout/output caps;
- receives only declared environment variables;
- executes from runtime workspace root or plugin root as configured by host;
- in hosted mode, executes in a permission-scoped workspace view where `.boring-agent/` is absent or read-only, declared file permissions determine what user workspace paths are visible/readable/writable, and only host-owned build/registry commands may write runtime artifacts or active registry state;
- stdout is capped (see normative limits below) and must contain a single JSON result with only trailing whitespace allowed.

Example:

```js
import fs from "node:fs/promises"

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"))

const text = await fs.readFile(input.path, "utf8")
const rows = text.trim() ? text.trim().split(/\r?\n/).length - 1 : 0

process.stdout.write(JSON.stringify({
  content: [{ type: "text", text: `Rows: ${rows}` }],
  data: { rows }
}))
```

### Tool declaration rules

- Generated scaffold uses `handler: { runtime, entry }`, not raw shell commands.
- Supported initial runtime: `node` only.
- `python` is deferred until sandbox images guarantee a pinned Python toolchain.
- Verifier rejects unknown `handler.runtime` values with `PLUGIN_MANIFEST_INVALID`.
- Handler `entry` must be plugin-relative and stay inside plugin root.
- Host maps handler descriptors to argv internally before local/sandbox exec.
- Advanced argv commands can be added later but should be verifier-gated and allowlisted.
- Tool name must be unique and preferably namespaced by plugin id.
- Parameters must be JSON Schema.
- Parameters that represent workspace paths should be marked with a host-recognized schema extension such as `"x-boring-path": true` so the proxy can pre-validate obvious path inputs before execution. This is defense in depth; hosted safety still depends on the permission-scoped exec envelope.
- Permissions must cover file/network/UI access.
- Host enforces timeout, cancellation, stdout/stderr caps, and result validation.

Permission rule: manifest permissions govern both host exposure and the hosted
execution envelope. Hosted generated tools/RPC must not run with broad workspace
filesystem or network access and rely only on cooperative handler behavior. Local
CLI remains trusted workspace code and may use the normal local workspace view.

### Why tools/RPC over backend routes for generated plugins

Most generated plugin backend needs are:

- read/write files;
- parse/analyze data;
- run scripts;
- call models/tools;
- fetch allowed network data;
- produce structured output for UI.

These are better as tools/RPC because they:

- work local and hosted;
- can be sandboxed;
- hot reload safely;
- do not mutate host backend API surface;
- avoid host auth/DB/process risk.

This does **not** mean app/internal plugins must avoid regular routes. Trusted
app modules may use normal Fastify routes when they own the server contract. The
important boundary is trust and lifecycle:

- app/internal route: reviewed app code, boot-composed, restart/redeploy to
  change, can access app DB/services by design;
- generated/runtime backend capability: manifest-declared tool/RPC, executed by
  host proxy in local/sandbox runtime, no host route registration.

#### Ask-user-shaped UI control

`ask-user` currently has a bespoke plugin route for browser answer submission.
That route is not a data API; it is UI control flow between browser and a
server-side waiting tool. The better long-term home is the host UiBridge/control
plane: browser posts a generic UI action such as `ask-user.answer`, the host
dispatches to the trusted ask-user runtime, and the tool waiter resolves.

So ask-user should migrate away from a custom route because it duplicates bridge
semantics, not because app/internal routes are forbidden.

#### Macro-shaped data transport

`boring-macro` is the canonical example of an app/internal plugin that currently
uses regular routes correctly. Its `/api/macro/*` routes are domain data/SDK
transport around ClickHouse and derived-series persistence; they are not a
pattern for generated plugins.

Keep regular routes for Macro unless there is a concrete reason to broker them:

- frontend data APIs such as catalog, facets, series, lineage;
- Python SDK calls such as `series/:id/data` and `transform/persist`;
- admin/internal actions such as refresh or ClickHouse proxying.

Only routes that duplicate core capabilities should move out of Macro:

- deck markdown read/write/list should use the workspace file API or a host-owned
  workspace path mapping, not `/api/macro/deck*`.

A generic data/RPC broker is optional infrastructure for runtime plugins and for
future cross-mode APIs. It is not required to replace every app/internal route.

## Runtime plugin RPC

Runtime plugin RPC is for frontend-to-plugin direct calls that should not wait
for an agent turn. It is primarily for generated/external plugins that need a
small backend-like operation without defining a backend route. It reuses the same
command proxy model.

Do not use this section to ban regular routes in app/internal plugins. If the
shell owns the code and composes it at boot, regular Fastify routes remain the
simplest and most debuggable option for domain APIs.

Manifest:

```json
{
  "boring": {
    "rpc": [
      {
        "op": "csv.preview",
        "inputSchema": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "limit": { "type": "number" }
          },
          "required": ["path"]
        },
        "outputSchema": {
          "type": "object",
          "properties": { "rows": { "type": "array" } },
          "required": ["rows"]
        },
        "handler": { "runtime": "node", "entry": "tools/preview.js" },
        "permissions": [
          { "kind": "files:read", "scope": { "globs": ["**/*.csv"] } }
        ]
      }
    ]
  }
}
```

Endpoint:

```txt
POST /api/v1/agent-plugins/:pluginId/rpc
```

This endpoint is host-owned and only dispatches to declared runtime-plugin ops.
It is not plugin-defined routing.

Request:

```json
{ "op": "csv.preview", "params": { "path": "data.csv", "limit": 50 } }
```

Rules:

- host owns the endpoint;
- plugin declares operations, schemas, and handler descriptors;
- host validates permissions/schema/path;
- execution happens through local/sandbox exec;
- host validates output schema and response size (initially max 2 MiB);
- no generated/runtime plugin-defined Fastify routes.

For app/internal plugins, a normal route such as `/api/macro/series/:id` can be
more appropriate than RPC because it is a stable product API and SDK transport,
not untrusted runtime extension code.

## Dependency policy

### Local CLI native plugin-dev

Local trusted plugin-dev may use workspace/app dependencies resolved by embedded
Vite. The verifier should still warn on heavy or risky dependencies, but local
users own the process and filesystem.

### Hosted iframe dev/stable

Hosted generated plugins may use dependencies only inside the sandbox/build
runtime. Dependency install/build scripts must never run in the host process.

MVP policy:

- support dependencies already present in the sandbox workspace;
- allow agent/user to add package dependencies through approved sandbox commands;
- build iframe artifacts inside sandbox;
- host serves only built bytes.

Marketplace policy later:

- require lockfile/provenance/integrity;
- block postinstall/network by default unless permissioned;
- scan dependency size and licenses if needed.

## Naming, collision, and error-code policy

- Plugin ids must be valid stable ids and should match normalized package name.
- Generated contribution ids must be namespaced by plugin id: `<plugin-id>.<thing>`.
- Tool names should be unique; if global tool namespace collides, prefix with plugin id.
- Host rejects or quarantines duplicate panel/command/tool ids with stable error codes.

Initial error-code families:

- `PLUGIN_MANIFEST_INVALID`
- `PLUGIN_CAPABILITY_DENIED`
- `PLUGIN_FRONT_BUILD_FAILED`
- `PLUGIN_FRONT_LOAD_FAILED`
- `PLUGIN_BRIDGE_DENIED` (subcodes: `unsupported-version`, `bad-origin`, `bad-token`, `rate-limited`, `payload-too-large`)
- `PLUGIN_TOOL_TIMEOUT`
- `PLUGIN_TOOL_RESULT_INVALID`
- `PLUGIN_PATH_DENIED`
- `PLUGIN_REGISTRY_CONFLICT`

## Initial limits (normative)

| Boundary | Limit |
|---|---:|
| Tool stdout single JSON result | 1 MiB |
| Tool stderr retained/truncated | 256 KiB |
| Bridge response payload | 2 MiB |
| RPC response payload | 2 MiB |
| Bridge requests per `(pluginId, frameId)` | token bucket: 10/sec refill, burst 20 |
| Tool default timeout | 30s, per-tool override capped at 5 min |
| RPC default timeout | 30s |
| `pi.systemPrompt` per plugin | 4 KiB |
| Aggregate plugin systemPrompt budget | 32 KiB; excess prompts dropped with diagnostic |

Exceeding a limit returns a stable error code and terminates the call/build/reload
step as appropriate.

## Lifecycle, health, and quarantine

Plugin lifecycle states:

```ts
type PluginLifecycleState =
  | "discovered"
  | "enabled"
  | "disabled"
  | "error"
  | "quarantined"
  | "revoked"
```

Quarantine triggers:

- repeated iframe crash loop;
- repeated bridge abuse/rate-limit violations;
- repeated infrastructure/tool timeouts not explained by user input;
- malformed manifests after prior successful load;
- permission violation attempts.

Normal user-input validation failures should not quarantine a plugin. They should
return structured errors to the panel/agent.

Quarantine behavior:

- stop loading frontend artifact/dev URL;
- stop exposing tools/RPC;
- preserve files on disk;
- surface health diagnostic and recovery action;
- recovery requires explicit user action plus successful re-verify; auto-recovery is not allowed.

## Agent generation process

The agent should follow this loop when asked to create or modify a plugin.

### Step 0 — detect host capabilities

Future command:

```bash
boring-ui plugin-capabilities "$BORING_AGENT_WORKSPACE_ROOT"
```

Expected output:

```json
{
  "contractVersion": 1,
  "pluginDev": true,
  "frontRuntime": "native",
  "toolRuntime": "sandboxTools",
  "backendRoutes": false,
  "hotReload": ["front", "tools", "skills", "metadata"]
}
```

If command does not exist yet, agent must assume conservative portable defaults:
`{ frontRuntime: "iframe", toolRuntime: "sandboxTools", backendRoutes: false }`
and scaffold with `--target auto`.

### Step 1 — write tiny implementation plan

Before writing files, agent records 5-10 bullets in plugin README or temp notes:

- plugin goal;
- UI surfaces needed;
- file-open routing needed;
- tools/RPC needed;
- permissions needed;
- smoke/test steps.

### Step 2 — scaffold

```bash
boring-ui scaffold-plugin <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
```

Scaffold creates:

- manifest-first `package.json`;
- frontend template for effective host mode;
- `tools/` directory and sample command handler;
- README with reload/test instructions.

### Step 3 — edit manifest first

Agent updates:

- label;
- `boring.ui.panels`;
- commands;
- `fileOpen` rules;
- permissions;
- `pi.sandboxTools`;
- `boring.rpc` if needed;
- `pi.systemPrompt` if agent should know tool behavior.

### Step 4 — implement frontend

Rules:

- no left tabs unless explicitly requested;
- file visualizers use file-open routing, not sidebar menus;
- local/native mode imports from `@hachej/boring-workspace/plugin`;
- hosted/iframe mode uses bridge APIs for files/UI/theme;
- keep dependencies minimal unless hosted sandbox dev/build supports them;
- render errors clearly in panel.

### Step 5 — implement tools/RPC handlers

Rules:

- no backend routes;
- handler descriptor only (`{ runtime, entry }`);
- JSON stdin/stdout;
- validate input defensively;
- clear non-zero errors;
- do not access paths outside workspace/plugin-permitted scope.

### Step 6 — verify statically

```bash
boring-ui verify-plugin <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
```

Verifier checks:

- manifest schema;
- no `boring.server` for generated plugins;
- no `server/index.ts` scaffold unless internal mode;
- front entry exists;
- `boring.ui` ids are unique and namespaced;
- handler entries stay inside plugin root;
- JSON schemas valid;
- permissions declared for file/network/UI operations;
- no left tabs unless explicit manifest reason.

### Step 7 — smoke tools

Future command:

```bash
boring-ui run-plugin-tool <name> <tool> --json '{...}' "$BORING_AGENT_WORKSPACE_ROOT"
```

Until then, run the command manually with JSON stdin.

### Step 8 — reload

```txt
/reload
```

Then inspect plugin health.

Future command:

```bash
boring-ui plugin-health <name> "$BORING_AGENT_WORKSPACE_ROOT"
```

### Step 9 — UI smoke

Verify:

- command opens panel;
- file-open route opens correct visualizer;
- no unwanted left menu item;
- tool works on sample data;
- reload banner shows front/tool success.

### Step 10 — iterate until clean

If errors:

- read health/reload diagnostics;
- fix only relevant plugin files;
- rerun verify;
- rerun `/reload`.

## CLI commands to add or extend

### `boring-ui plugin-capabilities`

Reports host generation contract.

### `boring-ui scaffold-plugin --target auto|native|iframe`

Scaffold according to effective host policy.

Default `auto` for generated/external plugins is portable:

- create both `front/native.tsx` and `front/iframe.tsx` wrappers when frontend UI is requested;
- put reusable renderer logic in shared modules;
- declare both entries in `boring.front`;
- host policy chooses effective frontend runtime:
  - local CLI -> native frontend + sandboxTools;
  - hosted -> iframe frontend + sandboxTools.

Explicit `--target native` or `--target iframe` may create a single-target plugin,
but verifier/health output must report that the plugin is not portable to the
missing runtime.

### `boring-ui verify-plugin`

Already exists; extend for manifest-first tools/UI/runtime rules.

### `boring-ui run-plugin-tool`

Runs a plugin tool command with JSON args through the same proxy contract used by Pi.

### `boring-ui plugin build`

Builds plugin frontend artifacts from runtime workspace root.

- `--mode native` may return a Vite module URL/revision;
- `--mode iframe-dev` starts/validates sandbox Vite;
- `--mode iframe-stable` emits `.boring-agent/plugins/<id>/<hash>/iframe.html`;
- writes/updates `.boring-agent/state/plugin-registry.json`.

### `boring-ui plugin-health`

Prints lifecycle/effective runtime/reload/build/tool errors.

## Implementation phases

### Phase 1 — frontier + manifest schema + scaffold rules

- Add/lock docs.
- Add `boring.ui`, `pi.sandboxTools`, `boring.rpc` schema.
- Update skill/prompt to forbid generated backend routes.
- Update scaffold to manifest-first shape.
- Update verifier to reject generated `boring.server`/`server/index.ts`.

### Phase 2 — tool proxy runtime

- Register `pi.sandboxTools` as Pi proxy tools.
- Local CLI executes through local workspace exec.
- Hosted executes through remote/sandbox exec only inside the permission-scoped exec envelope described above. If that envelope is unavailable, hosted generated tools/RPC that request file/network access are disabled with `PLUGIN_CAPABILITY_DENIED`.
- Add timeout/output/result validation.
- Add `run-plugin-tool`.

### Phase 3 — local CLI native frontend by default

- Enable plugin-dev by default in local CLI.
- Add `--no-plugin-dev`.
- Use embedded Vite middleware for `.pi/extensions` native front transform.
- Add trust banner.
- Ensure `/reload` reports browser front success/failure.
- Use an in-memory plugin revision map keyed by plugin id for native cache-busting; persistent `plugin-registry.json` is not required until hosted stable artifacts land.

### Phase 4 — hosted iframe panel runtime

- Enforce hosted iframe security baseline: isolated origin or opaque sandbox, restrictive sandbox/CSP, no ambient host credentials, and strict message source/origin validation.
- Add iframe panel wrapper.
- Add bridge handshake/envelope.
- Register panels/commands/fileOpen from manifest without importing frontend code.
- Add bridge ops: `files.read`, `ui.toast`, `theme.get`.

### Phase 5 — hosted stable iframe artifacts

- Add runtime-cwd plugin build command.
- Emit content-addressed iframe bundles under `.boring-agent/plugins/<id>/<hash>/`.
- Maintain `.boring-agent/state/plugin-registry.json` with atomic swap/rollback.
- Keep previous good artifact on build failure.
- Iframe uses stable artifact URL outside live-dev authoring.

### Phase 6 — hosted live-dev HMR

- Start Vite dev server inside sandbox on demand.
- Proxy HTTP + HMR websocket through host with auth/session token.
- Configure Vite base/HMR for proxied iframe URL.
- Add lifecycle/idle timeout/health.
- Iframe uses sandbox Vite URL during authoring.

### Phase 7 — declarative runtime plugin RPC

- Add `boring.rpc` manifest entries for generated/runtime plugins.
- Add `POST /api/v1/agent-plugins/:pluginId/rpc` as a host-owned broker endpoint.
- Execute via same local/sandbox proxy mechanics.
- Validate input/output schemas.
- Do not migrate app/internal domain routes just for purity; regular routes remain valid for boot-composed app plugins.

### Phase 8 — health/lifecycle + marketplace prep

- Add plugin health API/CLI.
- Add lifecycle states.
- Add `.pi/plugins.lock.json` for marketplace/provenance later.
- Add install/promote/revoke UX later.

## Acceptance criteria

### Local CLI

- Start `boring-ui` locally.
- Plugin-dev is active by default and visible in UI.
- Agent scaffolds CSV visualizer.
- Plugin has no backend route.
- `/reload` loads frontend and tool.
- Opening `.csv` uses plugin panel.
- `csv_summarize` tool runs through proxy/local exec.
- No left sidebar tab unless explicitly requested.
- `--no-plugin-dev` disables native frontend plugin-dev.

### Hosted sandbox dev

- Same manifest can run with effective iframe frontend.
- Host registers UI from manifest, not imported frontend code.
- File-tree click routes to host iframe wrapper panel.
- Iframe receives params over bridge.
- Iframe reads allowed files through permissioned bridge; RPC is optional after Phase 7.
- Sandbox Vite dev server can hot-update iframe content through proxied HMR.
- No plugin executable code imports into host backend.
- If sandbox Vite/HMR fails and a stable artifact exists, host can fall back to stable artifact with a health warning.

### Hosted sandbox stable

- Frontend artifact builds inside runtime/sandbox cwd.
- Artifact activates by content hash.
- Host serves artifact bytes without importing plugin code and without exposing them as same-origin unsandboxed host app content.
- Previous good artifact remains active if build fails.
- Tool executes through `sandbox.exec` inside a permission-scoped exec envelope.
- Tool/RPC execution cannot write `.boring-agent/` registry/artifact state.
- If permission-scoped exec is unavailable, hosted generated tools/RPC requiring file/network access are disabled with `PLUGIN_CAPABILITY_DENIED`.
- Missing permission/invalid path/malformed tool result produces stable errors.

### App/internal or promoted plugin

- App-composed plugin can still register regular server routes at boot.
- Routes are appropriate for trusted domain APIs and SDK transports, such as Macro data access.
- Route changes require restart/redeploy.
- This path is not used by generated plugin scaffold.

## What is close vs later

Close:

- local CLI native plugin-dev using existing Vite/playground learnings;
- manifest-first generated plugin scaffold;
- no backend routes;
- local command-proxy tools.

Medium:

- hosted sandbox command-proxy tools;
- iframe panel wrapper and basic bridge;
- stable content-hash iframe artifact publishing.

Later/advanced:

- hosted live-dev Vite HMR with websocket proxy;
- marketplace provenance/lockfile;
- WebContainer/full browser IDE mode, if ever needed.

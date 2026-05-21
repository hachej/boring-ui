# Runtime Plugin V2 Hot Reload Plan

## Status

Final consolidated planning note for the next runtime-plugin phase. This is the
human-readable synthesis of the round-based plan reviews in:

- `runtime-plugin-trust-modes-plan.md`
- `runtime-plugin-trust-modes-plan-review-synthesis.md`
- `runtime-plugin-agent-generation-plan.md`
- `runtime-plugin-agent-generation-plan-round2-synthesis.md`
- `runtime-plugin-agent-generation-plan-round3-synthesis.md`
- `runtime-plugin-agent-generation-plan-round4-synthesis.md`
- `runtime-plugin-agent-generation-plan-round5-synthesis.md`

Those files keep the detailed review trail. This file is the final operating
plan.

## Background

The plugin-agent layer PR proved that workspace-local `.pi/extensions` can be
created by the agent, verified, reloaded with `/reload`, and rendered in the
workbench without a full browser or server restart. It also exposed the next
architecture boundary: app-owned plugin packages and generated/runtime plugins
must not be treated as the same trust class.

Current behavior worth preserving:

- `/api/v1/agent-plugins` remains the canonical runtime plugin discovery route.
- `/reload` owns runtime plugin refresh; Vite HMR should not directly mutate
  runtime plugin registration state.
- Front plugin imports use cache-busted dynamic import URLs and preserve the
  previous version on browser import/register failure.
- File opens route through surface resolvers so generated visualizers can handle
  `.csv`, `.json`, `.md`, etc. without special file-tree code.
- Workspace-local `boring-ui` CLI is the authoring path inside the agent runtime;
  do not teach agents to use `npx` for scaffold/verify.

## Product classes

### App/internal plugin

Trusted app code composed at boot through plugin contribution APIs.

Examples:

- Macro
- Ask User
- Data Catalog
- first-party workbench integrations

Allowed:

- native React components in the host tree
- regular Fastify routes for domain APIs and SDK transport
- app DB/service access
- host-side tools, catalogs, providers, provisioning, system prompts

Lifecycle:

- boot-composed
- route/server changes require restart/redeploy
- not hot-reloaded by runtime `/reload`

### Runtime/generated plugin

User/agent/marketplace-authored extension under the workspace plugin root.

Examples:

- `.pi/extensions/csv-viewer`
- generated file visualizers
- hosted sandbox plugin panes

Allowed:

- manifest-declared panels, commands, catalogs, file-open rules, surface resolvers
- frontend pane content
- `pi.systemPrompt`, skills, prompts, Pi resources
- sandbox/local-exec tools
- optional runtime plugin RPC later

Not allowed:

- `boring.server`
- `server/index.ts`
- Fastify routes
- direct DB access
- host-process backend imports
- broad workspace/host mutation outside declared permissions

## Current hot-reload compatibility

| Surface | Local `.pi/extensions` / dev playground | App/internal packages | Hosted/generated target |
|---|---|---|---|
| `pi.systemPrompt`, skills, prompts, Pi resources | `/reload` hot-reload | package resources can be rediscovered in dev; static in production | host scans manifest and injects bounded context |
| `boring.front` native front | `/reload` dynamic import + cache busting | app dev server/build; package front can be rediscovered in dev | iframe only by default |
| `boring.server` / routes | not allowed | boot-time only | not allowed |
| generated tools | local command proxy | host/internal tool registration | sandbox/remote exec proxy |
| generated RPC | planned | use regular routes when app-owned | host-owned broker endpoint, sandbox/remote exec |
| packaged CLI static frontend | not hot-reloaded yet | n/a | n/a |

## Runtime plugin source layout

Generated plugin default scaffold should be portable:

```txt
.pi/extensions/<plugin-id>/
  package.json
  front/
    native.tsx      # local/native wrapper
    iframe.tsx      # hosted iframe wrapper
    Pane.tsx        # shared renderer where practical
  tools/
    <tool>.js       # optional sandbox/local-exec handlers
  skills/
    SKILL.md        # optional richer agent guidance
  README.md
```

The CLI may continue accepting simpler `front/index.tsx` layouts for current
local plugins, but the future default should support both native and iframe
frontends.

## UI primitive policy

Generated plugins should use a stable boring-ui primitive/design-system surface,
not random broad workspace internals.

Implications:

- The runtime must provision/install the package that exposes the supported
  primitives so generated plugin code can import it from inside the workspace.
- Scaffold templates should import documented primitives where useful.
- Verify should warn or fail on broad unsupported imports.
- Hosted builds must either bundle these primitives from sandbox dependencies or
  provide a stable bridge/iframe SDK import path.

Tracking issue: <https://github.com/hachej/boring-ui/issues/64>

## System prompt and Pi resource policy

Keep core prompts small. Plugin-specific guidance should come from plugin-owned
metadata/resources.

Runtime/generated plugins:

- use `package.json#pi.systemPrompt` for short guidance;
- use `pi.skills` / Pi package skills for longer domain instructions;
- guidance is scoped by plugin id and removed when disabled/quarantined.

App/internal plugins:

- may use `defineServerPlugin({ systemPrompt })` for trusted app context;
- may also contribute Pi package resources or skills.

Core/workspace:

- owns global rules only: workspace paths, file safety, plugin authoring workflow,
  bridge/tool contracts, and stable command names.

## Routes, data, and RPC

### Regular routes are OK for app/internal plugins

Macro is the canonical example. Its `/api/macro/*` routes are app-owned domain
APIs and SDK transport around ClickHouse and derived-series persistence. They do
not need to be rewritten into RPC for purity.

Keep regular routes for trusted domain APIs such as:

- catalog/facets/search
- series metadata/data/lineage
- Python SDK calls like `series.data` and `transform.persist`
- admin/internal refresh/proxy actions when reviewed by the app owner

### Generated plugins do not define routes

Generated/runtime plugins use:

- manifest-declared tools for agent-triggered work;
- optional runtime plugin RPC for frontend-triggered backend-like work;
- workspace file APIs for file read/write/list;
- UiBridge actions for UI control flow.

### Ask User should move into UiBridge actions

Ask User currently has a custom route for browser answer submission. That route
is UI control flow, not a domain data API. Long term it should become a host
UiBridge/control-plane action, e.g.:

```txt
ask-user.answer
ask-user.cancel
```

Browser posts the action; the trusted ask-user runtime resolves the waiting tool.

### Macro deck routes should move to workspace file APIs

Macro deck read/write/list duplicates generic workspace filesystem behavior.
Long term:

- replace `/api/macro/deck*` with workspace file APIs or a workspace path mapping;
- keep path validation in the workspace adapter.

## `_template-full` policy

`plugins/_template-full` is useful as an app/internal package example, but it
should not be the main generated-plugin authoring path.

Canonical authoring path:

```bash
boring-ui scaffold-plugin <name>
boring-ui verify-plugin <name>
```

Reasons:

- agents learn one command;
- scaffold can evolve native/iframe targets;
- verify can enforce generated-plugin restrictions;
- runtime packages can be provisioned consistently;
- generated plugins avoid copying `boring.server` patterns by accident.

## Hosted runtime model

Hosted generated plugins run as isolated iframe pane renderers plus sandbox tools.

Requirements:

- no same-origin unsandboxed iframe content;
- no ambient host cookies/storage;
- restrictive CSP;
- strict message source/origin/session/nonce checks;
- host owns DockView, file tree, command registry, routing, permissions, lifecycle;
- iframe owns pane content only.

## Hosted tool/RPC execution envelope

Hosted generated tool/RPC code runs in a permission-scoped exec envelope:

- no broad workspace read/write by default;
- declared file globs define visible/readable/writable files;
- `.boring-agent/` is hidden/read-only/not mounted writable;
- network egress is default-deny unless enforceable allowlist exists;
- timeouts, rate limits, stdout/stderr/result caps, and schema validation apply;
- if the platform cannot enforce the requested permission envelope, the capability
  is disabled with `PLUGIN_CAPABILITY_DENIED`.

## `.boring-agent/` ownership

`.boring-agent/` is runtime-owned. Generated plugins should not edit it directly.

Host-owned commands manage:

- runtime package installs
- iframe artifacts
- active plugin registry
- rollback state
- runtime bins and caches

File search and normal file-open routing should ignore runtime-owned artifacts.

## Implementation phases

### Phase 1 — contracts and scaffold defaults

- Update manifest schema for generated plugin classes.
- Scaffold portable native/iframe-compatible plugins.
- Keep generated scaffold route-free.
- Make templates use documented boring-ui primitives.
- Update verify to flag unsupported imports and generated `boring.server`.

### Phase 2 — local CLI plugin-dev

- Enable plugin-dev by default in CLI local workspaces.
- Use embedded Vite middleware or equivalent transform path for runtime plugin
  frontends.
- Show trust banner/status.
- Keep `/reload` as the plugin registry refresh boundary.
- Provide `--no-plugin-dev`.

### Phase 3 — sandboxTools proxy

- Add/lock `pi.sandboxTools` manifest contract.
- Local: execute handlers in workspace runtime cwd.
- Hosted: execute handlers in sandbox/remote exec envelope.
- Validate schemas, permissions, outputs, and limits.

### Phase 4 — hosted iframe wrapper and bridge

- Add host-owned iframe wrapper panel.
- Add iframe bridge SDK for params, theme, files, notifications, and bounded calls.
- Enforce origin/session/nonce/capability checks.

### Phase 5 — hosted stable artifacts

- Build iframe bundles inside sandbox/build-worker.
- Store content-hash artifacts under host-owned runtime state.
- Atomically update active registry.
- Keep previous good artifact on failure.

### Phase 6 — hosted live-dev HMR

- Start sandbox Vite dev server on demand.
- Proxy HTTP/HMR websocket through authenticated host endpoint.
- Use iframe URL for authoring.
- Fall back to stable artifact on failure.

### Phase 7 — runtime plugin RPC

- Add host-owned endpoint for generated plugin RPC.
- Dispatch only to declared manifest ops.
- Execute via local/sandbox proxy mechanics.
- Do not migrate app/internal routes just for purity.

### Phase 8 — lifecycle, health, marketplace prep

- Add plugin health/lifecycle state.
- Add quarantine and explicit recovery flow.
- Add provenance/lockfile groundwork.
- Add install/promote/revoke UX later.

## Acceptance criteria

Local CLI:

- agent scaffolds a plugin with `boring-ui scaffold-plugin`;
- `boring-ui verify-plugin` passes;
- `/reload` loads frontend/Pi resources without browser restart;
- file-open routes to generated visualizer;
- generated plugin has no backend route;
- plugin UI uses supported primitives;
- `--no-plugin-dev` disables native runtime plugin execution.

Hosted generated stable:

- same plugin runs in iframe mode;
- host registers surfaces from manifest, not host-imported frontend code;
- iframe can read allowed files through bridge;
- tools/RPC execute only through sandbox envelope;
- `.boring-agent/` cannot be modified by plugin code;
- bad builds keep previous artifact active.

App/internal:

- Macro-style regular routes continue working;
- route changes require restart/redeploy;
- server-side plugin power is not exposed to generated plugins.

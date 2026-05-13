# Hot-Reloadable Boring Plugins Plan

Last updated: 2026-05-12
Status: current architecture snapshot for PR #18

This file is the single active plan for the hot-reloadable plugin/agent layer.
Older split plans for agent docs, plugin-agent layering, and derivation path A
were consolidated here so implementation guidance matches the code now in the
branch.

## Goals

- `/reload` reloads both Pi agent assets and Boring workspace plugin assets.
- Plugin metadata is package-shaped and easy to author.
- UI registration is runtime code, not JSON-driven wiring.
- Pi-specific runtime/reload behavior stays behind the Pi harness adapter.
- The agent harness remains pluggable for non-Pi runtimes.
- Bad plugin metadata is observable and recoverable: no process crash, stable
  error events, and `.error` files.

## Package model

A Boring plugin is a package/directory with `package.json` metadata and optional
runtime entrypoints:

```txt
plugin/
  package.json
  front/index.tsx      # browser-only BoringFrontFactory
  agent/index.ts       # optional Pi ExtensionFactory
  agent/skills/        # optional Pi skills
  server/index.ts      # optional trusted workspace/server routes
  shared/              # optional platform-neutral types/constants
```

### `package.json#boring`

`boring` is workspace/UI discovery metadata only:

```json
{
  "name": "example-plugin",
  "boring": {
    "label": "Example Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts",
    "derivesFrom": "data-catalog"
  }
}
```

Allowed runtime semantics:

- `id` / derived package name selects the stable plugin id.
- `label` is display metadata.
- `front` points at the front factory entrypoint.
- `server` points at trusted Node routes/helpers, or `false` to opt out.
- `derivesFrom` is discovery metadata for templates/catalogs.

Not allowed in `boring`: panels, commands, left tabs, surface resolvers, agent
tools, skills, extensions, packages, system prompts. Those old JSON registration
arrays were intentionally removed.

### `package.json#pi`

`pi` owns agent/Pi contributions:

```json
{
  "pi": {
    "extensions": ["agent/index.ts"],
    "skills": ["agent/skills"],
    "packages": [{ "source": "file:.", "extensions": ["agent/index.ts"] }],
    "systemPrompt": "Use this plugin's tools when working with example data."
  }
}
```

`extensions`, `skills`, `packages`, and `systemPrompt` are consumed by the Pi
adapter. Workspace code only discovers and forwards them; it does not implement
Pi loading directly.

## Runtime registration

### Front/UI

`BoringFrontFactory` is the single runtime UI registration source:

```ts
import type { BoringFrontFactory } from "@hachej/boring-workspace/plugin"

const plugin: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "example.panel", title: "Example", component: ExamplePane })
  api.registerCommand({ id: "example.open", title: "Open Example", run: () => {} })
  api.registerLeftTab({ id: "example.left", title: "Example", component: ExampleLeft })
  api.registerSurfaceResolver({ id: "example.surface", resolve: () => ({ component: "example.panel" }) })
}

export default plugin
```

Front plugin code is browser code. It must not contribute executable agent tools.
The legacy front-side `agentTools` / `agent-tool` output path is removed.

### Server/workspace

`server/index.ts` is trusted host-process code for workspace routes or support
helpers. Hot-reloadable package plugins should put new tool capabilities in
`pi.extensions` via `agent/index.ts`. Programmatic host/server plugin APIs may
still adapt legacy `extraTools` during migration, but package metadata does not
carry front-side or JSON-declared tools.

### Agent/Pi

`agent/index.ts` exports native Pi extension factories. The Pi harness adapter
owns conversion into `DefaultResourceLoader`, dynamic package metadata refresh,
skill loading, and `piSession.reload()`.

## Reload flow

1. User sends `/reload` in chat.
2. Front slash-command calls `POST /api/v1/agent/reload`.
3. Generic agent route calls the configured harness `reloadSession` method.
4. Pi harness implementation refreshes Pi extension/skill/package inputs and
   reloads the Pi session.
5. Workspace composition `beforeReload` reloads `BoringPluginAssetManager`.
6. Manager emits `boring.plugin.load`, `boring.plugin.unload`, or
   `boring.plugin.error` SSE events.
7. Front plugin runtime hot-swaps successful `front` modules and keeps the last
   good UI alive on malformed/error events.

The generic agent package exposes only the harness seam; Pi-specific knobs live
under `pi` options.

## Validation and safety

Plugin discovery/preflight must:

- reject invalid ids and duplicate effective plugin ids;
- reject `.` paths, absolute paths, backslash paths, null-byte paths, and
  traversal (`../`) paths;
- validate explicit `front`, `server`, `pi.extensions`, `pi.skills`, and nested
  `pi.packages[*]` resource filters;
- perform realpath containment checks for existing paths;
- check the nearest existing ancestor for missing paths under symlinked parents;
- allow empty collection directories such as `.pi/extensions`;
- report explicit plugin dirs without `package.json` as `MISSING_PACKAGE_JSON`;
- surface invalid JSON/metadata through preflight errors rather than crashing
  startup.

Error reporting:

- `BoringPluginAssetManager.load()` returns errors.
- SSE emits `boring.plugin.error`.
- `.error` files are written under the configured error root.
- If a plugin id cannot be safely derived, use a stable `preflight-<hash>` id.

## Agent docs for plugin creation

The agent should learn the plugin API from workspace-owned Markdown docs:

- `packages/workspace/src/server/docs/plugins.md`
- `packages/workspace/src/server/docs/panels.md`
- `packages/workspace/src/server/docs/bridge.md`

`buildBoringSystemPrompt()` embeds those docs into the agent prompt when the
workspace app has strong filesystem capability. This replaces the older separate
agent-doc-embedding plan.

## Current asset-serving caveat

Hot-loaded front entries currently use Vite-style `/@fs/<absolute-path>` module
URLs. `WorkspaceProvider` gates that path behind `frontPluginHotReload="vite"`,
which defaults on only in dev, because Vite transforms TypeScript/TSX and React
imports for the browser.

A production Fastify-only host needs a workspace-owned authenticated module
asset endpoint/bundler before front plugin hot-loading can work without Vite.
Until that endpoint exists, document front plugin hot-reload as development /
workspace-dev-server scope.

## Public API boundaries

- `@hachej/boring-workspace/plugin` exports front authoring helpers,
  `BoringFrontFactory`, and package metadata types.
- Public barrels export `BoringPluginPackageJson`, not the server runtime
  manifest shape.
- Server-only runtime manifests stay under `server/agentPlugins`.
- Shared/browser code must not import `@hachej/boring-agent` values.
- `UiBridge.postCommand` remains the single command dispatch source.

## Done in PR #18

- Generic `/api/v1/agent/reload` route and `/reload` slash command.
- Pluggable `AgentHarnessFactory` and Pi-scoped adapter options.
- Workspace plugin scanner, asset manager, routes, and SSE front reload client.
- `package.json#pi` / `package.json#boring` split.
- `BoringFrontFactory` as the only runtime UI registration source.
- Removal of obsolete front-side `agentTools` registration path.
- Realpath-aware path validation and observable preflight errors.
- Consolidated plan docs into this current architecture plan.

## Not in scope for PR #18

- `apps/boring-macro-v2`.
- Password-reset smoke tests.
- Production Fastify asset bundling for front plugin modules.
- Cloud/multi-tenant plugin provisioning.

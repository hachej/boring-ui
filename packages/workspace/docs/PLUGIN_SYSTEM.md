# Plugin / Agent Layer

Normative spec for `@hachej/boring-workspace`'s current plugin + agent
layer. Code comments and tests cite section numbers in this file (for
example `PLUGIN_SYSTEM.md §4.5`), so keep headings stable when editing.

This document describes the implementation as it exists now. Historical
implementation plans live under `packages/workspace/docs/plans/archive/`.
For future generated/hosted runtime-plugin architecture, see the repo-level
`docs/runtime-plugin-v2-hot-reload-plan.md`.

## Contents

1. [Glossary](#1-glossary)
2. [End-to-end behaviour](#2-end-to-end-behaviour)
3. [Architecture](#3-architecture)
4. [Public API](#4-public-api)
5. [Key algorithms](#5-key-algorithms)
6. [Gotchas](#6-gotchas)
7. [Non-goals](#7-non-goals)
8. [Risk register](#8-risk-register)

---

## 1. Glossary

| Term | Definition |
| --- | --- |
| **App/internal plugin** | Trusted package composed by the app at boot. May export `boring.server`, Fastify routes, agent tools, providers, catalogs, and domain APIs. Server changes require restart/redeploy. |
| **Runtime/generated plugin** | Workspace-local plugin under `.pi/extensions/<id>/`, usually produced by `boring-ui-plugin scaffold`. It is hot-loaded for front/Pi resources, but must not rely on dynamic backend routes. |
| **Boring plugin package** | Node package with `package.json#boring` and/or `package.json#pi`. App-default packages are declared in `package.json#boring.defaultPluginPackages` or passed to `createWorkspaceAgentServer`. |
| **Boring front factory** | Default export of `boring.front`: `(api: BoringFrontAPI) => void | Promise<void>`. Usually created with `definePlugin({ ... })`. |
| **Workspace server plugin** | Trusted boot-time server contribution returned by `defineServerPlugin({ ... })` or a compatible object. May include routes, tools, system prompt, Pi resources, and provisioning. |
| **Asset manager** | `BoringPluginAssetManager`. Scans plugin dirs, computes signatures, tracks revisions, emits `boring.plugin.{load,unload,error}` events, and backs `/api/v1/agent-plugins`. |
| **Revision** | Per-plugin monotonic integer. It bumps on signature changes and is appended to browser front imports for cache busting. |
| **Surface resolver** | Front contribution that maps a typed request such as `open-path` to a panel id/title/params. File opens should route through this path. |

---

## 2. End-to-end behaviour

### App/internal package plugin

1. App installs or references a plugin package.
2. App declares it through `defaultPluginPackages`, `appPackageJsonPath`, or
   explicit `plugins` passed to `createWorkspaceAgentServer`.
3. Workspace resolves the package at boot.
4. `boring.front` is exposed through the asset manager and front hot-load
   path in dev.
5. `boring.server` is imported and boot-composed once; routes and agent
   tools are registered with the Fastify/agent process.
6. Server changes require process restart. `/reload` may diagnose the drift,
   but it does not rewire routes/tools in-place.

### Runtime/generated plugin

1. Agent/user runs the workspace-local CLI:

   ```bash
   boring-ui-plugin scaffold <name>
   boring-ui-plugin verify <name>
   ```

2. The plugin lives under `.pi/extensions/<name>/`.
3. `/reload` scans plugin manifests, refreshes Pi resources, and emits SSE
   load/unload/error events.
4. Browser dynamic-imports `boring.front` with revision + salt query params
   and atomically replaces that plugin's registry entries.
5. Previous working UI remains live when a front import/register fails.
6. Generated plugins should omit `boring.server`; backend-like work should use
   Pi extensions/tools today and future brokered sandbox tools/RPC later.

---

## 3. Architecture

```
App package.json / createWorkspaceAgentServer options
        │
        ▼
resolve default plugin package dirs + explicit plugin entries
        │
        ├─ bootstrapServer(...)          trusted boot-time server plugins
        │     ├─ routes                  Fastify app.register at boot
        │     ├─ agentTools              passed to createAgentApp at boot
        │     ├─ systemPromptAppend      static prompt addendum
        │     ├─ pi packages/skills/exts static Pi resources
        │     └─ provisioning            runtime workspace materialization
        │
        ├─ BoringPluginAssetManager      manifest scan + signatures + SSE
        │     ├─ /api/v1/agent-plugins
        │     ├─ /api/v1/agent-plugins/events
        │     └─ /api/v1/agent-plugins/:id/error
        │
        └─ createAgentApp(...)
              ├─ beforeReload: asset scan + diagnostics + caller hook
              ├─ systemPromptDynamic: plugin `pi.systemPrompt`
              └─ pi.getHotReloadableResources: plugin skills/extensions/packages

Browser WorkspaceAgentFront
        │
        └─ useAgentPluginHotReload
              ├─ EventSource to /api/v1/agent-plugins/events
              ├─ dynamic import(frontUrl?v=<revision>&t=<salt>)
              └─ registry.replaceByPluginId(...) per output kind
```

Subpath intent:

| Subpath | Audience | Contents |
| --- | --- | --- |
| `/plugin` | Front plugin authors | `definePlugin`, front API/types, manifest validators, panel/surface contracts. |
| `/server` | Trusted server plugin authors/hosts | `defineServerPlugin`, server plugin types, asset manager helpers. |
| `/app/server` | App shells | `createWorkspaceAgentServer` and orchestration options. |
| `/app/front` | App shells | `WorkspaceAgentFront`. |
| `/shared` | Runtime-agnostic contracts | Shared types only. |

---

## 4. Public API

### 4.1 Plugin `package.json`

```jsonc
{
  "name": "my-plugin",
  "version": "0.1.0",
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts" // app/internal only; omit for generated plugins
  },
  "pi": {
    "systemPrompt": "Short guidance for the agent.",
    "extensions": ["agent/index.ts"],
    "skills": ["skills/my-skill"],
    "packages": ["."]
  }
}
```

Rules:

- `boring.front`, `boring.server`, `pi.extensions`, and `pi.skills` are safe
  relative paths contained by the package root.
- `boring.server: true` is invalid. Use a string path or omit it.
- Plugin id is derived from `package.json#name`; `boring.id` is rejected.
- Runtime/generated plugins should include `boring.front` and/or `pi.*` and
  omit `boring.server`.

### 4.2 App `package.json`

```jsonc
{
  "boring": {
    "defaultPluginPackages": [
      "@hachej/boring-ask-user",
      "./src/plugins/playgroundDataCatalog"
    ]
  }
}
```

Relative entries resolve against the app package.json when
`appPackageJsonPath` is supplied. Explicit `defaultPluginPackages` passed to
`createWorkspaceAgentServer` are merged with manifest entries.

### 4.3 Front authoring (`@hachej/boring-workspace/plugin`)

Use the declarative object form:

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin({
  id: "my-plugin",
  label: "My Plugin",
  panels: [
    {
      id: "my-plugin.panel",
      label: "My Panel",
      placement: "center",
      component: MyPanel,
    },
  ],
  commands: [
    { id: "my-plugin.open", title: "Open My Plugin", panelId: "my-plugin.panel" },
  ],
  surfaceResolvers: [myResolver],
})
```

The legacy positional form `definePlugin(id, factory, options?)` is not
supported. For advanced composition, use `setup(api) { ... }` inside the
config object.

### 4.4 Server authoring (`@hachej/boring-workspace/server`)

Trusted app/internal packages may export a server plugin:

```ts
import { defineServerPlugin } from "@hachej/boring-workspace/server"

export default defineServerPlugin({
  id: "my-plugin",
  systemPrompt: "Use My Plugin when ...",
  agentTools: [tool],
  routes: async (app) => {
    app.get("/api/my-plugin/health", async () => ({ ok: true }))
  },
})
```

This is boot-time composition. Routes and tools are not hot-wired into a
running Fastify/agent process by `/reload`.

### 4.5 Hot-reload coverage and partial-failure tolerance

| Surface | Runtime `.pi/extensions` | App/internal package plugin | Notes |
| --- | --- | --- | --- |
| `pi.systemPrompt` | `/reload`, next turn | `/reload` when discovered | Appended by `systemPromptDynamic`. |
| `pi.extensions` | `/reload` through Pi session reload | `/reload` when discovered as package resources | File paths are re-read from manifest. |
| `pi.skills` / `pi.packages` | `/reload` through dynamic resource getter | `/reload` when discovered as package resources | `verify-plugin` checks declared local skill paths. |
| `boring.front` panels/commands/catalogs/surface resolvers | `/reload` + SSE + browser dynamic import | `/reload` in dev when front URL is served by the app/Vite | Previous version stays live on import/register failure. |
| `boring.server` routes/agentTools | Not supported for generated plugins | Boot-time only | `/reload` can warn `requiresRestart`. Restart process to apply. |
| Providers/bindings from hot-loaded front factories | Skipped | Static composition only | Dynamic provider tree mounting is intentionally not implemented yet. |

Partial-failure rule: a failed plugin scan/import/register must not abort the
whole reload. Healthy plugins still update; failing plugins emit diagnostics,
write/read `.error` state, and keep their previous live UI where possible.

### 4.6 CLI authoring path

Generated plugin authoring uses the provisioned workspace-local CLI:

```bash
boring-ui-plugin scaffold <name>
boring-ui-plugin verify <name>
```

Do not teach agents to copy `packages/plugin-cli/templates/plugin` for generated runtime
plugins. That template is an app/internal publishable package example.

---

## 5. Key algorithms

### 5.1 Manifest scan

`scanBoringPlugins(pluginDirs)` discovers plugin package roots, validates
manifest shape, resolves contained entry paths, detects duplicate ids, and
returns `BoringServerPluginManifest[]` plus preflight diagnostics.

### 5.2 Signatures and revisions

`BoringPluginAssetManager` hashes manifest fields, front/server file
signatures, relevant front/server/shared directories, and Pi resource paths.
When a signature changes, the plugin revision increments and a load/unload/error
event is emitted.

### 5.3 Front import cache busting

Browser imports append both revision and salt:

```ts
import(`${frontUrl}?v=${revision}&t=${Date.now()}`)
```

The salt avoids stale Vite/browser module graph reuse across repeated reloads
or dev-server restarts.

### 5.4 Atomic registry replacement

Front factories are first captured into an in-memory API. The captured panels,
commands, catalogs, and surface resolvers are then installed with
`replaceByPluginId` per registry. DockView and registry subscribers should not
see an intermediate empty state.

### 5.5 Server drift warnings

When a plugin had a server entry in a previous revision and that server file
changes, the load event carries `requiresRestart: ["routes", "agentTools"]`.
The chat reload response also includes restart warnings so users know `/reload`
updated front/Pi resources but not boot-wired server code.

### 5.6 Path containment

Manifest paths are lexically safe relative paths and are checked with realpath
containment so symlink escapes are rejected. Runtime workspace provisioning
template targets are also constrained to remain inside the workspace root.

### 5.7 Output ownership and collision detection

Plugin-owned outputs carry `pluginId`. Hot reload uses that ownership to replace
only the current plugin's outputs. Cross-plugin id collisions are rejected with
`PLUGIN_OUTPUT_ID_COLLISION`; intra-plugin duplicate output ids are rejected
while capturing the front factory.

---

## 6. Gotchas

1. `/reload` is the runtime plugin refresh boundary. Vite HMR should not
   directly hot-update `.pi/extensions` modules into the host tree.
2. Native `EventSource` cannot send Authorization headers. When bearer auth is
   required and no token-query fallback exists, front plugin hot reload is
   disabled rather than silently unauthenticated.
3. Dynamic providers/bindings are not mounted for hot-loaded runtime plugins;
   use static app composition for provider trees.
4. `boring.server` in a runtime plugin may verify as a valid file path but it is
   not dynamically registered by `/reload`.
5. The asset manager is scan/hash/emit. Server route/tool import and
   composition happen through app/server orchestration.
6. Keep generated plugins route-free; use Pi extensions/tools and workspace file
   APIs instead.
7. Use surface resolvers for file visualizers. Do not hard-code extension logic
   in the file tree.

---

## 7. Non-goals

- Hot-registering Fastify routes or static `agentTools` from generated plugins
  into a live server process.
- Loading untrusted hosted plugin JavaScript directly into the host React tree.
- Replacing app/internal domain APIs (for example Macro routes) with runtime
  plugin RPC for purity.
- Dynamic provider/binding trees for runtime hot-loaded plugins in this PR.
- Marketplace signing/provenance/permissions. Those belong to the next runtime
  plugin architecture phase.

---

## 8. Risk register

| Risk | Current mitigation |
| --- | --- |
| Broken generated front import | Browser import/register error is surfaced; previous version remains live. |
| Stale server code after `/reload` | Restart warnings for server-path drift; docs state boot-time-only semantics. |
| Bad plugin blocks all reloads | Partial-failure tolerance; diagnostics per plugin. |
| Path escape via manifest entries | Safe relative path validation + realpath containment. |
| Path escape via runtime provisioning templates | Template targets are constrained to workspace-root descendants. |
| Duplicate output ids | Cross-plugin and intra-plugin collision checks. |
| Agent writes plugin into wrong cwd | Workspace-local `boring-ui` shim exports `BORING_AGENT_WORKSPACE_ROOT`; verifier prints scanned path. |

# Workspace Plugin Structure

Last updated: 2026-05-01

Workspace plugins use a small, predictable folder shape. The goal is
ownership clarity, not ceremony: plugin domain behavior stays in the plugin,
and workspace core stays a generic host.

See `INTERFACES.md` for the package-level contracts these plugins contribute
to.

## Standard Layout

Start from `packages/workspace/templates/plugin/` when creating a new plugin,
then delete the files the plugin does not need.

```txt
<plugin>/
  front/
    index.tsx            # front plugin factory and public front exports
    panels.tsx           # panel definitions
    catalogs.ts          # catalog outputs/config helpers
    surfaceResolver.ts   # openSurface target -> panel resolution
    bindings.tsx         # React side-effect bindings, if needed
    data/                # plugin-owned client data API/hooks/cache
  server/
    index.ts             # server plugin factory and public server exports
    routes.ts            # trusted server routes, if needed
    services/            # Node.js services (DB clients, etc.), if needed
    config.ts            # server-side config loading, if needed
  agent/
    index.ts             # native Pi ExtensionFactory, if needed
    sdk/                 # Python SDK installed into agent sandbox, if needed
    transforms/          # Executable/user-editable transforms, if needed
    workspace-template/  # Workspace scaffold copied at provision time, if needed
    skills/              # Agent skill .md files, if needed
    prompts/             # Pi prompt templates, if needed
  shared/
    constants.ts         # plugin id, catalog ids, surface kinds
    types.ts             # platform-neutral shared types, if needed
```

Use only the files a plugin actually needs. Large component families may live
in subfolders such as `file-tree/`, `code-editor/`, or `empty-file-panel/`.

### Layer Boundaries

The four layers have strict ownership rules:

- **`front/`** — React only. Never imports `server/` or `agent/`.
- **`server/`** — Trusted Node.js host. Never imports `front/`. Hosts optional
  workspace/UI support routes and references provisioning assets when needed.
- **`agent/`** — Pi/sandbox runtime assets. Keep free of Node.js server
  infrastructure. Native tools live in Pi extension files declared through
  `package.json#pi.extensions`. Prefer moving shared types to `shared/`.
- **`shared/`** — Platform-neutral. Never imports `front/`, `server/`, or `agent/`.

## Ownership Rules

- `front/index.tsx` composes front outputs; large behavior belongs in focused files.
- `server/index.ts` composes server outputs with `defineServerPlugin()`.
- Shared files must stay platform-neutral. Do not import plugin `front/` or
  `server/` code from `shared/`.
- Domain search belongs in `front/catalogs.ts`.
- Domain open behavior belongs in `front/surfaceResolver.ts`.
- Domain event names live in `shared/events.ts` when both layers need the
  contract; event names must be keyed by plugin id.
- Plugin data clients/hooks live in `front/data/`, not package `front/data`.
- Server routes, DB services, and config live under `server/`, not mixed
  with client code.
- Agent tools, Python SDKs, transforms, workspace seeds, and skills live under
  `agent/`, not under `server/` or front plugins. Hot-reloadable agent tools
  are Pi extension contributions declared through `package.json#pi`.
- Workspace core may host registries, providers, event transport, and bridge
  dispatch only. It must not hardcode plugin panel ids or plugin domain rules.
- Catalog selection and plugin-owned routing should prefer `openSurface`.
  `openPanel` remains available for explicit app-level panel opens.
- Executable agent tools are never front plugin contributions; front plugins
  only register UI through `BoringFrontFactory`.

## Composed Plugins

Use `composePlugins()` when a front plugin is easier to build from smaller
front fragments. The composed plugin flattens child panels, commands,
catalogs, bindings, and outputs into one normal `WorkspaceFrontPlugin`.

Default behavior adopts child ownership to the parent plugin id. Use
`adoptOutputs: false` only when registry ownership must stay attached to the
child fragment for diagnostics or selective unregister behavior.

```ts
const macroPlugin = composePlugins({
  id: "boring-macro",
  label: "Macro",
  plugins: [macroPanelsPlugin, macroSurfacesPlugin, macroSeriesExplorerPlugin],
})
```

Use `composeServerPlugins()` for the matching server side when statically
composing host integrations. Hot-reloadable package plugins should declare Pi
assets in `package.json#pi` and UI discovery in `package.json#boring`.

```ts
const macroServerPlugin = composeServerPlugins({
  id: "boring-macro",
  label: "Macro",
  plugins: [macroToolsPlugin, macroRoutesPlugin],
})
```

## Pi Package Adapters

Treat pi packages as implementation dependencies. The app-facing contract is a
workspace adapter plugin that wraps the pi package and optionally adds front
integration.

Do not require pi packages to export Boring-specific adapters. The pi ecosystem
already has its own shape, such as `package.json` `pi.extensions` entries and
extension functions that call `pi.registerCommand(...)`. Workspace adapters
should adapt to that shape.

Declare native pi package dependencies on the server plugin:

```ts
defineServerPlugin({
  id: "markdown-preview",
  piPackages: ["npm:pi-markdown-preview@0.9.7"],
})
```

Workspace passes these declarations to `@hachej/boring-agent` as in-memory Pi
settings. This enables Pi's native package loader without mutating
`.pi/settings.json`.

```txt
src/plugins/markdownPreview/
  shared/
    constants.ts        # workspace ids, surface kinds, command names
  server/
    index.ts            # defineServerPlugin(), pi package dependency wrapper
    routes.ts           # optional workspace-native render/preview routes
  front/
    index.tsx           # defineFrontPlugin()
    panels.tsx          # workspace-native preview panel
    surfaceResolver.ts  # markdown-preview.open -> panel resolution
```

For example, a wrapper around `pi-markdown-preview` can depend on that package,
read or invoke its pi extension behavior on the server side, and expose a
workspace-native `markdown-preview.open` surface on the front side. The agent
prompt should teach the model to use workspace `openSurface` when a Boring app
is present, even if the underlying pi package also provides terminal/browser
slash commands.


## Current Plugins

- `packages/workspace/src/plugins/filesystemPlugin`
- Data catalog package: `@hachej/boring-data-catalog` (`plugins/data-catalog/src`)
- `apps/workspace-playground/src/plugins/playgroundDataCatalog`
- Macro plugin example: `hachej/boring-macro` (`src/plugins/macro`)

## Invariants

Run:

```sh
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
```

The scan rejects:

- `filePatterns`, `fileFallback`, `PanelRegistry.resolve`, and file-handler
  routing metadata in source.
- `front/data` imports or path references in source.
- `@hachej/boring-agent` imports from `workspace/src/shared/plugins`.
- `front`/`server` imports from production `workspace/src/shared/plugins`.
- Production plugin `front/`, `server/`, and `shared/` layers importing across
  the wrong layer boundary.
- `server/sdk`, `server/transforms`, `server/workspace-template` paths inside
  plugin directories (these are agent assets and must live under `agent/`).
- TypeScript source files directly under a plugin root instead of
  `front/`, `server/`, `agent/`, or `shared/`.
- Plugin-domain imports from production `workspace/src/front/chrome`, `events`,
  and `hooks`.
- Legacy plugin file names such as `catalog.ts`, `surfaceTargets.ts`,
  root-level `client.ts`, or root-level `server.ts`.

# Workspace Interfaces

Last updated: 2026-05-02

`@hachej/boring-workspace` is a workspace UI and bridge package. The app shell owns
auth, routing, application persistence, and the concrete chat component.
Workspace owns layout runtime, layout preferences, plugin registries, bridge
commands, and default workspace plugins.

## Package Boundaries

- `src/front/` hosts React providers, layouts, Dockview chrome, registries,
  bridge clients, and generic UI.
- `src/plugins/` hosts plugin-owned domain behavior. Plugin code is split by
  layer: `front/`, `server/`, and `shared/`.
- `src/server/` hosts workspace UI bridge routes, UI tools, and server plugin
  bootstrap helpers.
- `src/shared/` hosts browser-safe contracts only. No `node:*`, no `Buffer`,
  and no agent package imports.
- `src/app/` hosts front/server composition helpers such as
  `WorkspaceAgentFront` and `createWorkspaceAgentServer`, where workspace app
  code may compose with documented `@hachej/boring-agent/server` APIs.

## Core Contracts

- Plugin contributions: `src/shared/plugins/frontFactory.ts`
  - Front plugins are authored with `definePlugin({ panels, leftTabs, commands,
    catalogs, bindings, providers, surfaceResolvers })`. Agent tools belong to
    Pi/server runtime paths, not front plugin contributions.
- Surface opening: `src/shared/types/surface.ts`
  - `SurfaceOpenRequest { kind, target, meta }` is resolved by plugin
    surface resolvers into panel openings.
- UI bridge: `src/shared/ui-bridge.ts`
  - Agents and servers post `UiCommand` values. The front-end dispatches them
    against the workspace runtime.
- Filesystem data: `src/plugins/filesystemPlugin/front/data`
  - Filesystem client, hooks, event stream, and cache invalidation are plugin
    owned.
- Data catalog package: `@hachej/boring-data-catalog/front` and
  `@hachej/boring-data-catalog/server`
  - Catalog rows are opened through `openSurface`; row-to-panel mapping belongs
    to the plugin resolver.
- Server plugins: `src/server/plugins`
  - `defineServerPlugin()` validates tools, routes, provisioning, and native Pi
    package declarations.
  - `piPackages` are passed to `@hachej/boring-agent` as in-memory Pi settings, so
    workspace adapters can depend on native Pi packages without requiring
    Boring-specific exports from those packages.

## Ownership Rules

- Workspace chrome must not hardcode plugin panel ids or plugin domain rules.
- Plugin data APIs stay under the owning plugin; there is no `front/data`
  compatibility layer.
- Use `openSurface` for domain targets that need resolver selection.
- Use `openPanel` only when the caller intentionally names the concrete panel.
- Front/shared workspace code does not value-import `@hachej/boring-agent`; app/server
  composition may import documented agent server APIs.

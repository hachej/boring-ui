# Workspace Interfaces

Last updated: 2026-06-12

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

## Chat-first workspace boot

The default core-composed workspace route is chat-first after identity match: `WorkspaceAgentFront` mounts immediately, while `WorkspaceBackgroundBoot` warms tree/session/runtime readiness in the background. `WorkspaceBootGate` remains available for shells that want blocking boot.

Workbench surfaces are locally gated by warmup state. File tree/editor/plugin workspace surfaces do not mount while the current workspace is preparing or failed; chat remains visible. See [`packages/core/docs/CHAT_FIRST_WORKSPACE_BOOT.md`](../../core/docs/CHAT_FIRST_WORKSPACE_BOOT.md) for the product contract and stable readiness errors.

## Core Contracts

- Plugin contributions: `src/shared/plugins/frontFactory.ts`
  - Front plugins are authored with `definePlugin({ panels, commands,
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

## Session creation protocol

Session providers must return the canonical created session from both supported
entry points:

- `WorkspaceAgentSessionsApi.create(input)` for `useSessions` providers.
- `WorkspaceAgentFrontProps.onCreateSession()` for controlled session hosts.

The result may be synchronous (`TSession`) or asynchronous
(`Promise<TSession>`). It must be the created row itself, with a non-empty
string `id`. `agentTypeId` is optional for compatibility sources, but when
present it must be a non-empty string; addressed hosts use it as the canonical
session owner. Invalid, missing, or `void` results reject with
`SESSION_CREATE_PROTOCOL_ERROR`; a thrown provider error or rejected provider
promise remains the task rejection. Consumers can import the canonical
`SESSION_CREATE_PROTOCOL_ERROR` constant and `SessionCreateProtocolError` type
from `@hachej/boring-workspace` or `@hachej/boring-workspace/app/front`.

Creates are serialized per session source and deduplicated only while the same
intent is queued or active. A failed task is removed before its callbacks run,
its settlement cleanup always runs, and a later user action may retry. The
workspace does not automatically retry provider failures; provider-side retry
must still return one canonical row when it succeeds.

Legacy providers that currently mutate their store and return `void` must be
migrated to return the row they created. For example, return the parsed create
response, or retain the locally constructed row, publish it to the store, and
then return that same row. Do not rely on the workspace to infer a created row
from later list or active-session changes.

## Ownership Rules

- Workspace chrome must not hardcode plugin panel ids or plugin domain rules.
- Plugin data APIs stay under the owning plugin; there is no `front/data`
  compatibility layer.
- Use `openSurface` for domain targets that need resolver selection.
- Use `openPanel` only when the caller intentionally names the concrete panel.
- Front/shared workspace code does not value-import `@hachej/boring-agent`; app/server
  composition may import documented agent server APIs.

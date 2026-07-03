# Workspace Docs

`@hachej/boring-workspace` is the workspace UI, layout, plugin, and bridge layer
for boring-ui apps. It composes chat, files, catalogs, editors, and app-specific
panes into an IDE-style workbench. The app shell owns auth, routing, persistence,
and the concrete chat component; the workspace owns the layout runtime, the
plugin registries, and the typed agent-to-browser bridge.

This folder holds the current normative docs. Read this index first, then jump to
the doc that matches your task.

## Architecture at a glance

- **Layout runtime** — Dockview-based panes (`IdeLayout`, `ChatLayout`,
  `ResponsiveDockviewShell`) mounted by `WorkspaceProvider`. Panels open in the
  center/right/bottom; left-tabs stay docked in the sidebar.
- **Plugin host** — `WorkspaceProvider` runs `bootstrap(plugins)` to populate the
  panel, command, catalog, and surface-resolver registries. Lazy panel factories
  are auto-wrapped in `React.lazy + Suspense + ErrorBoundary`.
- **UI bridge** — Agents/servers post `UiCommand` values (`src/shared/ui-bridge.ts`);
  the front-end dispatches them against the workspace runtime over SSE with an
  HTTP poll fallback.
- **Surface resolvers** — Decouple agent "open X" requests from concrete panel
  ids. A `SurfaceOpenRequest { kind, target, meta }` is resolved by plugin
  surface resolvers into panel openings (`src/shared/types/surface.ts`).
- **Two plugin tiers** — App/internal package plugins (trusted, boot-time, may add
  routes/agent tools/Pi resources) and runtime/generated `.pi/extensions` plugins
  (a.k.a. *external* plugins: hot-reloaded for front/Pi, route-free, and loaded
  only in local/direct-style host runtime contexts — not `vercel-sandbox`). See
  `PLUGIN_SYSTEM.md` §1.1 for the trust model.

## Key abstractions

| Abstraction | Where | What it is |
| --- | --- | --- |
| `WorkspaceProvider` | `src/front/provider` | Root provider; boots plugins, layout, bridge. |
| `useWorkspaceLeftPaneActions()` | `@hachej/boring-workspace` | Public hook for host apps that want to render workspace left-pane category buttons inside their own explorer/sidebar without mounting `WorkbenchLeftPane`. |
| `definePlugin()` | `@hachej/boring-workspace/plugin` | Declarative front plugin: panels, leftTabs, commands, catalogs, bindings, providers, surfaceResolvers. |
| `defineServerPlugin()` | `@hachej/boring-workspace/server` | Trusted boot-time server plugin: routes, agent tools, system prompt, Pi packages, provisioning. |
| `PaneProps<T>` | `src/shared/types/panel.ts` | Props every panel/left-tab component receives (`params`, `api`, `containerApi`). |
| `UiCommand` / `UiBridge` | `src/shared/ui-bridge.ts` | Typed agent→browser command contract. |
| `SurfaceOpenRequest` | `src/shared/types/surface.ts` | Domain open request resolved to a panel. |
| `BoringPluginAssetManager` | `src/server/agentPlugins` | Scans plugin dirs, hashes signatures, emits load/unload/error events, backs `/api/v1/agent-plugins`. |

## Architectural decisions

- **App shell owns auth/routing/persistence/chat; workspace owns chrome.** Keeps
  the workspace package reusable and the chat component injected, not hardcoded.
- **Front/shared workspace code does not value-import `@hachej/boring-agent`.** The
  dependency is inverted via the injected `chatPanel`, so the workbench builds and
  ships without the agent package. Only `src/app/*` composition may import
  documented agent server APIs.
- **Agents open domain targets through `openSurface`, not `openPanel`.** Surface
  resolvers map requests to panels so workspace chrome never hardcodes plugin
  panel ids or domain rules. Use `openPanel` only when the caller intentionally
  names a concrete panel.
- **Plugin data APIs live under the owning plugin.** There is no shared
  `front/data` compatibility layer; e.g. the filesystem client/hooks/events are
  plugin-owned (`src/plugins/filesystemPlugin/front/data`).
- **Generated runtime plugins stay route-free; server changes are boot-time only.**
  `/reload` refreshes front/Pi resources and tolerates per-plugin failures, but
  does not hot-wire Fastify routes or agent tools. Server-file drift surfaces a
  `requiresRestart` warning.
- **Chat-first boot.** `WorkspaceAgentFront` mounts immediately while readiness
  warms in the background; workbench surfaces are locally gated by warmup state.
- **Style isolation.** Workspace owns public `--boring-*` tokens and Tailwind base
  reset; agent consumes them under `[data-boring-agent]`. See
  [`docs/TAILWIND-V4-STYLE-ISOLATION.md`](../../../docs/TAILWIND-V4-STYLE-ISOLATION.md).

## Host explorer composition

Standalone workspaces can keep using `WorkbenchLeftPane`. Apps that already own a
left explorer/sidebar can instead render the category actions themselves:

```tsx
import { useWorkspaceLeftPaneActions } from "@hachej/boring-workspace"

function HostExplorer() {
  const actions = useWorkspaceLeftPaneActions({ onOpenPanel })

  return actions.map((action) => (
    <button key={action.id} aria-pressed={action.active} onClick={action.select}>
      {action.icon}
      {action.title}
    </button>
  ))
}
```

Use this public hook rather than deep-importing chrome internals. Search UI,
left-tab content hosting, and plugin chrome action portals remain owned by the
default `WorkbenchLeftPane` unless a host explicitly renders that full component.

## Docs

Authoring:
- [`PLUGIN_STRUCTURE.md`](./PLUGIN_STRUCTURE.md) — quick layout guide for
  generated/runtime plugins vs app/internal publishable package plugins.
- [`PLUGIN_SYSTEM.md`](./PLUGIN_SYSTEM.md) — normative spec for the plugin/agent
  layer: manifest fields, front + server authoring API, hot-reload coverage,
  and key algorithms. Code and tests cite it as `Per PLUGIN_SYSTEM.md §X`, so its
  section numbering is stable.

Boundaries / contracts:
- [`INTERFACES.md`](./INTERFACES.md) — package boundaries, core contracts, and
  ownership rules across `src/front`, `src/server`, `src/shared`, `src/plugins`,
  and `src/app`.

History:
- [`plans/archive/`](./plans/archive/) — superseded implementation plans and specs
  kept for historical context. Not normative; current behavior is described in the
  docs above and verified against source.

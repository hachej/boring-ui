# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

boring-ui is a monorepo for building agent-powered products. It provides three primitives — **one chat, panes, a command palette** — wired to a production backend. Apps are built by extending the workspace with plugins that contribute panels, commands, and data.

## Commands

All commands use `pnpm`. Run from the repo root unless stated otherwise.

```bash
pnpm install          # install all workspace deps
pnpm dev              # run all dev servers concurrently
pnpm build            # build all packages
pnpm typecheck        # tsc --noEmit across all packages (sequential)
pnpm lint             # lint (currently runs typecheck per package)
pnpm test             # vitest run across all packages
pnpm lint:invariants  # validate plugin definitions + agent isolation
pnpm ci               # lint + typecheck + test + lint:invariants + e2e
```

**Scoped commands (use these during development):**

```bash
# Run tests for one package
pnpm --filter @boring/workspace run test
pnpm --filter @boring/agent run test

# Run a single test file
pnpm --filter @boring/workspace run test src/shared/plugins/__tests__/bootstrap.test.ts

# Run tests matching a name pattern
pnpm --filter @boring/workspace run test --testNamePattern "bootstrap"

# Watch mode
pnpm --filter @boring/agent run test:watch

# Typecheck one package
pnpm --filter @boring/workspace run typecheck

# Run a specific app dev server
pnpm --filter @boring/macro dev
pnpm --filter full-app dev
```

**Apps require workspace to be built first** (watch out):

```bash
# boring-macro-v2 and full-app tests need workspace built:
pnpm --filter @boring/workspace build && pnpm --filter @boring/macro run test
```

## Monorepo structure

```
packages/
  core/       → DB (Drizzle/Postgres), auth (better-auth), app factory, frontend shell
  workspace/  → Panel registry, plugin system, file tree, editors, dockview layout
  agent/      → Coding agent runtime + tool catalog (bash, read, write, edit, grep…)
  ui/         → Shared shadcn-style UI primitives (@boring/ui)
apps/
  full-app/             → Reference production app; wraps @boring/core
  boring-macro-v2/      → Example domain app with a custom plugin
```

Internal packages use `workspace:*` protocol. Build tool is `tsup` for packages, `vite` for apps.

## Plugin system

Plugins are the primary extension point. A plugin contributes panels, commands, catalogs, left-tabs, and surface resolvers to the workspace shell.

### Minimal plugin

```ts
import { defineFrontPlugin } from "@boring/workspace"

export const myPlugin = defineFrontPlugin({
  id: "my-plugin",
  label: "My Plugin",
  systemPrompt: "You can open widgets with the 'open-widget' tool.",  // injected into agent context
  outputs: [
    {
      type: "panel",
      panel: definePanel({
        id: "my-widget",
        title: "Widget",
        placement: "center",
        // Zero-arg factory → auto-detected as lazy by PanelRegistry
        component: () => import("./WidgetPane").then(m => ({ default: m.WidgetPane })),
      }),
    },
  ],
})
```

### Panel components

Panel components receive `PaneProps<T>` (from `@boring/workspace`):

```ts
import type { PaneProps } from "@boring/workspace"

interface Params { id?: string }

export function WidgetPane({ params, api, containerApi }: PaneProps<Params>) {
  // params — data passed when the panel is opened
  // api    — DockviewPanelApi (close, setTitle, onDidParametersChange, …)
  // containerApi — DockviewApi (addPanel, fromJSON, …)
}
```

### Auto-lazy loading

**Do not set `lazy: true`.** The registry auto-detects it: a zero-arg function `() => import(...)` is treated as a lazy factory; a component `(props) => JSX` is treated as eager. This means plugin panels are automatically code-split and only loaded when first opened.

### Output types

| type | contributes |
|---|---|
| `panel` | a center/right/bottom pane opened programmatically |
| `left-tab` | a persistent tab in the left sidebar |
| `command` | an entry in the command palette |
| `catalog` | a data explorer tab with search + row selection |
| `surface-resolver` | maps a `SurfaceOpenRequest` kind → panel id |
| `binding` | a React component mounted in the provider tree (for context) |
| `provider` | same as binding but receives `apiBaseUrl`, `authHeaders`, etc. |

### Composing plugins

```ts
import { composePlugins } from "@boring/workspace"

export const myPlugin = composePlugins({
  id: "my-plugin",
  plugins: [panelsPlugin, catalogPlugin, surfacePlugin],
})
```

### Registering with the shell

Pass the plugin to `WorkspaceAgentFront` (macro-style app) or `WorkspaceProvider` (custom shell):

```tsx
<WorkspaceAgentFront plugins={[myPlugin]} {...shellOptions} />
```

## Key architectural flows

### How panels render

1. `WorkspaceProvider` creates a `PanelRegistry` and calls `bootstrap()` with all plugins.
2. `bootstrap()` calls `registry.register()` for every panel output.
3. `PanelRegistry.register()` auto-detects lazy vs eager from `component.length`.
4. `DockviewShell` calls `registry.getComponents()` which wraps lazy panels in `React.lazy + Suspense + PluginErrorBoundary`.
5. When dockview opens a panel by id it renders the wrapped component.

### Bridge / UI commands

The workspace has a typed pubsub bus (`events`, `postUiCommand`) for communication between the agent backend and the frontend. Use `events.on(workspaceEvents.xxx, handler)` on the front and `postUiCommand(...)` from the server-side plugin to trigger panel opens, file navigation, etc.

### Surface resolver

A surface resolver maps an agent-emitted `SurfaceOpenRequest` (e.g. `{ kind: "open-series", seriesId: "GDPC1" }`) to a panel open call. Register via `type: "surface-resolver"` output with a `resolve(req) → SurfacePanelResolution | null` function.

## Vite alias convention (boring-macro-v2)

The macro app resolves `@boring/workspace` to source (`packages/workspace/src/index.ts`) for HMR. If you add a new `@boring/workspace/*` subpath import, add it to **both**:
- `apps/boring-macro-v2/vite.config.ts` → `resolve.alias`
- `packages/workspace/package.json` → `exports` map (and rebuild workspace)

## TypeScript

Each package has its own `tsconfig.json`. Workspace package has separate `tsconfig.front.json` and `tsconfig.server.json`. Run `pnpm typecheck` from root to check all. The `moduleResolution: Bundler` setting is used throughout — subpath imports follow `package.json` exports.

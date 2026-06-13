# @hachej/boring-workspace

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-workspace.svg)](https://www.npmjs.com/package/@hachej/boring-workspace)

</div>

The workspace UI, layout, plugin, and bridge layer for boring-ui apps. It gives you
an IDE-style workbench — Dockview panes, a plugin system that contributes panels,
tabs, commands, catalogs, and surface resolvers, and a typed agent-to-browser
bridge. You write the domain logic; the workspace handles the chrome. The app shell
injects the chat component and owns auth, routing, and persistence.

```bash
pnpm add @hachej/boring-workspace
```

## Usage

```tsx
import { WorkspaceProvider, IdeLayout } from "@hachej/boring-workspace"
import { ChatPanel } from "@hachej/boring-agent"

function App() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel} workspaceId="default" plugins={[myPlugin]}>
      <IdeLayout />
    </WorkspaceProvider>
  )
}
```

Add a panel with a plugin:

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"

export const myPlugin = definePlugin({
  id: "my-panel",
  label: "My Panel",
  panels: [
    {
      id: "my-widget",
      label: "Widget",
      placement: "center",
      component: () => import("./WidgetPane").then(m => ({ default: m.WidgetPane })),
    },
  ],
})
```

`WorkspaceProvider` requires `chatPanel` and `workspaceId`; `plugins`, `apiBaseUrl`,
`authHeaders`, and `layoutPreferences` are optional. Lazy panel factories
(`() => import(...)`) are auto-wrapped in `React.lazy + Suspense + ErrorBoundary` —
do not set `lazy: true`.

## Package surfaces

| Import | Environment | What you get |
| --- | --- | --- |
| `@hachej/boring-workspace` | Browser | `WorkspaceProvider`, `IdeLayout`, `ChatLayout`, layout primitives |
| `@hachej/boring-workspace/plugin` | Browser | `definePlugin()` and browser-safe authoring types |
| `@hachej/boring-workspace/server` | Node | `defineServerPlugin()`, server routes, UI tools, Pi helpers |
| `@hachej/boring-workspace/shared` | Any | `PaneProps`, `SurfaceOpenRequest`, `UiCommand`, plugin types |
| `@hachej/boring-workspace/events` | Any | Typed event bus for bridge communication |
| `@hachej/boring-workspace/charts` | Browser | Recharts wrappers |
| `@hachej/boring-workspace/testing` | Browser | Test utilities and mock providers |
| `@hachej/boring-workspace/app/front` | Browser | App composition: `WorkspaceAgentFront` |
| `@hachej/boring-workspace/app/server` | Node | App composition: `createWorkspaceAgentServer` |
| `@hachej/boring-workspace/globals.css` | Browser | Global CSS for the workspace chrome |

## Documentation

See [`docs/README.md`](./docs/README.md) for the architecture overview, key
abstractions, and architectural decisions. From there:

- [`docs/PLUGIN_SYSTEM.md`](./docs/PLUGIN_SYSTEM.md) — normative plugin/agent layer spec.
- [`docs/PLUGIN_STRUCTURE.md`](./docs/PLUGIN_STRUCTURE.md) — plugin layout quick reference.
- [`docs/INTERFACES.md`](./docs/INTERFACES.md) — package boundaries and ownership rules.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

## License

MIT

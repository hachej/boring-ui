# @hachej/boring-workspace

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-workspace.svg)](https://www.npmjs.com/package/@hachej/boring-workspace)

</div>

Plugin system, panel registry, Dockview-based IDE layout, and typed agent-to-browser bridge for boring-ui apps. Everything the user touches — chat, files, catalogs, custom panes — composes here.

```bash
pnpm add @hachej/boring-workspace
```

---

## TL;DR

**The Problem**: Agent apps need more than a chat window. You want file trees, editors, data tables, custom panes, keyboard shortcuts — but wiring all that chrome yourself means fighting layout engines, managing panel lifecycles, and building bridges between backend commands and frontend actions.

**The Solution**: `@hachej/boring-workspace` gives you a complete IDE-style workbench with a plugin system that contributes panes, tabs, commands, catalogs, surface resolvers, and React context. The agent backend talks to the UI through a typed pubsub bus. You write the domain logic; the workspace handles the chrome.

### Why Use @hachej/boring-workspace?

| Feature | What It Does |
|---------|--------------|
| **Plugin system** | Contribute panels, left-tabs, commands, catalogs, surface resolvers, and React bindings through a single manifest |
| **Dockview layout** | Split, resize, drag, and dock panels — VS Code–style behavior out of the box |
| **Auto code-splitting** | Lazy panels (`() => import(...)`) are automatically wrapped in `React.lazy + Suspense + ErrorBoundary` |
| **Typed UI bridge** | Agent calls `exec_ui({ kind: "openFile", params })` → panel opens in the workbench. SSE + HTTP fallback. |
| **Surface resolver** | Map agent-emitted `SurfaceOpenRequest` to panel opens — domain-specific routing without hardcoding panel IDs |
| **Built-in plugins** | File tree, editor, command palette, session management — ready on mount |
| **Composable** | Three levels: full layout (`IdeLayout`), provider + layout primitives, or headless hooks — pick what you need |

---

## Quick Example

```tsx
import { WorkspaceProvider, IdeLayout } from "@hachej/boring-workspace"
import { ChatPanel } from "@hachej/boring-agent"

// Full shell — plug in your chat and plugins
function App() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel} workspaceId="default" plugins={[myPanelPlugin, dataCatalogPlugin]}>
      <IdeLayout />
    </WorkspaceProvider>
  )
}
```

Add a panel in 8 lines:

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"

export const myPanelPlugin = definePlugin({
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

---

## Installation

```bash
# pnpm
pnpm add @hachej/boring-workspace

# npm
npm install @hachej/boring-workspace

# from source
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
pnpm --filter @hachej/boring-workspace build
```

---

## Architecture

### Plugin System

Plugins bootstrap into the workspace through a single `registerPlugin` call. `WorkspaceProvider` creates a `PanelRegistry`, calls `bootstrap()` with all plugins, and the registry auto-wraps lazy components.

```
WorkspaceProvider
  ├── bootstrap(plugins)
  │     ├── registry.register(panel outputs)
  │     ├── registry.register(left-tab outputs)
  │     └── registry.register(command outputs)
  │
  ├── DockviewShell
  │     ├── registry.getComponents() → lazy-wrapped panels
  │     └── DockviewReact (layout chrome)
  │
  ├── UiBridgeClient
  │     ├── SSE command stream
  │     └── HTTP poll fallback
  │
  └── Layout (IdeLayout / ChatLayout / ResponsiveDockviewShell)
```

### UI Bridge

```
Agent Backend                    Frontend
──────────────                   ────────
  POST /api/v1/ui/commands  ──►  UiBridge dispatches
  { kind, params }             │  ├── openFile
                               │  ├── openPanel
                               │  └── showNotification
```

Agent plugins emit `UiCommand` values on the server. The workbench has a typed event bus that dispatches them to the right handler.

```
POST /api/v1/ui/commands
  { kind: "openFile", params: { path: "src/index.ts" } }

↓

UiBridgeClient receives → dispatches to FileTree plugin → expands node + focuses editor
```

### Built-in Plugins

| Plugin | What It Adds |
|--------|-------------|
| Filesystem plugin | File tree (left tab), editor (center panel), file navigation |
| Chat plugin | Integrates the injected `ChatPanel` into the layout |
| Command palette | `⌘K`-driven search across commands, panels, and surfaces |
| Session plugin | Lightweight session toolbar (current session, dropdown, new chat) |

---

## Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-workspace` | Browser | `WorkspaceProvider`, `IdeLayout`, built-in layout primitives |
| `@hachej/boring-workspace/plugin` | Browser | `definePlugin()` and browser-safe plugin authoring types |
| `@hachej/boring-workspace/server` | Node | `defineServerPlugin()`, server routes, UI tools, Pi package helpers |
| `@hachej/boring-workspace/shared` | Any | `PaneProps`, `SurfaceOpenRequest`, `UiCommand`, plugin types |
| `@hachej/boring-workspace/events` | Any | Typed event bus for bridge communication |
| `@hachej/boring-workspace/charts` | Browser | Recharts wrappers for data visualization |
| `@hachej/boring-workspace/testing` | Browser | Test utilities and mock providers |
| `@hachej/boring-workspace/app/front` | Browser | App composition: `WorkspaceAgentFront` |
| `@hachej/boring-workspace/app/server` | Node | App composition: `createWorkspaceAgentServer` |
| `@hachej/boring-workspace/globals.css` | Browser | Global CSS for the workspace chrome |

---

## Plugin Output Types

| Output Type | Contributed Surface | Example |
|-------------|--------------------|---------|
| `panel` | Center/right/bottom pane | Code editor, data table, settings page |
| `left-tab` | Persistent sidebar tab | File tree, data catalog, status panel |
| `command` | Command palette entry | "Toggle dark mode", "Format files" |
| `catalog` | Searchable data explorer | Customer list with faceted filters |
| `surface-resolver` | Maps `exec_ui` → panel | `openFile` → editor panel with path |
| `binding` | React context in provider tree | Theme, auth, workspace-scoped state |
| `provider` | Binding + `apiBaseUrl` injection | Server-side plugin config passed to front |
| `agent-tool` | Static agent tool via server plugin | `deploy`, `test`, `lint` commands |

### Writing a Plugin

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"
import type { PaneProps } from "@hachej/boring-workspace"

export const statusPlugin = definePlugin({
  id: "build-status",
  label: "Build Status",
  leftTabs: [
    {
      id: "build-status-tab",
      title: "Build",
      panelId: "build-status-tab",
      component: () => import("./StatusTab").then(m => ({ default: m.StatusTab })),
    },
  ],
  panels: [
    {
      id: "build-details",
      label: "Build Details",
      placement: "bottom",
      component: () => import("./BuildDetails").then(m => ({ default: m.BuildDetails })),
    },
  ],
})

// Panel components receive PaneProps<T>:
function StatusTab({ params, api, containerApi }: PaneProps<{}>) {
  // params  — data when panel is opened
  // api     — DockviewPanelApi (close, setTitle, …)
  // containerApi — DockviewApi (addPanel, layout, …)
}
```

### Server Plugins

Server plugins are boot-time/static composition. Hot-reloadable `.pi/extensions` agent tools should use Pi extensions instead.

```ts
import { defineServerPlugin } from "@hachej/boring-workspace/server"

export const statusServerPlugin = defineServerPlugin({
  id: "build-status",
  agentTools: [buildTool], // Agent tools
  routes: async (app) => { // Fastify plugin function
    app.register(statusRoutes, { prefix: "/build-status" })
  },
  provisioning: {
    templateDirs: [
      { id: "build-status-seed", path: seedBuildDir, target: "." },
    ],
  },
})
```

---

## Configuration

### WorkspaceProvider Props

```tsx
<WorkspaceProvider
  chatPanel={ChatPanel}                 // Required: React component for chat
  workspaceId={id}                      // Required: workspace identifier
  plugins={[pluginA, pluginB]}          // Optional: extend with custom plugins
  apiBaseUrl="http://localhost:3000"    // Optional: backend URL
  authHeaders={...}                     // Optional: auth for HTTP requests
  layoutPreferences={...}               // Optional: initial Dockview layout JSON
/>
```

---

## How @hachej/boring-workspace Compares

| Feature | @hachej/boring-workspace | VS Code (Theia) | Custom layout |
|---------|--------------------------|-----------------|---------------|
| Panel layout | ✅ Dockview, drag/drop/split | ✅ Tabbed | ⚠️ Build yourself |
| Plugin system | ✅ Panels + tabs + commands + catalogs | ✅ Extension API | ❌ DIY |
| Agent bridge | ✅ Typed UiBridge pubsub | ❌ Not agent-native | ❌ DIY |
| Code splitting | ✅ Auto-detects lazy factories | ⚠️ Require-based | ⚠️ Manual |
| Setup time | ✅ ~10 lines | ❌ Heavy framework | ❌ Weeks |

**When to use @hachej/boring-workspace:**
- Building an agent-powered IDE with customizable panes
- You need plugins to add panels without touching the shell
- You want the agent to open things (files, data, charts) in the workbench

**When it might not fit:**
- You just want a chat box (use `@hachej/boring-agent` standalone)
- You need a full VS Code replacement (no language server protocol support)
- You want to control every pixel of the layout (use Dockview directly)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Panel not found: <id>` | Plugin not registered | Check `plugins` prop on `WorkspaceProvider` |
| Blank panel / white screen | Lazy component threw | Check `PluginErrorBoundary` — inspect console |
| `UiBridge not connected` | Backend not running | Verify `apiBaseUrl` and backend endpoint |
| Commands not arriving | SSE blocked by proxy | Use `?poll=true` on `/api/v1/ui/commands/next` |
| Plugin not loading | Missing `definePlugin` wrapper or `boring.front` manifest entry | Package front plugins must default-export `definePlugin({ ... })` and declare `boring.front` |
| Duplicate panel IDs | Two plugins register same ID | Rename one panel's `id` field |

---

## Limitations

- **Plugin panels share the same registry** — name collisions between plugins cause the last-registered panel to win. Namespace your IDs.
- **No code editor language server** — The editor ships CodeMirror6 with syntax highlighting but no LSP. Semantic features (go-to-definition, rename) are not available.
- **Rich text editor is TipTap-based** — It's included but opt-in via peer dependencies. Not all TipTap extensions are wired up.
- **Frontend code must not value-import `@hachej/boring-agent`** — Package-neutral workspace code stays agent-free. Use the `chatPanel` injection pattern instead.
- **Layout state persistence is the shell's job** — Workspace doesn't save/restore layouts between sessions. The shell owns `layoutPreferences`.

---

## FAQ

**Q: What's the difference between a `panel` and a `left-tab`?**  
A: `panel` opens in the main Dockview area (center/right/bottom). `left-tab` is a persistent sidebar element that stays docked to the left. Users open panels programmatically; left-tabs are always visible.

**Q: How do I lazy-load a panel?**  
A: Pass a zero-arg arrow function `() => import("./Pane").then(m => ({ default: m.Pane }))`. The registry auto-detects this pattern and wraps it in `React.lazy + Suspense`. Don't set `lazy: true`.

**Q: Can the agent open my plugin's panel?**  
A: Yes. Register a `surface-resolver` that maps the agent's `SurfaceOpenRequest` to your panel ID. Then the agent can use `exec_ui` to open it.

**Q: Why can't frontend workspace code import from `@hachej/boring-agent`?**  
A: The workspace package stays package-neutral so it can be used without the agent. The `chatPanel` prop injects the agent's UI, keeping the dependency inverted.

**Q: What's `surface-resolver` for?**  
A: It decouples agent-side "open X" requests from frontend panel IDs. The agent says `{ kind: "open-series", seriesId: "GDPC1" }`, and the surface resolver maps that to `{ panelId: "series-chart", params: { seriesId: "GDPC1" } }`.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT

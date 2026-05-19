# workspace-playground

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

Standalone rich playground for `@hachej/boring-workspace`. Full IDE workbench with panels, plugin system, command palette, and chat — wired to a local agent backend with no auth and no database. Perfect for building and iterating on plugins.

```bash
pnpm --filter workspace-playground dev
```

---

## TL;DR

**The Problem**: You're building a workspace plugin (a new panel, a data catalog, a sidebar tab, a surface resolver) and you need a live workbench to test it in — but booting the full app with Postgres and auth is overkill.

**The Solution**: `workspace-playground` gives you a full IDE workbench (chat, file tree, editor panels, command palette) plus pre-loaded plugins (`ask-user`, `data-catalog`, a demo catalog) — all running from source with HMR. Save a plugin file and the workbench updates.

### Why Use workspace-playground?

| Feature | What It Does |
|---------|--------------|
| **Full workbench out of the box** | Chat, file tree, editor panels, command palette, session toolbar |
| **Plugins from source with HMR** | `ask-user`, `data-catalog`, `data-explorer` all loaded from workspace source |
| **Demo catalog included** | A `playgroundDataCatalog` plugin with DuckDB-backed sample data to explore |
| **E2E test suite** | Playwright tests validate panel lifecycle and plugin contract |
| **Fast iteration** | Dev script rebuilds workspace + plugins before each run — save, see it live |
| **No auth / no DB overhead** | Runs in-memory — no Postgres setup needed |

---

## Quick Example

```bash
# Clone and install
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install

# Start the playground
pnpm --filter workspace-playground dev
```

Open `http://localhost:5200`. You see:
- **File tree** (left sidebar) — browse files in the project root
- **Chat panel** (center) — talk to the agent
- **Editor** (center) — opens files from the tree or chat
- **Command palette** (`⌘K`) — search commands and panels
- **Session toolbar** — current session, new chat, dropdown

---

## What Loads in the Playground

### Built into the Shell

| Surface | Source | What It Adds |
|---------|--------|--------------|
| **Chat** | `@hachej/boring-agent` | `<ChatPanel>` with agent runtime (passed as `chatPanel` prop) |
| **File tree / Editor** | `@hachej/boring-workspace` | Left tab + center panel + search (built into the shell, not user-registered plugins) |
| **Command palette** | `@hachej/boring-workspace` | `⌘K`-driven command search (built into the shell) |

### Registered as Plugins

| Plugin | Package | What It Adds |
|--------|---------|--------------|
| **Ask User** | `@hachej/boring-ask-user` | `ask_user` tool + questions panel (`askUserPlugin`) |
| **Data Catalog** | Local plugin (`src/plugins/`) | Demo catalog with DuckDB-backed sample data (`playgroundDataCatalogPlugin`) |
| **Data Explorer** | `@hachej/boring-data-explorer` | Faceted table component — used by data catalog (transitive dep, not a standalone plugin) |

Registered in `src/front/App.tsx`:
```tsx
<WorkspaceAgentFront
  chatPanel={ChatPanel}
  workspaceId={projectName}
  plugins={[playgroundDataCatalogPlugin, askUserPlugin]}
  // ...
/>
```

### Adding a Plugin to the Playground

1. Create your plugin:

```tsx
// src/plugins/my-plugin/front/index.tsx
import { defineFrontPlugin, definePanel } from "@hachej/boring-workspace"

export const myPlugin = defineFrontPlugin({
  id: "my-plugin",
  label: "My Plugin",
  outputs: [{
    type: "panel",
    panel: definePanel({ id: "my-widget", title: "Widget", placement: "center", component: () => import("./WidgetPane").then(m => ({ default: m.WidgetPane })) }),
  }],
})
```

2. Register it in `src/front/App.tsx` — add to the `plugins` array on `WorkspaceAgentFront`:

```tsx
import { myPlugin } from "../plugins/my-plugin/front"

plugins={[playgroundDataCatalogPlugin, askUserPlugin, myPlugin]}
```

3. For frontend-only plugins: no dev script change needed. If your plugin needs server routes or agent tools, add it to `src/server/dev.ts` plugins or pluginFactories.

---

## What It Looks Like

```
┌─────────────────────────────────────────────────────────────┐
│ workspace-playground                     [⌘K]  [New Chat ▼]│
├──────────┬──────────────────────────────┬───────────────────┤
│ 📁 Files │  📄 src/index.ts  [×]       │  📊 Data Catalog  │
│          │                              │                   │
│ 📂 src   │  function hello() {         │  ┌──────────────┐ │
│  index.ts│    return "world";          │  │ 👥 Customers │ │
│  utils.ts│  }                          │  │ 📄 Invoices   │ │
│          │                              │  │ 📦 Orders    │ │
│ 📂 tests │                              │  └──────────────┘ │
│  test.ts │                              │                   │
│          │  ┌────────────────────────┐  │                   │
│ 👥 Data  │  │ You: explain the code  │  │                   │
│ Catalog  │  │ 🤖 This function...   │  │                   │
│          │  └────────────────────────┘  │                   │
│ ❓ Ask   │                              │                   │
│          │  Ask me something... [Send]  │                   │
└──────────┴──────────────────────────────┴───────────────────┘
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (Vite + HMR)                           │
│                                                  │
│  <WorkspaceAgentFront plugins={[...]}>          │
│    ├── <IdeLayout> (Dockview chrome)             │
│    │   ├── File tree (left tab, built-in)        │
│    │   ├── Editor (center panel, built-in)       │
│    │   ├── ChatPanel (injected via chatPanel)    │
│    │   ├── Command palette (⌘K, built-in)       │
│    │   └── Data Catalog plugin (left tab)        │
│    └── <UiBridgeClient> (SSE + HTTP poll)        │
└───────────────────────┬──────────────────────────┘
                        │ HTTP (local agent)
┌───────────────────────▼──────────────────────────┐
│  In-process Fastify (agent runtime)              │
│                                                  │
│  createWorkspaceAgentServer({                    │
│    workspaceRoot,                                │
│    mode: "local",                                │
│    plugins: [playgroundDataServerPlugin],        │
│    pluginFactories: [createAskUserServerPlugin], │
│  })                                              │
│                                                  │
│  ├── Harness (pi-coding-agent)                   │
│  ├── Tools (bash, read, write, edit, find…)      │
│  ├── SessionStore (in-memory)                    │
│  └── UiBridge (in-memory + SSE fan-out)          │
└──────────┬───────────────────────────────────────┘
           │ fs ops + exec
┌──────────▼───────────────────────────────────────┐
│  Project filesystem                              │
│  (default: apps/workspace-playground/workspace)  │
│  (seeded from src/fixtures/)                     │
└──────────────────────────────────────────────────┘
```

---

## Installation

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 8

### From Source

```bash
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
```

---

## Quick Start

### 1. Run

```bash
pnpm --filter workspace-playground dev
```

Opens at `http://localhost:5200`.

### 2. The Dev Script

The `dev` command rebuilds all workspace-source packages before starting Vite:

```bash
pnpm --filter @hachej/boring-agent build
pnpm --filter @hachej/boring-workspace build
pnpm --filter @hachej/boring-ask-user build
pnpm --filter @hachej/boring-data-catalog build
vite
```

For HMR on source changes (no rebuild needed):

```bash
pnpm --filter workspace-playground dev:local
```

This sets `BORING_USE_LOCAL_PACKAGES=1`, which resolves workspace + agent + plugin imports directly from source.

---

## E2E Testing

```bash
pnpm --filter workspace-playground test:e2e
```

Playwright test suite covering:

| Spec File | What It Tests |
|-----------|---------------|
| `cmd-palette.spec.ts` | Command palette open/close/search behavior |
| `cmd-palette-click.spec.ts` | Click-to-execute commands from the palette |
| `cmd-effects.spec.ts` | UI bridge command effects (openFile, openPanel, etc.) |
| `no-auth-deps.spec.ts` | Workspace loads without auth or database dependencies |
| `resize-persistence.spec.ts` | Layout resize state persists across reloads |
| `visual.spec.ts` | Visual regression — no unexpected UI breakage |

Use this as a sanity check after making changes to panel registry or plugin invariant lints.

---

## What It Does NOT Include

| Feature | Status | Where to Find It |
|---------|--------|------------------|
| Auth / login | ❌ No | `apps/full-app` |
| Postgres / DB | ❌ No | `apps/full-app` |
| Multi-tenant workspaces | ❌ No | `apps/full-app` |
| Email verification / invites | ❌ No | `apps/full-app` |
| Session persistence | ⚠️ In-memory | `apps/full-app` (JSONL + DB) |

---

## How workspace-playground Compares

| Feature | workspace-playground | full-app | agent-playground |
|---------|---------------------|----------|-----------------|
| Workbench shell | ✅ Full IDE | ✅ Full IDE | ❌ Chat only |
| Plugin system | ✅ With HMR | ✅ Production | ❌ None |
| File tree/editor | ✅ Yes | ✅ Yes | ❌ No |
| Data catalog | ✅ Demo included | ✅ Configurable | ❌ No |
| Auth/workspaces | ❌ None | ✅ Multi-user | ❌ None |
| Plugin HMR | ✅ Source alias | ❌ Package imports | ❌ N/A |
| E2E tests | ✅ Playwright suite | ✅ Smoke tests | ❌ None |
| Best for | Plugin dev + workspace chrome | Production deploy | Agent runtime only |

**When to use workspace-playground:**
- You're building a workspace plugin (panel, tab, command, catalog)
- You need to test the panel registry, Dockview layout, or UI bridge
- You want to iterate on workspace chrome with HMR
- You need E2E validation of plugin contracts

**When it might not fit:**
- You only need the agent chat (use `agent-playground`)
- You need multi-user auth and Postgres (use `full-app`)
- You want a one-command demo (use `npx @hachej/boring-ui-cli`)

---

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm --filter workspace-playground dev` | Build all deps + start Vite server |
| `pnpm --filter workspace-playground dev:local` | Same with `BORING_USE_LOCAL_PACKAGES=1` for HMR |
| `pnpm --filter workspace-playground build` | Build all workspace packages + Vite production build |
| `pnpm --filter workspace-playground test:e2e` | Run Playwright test suite |
| `pnpm --filter workspace-playground typecheck` | TypeScript check across all workspace deps |

---

## Demo Data Catalog

The playground ships with a `playgroundDataCatalogPlugin` (`src/plugins/playgroundDataCatalog/`) that demonstrates the full data catalog contract:

- **Sample tables**: `customers`, `orders`, `products` — backed by DuckDB fixtures
- **Server adapter**: Implements `ExplorerDataSource` with DuckDB SQL queries
- **Front panel**: Shows the catalog as a left tab with clickable sources
- **Surface resolver**: Agent can open specific rows via `exec_ui`

This is the canonical example for how a data plugin integrates: server-side data access, front-side catalog tab, and agent-driven row opening.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BORING_USE_LOCAL_PACKAGES` | `0` | Set `1` to resolve workspace packages from source for HMR (or use `dev:local`) |
| `BORING_AGENT_WORKSPACE_ROOT` | `apps/workspace-playground/workspace` (seeded from fixtures) | Directory the agent sees as its filesystem |
| `ANTHROPIC_API_KEY` | (unset) | API key for agent. If absent, agent will fail on first message |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `workspace package not built` | Need initial build | Run `pnpm --filter @hachej/boring-workspace build` first, or use `dev` script |
| Panel renders blank | Lazy panel threw | Check `PluginErrorBoundary` — look in browser console for stack trace |
| HMR not updating | Source alias not active | Use `dev:local` (sets `BORING_USE_LOCAL_PACKAGES=1`) |
| Catalog tab missing | Data catalog plugin not loaded | Check `plugins` array in `src/front/App.tsx` |
| Agent returns errors | API key not set | Set `ANTHROPIC_API_KEY` in `.env` or env |
| E2E tests fail | App not built | Run `pnpm --filter workspace-playground build` before `test:e2e` |

---

## Limitations

- **No persistence**: Sessions and workspace state are in-memory. Reset on restart.
- **No auth**: No user accounts, sign-in, or multi-tenant isolation.
- **Local dev only**: The playground is not designed for deployment. Use `apps/full-app` for production.
- **Single agent instance**: Only one workspace, one agent. No multi-workspace switching.
- **Demo data is static**: The playground catalog uses bundled DuckDB fixtures. For live data, connect your own adapter.

---

## FAQ

**Q: Why does the dev script rebuild so many packages?**  
A: The playground depends on workspace-source packages. The dev script ensures all of them are compiled before Vite starts, so your workspace + agent + plugin changes propagate without manual rebuilds.

**Q: What does `dev:local` do differently?**  
A: It sets `BORING_USE_LOCAL_PACKAGES=1`, which gates Vite aliases to resolve `@hachej/boring-workspace/*` and `@hachej/boring-agent/*` imports directly from source. This enables HMR — edit a file, save, the browser updates without a full rebuild.

**Q: Can I use this with a real database?**  
A: The playground is designed for in-memory dev. For database-backed testing, use `apps/full-app` with its Postgres integration.

**Q: How do I test a new plugin against the playground?**  
A: Create your plugin files, import them in `src/front/App.tsx` (and `src/server/dev.ts` if server-side), add to the `plugins` array, and run `pnpm --filter workspace-playground dev:local` for instant HMR.

**Q: What's the difference between the demo catalog and `@hachej/boring-data-catalog`?**  
A: The demo (`playgroundDataCatalogPlugin`) is a local plugin that wires up sample DuckDB fixtures. It shows how to implement the catalog data adapter. Use `@hachej/boring-data-catalog`'s `createDataCatalogPlugin()` factory for production catalogs.

**Q: Where do E2E test files live?**  
A: `apps/workspace-playground/e2e/` with spec files for command palette, UI bridge effects, layout persistence, and visual baseline.

---

## See Also

- [`apps/full-app`](../full-app/README.md) — full production reference app
- [`apps/agent-playground`](../agent-playground/README.md) — agent runtime only
- [`packages/workspace/README.md`](../../packages/workspace/README.md) — workspace package documentation
- [`plugins/data-catalog/README.md`](../../plugins/data-catalog/README.md) — data catalog plugin documentation
- [`plugins/data-explorer/README.md`](../../plugins/data-explorer/README.md) — data explorer primitive

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT

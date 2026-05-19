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
| **E2E test suite** | Playwright tests validate panel lifecycle and plugin contracts |
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

Open `http://localhost:5173`. You see:
- **File tree** (left sidebar) — browse files in the project root
- **Chat panel** (center) — talk to the agent
- **Editor** (center) — opens files from the tree or chat
- **Command palette** (`⌘K`) — search commands and panels
- **Session toolbar** — current session, new chat, dropdown

---

## What Loads in the Playground

| Plugin | Package | What It Adds |
|--------|---------|--------------|
| **Chat** | `@hachej/boring-agent` | `<ChatPanel>` with agent runtime |
| **Filesystem** | `@hachej/boring-workspace` | File tree (left tab) + editor (center panel) + search |
| **Command palette** | `@hachej/boring-workspace` | `⌘K`-driven command search |
| **Ask User** | `@hachej/boring-ask-user` | `ask_user` tool + panel for agent questions |
| **Data Catalog** | `@hachej/boring-data-catalog` | Sidebar tab with sample data sources |
| **Data Explorer** | `@hachej/boring-data-explorer` | Faceted table component (used by catalog) |
| **Playground Data Catalog** | Local plugin (`src/plugins/`) | Demo catalog with DuckDB fixtures and sample queries |

### Adding a Plugin to the Playground

Register it in `src/plugins.ts` and add your plugin's build to the dev script in `package.json`:

```ts
// src/plugins.ts
import { myPlugin } from "./plugins/my-plugin/front"

export const plugins = [
  filesystemPlugin,
  chatPlugin,
  askUserPlugin,
  dataCatalogPlugin,
  myPlugin,  // ← add here
]
```

```json
// package.json — add to dev script
"dev": "pnpm --filter @hachej/boring-ask-user build && pnpm --filter my-plugin build && vite"
```

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

## Installation

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 8
- **Bun** (for DuckDB fixtures in demo catalog)

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

Opens at `http://localhost:5173` (Vite default).

### 2. The Dev Script

The `dev` command rebuilds all workspace-source packages before starting Vite:

```bash
pnpm --filter @hachej/boring-agent build
pnpm --filter @hachej/boring-workspace build
pnpm --filter @hachej/boring-ask-user build
pnpm --filter @hachej/boring-data-catalog build
vite
```

This ensures source changes propagate to the running app without manual rebuilds. Edit a plugin, save, and the workbench updates.

### 3. Source Alias (HMR)

Set `BORING_USE_LOCAL_PACKAGES=1` for direct source imports with Vite HMR:

```bash
BORING_USE_LOCAL_PACKAGES=1 pnpm --filter workspace-playground dev
```

This gates the Vite alias to resolve `@hachej/boring-workspace/*` and plugin imports directly from source, giving you instant hot reload — no rebuild needed for most changes.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (Vite + HMR)                           │
│                                                  │
│  <WorkspaceProvider plugins={[...]} chatPanel={ChatPanel}>
│    ├── <IdeLayout> (Dockview chrome)              │
│    │   ├── FileTree plugin (left tab)             │
│    │   ├── Editor plugin (center panel)           │
│    │   ├── ChatPanel (injected)                   │
│    │   ├── Command palette (⌘K)                   │
│    │   └── Data Catalog plugin (left tab)         │
│    └── <UiBridgeClient> (SSE + HTTP poll)   │
└───────────────────────┬──────────────────────────┘
                        │ HTTP (local agent)
┌───────────────────────▼──────────────────────────┐
│  In-process Fastify (agent runtime)              │
│                                                  │
│  @hachej/boring-agent (direct mode)              │
│  ├── Harness (pi-coding-agent)                   │
│  ├── Tools (bash, read, write, edit, find…)      │
│  ├── SessionStore (in-memory)                    │
│  └── UiBridge (in-memory + SSE fan-out)          │
└──────────┬───────────────────────────────────────┘
           │ fs ops + exec
┌──────────▼───────────────────────────────────────┐
│  Project filesystem (workspace root = repo)      │
└──────────────────────────────────────────────────┘
```

---

## E2E Testing

```bash
pnpm --filter workspace-playground test:e2e
```

Playwright test suite that validates:
- Panel lifecycle (open, close, resize)
- Plugin contract (panels render from registry)
- UI bridge commands (agent → frontend dispatch)
- Ask-user plugin panel flow
- Data catalog plugin surface resolution

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
| `pnpm --filter workspace-playground dev` | Start dev server with auto-rebuild |
| `pnpm --filter workspace-playground dev:local` | Same with `BORING_USE_LOCAL_PACKAGES=1` for HMR |
| `pnpm --filter workspace-playground build` | Build all workspace packages + Vite build |
| `pnpm --filter workspace-playground test:e2e` | Run Playwright test suite |
| `pnpm --filter workspace-playground typecheck` | TypeScript check across all workspace deps |

---

## Demo Data Catalog

The playground ships with a `playgroundDataCatalog` plugin (`src/plugins/playgroundDataCatalog/`) that demonstrates the full data catalog contract:

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
| `BORING_USE_LOCAL_PACKAGES` | `0` | Set `1` to resolve workspace packages from source for HMR |
| `BORING_AGENT_WORKSPACE_ROOT` | Repo root | Directory the agent sees as its filesystem |
| `ANTHROPIC_API_KEY` | (unset) | API key for agent. If absent, agent will fail on first message |

### Adding Custom Plugins

Each new plugin needs two files:

```
src/plugins/my-plugin/
├── front/index.tsx    # Front plugin: defineFrontPlugin({ ... })
└── server/index.ts    # Server plugin: defineServerPlugin({ ... })  (optional)
```

Then register in `src/plugins.ts` and add the build step to the dev script.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `workspace package not built` | Need initial build | Run `pnpm --filter @hachej/boring-workspace build` first, or use `dev` script |
| Panel renders blank | Lazy panel threw | Check `PluginErrorBoundary` — look in browser console for stack trace |
| HMR not updating | Source alias not active | Set `BORING_USE_LOCAL_PACKAGES=1` in dev command |
| Catalog tab missing | Data catalog plugin not loaded | Check `src/plugins.ts` includes `dataCatalogPlugin` |
| Agent returns errors | API key not set | Set `ANTHROPIC_API_KEY` in `.env` or env |
| E2e tests fail | App not built | Run `pnpm --filter workspace-playground build` before `test:e2e` |

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

**Q: What does `BORING_USE_LOCAL_PACKAGES=1` do?**  
A: It gates Vite aliases to resolve `@hachej/boring-workspace/*` imports directly from source. This enables HMR for workspace changes — edit a file, save, the browser updates without a full rebuild.

**Q: Can I use this with a real database?**  
A: The playground is designed for in-memory dev. For database-backed testing, use `apps/full-app` with its Postgres integration.

**Q: How do I test a new plugin against the playground?**  
A: Create your plugin files under `src/plugins/my-plugin/`, register in `src/plugins.ts`, add the build step to the dev script, and run `pnpm --filter workspace-playground dev`.

**Q: What's the difference between the demo catalog and `@hachej/boring-data-catalog`?**  
A: The playground has both: `@hachej/boring-data-catalog` (the package) plus `playgroundDataCatalog` (a local demo plugin that wires up sample DuckDB fixtures). The demo shows how to implement the catalog data adapter.

**Q: Where do E2E test files live?**  
A: `apps/workspace-playground/e2e/`. Run them with `pnpm --filter workspace-playground test:e2e`.

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

# Package map

This page answers a common contributor question: **where should this code live?**

## Full inventory

The monorepo has three layers: foundation packages, supporting packages/CLIs, and consumers (plugins + apps).

### Foundation packages (`packages/*`)

| Package | Role |
|---|---|
| `@hachej/boring-core` | DB, auth, config, HTTP app factory, frontend app shell |
| `@hachej/boring-agent` | Pane-embeddable coding agent; `direct`/`local`/`vercel-sandbox` execution modes |
| `@hachej/boring-workspace` | Workspace UI, plugin system, and UI bridge |

### Supporting packages (`packages/*`)

| Package | Role |
|---|---|
| `@hachej/boring-ui-kit` | Shared shadcn-style UI primitives consumed by the other packages and generated panes |
| `@hachej/boring-pi` | Pi skills and agent-facing references for boring-ui |
| `@hachej/boring-ui-cli` | Zero-config local boring-ui hub/launcher for a real folder or a workspaces registry |
| `@hachej/boring-ui-plugin-cli` | Slim plugin-authoring CLI for workspace runtimes |

### First-party workspace plugins (`plugins/*`)

| Plugin | Role |
|---|---|
| `@hachej/boring-ask-user` | Surfaces agent questions to the user and streams answers back |
| `@hachej/boring-data-catalog` | Plugin *builder* for data catalogs (`createDataCatalogPlugin(options)`) |
| `@hachej/boring-data-explorer` | Data explorer primitive and shared explorer contracts |
| `@hachej/boring-deck` | Front-only markdown deck plugin scaffold |
| `ccusage-dashboard`, `github-pr-tracker` | Signature-stub plugin slots (no published package yet) |

### Example apps (`apps/*`)

| App | Role |
|---|---|
| `agent-playground` | Standalone playground for `@hachej/boring-agent` |
| `workspace-playground` | Workspace UI playground (used for proof-of-work validation) |
| `full-app` | Full composed app shell (core + agent + workspace) |

The rest of this page covers where new code belongs across the three foundation packages.

## `@hachej/boring-core`

Put code here when it involves:

- users
- sessions tied to auth
- workspace membership and invites
- database schema or migrations
- config loading / validation
- Fastify app bootstrap for the app shell
- frontend app-wide providers such as auth/config/theme shell
- capabilities aggregation

Examples:
- `createCoreApp()`
- `loadConfig()`
- workspace CRUD
- invite acceptance
- current-user APIs

## `@hachej/boring-agent`

Put code here when it involves:

- LLM conversation loop
- tool registration or execution
- harness, catalog, workspace/sandbox runtime interfaces
- chat streaming
- agent session handling
- standalone agent app / CLI behavior
- execution mode adapters
- agent-side file, shell, or tool HTTP surfaces

Examples:
- `ChatPanel`
- front session/chat hooks from `@hachej/boring-agent`
- `createAgentApp()`
- `registerAgentRoutes()`
- `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`

## `@hachej/boring-workspace`

Put code here when it involves:

- layouts
- Dockview shell behavior
- panel registry
- plugin output contracts
- command palette entries
- catalog and surface resolver behavior
- UI bridge client behavior
- plugin-owned frontend/server/shared code

Examples:
- `WorkspaceProvider`
- `IdeLayout`
- plugin `panel`, `left-tab`, `command`, `catalog`, `surface-resolver`

## Smell checks

### If it needs the database
It probably belongs in core.

### If it must run in standalone agent mode
It probably belongs in agent.

### If it is about opening panels, tabs, or workspace surfaces
It probably belongs in workspace.

### If shared workspace code wants to import agent internals
Stop and check the invariant. Base workspace front/shared code should stay agent-neutral.

## Cross-package composition

Typical app-shell composition looks like:

1. core boots the real app shell (`createCoreWorkspaceAgentServer` / `CoreWorkspaceAgentFront` in the common case)
2. agent contributes runtime, tools, sessions, and chat UI
3. workspace contributes layout, plugin registries, and the UI bridge
4. app-specific plugins and routes compose on top

See also:
- [Architecture overview](./overview.md)
- [Design FAQ](../reference/design-faq.md)
- [Troubleshooting map](../reference/troubleshooting.md)
- [Composition guide](../guides/composition.md)

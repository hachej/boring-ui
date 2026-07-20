# boring-ui v2 — Documentation Index

Start here. This file explains the global project structure and points to the
docs of each package, plugin, and app. Depth lives next to the code it
describes: every substantial package has its own `docs/README.md` covering its
architecture, abstractions, and decisions. Read this file first, then descend
only into the package you're working on.

Agent hard rules and routing live in [`AGENTS.md`](../AGENTS.md) (imported by
`CLAUDE.md`). Agent workflow, coding process, review history, and proof
procedures live in [`kanzen/`](kanzen/).

## What this is

A pnpm monorepo of publishable packages for building agent-powered workspace
apps. Three foundation packages, composed by an app shell:

```
  apps/*  →  @hachej/boring-workspace  →  @hachej/boring-core
    │              ↑
    └──────→  @hachej/boring-agent  (standalone OK — zero core imports at runtime)
```

`@hachej/boring-core` owns persistence and identity. `@hachej/boring-agent` and
`@hachej/boring-workspace` stay DB-free; core injects stores. The agent can boot
standalone (`createAgentApp`) with zero core dependency.

## Packages

| Package | What it is | Docs |
| --- | --- | --- |
| `@hachej/boring-core` (`packages/core`) | Foundation every child app imports first: Postgres/Drizzle schema (users, workspaces, members, invites, settings), better-auth, TOML+env config, Fastify app factory, React shell with auth/workspace gating. Real apps compose via `createCoreWorkspaceAgentServer` + `CoreWorkspaceAgentFront`. Multi-workspace; plugins resolve statically (no hot reload — use the standalone workspace server for HMR). | [packages/core/docs/README.md](../packages/core/docs/README.md) |
| `@hachej/boring-agent` (`packages/agent`) | Pane-embeddable coding agent: LLM agent loop (built on `pi-coding-agent`), tool catalog, chat UI, with three swappable execution backends — `direct` (host), `local` (bwrap), `vercel-sandbox` (microVM) — selected at construction. Consumed standalone via `createAgentApp` + `ChatPanel`, or mounted into the workspace. Four entry points: top-level/`/front`, `/server`, `/shared`, `/eval`. | [packages/agent/docs/README.md](../packages/agent/docs/README.md) |
| `@hachej/boring-workspace` (`packages/workspace`) | Workspace UI, layout, plugin, and bridge layer: Dockview IDE workbench mounted by `WorkspaceProvider`; plugins (`definePlugin` front / `defineServerPlugin` server) contribute panels, left-tabs, commands, catalogs, surface resolvers; agents drive the UI through a typed `UiCommand` bridge (SSE + HTTP-poll). Two plugin tiers: boot-time package plugins and hot-reloadable `.pi/extensions` runtime plugins. | [packages/workspace/docs/README.md](../packages/workspace/docs/README.md) |
| `@hachej/boring-ui-kit` (`packages/ui`) | Shared shadcn-style primitive library (~50 typed React components on Radix + CVA) for IDE-style panels. No global CSS — styled via `--boring-*` CSS custom properties. | [packages/ui/README.md](../packages/ui/README.md) |
| `@hachej/boring-pi` (`packages/pi`) | Code-free Markdown package of agent-facing knowledge: the `boring-plugin-authoring` Pi skill plus `references/workspace/{plugins,panels,bridge}.md` deep-dives that runtime agents read to author plugins. | [packages/pi/README.md](../packages/pi/README.md) |
| `@hachej/boring-ui-cli` (`packages/cli`, bin `boring-ui`) | Zero-config local entry point and hub: Fastify server serving the prebuilt SPA + agent/workspace API against a real folder, no DB. Folder mode (`boring-ui [folder]`) or workspaces mode (`boring-ui workspaces`, YAML registry at `~/.boring-ui/workspaces.yaml`). Plugin discovery from Pi-shaped roots. | [packages/cli/docs/README.md](../packages/cli/docs/README.md) |
| `@hachej/boring-ui-plugin-cli` (`packages/plugin-cli`, bin `boring-ui-plugin`) | Plugin authoring CLI/library: `create` (npm-package plugin from template) and `scaffold` (hot-reloadable runtime plugin), plus `verify`/`test`/`install`/`list`/`remove`. Exports manifest validation + source resolution consumed by the host CLI. | [packages/plugin-cli/README.md](../packages/plugin-cli/README.md) |

## Plugins (`plugins/`)

| Plugin | One-liner | Docs |
| --- | --- | --- |
| `ask-user` | `ask_user` agent tool + Questions pane: typed, validated form question that blocks until the user submits or cancels. | [README](../plugins/ask-user/README.md) |
| `data-catalog` | Builder (`createDataCatalogPlugin`) binding an adapter into a left tab + visualization panel + catalog + surface resolver, plus a `query_data_catalog` agent tool. | [README](../plugins/data-catalog/README.md) |
| `data-explorer` | Headless searchable/faceted table primitive (`<DataExplorer>` + `ExplorerDataSource` contract) that data-catalog builds on. | [README](../plugins/data-explorer/README.md) |
| `deck` | Front-only markdown slide-deck plugin: read/edit/present modes, `workspace.open.path` resolver, app-owned widget injection, bundled `deck-authoring` Pi skill. | [README](../plugins/deck/README.md) |
| `diagram` | Diagram plugin: opens `.excalidraw` / `.excalidraw.png`, edits natively, renders images, and autosaves JSON with conflict detection. | [README](../plugins/diagram/README.md) |

## Apps (`apps/`)

| App | One-liner | Docs |
| --- | --- | --- |
| `agent-playground` | Minimal chat-only playground for the agent package: in-process Fastify agent (`createAgentApp`, mode `direct`) behind Vite with agent-front source HMR. | [README](../apps/agent-playground/README.md) |
| `workspace-playground` | Full IDE workbench playground for plugin development: Vite front proxying to an in-process `createWorkspaceAgentServer`, fixture-seeded workspace, demo plugins, Playwright e2e + agent evals. | [README](../apps/workspace-playground/README.md) |
| `full-app` | Production reference composing core + agent + workspace: better-auth, Postgres workspaces with roles/invites, Fly.io/Docker deployment with smoke tests. | [README](../apps/full-app/README.md) |

## Repository tools

| Tool | What it is | Docs |
| --- | --- | --- |
| `@hachej/boring-ui-review-tools` (`tools/ui-review`) | Private scenario-driven UI review engine. Registered behavior specs target local apps; component specs use tool-owned fixture hosts. Deterministic gates remain authoritative and visual criticism advisory. | [README](../tools/ui-review/README.md) |

## Cross-cutting docs (this folder)

- [`DECISIONS.md`](DECISIONS.md) — locked architectural decisions registry for the agent runtime (what/why/rationale/re-evaluate-when). Changing a locked decision requires updating this doc.
- [`WORKSPACE_CONTRACT.md`](WORKSPACE_CONTRACT.md) — the agent ↔ workspace integration contract: HTTP routes, component exports, UiBridge/UiCommand semantics, import boundaries.
- [`TAILWIND-V4-STYLE-ISOLATION.md`](TAILWIND-V4-STYLE-ISOLATION.md) — how packages share Tailwind v4 tokens: workspace owns `--boring-*` `:root` tokens; agent inherits them scoped to `[data-boring-agent]` (test-enforced).
- [`PERFORMANCE.md`](PERFORMANCE.md) — historical Vercel-sandbox vs local FS latency benchmarks (harness removed; kept for reference).
- [`FIXES.md`](FIXES.md) — production/runtime fix ledger for recurring incidents and deploy bugs.
- [`kanzen/`](kanzen/) — agent workflow, maintainer loop, coding practices,
  review history, procedures, proof gates, owner decisions, and budgeted
  autonomy.
- [`web/`](web/README.md) — human-oriented guide: architecture overview, full package map, getting started, composition guide, design FAQ, troubleshooting map, per-package explainers, glossary. Orientation, not normative spec — canonical specs live in `packages/*/docs/`.

## Normative specs (code cites these)

- [`packages/workspace/docs/PLUGIN_SYSTEM.md`](../packages/workspace/docs/PLUGIN_SYSTEM.md) — the plugin/agent-layer spec; source cites it as `Per PLUGIN_SYSTEM.md §X`. Keep section numbering stable.
- [`packages/workspace/docs/PLUGIN_STRUCTURE.md`](../packages/workspace/docs/PLUGIN_STRUCTURE.md) — canonical layout + code patterns for new plugins.

## Historical plans

Implementation plans, specs, and todo docs are archived — context only, never
current truth: [`docs/plans/archive/`](plans/archive/) at the root, and
`packages/{agent,cli,core,workspace}/docs/plans/archive/`,
`apps/full-app/docs/plans/archive/` per package.

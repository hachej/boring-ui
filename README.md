# Boring UI

![Boring UI — bring your agent skills, get a UI](docs/assets/readme/hero.png)

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

Boring UI is an opinionated framework for building agent-centric apps, built on [Pi](https://pi.dev).

Traditional SaaS is built around workflows users drive by hand: buttons, forms, pages, dashboards.

Agents change that.

When software can understand intent and act, every app collapses to two surfaces:

- **Chat** — tell the agent what to do.
- **Workbench** — inspect, steer, and refine the results.

That's what the Boring UI core provides: a shell the agent can control and reshape.

---

## Table of Contents

- [Give it a try](#give-it-a-try)
- [Make it yours](#make-it-yours)
- [Built with boring-ui](#built-with-boring-ui)
- [Repo map](#repo-map)
- [Architecture](#architecture)
- [Working in the repo](#working-in-the-repo)

## Give it a try

```bash
npx @hachej/boring-ui-cli
```

Starts a full agent workspace pointed at the current directory — chat, file tree, panels, command palette. No clone. No database. No setup.

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` before running (see [Pi providers](https://pi.dev/docs/latest/quickstart#configure-a-provider) for LLM setup).

[https://github.com/user-attachments/assets/c41c9020-fdf8-4031-927a-e432b99ed098](https://github.com/user-attachments/assets/c41c9020-fdf8-4031-927a-e432b99ed098)

A real session: ask the agent for a summary → it opens the README in the workbench → ask it to take notes → a new `notes.md` appears in the tree → search for it via the command palette. Chat in, workbench out.

## Make it yours

Of course every app, every workflow, every use case is different.

Different data. Different visualisations. Different agent skills.

That's why we created a plugin system.

Boring builds on Pi's plugin system for agent customization (prompt, skills, tools) and extends it with UI-aware surfaces.

Pi handles the agent loop (tool calling, sessions, skills, prompts). 

Boring adds the workbench, panels, and commands on top. 

The two halves are fully compatible — any Pi package works out of the box.

In practice, a plugin is a Node package with two manifest blocks:

- `pi.*` — agent side: skills, prompts, tools (loaded by [Pi](https://pi.dev))
- `boring.*` — UI side: panels, commands, catalogs, surface resolvers

Plugins compose at the app shell: register multiple packages/plugins side by side, or publish a package that wraps shared primitives. Swap a single surface, or add a brand-new pane type. Plugins ship through npm like any other dependency — no patching, no monorepo entanglement required.

For generated/runtime plugins, use `boring-ui scaffold-plugin <name>` from the workspace-local CLI. For app/internal publishable package plugins, use [plugins/_template-full](plugins/_template-full/README.md) as a reference example. The exact manifest shape is in [Plugin shape](#plugin-shape) below.

---

## Built with boring-ui

![MacroAnalyst — AI macro research, accelerated](docs/assets/readme/showcase-macro.png)

**[MacroAnalyst](https://boring-macro.fly.dev/)** — an AI analyst for macroeconomic research. Ask in plain English, get charts back in under a minute. 800,000+ economic series from FRED, BLS, BEA, and Treasury, all behind one chat and one workbench.

Production, paying customers, single codebase. Built on `@hachej/boring-core` + `@hachej/boring-agent` + `@hachej/boring-workspace` + custom domain plugins.

More on the same chassis in flight: `boring-accountant`, `boring-design`, `boring-lawyer`.

---

## Repo map

### Packages


| Package                    | Role                             | README                                             |
| -------------------------- | -------------------------------- | -------------------------------------------------- |
| `@hachej/boring-agent`     | Agent runtime, tools, chat UI    | [packages/agent](packages/agent/README.md)         |
| `@hachej/boring-workspace` | Workbench, panels, plugin system | [packages/workspace](packages/workspace/README.md) |
| `@hachej/boring-core`      | Auth, DB, app factory            | [packages/core](packages/core/README.md)           |
| `@hachej/boring-ui-kit`    | Shared UI primitives             | [packages/ui](packages/ui/README.md)               |
| `@hachej/boring-ui-cli`    | Zero-setup local entrypoint      | [packages/cli](packages/cli/README.md)             |


### Plugins


| Plugin                         | What it adds                                                              | README                                                   |
| ------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `@hachej/boring-ask-user`      | Agent-to-user question/answer surface and `ask_user` tool                 | [plugins/ask-user](plugins/ask-user/README.md)           |
| `@hachej/boring-data-explorer` | Searchable, faceted data tables — the primitive for explorer-style panels | [plugins/data-explorer](plugins/data-explorer/README.md) |
| `@hachej/boring-data-catalog`  | Configurable catalog tab built on `data-explorer`                         | [plugins/data-catalog](plugins/data-catalog/README.md)   |
| App/internal plugin example    | Publishable package-plugin reference; generated plugins use `boring-ui scaffold-plugin` | [plugins/_template-full](plugins/_template-full/README.md)         |


### Reference apps


| App                         | Purpose                                                | README                                                           |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `apps/full-app`             | Production-shaped reference: auth, DB, multi-workspace | [apps/full-app](apps/full-app/README.md)                         |
| `apps/agent-playground`     | `@hachej/boring-agent` alone — no workbench, no DB     | [apps/agent-playground](apps/agent-playground/README.md)         |
| `apps/workspace-playground` | `@hachej/boring-workspace` + plugins — no auth backend | [apps/workspace-playground](apps/workspace-playground/README.md) |


---

## Plugin shape

Plugins are standard Node packages. `package.json#pi` describes hot-reloadable
agent resources, while `package.json#boring` describes workspace UI/static app
integration:

```json
{
  "name": "my-plugin",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["agent/index.ts"],
    "skills": ["agent/skills"],
    "prompts": ["agent/prompts"],
    "systemPrompt": "Short agent guidance."
  },
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts"
  }
}
```

- `pi.*` — hot-reloadable agent resources loaded by Pi (`extensions`, `skills`, `prompts`, `systemPrompt`)
- `boring.front` — workbench UI from `definePlugin({ ... })`: panels, commands, catalogs, surface resolvers, providers, bindings
- `boring.server` — explicit static/boot-time server integration from `defineServerPlugin({ ... })`: agent tools that need backend state and HTTP routes. Restart the workspace server after changes.

Start from [plugins/_template-full](plugins/_template-full/README.md) for publishable packages, or `boring-ui scaffold-plugin <name>` for a front/Pi hot-reloadable local plugin.

### Current hot-reload compatibility

| Plugin surface | Local `.pi/extensions` / CLI | App/internal package plugins | Notes |
|---|---:|---:|---|
| `pi.systemPrompt`, `pi.skills`, `pi.prompts`, `pi.extensions` | hot-reload via `/reload` | hot-reload when discovered as plugin package resources | Agent context updates without server restart. |
| `boring.front` panels/commands/catalogs/surface resolvers | hot-reload via `/reload` in dev/playground | static by default; package front assets can be rediscovered in dev | Browser import failures are surfaced and previous version is kept. |
| `boring.server` / `defineServerPlugin({ routes, agentTools })` | not hot-reloaded | boot-time only | Restart/redeploy after changes. Generated runtime plugins should omit `boring.server`. |
| Runtime plugin frontend in packaged CLI static mode | not yet | n/a | Planned: local plugin-dev transform endpoint / embedded Vite for CLI. |

Planned direction: keep app/internal plugins powerful and boot-composed, but keep generated/runtime plugins route-free. Generated plugins should use manifest-declared front surfaces plus brokered tools/RPC rather than custom backend routes.

**What you can add:**

- **Panels** — arbitrary React panes in the workbench (editors, charts, tables, anything)
- **Left tabs** — persistent sidebars (data catalogs, file navigators, status views)
- **Commands** — entries in the command palette, triggered by user or agent
- **Catalogs** — searchable, faceted data explorers the agent can surface
- **Agent tools** — new capabilities the model can call, with schema-defined parameters
- **Skills + prompts** — domain knowledge and reasoning patterns the agent follows

### Existing Plugins


| Plugin                                                                               | Description                                                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [ask-user](https://github.com/hachej/boring-ui/tree/main/plugins/ask-user)           | Agent-to-human Q&amp;A with a UI prompt                                                       |
| [data-explorer](https://github.com/hachej/boring-ui/tree/main/plugins/data-explorer) | Searchable, faceted data tables                                                               |
| [data-catalog](https://github.com/hachej/boring-ui/tree/main/plugins/data-catalog)   | Catalog tab built on data-explorer                                                            |
| coming: llm-wiki                                                                     | [LLM powered second brain](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) |
| coming: tasks                                                                        | Task tracking, Kanban boards the agent can read and update                                    |
| coming: workflows                                                                    | Multi-step agent orchestration — chain steps, define branches, trigger sub-agents             |
| coming: data-branch                                                                  | Fork, explore, and compare agent-generated datasets side by side in the workbench             |

See [Pi extensions docs](https://pi.dev/docs/latest/extensions) for the full Pi plugin surface.

---

## Built with boring-ui

<p align="center"><img src="https://boring-macro.fly.dev/landing/app-screenshot.png?v=8" alt="MacroAnalyst" width="480"></p>

**[MacroAnalyst](https://boring-macro.fly.dev/)** — an interactive macroeconomic analyst powered by Boring UI.

Ask in plain English, get charts back in under a minute. Behind the scenes the agent:

- Fetches live time series from a database of 800,000+ series 
- Transforms, resamples, and joins them using Python functions it chooses and writes
- Renders interactive decks charts in the workbench


| App                                                | Status |
| -------------------------------------------------- | ------ |
| boring-accountant — accounting workflows           | Coming |
| boring-design — design review and iteration        | Coming |
| boring-lawyer — legal research and document review | Coming |


---

## Repo map

The repo is structured in packages, each with a focused scope.


| Package                    | Role                             | README                                             |
| -------------------------- | -------------------------------- | -------------------------------------------------- |
| `@hachej/boring-agent`     | Agent runtime, tools, chat UI    | [packages/agent](packages/agent/README.md)         |
| `@hachej/boring-workspace` | Workbench, panels, plugin system | [packages/workspace](packages/workspace/README.md) |
| `@hachej/boring-core`      | Auth, DB, app factory            | [packages/core](packages/core/README.md)           |
| `@hachej/boring-ui-kit`    | Shared UI primitives             | [packages/ui](packages/ui/README.md)               |
| `@hachej/boring-ui-cli`    | Zero-setup local entrypoint      | [packages/cli](packages/cli/README.md)             |


The repo also ships reference apps — drop one into any agent and it will scaffold a custom app for you in seconds.


| App                         | Purpose                                                   | README                                                           |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/full-app`             | Production-shaped reference: auth, DB, multi-workspace    | [apps/full-app](apps/full-app/README.md)                         |
| `apps/agent-playground`     | `@hachej/boring-agent` — single agent chat on top of Pi   | [apps/agent-playground](apps/agent-playground/README.md)         |
| `apps/workspace-playground` | `@hachej/boring-workspace` — agent chat and the workbench | [apps/workspace-playground](apps/workspace-playground/README.md) |


---

## Architecture

Two layers connected by a bridge.

**Frontend** is React + Vite — renders chat, file tree, and workbench. The workbench is a pane container that displays files, tables, charts, or custom plugin views.

**UiBridge** is the link between frontend and backend. The agent or server posts commands (`openFile`, `openPanel`, `openSurface`) and the workbench dispatches them. This is how the agent drives the UI without touching the DOM.

**Backend** is Node.js.

**Agent runtime** is the Pi agent loop (`AgentHarness`). It runs natively on the backend — no VMs, no containers needed. It receives user messages, streams chat responses, delegates tool calls to a `ToolCatalog`, and manages sessions. It knows nothing about files, shells, or UI — only `AgentTool[]`.

`AgentHarness` is an interface, not a hardcoded dependency. The design leaves room for swapping in a different harness later. For now, Pi is the only implementation.

The agent just calls the tools — we handle where they actually run. 

That's why `Workspace` and `Sandbox` exist: they abstract the execution layer so the same tools (`ls`, `read`, `write`, `exec`) work identically whether hitting the local filesystem, a Linux container, or a remote VM.

### Core abstractions


| Interface      | Defined in                 | Used for                                    | Adapters                                             |
| -------------- | -------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `Workspace`    | `@boring/agent/shared`     | Read/write files (agent + UI filetree)      | `NodeWorkspace`, `VercelSandboxWorkspace`            |
| `Sandbox`      | `@boring/agent/shared`     | Shell execution (agent commands)            | `DirectSandbox`, `BwrapSandbox`, `VercelSandboxExec` |
| `UiBridge`     | `@boring/workspace/shared` | Workbench control (agent + command palette) | in-memory bridge (room for browser-side adapter)     |
| `AgentHarness` | `@boring/agent/shared`     | Agent loop                                  | Pi (room for more)                                   |


### Sandbox

`Sandbox` abstracts isolated execution. The agent runs commands through it — the same `bash` tool works identically regardless of where the shell is:


| Sandbox            | Implementation        | When to use                         |
| ------------------ | --------------------- | ----------------------------------- |
| **direct**         | `child_process.exec`  | Local dev, no isolation             |
| **bwrap**          | Linux bubblewrap      | Local dev with filesystem isolation |
| **vercel-sandbox** | Vercel Firecracker VM | Remote sandbox                      |


### Workspace

`Workspace` is the filesystem abstraction that both the agent tools and the frontend file routes consume. It defines operations — `readFile`, `writeFile`, `readdir`, `stat`, `watch` — and each adapter implements them for its target environment.

Pi ships native tools for `read`, `write`, `edit`, `find`, `grep`, `ls`. In local mode they call `node:fs` directly. In remote mode we adapt them to call through the `Workspace` interface over HTTP. Same tools, same agent, different backend.


| Workspace                  | Implementation                              |
| -------------------------- | ------------------------------------------- |
| **NodeWorkspace**          | Local filesystem via `node:fs`              |
| **VercelSandboxWorkspace** | Remote filesystem over HTTP to a sandbox VM |


Sandbox and Workspace are always created together as a pair so they share the same filesystem:


| Mode               | Sandbox             | Workspace                |
| ------------------ | ------------------- | ------------------------ |
| **direct**         | `DirectSandbox`     | `NodeWorkspace`          |
| **local**          | `BwrapSandbox`      | `NodeWorkspace`          |
| **vercel-sandbox** | `VercelSandboxExec` | `VercelSandboxWorkspace` |


---

## Hosting

The full app ships two deployment targets:

- **Fly.io** — Docker container + Postgres. The `apps/full-app` Dockerfile builds the monorepo in dependency order. Run `fly launch`, set secrets (`DATABASE_URL`, `AUTH_SECRET`), deploy.
- **Vercel** — serverless function for agent routes + edge static assets. `@boring/core` ships a `vercelEntry` and build script (`build-vercel-api.mjs`) that bundle the backend into a single Vercel Function.

Both targets use the same `@boring/core` app factory (`createCoreApp`) — swap the entry point, same app.

---

## Working in the repo

```bash
pnpm install
pnpm build            # build all packages
pnpm dev              # run all dev servers
pnpm typecheck        # tsc --noEmit across all packages
pnpm test             # vitest across all packages
pnpm lint:invariants  # plugin contract + agent isolation lint
pnpm ci               # lint + typecheck + test + invariants + e2e
```

Scoped commands during development:

```bash
pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-agent test:watch
pnpm --filter full-app dev
```

Apps that consume `@hachej/boring-workspace` source need the workspace built once first:

```bash
pnpm --filter @hachej/boring-workspace build && pnpm --filter workspace-playground test
```

---

## License

MIT
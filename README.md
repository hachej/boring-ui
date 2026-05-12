<div align="center">

# Boring UI

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

**Turn chat into work.**

Boring UI turns agent skills into a real app: panels, files, tools, outputs, and state in one workspace.

<img width="980" alt="Boring UI banner" src="https://github.com/user-attachments/assets/6bb196de-1518-4f20-a603-6a5809552cf7" />

</div>

MIT-licensed monorepo for building agent, workspace, and app-shell packages.

## In one line

**Chat in → work appears**

## Why it exists

Most AI products stop at chat: you ask, it replies, and the work happens somewhere else.

Boring UI starts from a different idea:

> **Chat should be the control layer — not the destination.**

The agent should not just answer. It should open panels, inspect files, run tools, render outputs, and leave behind work the user can inspect and keep going with.

That is the core model:

- **chat** drives intent
- **commands** trigger actions
- **artifacts** hold the work

## What are workspace artifacts?

Artifacts are the visible outputs the agent creates or changes while working.

Depending on your product, an artifact might be:

- a file or code diff
- a chart, report, or table
- a generated document or note
- a query result or dataset preview
- a log stream or command output
- a custom panel for a domain object in your app

The point is simple: the agent should not only talk about work. It should show the work itself.

## What you can build

- browser-based coding agents
- agent workspaces for internal teams
- domain-specific copilots with inspectable outputs
- software where the interface adapts to the task

## Design principles

> **Opinionated at the center. Extensible at the edges.**

### Opinionated core

Boring UI has a strong default point of view:

- chat is a first-class control surface
- the workspace is the main output surface
- agents open UI, not just text
- auth, config, and workspaces are part of the default shape

This is not a blank-canvas UI kit. It is a framework for agent-first software.

### Extensible by design

The core is built to expand.

You customize it through plugins and composition points:

- add panels for your domain
- add catalogs, commands, and bindings
- add agent tools
- add surface resolvers that map actions to UI
- swap runtime modes depending on deployment model

The framework has a point of view. Your product still keeps its own.

## How the stack is packaged

| Package | Role | Use it when |
|---|---|---|
| `@hachej/boring-core` | Auth, config, database, app shell, and backend foundation | You want a full app shell |
| `@hachej/boring-agent` | Embeddable coding agent with a Pi-native harness and `direct`, `local`, and `vercel-sandbox` runtime modes | You want agent execution and chat |
| `@hachej/boring-workspace` | Workspace UI, plugins, layouts, editors, and UI bridge | You want agent-controlled UI |
| `@hachej/boring-ui-cli` | Zero-setup entrypoint for running a full agent workspace | You want to try Boring UI immediately |

## Package composition

Architecture only, not literal package dependencies:

```text
apps/*  ->  @hachej/boring-workspace  ->  @hachej/boring-core
   \            ^
    \------->  @hachej/boring-agent
```

Notes:

- `@hachej/boring-core` owns persistence and identity
- `@hachej/boring-agent` can run standalone with zero core dependency at runtime
- `@hachej/boring-workspace` owns workspace UI contracts and app composition helpers

## Why Boring UI

- **Agent-controlled UI** — agents open panels and render outputs, not just text replies
- **Visible work** — the result lives in the workspace, not only in chat
- **Pi-native harness** — Boring UI uses Pi as its first harness and extends Pi through its plugin system
- **Sandboxed execution** — run in `direct`, `local`, or `vercel-sandbox` modes
- **Plugin extensibility** — add panels, catalogs, commands, bindings, and tools
- **Core product scaffolding** — auth, workspaces, config, and app shell already wired

## Repo layout

- `packages/core` — core package
- `packages/agent` — agent package
- `packages/workspace` — workspace package
- `packages/ui` — shared UI kit
- `packages/cli` — CLI package
- `apps/full-app` — reference production app
- `apps/agent-playground` — agent-focused playground
- `apps/workspace-playground` — workspace-focused playground

## Quickstart

### Fastest way to try it

```bash
npx @hachej/boring-ui-cli
```

This starts a full agent workspace in your current directory: chat, panels, file tree, and command palette.

No clone. No database. No app setup.

You can also provide an API key directly:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx @hachej/boring-ui-cli
```

See `packages/cli/README.md` for CLI details.

### Run the full reference app

```bash
pnpm install
cp apps/full-app/.env.example apps/full-app/.env
```

Fill in the required values in `apps/full-app/.env`:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `WORKSPACE_SETTINGS_ENCRYPTION_KEY`
- `BETTER_AUTH_URL`

Then run:

```bash
pnpm --filter full-app migrate
pnpm --filter full-app dev
```

Frontend runs at `http://localhost:5173`.

See `apps/full-app/README.md` for full setup and deploy steps.

### Verify the repo

```bash
pnpm lint
pnpm typecheck
pnpm test
```

For the full CI check:

```bash
pnpm ci
```

## Common scripts

From the repo root:

```bash
pnpm build
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
pnpm storybook
```

## Package details

> Start with the product model above. Use the details below when you need implementation boundaries.

### `@hachej/boring-core`

Foundation package for Boring UI apps.

It provides:

- config loading and validation
- Fastify app factory
- Postgres + Drizzle integration
- better-auth integration
- user/workspace management
- frontend app shell and providers

Docs: `packages/core/docs/CORE.md`

### `@hachej/boring-agent`

Embeddable coding agent and standalone app with a Pi-native harness.

It ships three runtime modes behind one interface:

- `direct` — no isolation, local dev friendly
- `local` — `bwrap` isolation on Linux
- `vercel-sandbox` — Firecracker microVM execution

Docs: `packages/agent/docs/plans/agent-package-spec.md`

### `@hachej/boring-workspace`

Workspace UI and bridge package.

It provides:

- layout runtime and Dockview composition
- plugin registries
- workspace bridge commands
- default workspace plugins
- app composition helpers for agent-integrated shells

Docs: `packages/workspace/docs/INTERFACES.md`

## Reference app

`apps/full-app` is the canonical wiring example for core + agent + workspace.

Useful commands:

```bash
pnpm --filter full-app dev
pnpm --filter full-app build
pnpm --filter full-app start
pnpm --filter full-app e2e:smoke
```

More: `apps/full-app/README.md`

## Specs

Canonical docs live in:

- `packages/core/docs/CORE.md`
- `packages/workspace/docs/INTERFACES.md`
- `packages/agent/docs/plans/agent-package-spec.md`

## License

MIT

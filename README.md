<div align="center">

# Boring UI

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

**Build agent-native software where chat triggers actions and the real work shows up in the workspace.**

Boring UI turns agent skills into an inspectable product surface: panels, files, tools, outputs, and workflow state living together in one app.

<img width="980" alt="Boring UI banner" src="https://github.com/user-attachments/assets/6bb196de-1518-4f20-a603-6a5809552cf7" />

</div>

MIT-licensed monorepo for building production-grade agent, workspace, and app-shell packages.

## In one line

**Chat in → actions happen → workspace artifacts appear**

## Why it exists

Most AI products stop at chat: you ask, the model replies, and the real work still happens somewhere else.

Boring UI is built on a different idea:

> **Chat should be the control layer — not the destination.**

The agent should not just answer. It should open panels, inspect files, run tools, render outputs, and leave behind work the user can inspect, manipulate, and continue from.

That is the core model:

- **chat** drives intent
- **commands** trigger actions
- **workspace artifacts** hold the work

## What are workspace artifacts?

Artifacts are the visible outputs the agent creates or manipulates while working.

Depending on your product, an artifact might be:

- a file or code diff
- a chart, report, or table
- a generated document or note
- a query result or dataset preview
- a log stream or command output
- a custom panel for a domain object in your app

The point is simple: the agent should not only talk about work. It should surface the work itself.

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

This is not a blank-canvas UI kit. It is a framework for building agent-native software.

### Extensible by design

The core is deliberately expandable.

You customize the system through plugins and composition points:

- add panels for your domain
- add catalogs, commands, and bindings
- add agent tools
- add surface resolvers that map actions to UI
- swap runtime modes depending on deployment model

The framework has a point of view. Your product still gets to have its own.

## How the stack is packaged

Boring UI is the monorepo that provides that stack.

It is composed from:

- a canonical backend and auth layer from `@hachej/boring-core`
- an embeddable coding agent from `@hachej/boring-agent`
- a customizable workspace shell from `@hachej/boring-workspace`

Together they let you build apps where agents can inspect files, run tools, create outputs, and render those outputs directly in the interface.

## Package composition

Architectural composition (not literal package-manager dependencies):

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
- **Visible work products** — the result of the agent's work lives in the workspace, not only in chat
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

This starts a full agent workspace against your current directory: chat, panels, file tree, and command palette.

No clone. No database. No app setup.

You can also provide an API key directly:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx @hachej/boring-ui-cli
```

See `packages/cli/README.md` for CLI usage details.

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

See `apps/full-app/README.md` for full setup and deployment details.

### Verify the repo

```bash
pnpm lint
pnpm typecheck
pnpm test
```

For the full CI-equivalent check:

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

Embeddable coding agent and standalone app.

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

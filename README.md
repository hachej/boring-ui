<div align="center">

# boring-ui-v2

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

<p><strong>Chat in. Workspace out.</strong></p>
<p><strong>Your Workflow. Your Agent. Your UI.</strong></p>
<p>Build apps where chat controls a real workspace — not just a reply box.</p>

<img width="1818" height="865" alt="boring-ui-v2 banner" src="https://github.com/user-attachments/assets/6bb196de-1518-4f20-a603-6a5809552cf7" />

</div>

MIT-licensed monorepo for building agent-native apps.

boring-ui-v2 gives you the building blocks for products where an agent can:

- open panels and editors
- inspect and edit files
- run tools and commands
- show logs, previews, charts, and results in the UI

Use it to build things like:

- browser-based coding agents
- internal tools with agent-driven workflows
- copilots that operate inside a custom workspace
- apps where the UI changes based on the task

<p align="center"><strong>user asks → agent opens the right UI, runs tools, and shows the result</strong></p>

- `@hachej/boring-core` — app shell, auth, config, DB, Fastify app factory, frontend providers
- `@hachej/boring-agent` — pane-embeddable coding agent with `direct`, `local`, and `vercel-sandbox` runtime modes
- `@hachej/boring-workspace` — workspace UI, plugin system, layouts, catalogs, editors, and UI bridge

## Manifesto

Most AI products stop at chat.

You ask.
The model replies.
You read.
Then you do the real work somewhere else.

boring-ui-v2 is built on a different belief:

**chat should not be the destination. chat should be the control layer.**

A workflow can be interfaced through three things:

- an agent chat
- a command palette
- artifacts visualized in a workbench

That means the agent does not just answer.
It opens panels.
It edits files.
It runs commands.
It renders outputs.
It gives the user something to inspect, manipulate, and continue from.

The goal is not a smarter chatbot.
The goal is software whose interface can adapt to the work.

## What are artifacts?

Artifacts are the things the agent produces or manipulates while doing work.

Depending on your product, an artifact might be:

- a file or code diff
- a chart, report, or table
- a generated document or note
- a query result or dataset preview
- a log stream or command output
- a custom panel for a domain object in your app

The point is simple: the agent should not only talk about work. It should surface the work itself.

## Design principles

### Opinionated core

boring-ui-v2 is opinionated.

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

## What it is

boring-ui-v2 is the monorepo that provides that stack.

It is composed from:

- a canonical backend and auth layer from `@hachej/boring-core`
- an embeddable coding agent from `@hachej/boring-agent`
- a customizable workspace shell from `@hachej/boring-workspace`

Together they let you build apps where agents can inspect files, run tools, create outputs, and render those outputs directly in the interface.

## Package graph

```text
apps/*  ->  @hachej/boring-workspace  ->  @hachej/boring-core
   \            ^
    \------->  @hachej/boring-agent
```

Notes:

- `@hachej/boring-core` owns persistence and identity
- `@hachej/boring-agent` can run standalone with zero core dependency at runtime
- `@hachej/boring-workspace` owns workspace UI contracts and app composition helpers

## Highlights

- Agent-controlled UI via workspace bridge commands
- Sandboxed execution modes for local and remote runtimes
- Workspace plugin system for panels, catalogs, commands, bindings, and tools
- Auth, workspaces, invites, and config in the core layer
- Standalone agent app or fully composed multi-package app

## Repo layout

- `packages/core` — core package
- `packages/agent` — agent package
- `packages/workspace` — workspace package
- `packages/ui` — shared UI kit
- `apps/full-app` — reference production app
- `apps/agent-playground` — agent-focused playground
- `apps/workspace-playground` — workspace-focused playground

## Quickstart

Install deps:

```bash
pnpm install
```

Run the monorepo checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Run the reference app:

```bash
cp apps/full-app/.env.example apps/full-app/.env
pnpm --filter full-app migrate
pnpm --filter full-app dev
```

Frontend runs at `http://localhost:5173`.

## Common scripts

From repo root:

```bash
pnpm build
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
pnpm storybook
```

## Packages

### `@hachej/boring-core`

Foundation package for boring-ui-v2 apps.

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

## Status

This repo is an active v2 monorepo. Specs live in:

- `packages/core/docs/CORE.md`
- `packages/workspace/docs/INTERFACES.md`
- `packages/agent/docs/plans/agent-package-spec.md`

## License

MIT

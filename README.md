# boring-ui-v2

<<<<<<< Updated upstream
Boring UI is a framework for building agent-driven workflows in the browser.

It gives you an embedded chat interface for directing the agent, plus a workbench for reviewing the outputs it creates — files, documents, code, research, and other artifacts.

Use it to build things like coding agents, research copilots, internal workflow tools, analyst workbenches, and document-based products where the agent needs to do work and hand the results back in a structured UI.

It provides the backend foundation (`@boring/core`), the agent runtime (`@boring/agent`), and the frontend workspace shell (`@boring/workspace`).

## Packages

### `@boring/core`
App foundation:
- Postgres + Drizzle
- auth + users + workspaces
- Fastify app factory
- frontend app shell (`<BoringApp />`)
=======
An open-source framework for building domain-specific agent workbenches — internal tools where one chat, a workspace, and a command palette replace the form-heavy SaaS your team currently uses.

**Why boring?**

Every SaaS your team uses was built for the last era — dozens of pages, hundreds of form fields, workflows split across tabs.

boring-ui is deliberately not that. It's minimal, unremarkable, and designed to be reshaped by the agent, in real time, on your behalf.

> *"I need a panel that shows open contracts by risk score."*
> The agent writes the code, ships the panel, the app changes.
> No developer. No ticket. No sprint.

---

**Build the internal Cowork your domain actually needs.**

[Claude Cowork](https://www.anthropic.com/product/claude-cowork) proved the pattern for knowledge workers. [Claude Code](https://claude.ai/code) proved it for developers. boring-ui is the open-source framework to build the same thing for your domain — your data model, your workflows, your team.

- Your data stays yours
- Your agent knows your context
- Your interface fits your workflow

Powered by [pi](https://github.com/mariozechner/pi-coding-agent), Mario Zechner's open-source agent runtime. Works with any model provider: Anthropic, OpenAI, OpenRouter, or your own self-hosted models.

---

## What you get

**One chat** — a persistent conversation that drives the agent. Your domain experts talk to it like a colleague who knows their workflow, not a generic assistant.

**Panes** — a workspace for whatever the agent produces: documents, data, code, research, artifacts. Each pane is a plugin built for your domain. A contract review panel. A market data explorer. A query builder. You define what the workspace shows.

**Command palette** — keyboard-first access to everything. Your team's power users will live in it.

**Self-editable** — in development environments, the agent has access to the plugin codebase and can scaffold new panels on request. Your analyst asks for a panel that surfaces contract risk scores — the agent writes the plugin, the interface updates. Lock this down in production as your team sees fit.

Plus the backend you'd have to build anyway:

- Postgres + Drizzle ORM
- Auth + users + workspaces (via better-auth)
- Fastify app factory
- Coding agent runtime with tools: `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`
- Three agent runtime modes: `direct`, `local` (bwrap sandbox), `vercel-sandbox`

---

## Packages

| Package | What it is |
|---|---|
| `@boring/core` | DB, auth, app factory, frontend shell |
| `@boring/agent` | Coding agent runtime + tool catalog |
| `@boring/workspace` | Chat layout, pane registry, file tree, editors |
>>>>>>> Stashed changes

Docs: [`packages/core/docs/CORE.md`](packages/core/docs/CORE.md)

<<<<<<< Updated upstream
### `@boring/agent`
Pane-embeddable coding agent:
- chat runtime
- tool catalog (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`)
- runtime modes: `direct`, `local` (bwrap), `vercel-sandbox`
- standalone server/CLI surface

Docs: [`packages/agent/README.md`](packages/agent/README.md)

### `@boring/workspace`
Frontend-only IDE/workspace shell:
- chat-centered layout
- file tree
- editors
- panel registry
- UI bridge integration

## Repo shape

```text
apps/*                  # example / reference apps
packages/core           # app foundation
packages/agent          # coding agent
packages/workspace      # workspace UI shell
```

Dependency direction:

```text
apps/* -> @boring/workspace -> @boring/core
   └──> @boring/agent
```

## Example apps

### `apps/full-app`
Reference production-style app wiring core + agent + workspace together.

Run:
=======
## Get started
>>>>>>> Stashed changes

```bash
pnpm install
cp apps/full-app/.env.example apps/full-app/.env
# set DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, WORKSPACE_SETTINGS_ENCRYPTION_KEY
pnpm --filter full-app migrate
pnpm --filter full-app dev
```

<<<<<<< Updated upstream
See: [`apps/full-app/README.md`](apps/full-app/README.md)
=======
Open `http://localhost:5173`.
>>>>>>> Stashed changes

### `apps/workspace-playground`
Fastest way to poke at the workspace UI locally.

<<<<<<< Updated upstream
```bash
pnpm --filter workspace-playground dev
```

### `apps/boring-macro-v2`
Macro-economic analysis app built on top of the workspace + agent stack.

```bash
pnpm --dir apps/boring-macro-v2 dev
```

## Root commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```
=======
## Build a plugin

Plugins contribute panels, commands, and data to the workspace. A minimal panel:

```ts
import { defineFrontPlugin, definePanel } from '@boring/workspace'

export const myPlugin = defineFrontPlugin({
  id: 'contract-review',
  label: 'Contract Review',
  systemPrompt: 'You can open the contract review panel with the open-panel tool.',
  outputs: [
    {
      type: 'panel',
      panel: definePanel({
        id: 'contract-review-panel',
        title: 'Contract Review',
        placement: 'center',
        component: () => import('./ContractReviewPane').then(m => ({ default: m.ContractReviewPane })),
      }),
    },
  ],
})
```

Register it with the shell:

```tsx
<WorkspaceAgentFront plugins={[myPlugin]} />
```

The agent picks up the `systemPrompt` and can open the panel autonomously. Full plugin docs: [`packages/workspace/docs/plugins.md`](packages/workspace/docs/plugins.md)

---

## License

MIT
>>>>>>> Stashed changes

Useful targeted commands:

<<<<<<< Updated upstream
```bash
pnpm --filter @boring/agent dev
pnpm --filter @boring/workspace dev
pnpm --filter full-app dev
pnpm --filter workspace-playground dev
pnpm --dir apps/boring-macro-v2 dev
```

## Current focus

This repo is building toward three publishable building blocks:
- a canonical app core
- a standalone/embeddable coding agent
- a frontend-only workspace shell

If you want the full architectural spec, start with:
- [`AGENTS.md`](AGENTS.md)
- [`packages/agent/docs/plans/agent-package-spec.md`](packages/agent/docs/plans/agent-package-spec.md)
- [`packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md`](packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md)
- [`packages/core/docs/CORE.md`](packages/core/docs/CORE.md)
=======
Built with TypeScript · React 19 · Tailwind v4 · Fastify · Drizzle · better-auth
>>>>>>> Stashed changes

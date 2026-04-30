# boring-ui-v2

Boring UI v2 is a framework for building chat-first products with real tools, files, and workspaces — apps that feel like ChatGPT plus an IDE.

With it, you can build things like AI coding environments, internal copilots, research workbenches, document+chat apps, and domain-specific tools such as data or macro-analysis products.

It gives you the backend foundation (`@boring/core`), the agent runtime (`@boring/agent`), and the frontend workspace shell (`@boring/workspace`).

## Packages

### `@boring/core`
App foundation:
- Postgres + Drizzle
- auth + users + workspaces
- Fastify app factory
- frontend app shell (`<BoringApp />`)

Docs: [`packages/core/docs/CORE.md`](packages/core/docs/CORE.md)

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

```bash
pnpm install
cp apps/full-app/.env.example apps/full-app/.env
pnpm --dir packages/core drizzle:migrate
pnpm --filter full-app dev
```

See: [`apps/full-app/README.md`](apps/full-app/README.md)

### `apps/workspace-playground`
Fastest way to poke at the workspace UI locally.

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

Useful targeted commands:

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

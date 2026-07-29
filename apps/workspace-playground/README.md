# workspace-playground

Standalone dev surface for `@hachej/boring-workspace`. The full workbench — file tree, editor, agent chat, command palette, panels, and plugins — backed by the same Fastify server production uses, with **no auth and no database**.

For the bare agent chat use [`agent-playground`](../agent-playground/README.md); for the production-shaped reference (auth + Postgres + deploy) use [`full-app`](../full-app/README.md).

## What it is

`pnpm --filter workspace-playground dev` builds the workspace stack to `dist/` (`build:deps`) and starts Vite on **`http://localhost:5200`**. A Vite plugin boots `createWorkspaceAgentServer({ mode: 'local' })` in-process on **`http://127.0.0.1:5210`**; Vite proxies `/api/v1` to it. The agent owns the filesystem and the UI bridge — there is no mock API.

The frontend (`src/front/App.tsx`) mounts `WorkspaceAgentFront` with front plugins for ask-user/inbox (`@hachej/boring-ask-user` with `appLeftInbox: true`), tasks (`@hachej/boring-tasks`), deck (`@hachej/boring-deck`), and Diagram (`@hachej/boring-diagram`). The server registers `defaultPluginPackages`: `@hachej/boring-ask-user`, `@hachej/boring-tasks`, and `@hachej/boring-diagram`.

### Rebuild required after package edits

Unlike `agent-playground`, the Vite aliases here point at the **built `dist/` artifacts** of `@hachej/boring-workspace` (and agent/ui/deck/data-catalog). `dev` runs `build:deps` first, but editing those package sources mid-session requires re-running `build:deps` (or `dev`) to pick up the change.

### Workspace fixtures

`src/fixtures/` is committed seed content; `workspace/` is the gitignored runtime root the agent reads/writes. On boot the dev server seeds `workspace/` from `src/fixtures/` if entries are missing. Set `BORING_WORKSPACE_PLAYGROUND_SEED_FIXTURES=0` to skip seeding. Delete `workspace/` to reset.

## Run

```bash
# from repo root, after `pnpm install`
pnpm --filter workspace-playground dev
```

Open `http://localhost:5200`. Append `?showcase=1` for the showcase route, or visit `/full-page` for the full-page panel.

### Skill resource review

The playground includes workspace, package-owned, and optional readonly company-context skills:

```bash
# All sources readable
pnpm --filter workspace-playground dev:skills

# Same playground with read denied on company_context/.agents/skills
pnpm --filter workspace-playground dev:skills:denied
```

Use [`docs/issues/938/playground-checklist.md`](../../docs/issues/938/playground-checklist.md) for the complete reviewer checklist.

## Scripts

| Script | What it does |
|--------|--------------|
| `build:deps` | Build the workspace stack and playground plugins, including BI dashboard resources, to `dist/` |
| `dev` | `build:deps`, then `vite` (UI :5200 + in-process agent :5210) |
| `dev:skills` | Starts `dev` with the readonly `company_context` skill fixture enabled |
| `dev:skills:denied` | Same fixture, but denies read access to `company_context/.agents/skills` |
| `build` | `build:deps`, then `vite build` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `test:e2e` | `build:deps`, then `playwright test` (specs include `deck-plugin.spec.ts`, `cmd-palette*`, `no-auth-deps`, `resize-persistence`, `visual`) |
| `eval` / `eval:slash-command` / `eval:woreplace` | `vite-node` agent evals under `src/eval/` (run with `AGENT_API_PORT=5350`) |

## Env vars

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `5200` | Vite UI port |
| `AGENT_API_PORT` | `5210` | In-process agent server port |
| `BORING_WORKSPACE_PLAYGROUND_SEED_FIXTURES` | `1` | `0` disables seeding `workspace/` from fixtures |
| `BORING_WORKSPACE_PLAYGROUND_MULTI_FS` | `0` | `1` enables the committed readonly `company_context` fixture |
| `BORING_WORKSPACE_PLAYGROUND_HIDE_COMPANY_SKILLS` | `0` | `1` denies read access to `company_context/.agents/skills` |
| `BORING_AGENT_WORKSPACE_ROOT` | `apps/workspace-playground/workspace` | Point the agent at an external workspace root |
| `CHOKIDAR_USEPOLLING` / `BORING_VITE_USEPOLLING` | `0` | `1` for polling file watch (network mounts, some containers); interval via `CHOKIDAR_INTERVAL` / `BORING_VITE_POLL_INTERVAL` |

## Composition

Depends on `@hachej/boring-workspace` (the workbench shell + `createWorkspaceAgentServer`), `@hachej/boring-agent` (the runtime), `@hachej/boring-deck`, `@hachej/boring-ask-user`, `@hachej/boring-tasks`, `@hachej/boring-diagram`, and `@hachej/boring-bi-dashboard` (plugins), and `@hachej/boring-data-catalog` / `@hachej/boring-data-explorer`. It does **not** use `@hachej/boring-core` — there is no auth or database layer.

## License

MIT

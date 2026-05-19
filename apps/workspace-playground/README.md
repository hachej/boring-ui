# workspace-playground

Standalone playground for [`@hachej/boring-workspace`](../../packages/workspace/README.md). Workbench, panels, plugin system, command palette — wired to a local agent backend with no auth and no DB.

Use this when you're working on the workspace shell, panel registry, plugin contract, or building/iterating on a plugin (`ask-user`, `data-catalog`, your own).

---

## Run

```bash
pnpm --filter workspace-playground dev
```

Frontend: `http://localhost:5173`.

The dev script rebuilds `@hachej/boring-agent`, `@hachej/boring-workspace`, `@hachej/boring-ask-user`, and `@hachej/boring-data-catalog` first so source changes propagate to the running app.

---

## What it loads

By default this playground loads:

- `@hachej/boring-workspace` — workbench shell, file tree, editor, command palette
- `@hachej/boring-agent` — chat panel and agent runtime
- `@hachej/boring-ask-user` — `ask_user` panel
- `@hachej/boring-data-catalog` (which pulls in `@hachej/boring-data-explorer`)

To add a new plugin to the playground, register it in `src/plugins.ts` and add the plugin's build to the dev script alongside the others.

---

## E2E

```bash
pnpm --filter workspace-playground test:e2e
```

Playwright suite, runs against a built app. Use this to sanity-check panel lifecycle and plugin contract after invariant lint passes.

---

## What it does NOT include

- No `@hachej/boring-core` — no auth, no Postgres, no multi-tenant workspaces
- No persistence beyond what plugins manage themselves

For a full reference app, see [`apps/full-app`](../full-app/README.md). For the agent-only counterpart, see [`apps/agent-playground`](../agent-playground/README.md).

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

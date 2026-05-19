# agent-playground

Standalone playground for [`@hachej/boring-agent`](../../packages/agent/README.md). Chat UI + agent runtime — no auth, no DB, no workbench panels.

Use this when you're working on the agent runtime, tool catalog, or chat UI in isolation.

---

## Run

```bash
cp apps/agent-playground/.env.example apps/agent-playground/.env.local  # if you haven't yet
pnpm --filter agent-playground dev
```

Frontend: `http://localhost:5173` (Vite default).

The dev script also rebuilds `@hachej/boring-agent` before each run so source changes propagate without manual rebuilds.

---

## Env

Minimum:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Optional model override:

```bash
BORING_AGENT_DEFAULT_MODEL_PROVIDER=anthropic
BORING_AGENT_DEFAULT_MODEL_ID=claude-sonnet-4-6
```

---

## What it does NOT include

- No `@hachej/boring-core` — no auth, no Postgres, no workspaces
- No `@hachej/boring-workspace` — no panels, no plugin system, no command palette
- No persistence across restarts

For a full reference app with all of that, see [`apps/full-app`](../full-app/README.md). For the workbench-only counterpart, see [`apps/workspace-playground`](../workspace-playground/README.md).

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

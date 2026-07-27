# agent-playground

Standalone dev surface for `@hachej/boring-agent`. A full-screen chat UI wired to the agent runtime — no auth, no database, no workbench panels, no plugins. The fastest loop for iterating on the agent harness, tools, chat UI, and model wiring.

For panels/file-tree/plugins use [`workspace-playground`](../workspace-playground/README.md); for the production-shaped reference use [`full-app`](../full-app/README.md).

## What it is

`pnpm --filter agent-playground dev` boots one in-process Agent Host (`createAgentHost()` with the direct runtime adapter) on an ephemeral Fastify port, then starts a Vite dev server on **`http://localhost:5183`** that proxies `/api`, `/health`, and `/ready` to it. A fixed trusted-local capability is the only scope the app can issue; all session work flows through its `AgentGateway`. The frontend renders `ChatPanel` from `@hachej/boring-agent/front`. The agent's workspace root is the **current working directory** — it reads and writes the real filesystem.

The Vite config aliases `@hachej/boring-agent/front` and `/shared` directly to `packages/agent/src`, so editing agent **frontend/shared** source hot-reloads without a rebuild. The `dev` script first runs `build:dev` on `@hachej/boring-agent` to compile the **server** half; restart after changing agent server code.

## Run

```bash
# from repo root, after `pnpm install`
echo 'ANTHROPIC_API_KEY=sk-ant-...' > apps/agent-playground/.env.local
pnpm --filter agent-playground dev
```

Open `http://localhost:5183`. The `dev` script loads `.env.local` via `tsx --env-file`.

The agent is not Anthropic-only: it also supports Infomaniak (OpenAI-compatible) and a fully custom OpenAI-compatible provider. Configure a default model with `BORING_AGENT_DEFAULT_MODEL` / `BORING_AGENT_CUSTOM_MODEL_PROVIDER` / `BORING_AGENT_CUSTOM_MODEL_ID`, or the `BORING_AGENT_INFOMANIAK_*` + `INFOMANIAK_API_TOKEN` vars (see `packages/agent`).

## Scripts

| Script | What it does |
|--------|--------------|
| `dev` | `build:dev` the agent package, then `tsx src/server/index.ts` (one Agent Host + Fastify + Vite on :5183) |
| `test` | Run the bounded AgentGateway lifecycle smoke |
| `typecheck` | `tsc --noEmit` |

## Env vars

| Var | Default | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | — | Required for the default Anthropic provider |
| `FRONTEND_PORT` | `5183` | Vite port |
| `FRONTEND_STRICT_PORT` | `0` | `1` to fail instead of incrementing if the port is taken |
| `HOST` | `0.0.0.0` | Vite host |
| `BORING_AGENT_DEFAULT_MODEL`, `BORING_AGENT_CUSTOM_MODEL_*`, `BORING_AGENT_INFOMANIAK_*`, `INFOMANIAK_API_TOKEN` | — | Model/provider selection (read by `@hachej/boring-agent`) |

Note: the Agent Host workspace root is the process cwd. Sessions use `BORING_AGENT_SESSION_ROOT` when set and otherwise stay under the playground's `.boring-agent/sessions` directory. `BORING_AGENT_WORKSPACE_ROOT` is **not** read here.

## Composition

Depends on `@hachej/boring-agent` plus Fastify/React development surface dependencies. It does not pull in `@hachej/boring-core` or `@hachej/boring-workspace` — it is the isolated Agent Host reference composition.

## License

MIT

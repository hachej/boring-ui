# @hachej/boring-ui-cli

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-ui-cli.svg)](https://www.npmjs.com/package/@hachej/boring-ui-cli)

</div>

**Turn an agent into an app — in one command.** Start a full IDE-style workbench pointed at a folder: chat, file tree, editor, command palette, plugins. No clone, no database, no config.

```bash
npx @hachej/boring-ui-cli
```

The binary is `boring-ui`.

---

## Quick start

```bash
# Open the current folder as a workspace (browser opens at localhost:5200)
npx @hachej/boring-ui-cli

# Open a specific folder
npx @hachej/boring-ui-cli ~/projects/foo

# Custom port / host
npx @hachej/boring-ui-cli --port 8080 --host 127.0.0.1
```

The CLI does not take an API key flag. On first run, if no LLM provider is
configured it prints a guide: in another terminal run `pi` (or
`npx @earendil-works/pi-coding-agent`) and use `/login` to add an API key or
sign in to a subscription (Claude Pro/Max, ChatGPT Plus, Copilot). Credentials
are saved at `~/.pi/agent/auth.json`; refresh the browser afterward.

---

## Commands

```
boring-ui [folder] [options]            Open a single folder as a workspace (folder mode)
boring-ui workspaces                    Start the multi-workspace hub (workspaces mode)
boring-ui workspaces add <folder>       Register a folder as a saved workspace
boring-ui workspaces list               List saved workspaces
boring-ui workspaces remove <id>        Remove a saved workspace
boring-ui workspaces rename <id> <name> Rename a saved workspace
boring-ui plugin <subcommand> …         Plugin authoring (delegates to boring-ui-plugin)
```

`boring-ui plugin …` forwards to `@hachej/boring-ui-plugin-cli`; run
`boring-ui plugin` with no subcommand for its usage.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port <port>` | `5200` (or `$PORT`) | HTTP port |
| `--host <host>` | `0.0.0.0` (or `$HOST`) | Listen host |
| `-m, --mode <mode>` | `local` | `local` (no sandbox, full network) or `local-sandbox` (bwrap-isolated, no network, Linux only) |
| `-h, --help` | | Show help |

### Environment variables

| Variable | Description |
|----------|-------------|
| `PORT`, `HOST` | Fallbacks for `--port` / `--host` |
| `BORING_MODE` | Fallback for `--mode` |
| `BORING_AGENT_WORKSPACE_ROOT` | Overrides the folder argument in folder mode |
| `BORING_UI_WORKSPACES_PATH` | Path to the workspaces registry (default `~/.boring-ui/workspaces.yaml`) |
| `BORING_USE_LOCAL_PACKAGES` | `1` to resolve the bundled plugin-cli runtime from the local monorepo checkout |

---

## Installation

No install needed — `npx @hachej/boring-ui-cli`. Or install globally:

```bash
npm install -g @hachej/boring-ui-cli   # or: pnpm add -g @hachej/boring-ui-cli
boring-ui
```

### From source

```bash
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
pnpm --filter @hachej/boring-ui-cli build:full   # builds front bundle + server
node packages/cli/dist/index.js
```

`build:full` is required from source: the server refuses to start without a
built frontend under `public/`.

---

## Two modes

- **Folder mode** (`boring-ui [folder]`) — one folder, one workspace. The fast
  editor-launcher path, like `code .`.
- **Workspaces mode** (`boring-ui workspaces`) — a persistent local hub serving
  multiple folder-backed workspaces, with a workspace switcher in the UI. The
  registry is a user-local YAML file, not a database.

Both run a Fastify server that serves the prebuilt React/Vite SPA plus the agent
and workspace API routes against your real filesystem. There is no database.

## Plugins

The CLI discovers plugins from Pi-shaped roots — `~/.pi/agent/extensions/*`
(global) and `<workspace>/.pi/extensions/*` (workspace-local) — plus
CLI-bundled defaults (e.g. `@hachej/boring-ask-user`). Authoring is handled by
the bundled `boring-ui-plugin` CLI:

```bash
boring-ui-plugin create <name> --path plugins   # npm-package plugin (build step)
boring-ui-plugin scaffold <name>                 # workspace runtime plugin (.pi/extensions, hot-reload)
boring-ui-plugin verify [name]
boring-ui-plugin test <name>
```

See `@hachej/boring-ui-plugin-cli` for the full plugin authoring workflow.

---

## Documentation

- [`docs/README.md`](./docs/README.md) — architecture and key abstractions
- [`docs/plans/archive/`](./docs/plans/archive/) — historical design plans (not current docs)

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings.

---

## License

MIT

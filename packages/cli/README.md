# @hachej/boring-ui-cli

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-ui-cli.svg)](https://www.npmjs.com/package/@hachej/boring-ui-cli)

</div>

**Turn an agent into an app — in one command.** Start a full IDE-style workbench pointed at your current directory: chat, file tree, editor, command palette. No clone. No database. No config.

```bash
npx @hachej/boring-ui-cli
```

---

## TL;DR

**The Problem**: You want a coding agent in a browser IDE — but you don't want to clone a repo, set up Postgres, configure auth, or deploy anything. You just want to talk to an AI about your code.

**The Solution**: `npx @hachej/boring-ui-cli` starts a full workbench locally, using your current directory as the workspace. It opens a browser tab with chat, file explorer, and panels. Zero setup, zero config, zero deploy.

### Why Use @hachej/boring-ui-cli?

| Feature | What It Does |
|---------|--------------|
| **Zero-config startup** | `npx @hachej/boring-ui-cli` — that's it. Opens your browser to a full agent workbench. |
| **Simple auth** | Set `ANTHROPIC_API_KEY` in your environment. The agent runs with direct filesystem access to your cwd. |
| **Full workspace** | Chat, file tree, editor panels, command palette — all running against your real directory. |
| **No database** | Runs in-memory. State persists for the session. No external dependencies. |
| **Customizable port + root** | `PORT=8080` and `BORING_AGENT_WORKSPACE_ROOT=/path` env vars for power users. |

---

## Quick Example

```bash
# Navigate to any project
cd /path/to/my-project

# Start the CLI — opens browser at localhost:5200
npx @hachej/boring-ui-cli

# With a custom port
PORT=8080 npx @hachej/boring-ui-cli

# Point at a specific directory
BORING_AGENT_WORKSPACE_ROOT=/path/to/project npx @hachej/boring-ui-cli

# With API key
ANTHROPIC_API_KEY=sk-ant-... npx @hachej/boring-ui-cli
```

Once the browser opens, you can:
```
# In the chat box:
"read my README and suggest improvements"
"find all TypeScript files that import 'react'"
"rewrite the test file to use vitest"
```

---

## Installation

No installation needed — use `npx`:

```bash
npx @hachej/boring-ui-cli
```

Or install globally for repeated use:

```bash
# npm
npm install -g @hachej/boring-ui-cli

# pnpm
pnpm add -g @hachej/boring-ui-cli

# Then just run:
boring-ui
```

### From Source

```bash
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
pnpm --filter @hachej/boring-ui-cli build
npx ./packages/cli/dist/index.js
```

### Plugins

Plugin authoring operations live in the dedicated plugin CLI:

```bash
boring-ui-plugin create my-package-plugin --path plugins
boring-ui-plugin scaffold my-runtime-plugin "$BORING_AGENT_WORKSPACE_ROOT"
boring-ui-plugin verify my-runtime-plugin "$BORING_AGENT_WORKSPACE_ROOT"
boring-ui-plugin test my-runtime-plugin
```

---

## Authentication

The CLI talks to Anthropic Claude via the agent runtime. You need a valid API key:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx @hachej/boring-ui-cli
```

Only Anthropic Claude is wired in v1. The agent harness supports other providers via the `AgentHarness` interface, but only Anthropic is implemented.

---

## Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key. The agent requires a valid key to function. |
| `PORT` | `5200` | Port to run the server on |
| `BORING_AGENT_WORKSPACE_ROOT` | `.` (cwd) | Root directory for the workspace. The agent sees this as its filesystem. |
| `BORING_AGENT_MODE` | `direct` | `direct` (no sandbox) or `local` (bwrap sandbox, Linux only) |
| `BORING_AGENT_DEFAULT_MODEL_ID` | `claude-sonnet-4-6` | Default model to use |

---

## Architecture

```
npx @hachej/boring-ui-cli
  ├── Boot Fastify server (direct mode, in-memory)
  ├── Serve frontend SPA (Vite-built bundle)
  ├── Open browser → http://localhost:5200
  └── Workspace = your current directory (or $BORING_AGENT_WORKSPACE_ROOT)
```

The CLI is the zero-config entry point to the full boring-ui stack. Under the hood it wires together:

- `@hachej/boring-agent` — agent runtime, tools, chat UI
- `@hachej/boring-workspace` — file tree, panels, command palette, plugins
- `@hachej/boring-ui-kit` — shared UI primitives

All running locally against your real filesystem with no database.

---

## How @hachej/boring-ui-cli Compares

| Feature | @hachej/boring-ui-cli | Claude Code | Codex CLI | Cursor |
|---------|------------------------|-------------|-----------|--------|
| Browser UI | ✅ Full IDE with panels | ❌ Terminal only | ❌ Terminal only | ✅ Desktop app |
| File tree | ✅ Side panel | ❌ | ❌ | ✅ |
| Zero setup | ✅ `npx` anywhere | ⚠️ Install + login | ⚠️ Install + login | ❌ Desktop app download |
| Panel system | ✅ Dockview splittable panels | ❌ | ❌ | ❌ |
| Plugin extensibility | ✅ Panels, commands, catalogs | ❌ | ❌ | ⚠️ Extensions |
| Local filesystem | ✅ Direct access | ✅ | ✅ | ✅ |
| Database required | ❌ None | ❌ | ❌ | ❌ |

**When to use @hachej/boring-ui-cli:**
- You want a browser-based coding agent with file tree and panels
- You don't want to install anything — just `npx`
- You want plugin extensibility (custom panels, data catalogs, etc.)

**When it might not fit:**
- You prefer terminal-only agent workflows (use Claude Code or Codex CLI)
- You need multi-user auth, workspaces, or a database (use `@hachej/boring-core`)
- You want a full desktop IDE with LSP, debugging, and git (use Cursor or VS Code)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ANTHROPIC_API_KEY not set` | No API key | `export ANTHROPIC_API_KEY=sk-ant-...` before running |
| `port already in use` | Port 5200 occupied | `PORT=5201 npx @hachej/boring-ui-cli` |
| Browser doesn't open | `BROWSER=none` or no display | Manually navigate to `http://localhost:5200` |
| Agent returns errors | Invalid API key | Verify your Anthropic API key is valid and has quota |
| `workspace root not found` | `BORING_AGENT_WORKSPACE_ROOT` points to non-existent dir | Create the directory or unset the variable to use cwd |

---

## Limitations

- **In-memory only**: No database, no persistent workspaces. State is lost when the CLI exits.
- **Single workspace**: Points at one directory. No multi-workspace switching.
- **No auth management**: No user accounts, invites, or role-based access.
- **Direct mode only**: No bwrap sandbox by default (use `BORING_AGENT_MODE=local` on Linux with bubblewrap installed).
- **Not for production**: This is a developer tool, not a deployment target. Use `@hachej/boring-core` for multi-user apps.
- **Only Anthropic Claude**: No OpenAI, Google, or other model providers wired in v1.

---

## FAQ

**Q: Do I need to install anything first?**  
A: No. `npx` downloads and runs the package on first use. Subsequent runs use the cached version.

**Q: What happens when I close the browser?**  
A: The server keeps running. Stop it with `Ctrl+C` in the terminal.

**Q: Can I use this with OpenAI models?**  
A: Only Anthropic Claude is wired in v1. Additional providers may be supported in future versions.

**Q: Is my code sent to the cloud?**  
A: Yes — the agent sends file contents and chat messages to the LLM provider (e.g. Anthropic). The filesystem operations run locally on your machine.

**Q: How is this different from `npx @hachej/boring-agent`?**  
A: `@hachej/boring-ui-cli` ships the full workbench (file tree, editor, command palette, plugins). `@hachej/boring-agent` is just the agent + chat. The CLI is the batteries-included zero-config entry point.

**Q: Can I extend the CLI with plugins?**  
A: Not directly in v1. The CLI uses the default agent + workspace configuration. For plugin extensibility, build a custom app using `@hachej/boring-workspace` + `@hachej/boring-core`.

---

## Building Something Bigger?

`@hachej/boring-ui-cli` is the zero-config entry point. For a full app with:
- Multi-user authentication
- Persistent workspaces with Postgres
- Email invites and password resets
- Custom domain plugins

See the [boring-ui monorepo](https://github.com/hachej/boring-ui) and its packages:

| Package | Purpose |
|---------|---------|
| `@hachej/boring-core` | Auth, DB, app factory, multi-user |
| `@hachej/boring-workspace` | Plugin system, panels, layouts |
| `@hachej/boring-agent` | Agent runtime, tools, chat UI |
| `@hachej/boring-ui-kit` | Shared React UI primitives |

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT

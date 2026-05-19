# agent-playground

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

Standalone rich playground for `@hachej/boring-agent`. Chat UI + agent runtime — no auth, no database, no workbench panels. Pure agent interaction surface.

```bash
cp apps/agent-playground/.env.example apps/agent-playground/.env.local && pnpm --filter agent-playground dev
```

---

## TL;DR

**The Problem**: You're working on the agent runtime — tweaking tools, adjusting the chat UI, testing new models — but you don't want the overhead of auth, Postgres, workspaces, and panels. You want to change code and see it live in a chat window.

**The Solution**: `agent-playground` boots the agent in isolation with a Vite dev server. It auto-rebuilds `@hachej/boring-agent` before each run so source changes propagate without manual rebuilds. One env var to start.

### Why Use agent-playground?

| Feature | What It Does |
|---------|--------------|
| **Zero boilerplate** | No auth, no Postgres, no workspaces — just chat and agent |
| **Auto-rebuild on save** | Dev script rebuilds `@hachej/boring-agent` so source changes are instant |
| **Model override** | Set provider/model via env vars to test different LLMs |
| **Minimal surface** | Just `ChatPanel` + `SessionToolbar` — no layouts, plugins, or side chrome |
| **Fastest iteration** | Start coding, save, the chat updates — full loop in seconds |

---

## Quick Example

```bash
# 1. Clone the repo (if you haven't)
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install

# 2. Set your API key
cp apps/agent-playground/.env.example apps/agent-playground/.env.local
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> apps/agent-playground/.env.local

# 3. Start the playground
pnpm --filter agent-playground dev
```

Open `http://localhost:5173` — a full-screen chat with the agent ready to go.

Try it out:
```
list all .ts files in the current directory
read the README.md and summarize it in 3 bullet points
find every import of "react" in src/
```

---

## What It Looks Like

```
┌─────────────────────────────────────────────┐
│  agent-playground                           │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 🤖 Here are the .ts files I found...│   │
│  │ - src/index.ts                      │   │
│  │ - src/utils.ts                      │   │
│  │ - src/types.ts                      │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ You: find every import of "react"   │   │
│  │ [ Send ]                            │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [New Chat]  [Session: abc-123 ▼]          │
└─────────────────────────────────────────────┘
```

No file tree. No panels. No command palette. Just a chat box pointed at your files.

---

## Installation

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 8
- **Anthropic API key** (or compatible provider)

### From Source

```bash
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
```

---

## Quick Start

### 1. Environment

```bash
cp apps/agent-playground/.env.example apps/agent-playground/.env.local
```

Minimum required:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Optional model override:
```bash
BORING_AGENT_DEFAULT_MODEL_PROVIDER=anthropic
BORING_AGENT_DEFAULT_MODEL_ID=claude-sonnet-4-6
```

### 2. Run

```bash
pnpm --filter agent-playground dev
```

Opens at `http://localhost:5173` (Vite default).

### 3. Change Code + See It Live

Edit `packages/agent/src/front/ChatPanel.tsx` → save → the playground auto-rebuilds and HMR updates the chat UI. No manual restart needed.

---

## Architecture

```
┌─────────────────────────┐
│  Browser (Vite + HMR)   │
│                         │
│  <ChatPanel>            │
│  <SessionToolbar>       │
│  useAgentChat hook      │
└──────────┬──────────────┘
           │ UIMessage stream (SSE)
┌──────────▼──────────────┐
│  Fastify (in-process)   │
│                         │
│  @hachej/boring-agent   │
│  ├── Harness (pi)       │
│  ├── Tools (7 standard) │
│  └── SessionStore       │
└──────────┬──────────────┘
           │ fs ops + exec
┌──────────▼──────────────┐
│  Your filesystem        │
│  (agent workspace root) │
└─────────────────────────┘
```

The playground runs an in-process Fastify server that serves the agent HTTP surface. The Vite frontend connects to it locally — no deployment, no external dependencies.

---

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm --filter agent-playground dev` | Start with auto-rebuild + HMR |
| `pnpm --filter agent-playground typecheck` | TypeScript check (builds agent first) |

### Dev Script Behavior

The `dev` script runs:
```bash
pnpm --filter @hachej/boring-agent build:dev && tsx --env-file=.env.local src/server/index.ts
```

The `build:dev` step ensures agent source changes are compiled before the playground server starts. This means you can edit agent code, save, and restart the playground with the updated build — no separate `pnpm build` needed.

---

## What It Does NOT Include

| Feature | Status | Where to Find It |
|---------|--------|------------------|
| Auth / login | ❌ No | `apps/full-app` |
| Postgres / DB | ❌ No | `apps/full-app` |
| Workbench panels | ❌ No | `apps/workspace-playground` |
| Plugin system | ❌ No | `apps/workspace-playground` |
| File tree / editor | ❌ No | `apps/workspace-playground` |
| Command palette | ❌ No | `apps/workspace-playground` |
| Session persistence | ⚠️ In-memory | `apps/full-app` (JSONL + DB) |

---

## How agent-playground Compares

| Feature | agent-playground | full-app | npx boring-ui-cli |
|---------|-----------------|----------|-------------------|
| Setup time | ✅ ~30 seconds | ⚠️ Requires Postgres | ✅ ~30 seconds |
| Agent access | ✅ Direct, full | ✅ Via core routes | ✅ Direct |
| Workbench panels | ❌ None | ✅ Full IDE | ✅ Full IDE |
| File tree/editor | ❌ None | ✅ Yes | ✅ Yes |
| Auth/workspaces | ❌ None | ✅ Multi-user | ❌ None |
| Best for | Agent runtime dev | Production reference | Quick demos |

**When to use agent-playground:**
- You're modifying `@hachej/boring-agent` source (tools, chat UI, harness)
- You want the fastest possible agent test loop
- You don't need panels, auth, or database

**When it might not fit:**
- You need file tree and panels (use `workspace-playground`)
- You need multi-user auth and workspaces (use `full-app`)
- You want a one-command demo (use `npx @hachej/boring-ui-cli`)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ANTHROPIC_API_KEY not set` | Missing env var | Create `.env.local` with `ANTHROPIC_API_KEY` |
| Port 5173 in use | Vite default port occupied | Set `PORT=5174` or kill the other process |
| Agent returns empty responses | Invalid API key | Check your Anthropic API key is valid and has quota |
| Build errors on startup | Agent package not compiled | Run `pnpm --filter @hachej/boring-agent build:dev` manually first |
| HMR not updating | Stale build artifacts | Restart the dev server (the dev script rebuilds agent each time) |

---

## Limitations

- **No persistent sessions**: Session state is in-memory and resets on restart.
- **No multi-user**: Single workspace, no auth, no roles.
- **No workbench**: Just chat. No file tree, editor panels, or plugin system.
- **Local filesystem only**: The agent sees the directory configured as its workspace root. No remote sandbox.
- **Not a production template**: This is a dev playground. Use `apps/full-app` for deployable code.

---

## FAQ

**Q: Why not just use `npx @hachej/boring-agent`?**  
A: The playground gives you HMR and auto-rebuild of agent source code. `npx` uses a compiled package — to see your code changes you'd need to rebuild and reinstall. The playground is faster for active development.

**Q: Can I change the agent's workspace root?**  
A: Set `BORING_AGENT_WORKSPACE_ROOT=/path/to/dir` in your `.env.local`. The agent will see that directory as its filesystem.

**Q: How do I test a different model?**  
A: Set `BORING_AGENT_DEFAULT_MODEL_PROVIDER` and `BORING_AGENT_DEFAULT_MODEL_ID` in `.env.local`. Note: only Anthropic Claude is wired in v1.

**Q: Can I add plugins to the playground?**  
A: The playground uses a bare agent runtime. To add plugins (ask-user, data-catalog), add them to the agent app creation in `src/server/index.ts` and register them in the frontend.

**Q: Where are sessions stored?**  
A: In-memory via pi-coding-agent's session manager. They're lost on restart. For persistent sessions, see `apps/full-app` which uses JSONL files + Postgres.

---

## See Also

- [`apps/full-app`](../full-app/README.md) — full production reference app
- [`apps/workspace-playground`](../workspace-playground/README.md) — workbench + panels + plugins
- [`packages/agent/README.md`](../../packages/agent/README.md) — agent package documentation

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT

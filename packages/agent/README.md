# @hachej/boring-agent

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-agent.svg)](https://www.npmjs.com/package/@hachej/boring-agent)

</div>

A pane-embeddable coding agent with three execution modes behind one interface. Ships as a standalone CLI (`npx @hachej/boring-agent`) and composes into any app shell.

```bash
npx @hachej/boring-agent
```

---

## TL;DR

**The Problem**: You want a coding agent in the browser — but also as a CLI — and you need it to run your code somewhere safe (or not). Existing solutions force you into one deployment model and one UI.

**The Solution**: One package that ships a full LLM agent loop, tool catalog, and chat UI — with swappable execution backends. Same agent, same tools, same UI. Three modes. Zero config to start.

### Why Use @hachej/boring-agent?

| Feature | What It Does |
|---------|--------------|
| **Three execution modes** | `direct` (no isolation, macOS dev) / `local` (bwrap sandbox) / `vercel-sandbox` (Firecracker microVM) |
| **CLI + embeddable** | `npx @hachej/boring-agent` works standalone; `<ChatPanel />` composes into any layout |
| **7 standard tools** | `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls` — ported from pi-coding-agent |
| **Workspace-local runtime provisioning** | Generates `.boring-agent` inside the selected workspace for mirrored skills, SDKs, CLIs, and templates |
| **Workspace-agnostic FS** | `Workspace` interface — agent tools and HTTP routes share the same filesystem view |
| **Session management** | List, create, switch, delete sessions with streamed history hydration |
| **UI bridge** | Agent opens files, panels, and surfaces in the workbench via typed commands |
| **Model picker + thinking toggle** | Inline in the composer — switch models and reasoning depth per message |

### Quick Example

```bash
# Start the agent in your current directory — zero setup
npx @hachej/boring-agent

# Or run with a specific workspace root
BORING_AGENT_WORKSPACE_ROOT=/path/to/project npx @hachej/boring-agent

# Set the API key
ANTHROPIC_API_KEY=sk-ant-... npx @hachej/boring-agent

# Run in local sandbox mode (Linux + bubblewrap)
BORING_AGENT_MODE=local npx @hachej/boring-agent
```

In the browser chat, try:
```
read the README and summarize it
find all TypeScript files that import "react"
write a test for src/utils.ts
```

---

## Workspace-local runtime provisioning

Boring UI keeps generated runtime state in the selected workspace at
`$BORING_AGENT_WORKSPACE_ROOT/.boring-agent`. Plugin skills are mirrored to
`.boring-agent/skills`, runtime CLIs live under `.boring-agent/node` or
`.boring-agent/venv`, and templates seed only missing workspace files. The
folder is generated/disposable and should not be hand-edited or committed.

See [docs/runtime-provisioning.md](docs/runtime-provisioning.md) for the full
user and plugin-author contract, including package metadata shape,
`provisionWorkspace: false`, `/api/v1/agent/reload`, and direct/local/Vercel
mode behavior.

---

## Architecture

```
┌─────────────────────────────────────┐
│         Chat UI (browser)           │
│  Composer · Messages · SessionBar    │
└──────────────────┬──────────────────┘
                   │ UIMessage stream (SSE)
┌──────────────────▼──────────────────┐
│          Agent Harness              │
│  (pi-coding-agent loop)             │
└──────────────────┬──────────────────┘
                   │ AgentTool[]
┌──────────────────▼──────────────────┐
│         Tool Catalog                │
│  bash · read · write · edit         │
│  find · grep · ls                   │
└──────┬──────────────┬───────────────┘
       │              │
┌──────▼─────┐ ┌──────▼─────┐
│ Workspace   │ │  Sandbox   │
│ (fs ops)   │ │  (exec)    │
│ read/write │ │  bwrap     │
│ readdir    │ │  vercel    │
└────────────┘ └────────────┘
```

**Two layers, clear boundary:**

- **Layer 1 (Core runtime):** `AgentHarness` · `Catalog` · `Workspace` · `Sandbox` — interfaces locked; adapters swap per mode.
- **Layer 2 (Integration):** `SessionStore` · `UiBridge` · `Provisioning` — replaceable plumbing, independent evolution.

### Execution Modes

| Mode | Workspace | Sandbox | Isolation | Use Case |
|------|-----------|---------|-----------|----------|
| `direct` | `NodeWorkspace` | `DirectSandbox` | None | macOS/Windows dev, quick tests |
| `local` | `NodeWorkspace` | `BwrapSandbox` | bwrap process jail | Linux deployments, safer default |
| `vercel-sandbox` | `VercelSandboxWorkspace` | `VercelSandboxExec` | Firecracker microVM | Multi-tenant, remote execution |

**Pairing invariant:** Workspace + Sandbox must target the same filesystem substrate. The adapter factory enforces this at construction — mismatched pairs are impossible.

---

## Installation

```bash
# npm
npm install @hachej/boring-agent

# pnpm
pnpm add @hachej/boring-agent

# standalone (no install needed)
npx @hachej/boring-agent
```

### From Source

```bash
git clone https://github.com/hachej/boring-ui.git
cd boring-ui
pnpm install
pnpm --filter @hachej/boring-agent build
```

---

## Quick Start

### 1. As a CLI

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run in your project directory
cd /path/to/project
npx @hachej/boring-agent
```

Opens `http://localhost:5200` with a full agent workspace pointed at your cwd.

### 2. Embedded in an App

**Server:**

```ts
import { createAgentApp } from "@hachej/boring-agent/server"

const app = await createAgentApp({
  mode: "local",              // "direct" | "local" | "vercel-sandbox"
  workspaceRoot: process.cwd(),
  apiBaseUrl: "http://localhost:3000",
})
await app.listen({ port: 3001 })
```

**Frontend:**

```tsx
import { ChatPanel, useAgentChat } from "@hachej/boring-agent"
import "@hachej/boring-agent/front/styles.css"

function App() {
  return <ChatPanel apiBaseUrl="http://localhost:3000" />
}
```

### 3. Composed with Workspace

```tsx
import { WorkspaceProvider, IdeLayout } from "@hachej/boring-workspace"
import { ChatPanel } from "@hachej/boring-agent"

function App() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel} workspaceId="proj-1">
      <IdeLayout />
    </WorkspaceProvider>
  )
}
```

---

## Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-agent` | Browser | `ChatPanel`, `SessionToolbar`, primitives, hooks, `theme.css` |
| `@hachej/boring-agent/server` | Node | `createAgentApp`, routes, harness, sandbox, workspace adapters |
| `@hachej/boring-agent/front` | Browser | Frontend-specific (same as top-level, explicit subpath) |
| `@hachej/boring-agent/shared` | Any | `AgentHarness`, `Workspace`, `Sandbox`, `AgentTool`, `SessionStore` interfaces |
| `@hachej/boring-agent/front/styles.css` | Browser | CSS custom properties for theming |
| `@hachej/boring-agent/eval` | Node | Evaluation toolkit for agent behavior |

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `BORING_AGENT_MODE` | No | `direct` | `direct`, `local`, or `vercel-sandbox` |
| `BORING_AGENT_WORKSPACE_ROOT` | No | `.` | Root directory for workspace |
| `BORING_AGENT_DEFAULT_MODEL_PROVIDER` | No | `anthropic` | Default model provider |
| `BORING_AGENT_DEFAULT_MODEL_ID` | No | `claude-sonnet-4-6` | Default model ID |
| `VERCEL_OIDC_TOKEN` | Remote only | — | Required for `vercel-sandbox` mode |
| `PORT` | No | `5200` | Server port |
| `HOST` | No | `localhost` | Server host |

### Config File

`boring.app.toml` (optional, for embedded mode):

```toml
[runtime]
mode = "local"           # direct | local | vercel-sandbox

[model]
default_provider = "anthropic"
default_id = "claude-sonnet-4-6"
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ANTHROPIC_API_KEY not set` | Missing API key | `export ANTHROPIC_API_KEY=sk-ant-...` |
| `bwrap not found` (local mode) | bubblewrap not installed | `sudo apt install bubblewrap` (Debian/Ubuntu) |
| `port already in use` | Port 5200 occupied | `PORT=5201 npx @hachej/boring-agent` |
| `workspace root not found` | Invalid `BORING_AGENT_WORKSPACE_ROOT` | Point to an existing directory |
| `Vercel sandbox auth failed` (remote mode) | Missing/invalid OIDC token | Set `VERCEL_OIDC_TOKEN` |
| `model provider not supported` | Unknown provider in config | Use `anthropic` (only supported provider in v1) |

---

## Limitations

- **Single model provider**: Only Anthropic (Claude) is supported in v1. The harness interface is designed to accept others, but only `anthropic` is wired.
- **No multi-user auth**: The agent is single-workspace-per-instance. Multi-user auth, billing, and workspace CRUD belong to `@hachej/boring-core`.
- **No git UI**: The agent runs git via `bash`, but there's no status bar, diff pane, or branch picker. When git UI lands, thin routes will be added.
- **Plugin loading is local-only**: Pi plugins load in the backend Node process. They're disabled in `vercel-sandbox` mode for security.
- **No browser-agent mode yet**: The `AgentHarness` interface has a `placement: "browser"` option, but no browser harness is implemented.
- **No MCP tool integration**: Not in scope for v1.

---

## FAQ

**Q: What's the difference between `direct` and `local` mode?**  
A: `direct` runs bash commands with no sandbox — the agent has full access to your machine. `local` wraps commands in bubblewrap (`bwrap`), which provides filesystem and process isolation on Linux. Use `direct` for macOS dev; use `local` on Linux servers.

**Q: Can I use OpenAI or other model providers?**  
A: Not in v1. Only Anthropic's Claude is wired up. The harness interface is provider-agnostic — community PRs for other providers are welcome.

**Q: How do sessions persist?**  
A: Via pi-coding-agent's JSONL session files under `${workdir}/.pi/sessions/`. The `PiSessionStore` reads and manages lifecycle. SQLite and IndexedDB implementations are planned.

**Q: Can I add custom tools to the agent?**  
A: Yes. Use the `CatalogDeps` pattern to build tools that bind to `Workspace` and `Sandbox`. For pi-native tools, register them via pi's extension system (`pi.extensions` in config). In `vercel-sandbox` mode, extensions are disabled.

**Q: What's the UI bridge for?**  
A: It lets the agent programmatically open files, panels, and surfaces in the workbench. The agent calls `exec_ui({ kind: "openFile", params: { path: "src/index.ts" } })` and the panel opens. It's a typed pubsub bus between backend and frontend.

**Q: How does stream resumption work?**  
A: The server wraps the harness's event stream in a per-turn ring buffer. Disconnected clients reconnect via `GET /api/v1/agent/pi-chat/:sessionId/events?from=<seq>`; the replay buffer serves missed events.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT

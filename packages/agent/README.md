# @hachej/boring-agent

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-agent.svg)](https://www.npmjs.com/package/@hachej/boring-agent)

</div>

A pane-embeddable coding agent: an LLM agent loop, a tool catalog, and a chat UI
behind one interface, with three swappable execution modes. The same agent,
tools, and UI run in `direct` (host process), `local` (bwrap sandbox), or
`vercel-sandbox` (Firecracker microVM) mode.

## Install

```bash
pnpm add @hachej/boring-agent
# or: npm install @hachej/boring-agent
```

Peer deps (optional): `react`, `react-dom`, `tailwindcss`.

## Usage

**Server** — standalone Fastify app:

```ts
import { createAgentApp } from "@hachej/boring-agent/server"

const app = await createAgentApp({
  mode: "local",                 // "direct" | "local" | "vercel-sandbox"
  workspaceRoot: process.cwd(),
})
await app.listen({ port: 3001 })
```

To embed routes into an existing Fastify instance, use `registerAgentRoutes`
instead. The full IDE shell (file tree, panes, UI-bridge tools) lives in
`@hachej/boring-workspace`, which mounts this agent.

**Authored agents (A1 v1)** — trusted server materialization:

```ts
import { materializeAgentDirectory } from "@hachej/boring-agent/server"

const source = await materializeAgentDirectory({
  directory: "agents/claims-assistant",
  expectedAgentTypeId: "claims-assistant",
  toolCatalog: new Map([["claims.lookup", trustedClaimsLookupTool]]),
})
```

A1 materializes JSON/Markdown into a server-only source. It does not create or
resolve `AgentDeployment`, deployment/digest provenance, CAS, registry state, or
runtime authority. Tool refs resolve only through an explicit per-agent trusted
host allowlist; capability, skill, and MCP refs are rejected as unsupported in
v1 materialization.

**Frontend** — the chat panel:

```tsx
import { ChatPanel } from "@hachej/boring-agent"
import "@hachej/boring-agent/front/styles.css"

function App() {
  return <ChatPanel apiBaseUrl="http://localhost:3001" />
}
```

## Configuration

Set an API key for the model provider (e.g. `ANTHROPIC_API_KEY`). Common env
vars: `BORING_AGENT_MODE` (default `direct`), `BORING_AGENT_WORKSPACE_ROOT`
(default cwd), `BORING_AGENT_SESSION_ROOT` (durable Pi session storage),
`BORING_AGENT_PORT`, and the `BORING_AGENT_DEFAULT_MODEL*` /
`BORING_AGENT_CUSTOM_MODEL*` / `BORING_AGENT_INFOMANIAK*` provider settings. See
[docs/runtime.md](./docs/runtime.md) and [docs/API.md](./docs/API.md).

## Documentation

See [docs/README.md](./docs/README.md) for the full doc index — architecture,
the export surfaces (`/front`, `/server`, `/shared`, `/eval`), authored-agent
materialization, runtime modes and provisioning, theming, plugins, error codes,
and risk/cost notes.

## Contributions

I do not accept outside contributions for my projects: I don't have the
bandwidth to review them, and it's my name on the result. Issues and bug reports
are welcome; PRs may be used to illustrate a fix, but I won't merge them
directly — I'll have Claude or Codex review submissions via `gh` and
independently decide whether and how to address them.

## License

MIT

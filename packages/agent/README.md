# @hachej/boring-agent

Agent runtime and chat UI for boring-ui apps.

```bash
pnpm add @hachej/boring-agent
```

---

## What it provides

- **Agent runtime** — LLM conversation loop with streaming, tool calling, and three execution modes
- **Tool catalog** — `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls` and more
- **Chat UI** — embeddable `ChatPanel` React component

---

## Execution modes

| Mode | Isolation | Typical use |
|---|---|---|
| `direct` | None | Local dev |
| `local` | `bwrap` process isolation | Safer Linux deployments |
| `vercel-sandbox` | Firecracker microVM | Multi-tenant / remote |

---

## Quickstart

```tsx
import { ChatPanel } from "@hachej/boring-agent"
import { WorkspaceProvider, IdeLayout } from "@hachej/boring-workspace"

export function App() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel}>
      <IdeLayout />
    </WorkspaceProvider>
  )
}
```

Server:

```ts
import { createAgentApp } from "@hachej/boring-agent/server"

const app = await createAgentApp({ mode: "local", workspaceRoot: process.cwd() })
await app.listen({ port: 3001 })
```

---

## Model config

```bash
ANTHROPIC_API_KEY=sk-ant-...
BORING_AGENT_DEFAULT_MODEL_PROVIDER=anthropic
BORING_AGENT_DEFAULT_MODEL_ID=claude-sonnet-4-6
```

---

## Package surfaces

```ts
import { ChatPanel } from "@hachej/boring-agent"           // React chat UI
import { ... } from "@hachej/boring-agent/server"          // Node/server entry
import { ... } from "@hachej/boring-agent/front"           // Frontend-only
import { ... } from "@hachej/boring-agent/shared"          // Platform-agnostic contracts
```

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

| Package | Role |
|---|---|
| `@hachej/boring-agent` | Agent runtime + tools |
| `@hachej/boring-workspace` | Plugin system, workbench |
| `@hachej/boring-core` | DB, auth, app factory |
| `@hachej/boring-ui-kit` | Shared UI primitives |
| `@hachej/boring-ui-cli` | Zero-setup CLI |

# @boring/agent

Pane-embeddable chat agent with pluggable sandboxing.

`@boring/agent` ships one mental model with three execution modes:

- `direct`: no isolation, local filesystem access.
- `local`: bubblewrap (`bwrap`) isolation on Linux.
- `vercel-sandbox`: remote Firecracker microVM execution.

It works as:

- A standalone CLI (`npx @boring/agent`).
- A package you embed into your own app shell.

## Quickstart

Current scaffold (works today):

```bash
pnpm --dir packages/agent dev
```

This starts the Fastify + Vite dev setup added in M0.

Planned package quickstart (after CLI beads land):

```bash
npx @boring/agent
```

## Runtime Modes

| Mode | Filesystem | Command execution | Isolation | Typical use |
|---|---|---|---|---|
| `direct` | Host machine | `child_process.exec` | None | Fast local dev on macOS/Windows/Linux |
| `local` | Host machine | `bwrap` sandbox | Host-level process isolation | Safer local/server Linux deployments |
| `vercel-sandbox` | Remote VM | Vercel Sandbox | Firecracker microVM boundary | Multi-tenant or remote isolated execution |

Status: only `direct` runtime is implemented in the current scaffold. `local` and `vercel-sandbox` are planned and tracked by later beads.

### Mode Selection

Planned auto-detect defaults:

- If Linux + `bwrap` is available: prefer `local`.
- Otherwise: use `direct`.
- `vercel-sandbox` is explicit opt-in.

## Architecture

Core runtime is split into four abstractions:

- `Harness`: LLM conversation loop and streaming.
- `Catalog`: tool registry exposed to the model.
- `Workspace`: filesystem operations (`readFile`, `writeFile`, etc).
- `Sandbox`: command execution (`exec` and optional isolated code execution).

High-level wiring:

```text
User/HTTP
   |
   v
Harness (sendMessage)
   |
   v
Catalog (tools)
   |                     |
   v                     v
Workspace <paired with> Sandbox
```

Important invariant: `Workspace` and `Sandbox` are swapped as a pair so tools and shell execution see the same filesystem substrate.

## Embedding in an App

Typical split in `boring-ui-v2`:

- `@boring/agent`: chat/runtime/tools/sandbox adapters.
- `@boring/workspace`: IDE-style layout and panes.
- App shell: composition and product-specific policy.

Use the app shell to choose runtime mode, inject stores, and expose HTTP routes to the frontend.

## Package Surfaces

- `@boring/agent` for front-facing exports.
- `@boring/agent/shared` for platform-agnostic contracts.
- `@boring/agent/server` for Node/server-only entry points.
- `@boring/agent/front` for frontend-only entry points.

## Custom Tools Example

See the minimal integration sketch:

- [examples/with-custom-tool](./examples/with-custom-tool/README.md)

## Design Notes

- Shared contracts in `src/shared/**` stay platform-agnostic.
- No `node:*` imports in shared contracts.
- No `Buffer` in shared contracts (`Uint8Array` only).
- UI dispatch flows through `UiBridge.postCommand`.

## Documentation

- [API](./docs/API.md)
- [STYLING](./docs/STYLING.md)
- [PLUGINS](./docs/PLUGINS.md)
- [MIGRATION](./docs/MIGRATION.md)

## Development

From repo root:

```bash
pnpm --dir packages/agent install
pnpm --dir packages/agent dev
pnpm --dir packages/agent test
pnpm --dir packages/agent lint
```

## License

Internal project in active development.

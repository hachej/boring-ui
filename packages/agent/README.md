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

Status: all three runtimes share one tool surface. `direct` and `local` run against the host workspace; `vercel-sandbox` runs file operations and bash in the same remote sandbox.

### Mode Selection

Default auto-detect behavior:

- If Linux + `bwrap` is available: prefer `local`.
- Otherwise: use `direct`.
- `vercel-sandbox` is explicit opt-in.

## Architecture

Core runtime is split into four abstractions:

- `Harness`: LLM conversation loop and streaming.
- `Catalog`: pi factory tools exposed to the model.
- `Workspace`: filesystem operations (`readFile`, `writeFile`, etc).
- `Sandbox`: command execution (`exec` and optional isolated code execution).

Baseline agent tools follow pi's names, schemas, and prompt snippets:
`bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls`. Custom behavior
is routed through pi Operations adapters or spawn hooks; custom AgentTools are
reserved for gaps such as `execute_isolated_code` and Vercel-only grep execution.

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

## Two UI Flavors

| | `@boring/agent` (bare) | `@boring/agent/ui-shadcn` |
|---|---|---|
| Import | `import { ChatPanel } from '@boring/agent'` | `import { ChatPanel } from '@boring/agent/ui-shadcn'` |
| Styling | CSS-var tokens, zero framework | Tailwind v4 + shadcn/ui |
| When to use | Embed in an existing design system | Standalone / Vercel-style chatbot |

Both are permanent. See [docs/UI-SHADCN.md](./docs/UI-SHADCN.md) for the full guide.

## Package Surfaces

- `@boring/agent` for front-facing exports.
- `@boring/agent/shared` for platform-agnostic contracts.
- `@boring/agent/server` for Node/server-only entry points.
- `@boring/agent/front` for frontend-only entry points.
- `@boring/agent/ui-shadcn` for Tailwind + shadcn styled ChatPanel.
- `@boring/agent/testing` for the eval framework (LLM tool-selection regression tests).

## Examples

- [examples/with-custom-tool](./examples/with-custom-tool/README.md) — bare ChatPanel with a custom tool
- [examples/with-shadcn](./examples/with-shadcn/) — Tailwind + shadcn styled ChatPanel

## Design Notes

- Shared contracts in `src/shared/**` stay platform-agnostic.
- No `node:*` imports in shared contracts.
- No `Buffer` in shared contracts (`Uint8Array` only).
- UI dispatch flows through `UiBridge.postCommand`.

## Documentation

- [API](./docs/API.md)
- [STYLING](./docs/STYLING.md)
- [CSP](./docs/CSP.md)
- [UI-SHADCN](./docs/UI-SHADCN.md)
- [PLUGINS](./docs/PLUGINS.md)
- [MIGRATION](./docs/MIGRATION.md)
- [CHANGELOG](./CHANGELOG.md)
- [Eval framework plan](./docs/plans/AGENT_EVAL_FRAMEWORK.md)

## Eval Framework

`@boring/agent/testing` is a YAML-driven harness for catching regressions in
LLM tool selection. Hosts (workspace, boring-macro, etc.) write fixtures
that say *"for this prompt, the agent must call this tool with these
params"* and the runner replays them through the real `app.inject` chat
route against `claude-haiku-4-5-20251001`.

Quickstart:

```bash
# Run the agent's own catalog suite (read / write / edit / bash / find).
ANTHROPIC_API_KEY=… pnpm --filter @boring/agent eval

# Run a custom suite.
pnpm --filter @boring/agent eval path/to/suite.yaml
```

Fixture format (excerpt):

```yaml
model: claude-haiku-4-5-20251001
defaults:
  retries: 1
  timeoutMs: 45000
prompts:
  - prompt: read the file README.md and tell me what it says
    expect:
      tool: read
      params:
        path: README.md

  - prompt: open the chart panel
    expect:
      tool: exec_ui
      params:
        kind: openPanel
        params:
          id: !EvalAny           # wildcard — any value satisfies
          component: !EvalRegex "^chart:"

  - prompt: what is 2 + 2?
    expectNoToolCall: true        # negative assertion
```

Hosts that wire their own tool catalog (e.g. workspace adds
`exec_ui`/`get_ui_state`, boring-macro adds `open_series`) write their own
driver script that boots `createWorkspaceAgentApp` (or equivalent) and
calls `runEvalSuite({ app, fixturesPath })`. The agent CLI runs the bare
`createAgentApp` baseline.

See [docs/plans/AGENT_EVAL_FRAMEWORK.md](./docs/plans/AGENT_EVAL_FRAMEWORK.md)
for the full design (pinned model, retry policy, fork-PR trust gate).

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

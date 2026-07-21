# @hachej/boring-agent Docs

`@hachej/boring-agent` is a pane-embeddable coding agent: an LLM agent loop, a
tool catalog, and a chat UI, with swappable execution backends. The same agent,
tools, and UI run in three modes — `direct` (host process), `local` (bwrap
sandbox), and `vercel-sandbox` (Firecracker microVM) — selected at construction.
It is consumed two ways: standalone via `createAgentApp` (Fastify server +
`ChatPanel`), or mounted into `@hachej/boring-workspace` for the full IDE shell.

## Architecture

```
Chat UI (ChatPanel / front)
   │  pi-chat SSE stream
Agent HTTP routes (registerAgentRoutes / createAgentApp)
   │
Agent harness (pi-coding-agent loop)  ── Tool catalog (AgentTool[])
   │                                          │
Workspace (filesystem)            Sandbox (command execution)
```

- **front** (`src/front`) — `ChatPanel` (= `PiChatPanel`), primitives, slash
  commands, tool renderers, session hooks. Browser-only.
- **server** (`src/server`) — `createAgentApp`, `registerAgentRoutes`, the Pi
  harness adapter, sandbox/workspace adapters, runtime provisioning, model
  config, HTTP routes. Node-only.
- **shared** (`src/shared`) — platform-agnostic contracts and zod schemas
  (`AgentHarness`, `Workspace`, `Sandbox`, `AgentTool`, `SessionStore`, chat
  frames, error codes).
- **eval** (`src/eval`) — agent-behavior evaluation toolkit.

Data flow: the browser opens a pi-chat SSE stream; the server drives the
pi-coding-agent harness; tools resolve filesystem ops through the `Workspace`
adapter and shell/exec through the `Sandbox` adapter. Workspace + Sandbox must
target the same filesystem substrate (the mode adapter enforces the pairing).

## Key abstractions

The public surfaces a consumer or extender touches (all in
`@hachej/boring-agent/shared` unless noted):

- `AgentHarness` — the agent loop interface; pi-coding-agent is the v1 impl.
- `Workspace` / `Sandbox` — filesystem and command-execution adapters, swapped
  per mode.
- `AgentTool` + `CatalogDeps` — the tool contract and the deps tools bind to.
- `SessionStore` — session listing/lifecycle.
- `createAgentApp` / `registerAgentRoutes` (`/server`) — entry points to run or
  embed the server.
- `ChatPanel` (`/front`) — the embeddable UI.

## Architectural decisions

Locked decisions live in the root [`docs/DECISIONS.md`](../../../docs/DECISIONS.md);
the agent ↔ workspace boundary is in
[`docs/WORKSPACE_CONTRACT.md`](../../../docs/WORKSPACE_CONTRACT.md). Highlights:

- Standalone CLI-shaped product; same code embeds into a host shell — decision 1.
- pi-coding-agent as the v1 harness behind a generic `AgentHarness` — decisions 4–5.
- `mode = direct | local | vercel-sandbox`; Workspace+Sandbox pairing invariant — decisions 7a–7f.
- Single Anthropic provider by default, but the model layer also supports custom
  OpenAI-compatible and Infomaniak providers — decision 10.
- Plugins extend via Pi resources or trusted server plugins, not core edits — decision 8.
- Four export surfaces: top-level/`front`, `/server`, `/shared`, `/eval` — decision 15.

## Documentation

**Surfaces & integration**

- [API](./API.md) — the four entry points and what each exports.
- [AUTHORING](./AUTHORING.md) — declarative agent directories, bounds, validation, and legacy catalog migration.
- [STYLING](./STYLING.md) — CSS-variable theming contract and public selectors.
- [UI-SHADCN](./UI-SHADCN.md) — `ChatPanel` styling model and tool-renderer overrides.
- [tools](./tools.md) — built-in tools, package-added tools, and how to add custom tools.
- [PLUGINS](./PLUGINS.md) — the two extension paths and tool-collision rules.
- [MIGRATION](./MIGRATION.md) — moving legacy integrations to the v2 split.

**Runtime & provisioning**

- [runtime](./runtime.md) — the three modes, the cwd invariant, and `.boring-agent/` layout.
- [runtime-provisioning](./runtime-provisioning.md) — when provisioning runs, package-authoring shape, trusted server provisioning.

**Contracts & operations**

- [ERROR_CODES](./ERROR_CODES.md) — the stable API error-code registry.
- [CSP](./CSP.md) — Content-Security-Policy compatibility.
- [ACCESSIBILITY](./ACCESSIBILITY.md) — a11y coverage and known gaps.

**Risk & cost notes**

- [KNOWN_LIMITATIONS](./KNOWN_LIMITATIONS.md) — accepted risks (orphaned sandboxes, deferred git routes).
- [RISKS-MULTI-TAB](./RISKS-MULTI-TAB.md) — last-write-wins behavior for concurrent edits.
- [VERCEL_COSTS](./VERCEL_COSTS.md) — Vercel sandbox cost model.
- [PERFORMANCE](./PERFORMANCE.md) — historical Vercel cold-start benchmark.

Historical plans and specs live under `docs/plans/archive/` — archival context only, not
current truth; verify against code before relying on them.

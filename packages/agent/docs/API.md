# API

This file documents the package API as it exists today in the v2 scaffold.
Roadmap-only APIs are explicitly marked.

## Entry Points

`@boring/agent` currently maps to the frontend entry (`dist/front.js`).

Additional subpath exports:

- `@boring/agent/front`
- `@boring/agent/shared`
- `@boring/agent/server`

## Current Runtime Surface

### `@boring/agent/server`

Currently exported:

- `createDirectSandbox` from `src/server/sandbox/direct/createDirectSandbox.ts`

Notes:

- This is the only runtime mode implementation currently available.
- Local `bwrap` and remote `vercel-sandbox` adapters are planned.

### `@boring/agent/shared`

Current contract files:

- `harness.ts` — `AgentHarness`, streaming event contracts.
- `tool.ts` — `AgentTool`, `ToolExecContext`, `ToolResult`.
- `workspace.ts` — platform-agnostic filesystem contract.
- `sandbox.ts` — command execution contract.
- `session.ts` — `SessionStore` and session models.
- `ui-bridge.ts` — `UiBridge`, `UiCommand`, `CommandResult`.
- `catalog.ts`, `file-search.ts`, `message.ts`, `sandbox-handle-store.ts`.

These files are the source of truth for TypeScript interfaces while higher-level
helpers are still being implemented.

## Planned High-Level API (Not Implemented Yet)

The following names appear in the spec and upcoming beads but are not shipped as
public runtime exports yet:

- `createAgentApp(...)`
- `ChatPanel`
- `useAgentChat(...)`

Track implementation progress in `docs/plans/agent-package-spec.md` and beads.

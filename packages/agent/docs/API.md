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
- `ui-bridge.ts` — `WorkspaceBridge`, `UiCommand`, `CommandResult`.
- `catalog.ts`, `file-search.ts`, `message.ts`, `sandbox-handle-store.ts`.

These files are the source of truth for TypeScript interfaces while higher-level
helpers are still being implemented.

## Shipped High-Level API

- `createAgentApp(config)` — standalone Fastify factory. Zero dependency on `@boring/core`. Powers `npx @boring/agent`. See `packages/agent/src/server/createAgentApp.ts`.
- `ChatPanel` — React component exported from `@boring/agent/front` (and top-level barrel). See `packages/agent/src/front/index.ts:2`.
- `useAgentChat(...)` — React hook, same export surface.

## Planned High-Level API (Not Implemented Yet)

- `registerAgentRoutes(app, opts)` — new Fastify plugin export for embedding into a core-built server. Lands in agent M4 alongside core's integration milestone. Paths are absolute (`/api/v1/agent/*`); no `prefix` option.

Track implementation progress in `docs/plans/agent-package-spec.md` and beads.

## Deferred HTTP Git Surface (v1.x)

`/api/v1/git/*` routes are intentionally not part of agent v1.

- Reason: there is no first-party git UI consumer in agent/workspace v1, so
  these routes would be dead code.
- Current behavior: use the `bash` tool for git commands.
- Activation point: when git UI returns (status/diff/badges), add the routes as
  thin wrappers over sandbox git execution.

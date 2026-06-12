# API

The package exposes four entry points. Browser code imports the top-level (or
`/front`) barrel; Node servers import `/server`; both share types from
`/shared`. The eval toolkit ships under `/eval`.

## Entry Points

| Import | Environment | Source barrel |
|---|---|---|
| `@hachej/boring-agent` | Browser | `src/front/index.ts` (alias of `/front`) |
| `@hachej/boring-agent/front` | Browser | `src/front/index.ts` |
| `@hachej/boring-agent/front/styles.css` | Browser | precompiled CSS |
| `@hachej/boring-agent/server` | Node | `src/server/index.ts` |
| `@hachej/boring-agent/shared` | Any | `src/shared/index.ts` |
| `@hachej/boring-agent/eval` | Node | `src/eval/index.ts` |

## `@hachej/boring-agent/front`

The styled chat UI and its building blocks. Key exports:

- `ChatPanel` (alias of `PiChatPanel`) — the pane-embeddable chat component.
  Props include `apiBaseUrl`, `sessionId`, and `toolRenderers`. See
  `src/front/chat/PiChatPanel.tsx`.
- `usePiSessions` and session helpers (`readActiveSessionId`,
  `writeActiveSessionId`, `PiSessionList`, `PiSessionBrowser`).
- Slash-command surface: `builtinCommands`, `createCommandRegistry`,
  `parseSlashCommand`, `getAgentCommands`.
- Tool renderers: `defaultToolRenderers`, `mergeToolRenderers`,
  `resolveToolRenderer`, `mergeShadcnToolRenderers`, `ToolCallGroup`.
- Primitives (`Message`, `Conversation`, `Reasoning`, `CodeBlock`,
  `PromptInput`, …) and the `cn` class helper.
- `DebugDrawer`, `ChatEmptyState`, `ArtifactOpenProvider`/`useOpenArtifact`,
  `uploadFile`.

> Note: there is no `useAgentChat` hook. The chat lifecycle lives inside
> `ChatPanel`/`PiChatPanel` and the `usePiSessions` hook.

## `@hachej/boring-agent/server`

The Node runtime. Key exports:

- `createAgentApp(opts)` — standalone Fastify factory. Zero dependency on
  `@hachej/boring-core` or `@hachej/boring-workspace`. See
  `src/server/createAgentApp.ts`.
- `registerAgentRoutes(app, opts)` — mounts the agent HTTP routes onto an
  existing Fastify instance (used by `@hachej/boring-workspace`). Paths are
  absolute under `/api/v1/agent/*`, `/api/v1/files`, etc.
- Sandbox adapters: `createDirectSandbox`, `createBwrapSandbox`, plus the
  Vercel sandbox/snapshot helpers (`createVercelSandboxWorkspace`,
  `bakeSnapshotIfNeeded`, deployment-snapshot providers, `FileHandleStore`).
- Workspace adapters: `createNodeWorkspace`, `createVercelSandboxWorkspace`.
- Mode resolution: `autoDetectMode`, `resolveMode`, `hasBwrap`.
- Provisioning: `provisionRuntimeWorkspace`, `provisionWorkspaceRuntime`,
  `getBoringAgentRuntimePaths`, `getBoringAgentRuntimeEnv`,
  `createVercelProvisioningAdapter`.
- HTTP/CSP: `applyCspHeaders`; `fileRoutes` for mounting file routes alone.
- Harness: `createResourceSettingsManager` and the Pi harness option types.
- `createLogger`.

## `@hachej/boring-agent/shared`

Platform-agnostic contracts (types + zod schemas). Source of truth for the
public interfaces:

- `harness.ts` — `AgentHarness`, `SendMessageInput`, `RunContext`,
  `AgentHarnessFactory`.
- `tool.ts` / `tool-ui.ts` — `AgentTool`, `ToolExecContext`, `ToolResult`,
  `JSONSchema`, `ToolUiMetadata`.
- `workspace.ts` — `Workspace`, `Entry`, `Stat`.
- `sandbox.ts` — `Sandbox`, `SandboxCapability`, `ExecOptions`, `ExecResult`.
- `catalog.ts` — `CatalogDeps`, `ToolCatalog`.
- `session.ts` — `SessionStore`, `SessionSummary`, `SessionDetail`.
- `config-schema.ts` — `ConfigSchema`, `EnvSchema`, `RuntimeModeSchema`,
  `validateConfig`.
- `error-codes.ts` — `ErrorCode`, `ERROR_CODES`, error-envelope schemas
  (see [ERROR_CODES.md](./ERROR_CODES.md)).
- `chat.ts` — `BoringChatMessage`, `PiChatEvent`, stream/snapshot frames and
  their zod schemas.
- `capabilities.ts`, `telemetry.ts`, `runtime.ts`, `sandbox-handle-store.ts`,
  `validateTool.ts`, `agentPluginEvents.ts`.

> There is no `ui-bridge.ts` or `message.ts` in `shared/`. UI-bridge tools
> (`exec_ui`, `get_ui_state`) and their types now live in
> `@hachej/boring-workspace` — `createAgentApp` ships zero UI tools by design.

## Deferred HTTP Git Surface

`/api/v1/git/*` routes exist but are intentionally thin/minimal: there is no
first-party git UI consumer in the agent today, so git operations run through
the `bash` tool. See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

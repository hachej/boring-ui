// @boring/agent — shared (platform-agnostic) public API

export type { AgentHarness, SendMessageInput, RunContext } from './harness'
export type { Workspace, Entry, Stat } from './workspace'
export type {
  Sandbox,
  SandboxCapability,
  ExecOptions,
  ExecResult,
  IsolatedCodeInput,
  IsolatedCodeOutput,
} from './sandbox'
export type { AgentTool, ToolExecContext, ToolResult, JSONSchema } from './tool'
export type { CatalogDeps, ToolCatalog } from './catalog'
export type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
} from './session'
export type { UIMessage, UIMessageChunk } from './message'
export type {
  UiBridge,
  UiState,
  UiCommand,
  CommandResult,
} from './ui-bridge'
export type { FileSearch } from './file-search'
export type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from './sandbox-handle-store'
export {
  RuntimeModeSchema,
  ConfigSchema,
  EnvSchema,
  validateConfig,
} from './config-schema'
export type { RuntimeModeId, AgentConfig, AgentEnv } from './config-schema'
export {
  ErrorCode,
  ERROR_CODES,
  ApiErrorPayloadSchema,
  ApiErrorResponseSchema,
  ErrorLogFieldsSchema,
} from './error-codes'
export type {
  ApiErrorPayload,
  ApiErrorResponse,
  ErrorLogFields,
} from './error-codes'

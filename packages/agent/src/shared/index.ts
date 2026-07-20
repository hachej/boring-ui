// @hachej/boring-agent — shared (platform-agnostic) public API

export type {
  AgentCoreHarness,
  AgentCoreHarnessFactory,
  AgentCorePromptInput,
  AgentCoreSessionAdapter,
  AgentCoreSessionSnapshot,
  AgentHarness,
  AgentSendInput,
  MessageAttachment,
  RunContext,
  SendMessageInput,
} from './harness'
export type {
  Agent,
  AgentActor,
  AgentConfig as CoreAgentConfig,
  AgentEvent,
  AgentMessageContent,
  AgentMessagePart,
  AgentReadiness,
  AgentReadinessStatus,
  AgentResolveInputResponse,
  AgentRuntimeAdapter,
  AgentStartReceipt,
  AgentStreamOptions,
} from './events'
export {
  AGENT_NOT_IMPLEMENTED_UNTIL_T1,
  AgentNotImplementedError,
  sessionStreamPath,
} from './events'
export type {
  WorkspaceAgentDispatcher,
  WorkspaceAgentDispatcherContext,
  WorkspaceAgentDispatcherSendInput,
} from './workspaceAgentDispatcher'
export type { WorkspaceRuntimeContext } from './runtime'
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
export type { ToolUiMetadata } from './tool-ui'
export { isToolUiMetadata, extractToolUiMetadata } from './tool-ui'
export type { CatalogDeps, ToolCatalog } from './catalog'
export type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionActivity,
  SessionActivityOptions,
  SessionActivityStatus,
  SessionDetail,
} from './session'
export type { FileSearch } from './file-search'
export type { AgentCliErrorV1 } from './agent-cli-error'
export type { TelemetryEvent, TelemetrySink } from './telemetry'
export { noopTelemetry, safeCapture } from './telemetry'
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
  AgentConsumptionErrorCode,
  AgentDefinitionErrorCode,
  AgentDeploymentErrorCode,
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
export {
  DEFAULT_AGENT_RUNTIME_CAPABILITIES,
  PI_AGENT_RUNTIME_CAPABILITIES,
} from './capabilities'
export type { AgentRuntimeCapabilities } from './capabilities'
export {
  AgentDefinitionValidationError,
  AgentDeploymentValidationError,
  OpaqueRefSchema,
  Sha256DigestSchema,
  createAgentAssetDigest,
  createAgentDefinitionDigest,
  createAgentDeploymentDigest,
  validateAgentDefinition,
  validateAgentDeployment,
} from './agent-definition'
export type {
  AgentDefinition,
  AgentDefinitionDigestAsset,
  AgentDefinitionReference,
  CompiledAgentDefinition,
  CompiledAgentBundle,
  AgentDeployment,
  AgentSchemaIssue,
  AgentSchemaValidationResult,
  Sha256Digest,
} from './agent-definition'
export { validateTool } from './validateTool'
export {
  TASK_STATES,
  ARTIFACT_LOCATOR_KINDS,
  AGENT_TASK_SCHEMA_VERSION,
  TaskStateSchema,
  PrincipalRefSchema,
  AgentRefSchema,
  WorkspaceFileLocatorSchema,
  ArtifactLocatorSchema,
  ArtifactRefSchema,
  PartSchema,
  AgentMessageSchema,
  AgentTaskSchema,
  ConsumptionGuardsSchema,
  AgentConsumptionValidationError,
  agentRefEquals,
  isValidTaskTransition,
  assertValidTransition,
  validateAgentTask,
  parseAgentTaskEdgeCompat,
  validateConsumptionGuards,
  detectConsumptionCycle,
  assertNoConsumptionCycle,
  isWithinConsumptionDepth,
  assertWithinConsumptionDepth,
} from './agent-consumption'
export type {
  TaskState,
  PrincipalRef,
  AgentRef,
  ArtifactLocatorKind,
  WorkspaceFileLocator,
  ArtifactLocator,
  ArtifactRef,
  TextPart,
  FilePart,
  DataPart,
  Part,
  AgentMessage,
  AgentTask,
  ConsumptionGuards,
} from './agent-consumption'
export {
  WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT,
  WORKSPACE_COMMAND_NOTIFY_EVENT,
} from './agentPluginEvents'
export type { CommandNotifyPayload } from './agentPluginEvents'
export {
  OpaqueShareLocatorIdSchema,
  ShareEntryProvenanceSchema,
  ShareEntryV1Schema,
  ShareEntryErrorCode,
  ShareEntryValidationError,
  InMemoryShareEntryStore,
  resolveShareEntry,
} from './share-entry'
export type {
  ShareEntryProvenance,
  ShareEntryV1,
  CreateShareEntryInput,
  ShareEntryStore,
  ShareEntryTombstone,
  ShareEntryResolution,
} from './share-entry'

export type {
  BoringChatMessage,
  BoringChatPart,
  ChatError,
  ChatAttachmentPayload,
  ChatModelSelection,
  ChatSubmitPayload,
  ThinkingLevel,
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  InterruptPayload,
  InterruptReceipt,
  PromptPayload,
  PromptReceipt,
  QueueClearPayload,
  QueueClearReceipt,
  StopPayload,
  StopReceipt,
  PiChatEvent,
  PiChatHeartbeatFrame,
  PiChatStreamFrame,
  PiChatSnapshot,
  PiChatStatus,
  QueuedUserMessage,
} from './chat'
export {
  BoringChatMessageSchema,
  BoringChatPartSchema,
  ChatAttachmentPayloadSchema,
  ChatErrorSchema,
  ChatModelSelectionSchema,
  CommandReceiptSchema,
  FollowUpPayloadSchema,
  FollowUpReceiptSchema,
  PiChatEventSchema,
  PiChatHeartbeatFrameSchema,
  PiChatSnapshotSchema,
  PiChatStatusSchema,
  PiChatStreamFrameSchema,
  PromptPayloadSchema,
  PromptReceiptSchema,
  QueueClearPayloadSchema,
  QueueClearReceiptSchema,
  InterruptPayloadSchema,
  StopPayloadSchema,
  QueuedUserMessageSchema,
  StopReceiptSchema,
  ThinkingLevelSchema,
  ToolUiMetadataSchema,
  sanitizeToolUiMetadata,
} from './chat'

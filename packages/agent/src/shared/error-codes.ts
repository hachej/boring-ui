import { z } from 'zod'

export const ErrorCode = z.enum([
  // Auth / config
  'UNAUTHORIZED',
  'MISSING_API_KEY',
  'INVALID_API_KEY',
  'OIDC_REFRESH_FAILED',
  'VERCEL_AUTH_FAILED',
  'CONFIG_INVALID',

  // Workspace / path
  'PATH_ESCAPE',
  'PATH_ABSOLUTE',
  'PATH_NULL_BYTE',
  'PATH_SYMLINK_ESCAPE',
  'PATH_NOT_FOUND',
  'PATH_NOT_WRITABLE',
  'WORKSPACE_UNINITIALIZED',
  'WORKSPACE_NOT_READY',
  'AGENT_HOST_SCOPE_VIOLATION',

  // Agent runtime / provisioning
  'AGENT_RUNTIME_NOT_READY',
  'AGENT_BINDING_DISPOSED',
  'AGENT_CONTROL_RECEIPT_INVALID',
  'RUNTIME_PROVISIONING_FAILED',
  'RUNTIME_PROVISIONING_LOCKED',

  // Sandbox / exec
  'BWRAP_UNAVAILABLE',
  'BWRAP_TIMEOUT',
  'OUTPUT_TRUNCATED',
  'SANDBOX_NOT_READY',
  'SANDBOX_EXPIRED',
  'VERCEL_API_ERROR',
  'REMOTE_WORKER_TIMEOUT',
  'REMOTE_WORKER_STREAM_CLOSED',
  'CIRCUIT_OPEN',
  'ABORTED',

  // Billing / metering
  'PAYMENT_REQUIRED',
  'MODEL_BUDGET_EXCEEDED',
  'METERING_UNSUPPORTED_COMMAND',

  // Session / bridge
  'SESSION_NOT_FOUND',
  'SESSION_LOCKED',
  'STREAM_BUFFER_EVICTED',
  'CURSOR_OUT_OF_RANGE',
  'BRIDGE_COMMAND_INVALID',

  // Tool
  'TOOL_NOT_FOUND',
  'TOOL_INVALID_INPUT',
  'TOOL_EXECUTION_ERROR',
  'AUTHORED_AGENT_ID_INVALID',
  'AUTHORED_AGENT_TYPE_MISMATCH',
  'AUTHORED_AGENT_REFERENCE_UNSUPPORTED',
  'AUTHORED_AGENT_TOOL_COLLISION',
  'MCP_AGENT_ARTIFACT_INVALID',
  'MCP_AGENT_ARTIFACT_TOO_LARGE',
  'MCP_AGENT_ARTIFACT_UNAVAILABLE',

  // Plugin
  'PLUGIN_LOAD_FAILED',
  'PLUGIN_NAME_COLLISION',
  'PLUGIN_RUNTIME_REVISION_MISMATCH',
  'PLUGIN_RUNTIME_PRIVATE_FILE',
  'PLUGIN_RUNTIME_UNSAFE_IMPORT',
  'PLUGIN_RUNTIME_TRANSFORM_FAILED',
  'RUNTIME_PLUGIN_NOT_FOUND',
  'RUNTIME_PLUGIN_ROUTE_NOT_FOUND',
  'RUNTIME_PLUGIN_HANDLER_FAILED',
  'RUNTIME_PLUGIN_LOAD_FAILED',
  'RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED',

  // Runtime provisioning
  'PROVISIONING_LAYOUT_FAILED',
  'PROVISIONING_SKILLS_FAILED',
  'PROVISIONING_TEMPLATES_FAILED',
  'PROVISIONING_NODE_PREFLIGHT_FAILED',
  'PROVISIONING_NPM_INSTALL_FAILED',
  'PROVISIONING_UV_BOOTSTRAP_FAILED',
  'PROVISIONING_UV_INSTALL_FAILED',
  'PROVISIONING_ARTIFACT_FAILED',

  // Lane W same-workspace share deep-link (AR1-003)
  'AR1_SHARE_NOT_FOUND',
  'AR1_SHARE_TOMBSTONED',

  // Internal
  'ERR_NOT_IMPLEMENTED_UNTIL_T1',
  'INTERNAL_ERROR',
])

export type ErrorCode = z.infer<typeof ErrorCode>

export const ERROR_CODES = ErrorCode.options

export const AgentDefinitionErrorCode = z.enum([
  'AGENT_DEFINITION_INVALID',
  'AGENT_DEFINITION_UNSUPPORTED_FIELD',
  'AUTHORED_AGENT_REFERENCE_UNSUPPORTED',
])

export type AgentDefinitionErrorCode = z.infer<typeof AgentDefinitionErrorCode>

export const AgentDeploymentErrorCode = z.enum([
  'AGENT_DEPLOYMENT_INVALID',
  'AGENT_DEPLOYMENT_UNSUPPORTED_FIELD',
])

export type AgentDeploymentErrorCode = z.infer<typeof AgentDeploymentErrorCode>

/**
 * Refusal codes for the agent-consumption contract (AC1, Decision 22,
 * issue #636). Scoped like {@link AgentDeploymentErrorCode} — canonical,
 * but intentionally outside the public {@link ErrorCode} / {@link
 * ERROR_CODES} registry (and `docs/ERROR_CODES.md`) until a runtime
 * dispatcher actually surfaces these over an API boundary.
 */
export const AgentConsumptionErrorCode = z.enum([
  'AGENT_CONSUMPTION_INVALID_TRANSITION',
  'AGENT_CONSUMPTION_CYCLE_DETECTED',
  'AGENT_CONSUMPTION_DEPTH_EXCEEDED',
  'AGENT_CONSUMPTION_SCHEMA_MISMATCH',
  'AGENT_CONSUMPTION_LEGACY_ARTIFACT_REJECTED',
])

export type AgentConsumptionErrorCode = z.infer<typeof AgentConsumptionErrorCode>

export const ApiErrorPayloadSchema = z.object({
  code: ErrorCode,
  message: z.string().min(1),
  details: z.record(z.unknown()).optional(),
})

export type ApiErrorPayload = z.infer<typeof ApiErrorPayloadSchema>

export const ApiErrorResponseSchema = z.object({
  error: ApiErrorPayloadSchema,
})

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>

export const ErrorLogFieldsSchema = z
  .object({
    level: z.enum(['warn', 'error']),
    code: ErrorCode,
    prefix: z.string().min(1),
    msg: z.string().min(1),
  })
  .catchall(z.unknown())

export type ErrorLogFields = z.infer<typeof ErrorLogFieldsSchema>

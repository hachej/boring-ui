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

  // Agent runtime / provisioning
  'AGENT_RUNTIME_NOT_READY',
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

  // Internal
  'ERR_NOT_IMPLEMENTED_UNTIL_T1',
  'INTERNAL_ERROR',
])

export type ErrorCode = z.infer<typeof ErrorCode>

export const ERROR_CODES = ErrorCode.options

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

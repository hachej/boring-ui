import { z } from 'zod'

export const ErrorCode = z.enum([
  // Auth / config
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

  // Sandbox / exec
  'BWRAP_UNAVAILABLE',
  'BWRAP_TIMEOUT',
  'OUTPUT_TRUNCATED',
  'SANDBOX_NOT_READY',
  'SANDBOX_EXPIRED',
  'VERCEL_API_ERROR',
  'CIRCUIT_OPEN',
  'ABORTED',

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

  // Internal
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

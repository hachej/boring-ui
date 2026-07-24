import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  AgentDefinitionErrorCode,
  AgentDeploymentErrorCode,
  ApiErrorResponseSchema,
  ERROR_CODES,
  ErrorCode,
  ErrorLogFieldsSchema,
} from '../error-codes'

const EXPECTED_ERROR_CODES = [
  'UNAUTHORIZED',
  'MISSING_API_KEY',
  'INVALID_API_KEY',
  'OIDC_REFRESH_FAILED',
  'VERCEL_AUTH_FAILED',
  'CONFIG_INVALID',
  'PATH_ESCAPE',
  'PATH_ABSOLUTE',
  'PATH_NULL_BYTE',
  'PATH_SYMLINK_ESCAPE',
  'PATH_NOT_FOUND',
  'PATH_NOT_WRITABLE',
  'WORKSPACE_UNINITIALIZED',
  'WORKSPACE_NOT_READY',
  'AGENT_HOST_SCOPE_VIOLATION',
  'AGENT_RUNTIME_NOT_READY',
  'AGENT_BINDING_DISPOSED',
  'AGENT_CONTROL_RECEIPT_INVALID',
  'RUNTIME_PROVISIONING_FAILED',
  'RUNTIME_PROVISIONING_LOCKED',
  'BWRAP_UNAVAILABLE',
  'BWRAP_TIMEOUT',
  'OUTPUT_TRUNCATED',
  'SANDBOX_NOT_READY',
  'SANDBOX_EXPIRED',
  'VERCEL_API_ERROR',
  'REMOTE_WORKER_CONFIG_INVALID',
  'REMOTE_WORKER_PROTOCOL_MISMATCH',
  'REMOTE_WORKER_UNAUTHENTICATED',
  'REMOTE_WORKER_UNAVAILABLE',
  'REMOTE_WORKER_UNQUALIFIED',
  'REMOTE_WORKER_REQUEST_INVALID',
  'REMOTE_WORKER_RESPONSE_INVALID',
  'REMOTE_WORKER_CAPABILITY_EXPIRED',
  'REMOTE_WORKER_AUTHORIZED_WORKSPACE_REQUIRED',
  'REMOTE_WORKER_BINDING_RECEIPT_INVALID',
  'REMOTE_WORKER_SANDBOX_WORKSPACE_MISMATCH',
  'REMOTE_WORKER_SANDBOX_NOT_FOUND',
  'REMOTE_WORKER_SANDBOX_EXPIRED',
  'REMOTE_WORKER_SANDBOX_DISPOSED',
  'REMOTE_WORKER_CREATE_CONCURRENCY_EXHAUSTED',
  'REMOTE_WORKER_EXEC_CONCURRENCY_EXHAUSTED',
  'REMOTE_WORKER_IDEMPOTENCY_CONFLICT',
  'REMOTE_WORKER_EXEC_IN_PROGRESS',
  'REMOTE_WORKER_SECRET_INVOCATION_NOT_REPLAYABLE',
  'REMOTE_WORKER_OUTCOME_UNKNOWN',
  'REMOTE_WORKER_INCOMPLETE_CLEANUP',
  'REMOTE_WORKER_DOCKER_COMMAND_FAILED',
  'REMOTE_WORKER_TIMEOUT',
  'REMOTE_WORKER_STREAM_CLOSED',
  'CIRCUIT_OPEN',
  'ABORTED',
  'PAYMENT_REQUIRED',
  'MODEL_BUDGET_EXCEEDED',
  'METERING_UNSUPPORTED_COMMAND',
  'SESSION_NOT_FOUND',
  'SESSION_LOCKED',
  'STREAM_BUFFER_EVICTED',
  'CURSOR_OUT_OF_RANGE',
  'BRIDGE_COMMAND_INVALID',
  'live_transcript_disabled',
  'live_transcript_local_only',
  'live_transcript_already_active',
  'live_transcript_session_not_found',
  'live_transcript_attachment_invalid',
  'live_transcript_setup_timeout',
  'live_transcript_permission_denied',
  'live_transcript_attachment_failed',
  'live_transcript_invalid_audio',
  'live_transcript_backpressure',
  'live_transcript_limit_exceeded',
  'live_transcript_upstream_failed',
  'live_transcript_revision_conflict',
  'live_transcript_not_active',
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
  'PROVISIONING_LAYOUT_FAILED',
  'PROVISIONING_SKILLS_FAILED',
  'PROVISIONING_TEMPLATES_FAILED',
  'PROVISIONING_NODE_PREFLIGHT_FAILED',
  'PROVISIONING_NPM_INSTALL_FAILED',
  'PROVISIONING_UV_BOOTSTRAP_FAILED',
  'PROVISIONING_UV_INSTALL_FAILED',
  'PROVISIONING_ARTIFACT_FAILED',
  'AR1_SHARE_NOT_FOUND',
  'AR1_SHARE_TOMBSTONED',
  'ERR_NOT_IMPLEMENTED_UNTIL_T1',
  'INTERNAL_ERROR',
] as const

function docCodesFromMarkdown(markdown: string): string[] {
  const matches = Array.from(
    markdown.matchAll(/^\|\s*`([A-Za-z0-9_]+)`\s*\|/gm),
    (match) => match[1],
  )
  return matches
}

describe('error code registry', () => {
  test('contains all known canonical codes', () => {
    expect(ERROR_CODES).toEqual(EXPECTED_ERROR_CODES)
  })

  test('parses every known code and rejects unknown codes', () => {
    for (const code of EXPECTED_ERROR_CODES) {
      expect(ErrorCode.parse(code)).toBe(code)
    }

    expect(() => ErrorCode.parse('path_escape')).toThrow()
    expect(() => ErrorCode.parse('totally_unknown_code')).toThrow()
  })

  test('keeps agent schema validation codes canonical', () => {
    expect(AgentDefinitionErrorCode.options).toEqual([
      AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
      AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
      AgentDefinitionErrorCode.enum.AUTHORED_AGENT_REFERENCE_UNSUPPORTED,
    ])
    expect(AgentDeploymentErrorCode.options).toEqual([
      AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_INVALID,
      AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_UNSUPPORTED_FIELD,
    ])
    expect(ERROR_CODES).not.toContain(AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID)
    expect(ERROR_CODES).not.toContain(AgentDeploymentErrorCode.enum.AGENT_DEPLOYMENT_INVALID)
  })
})

describe('error response and logs', () => {
  test('validates canonical API error response shape', () => {
    const parsed = ApiErrorResponseSchema.parse({
      error: {
        code: ErrorCode.enum.PATH_ESCAPE,
        message: "Path '../secrets' escapes workspace root",
        details: { path: '../secrets', workspaceRoot: '/tmp/ws' },
      },
    })

    expect(parsed.error.code).toBe('PATH_ESCAPE')
  })

  test('validates structured error log shape', () => {
    const parsed = ErrorLogFieldsSchema.parse({
      level: 'error',
      code: ErrorCode.enum.INTERNAL_ERROR,
      prefix: '[workspace]',
      msg: 'failed to stat file',
      requestId: 'req-123',
    })

    expect(parsed.code).toBe('INTERNAL_ERROR')
    expect(parsed.requestId).toBe('req-123')
  })
})

describe('docs parity', () => {
  test('ERROR_CODES.md stays in sync with enum values', () => {
    const docsPath = new URL('../../../docs/ERROR_CODES.md', import.meta.url)
    const markdown = readFileSync(docsPath, 'utf8')
    const docCodes = docCodesFromMarkdown(markdown)

    expect(new Set(docCodes)).toEqual(new Set(ERROR_CODES))
    expect(docCodes).toHaveLength(ERROR_CODES.length)
  })
})

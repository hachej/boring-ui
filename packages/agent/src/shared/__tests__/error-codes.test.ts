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
  'REMOTE_WORKER_TIMEOUT',
  'REMOTE_WORKER_STREAM_CLOSED',
  'CIRCUIT_OPEN',
  'ABORTED',
  'PAYMENT_REQUIRED',
  'MODEL_BUDGET_EXCEEDED',
  'METERING_UNSUPPORTED_COMMAND',
  'SESSION_NOT_FOUND',
  'SESSION_LOCKED',
  'NATIVE_SESSION_START_OUTCOME_UNKNOWN',
  'STREAM_BUFFER_EVICTED',
  'CURSOR_OUT_OF_RANGE',
  'BRIDGE_COMMAND_INVALID',
  'TOOL_NOT_FOUND',
  'TOOL_INVALID_INPUT',
  'TOOL_EXECUTION_ERROR',
  'AUTHORED_AGENT_ID_INVALID',
  'AUTHORED_AGENT_TYPE_MISMATCH',
  'AUTHORED_AGENT_CATALOG_REQUIRED',
  'AUTHORED_AGENT_CATALOG_INVALID',
  'AUTHORED_AGENT_REFERENCE_UNKNOWN',
  'AUTHORED_AGENT_REFERENCE_UNSUPPORTED',
  'AUTHORED_AGENT_TOOL_INVALID',
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
    markdown.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|/gm),
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

  test('keeps agent schema validation codes canonical and outside the API registry', () => {
    expect(AgentDefinitionErrorCode.options).toEqual([
      AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
      AgentDefinitionErrorCode.enum.AGENT_DEFINITION_UNSUPPORTED_FIELD,
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

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
import { CREDENTIAL_ERROR_CODES } from '../credentials'

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
  'AGENT_FLEET_PLUGIN_UNKNOWN',
  'AGENT_FLEET_CONFIG_BINDING_UNKNOWN',
  'AGENT_FLEET_MODEL_POLICY_UNCOMPILED',
  'AGENT_FLEET_SEAT_PERSONA_INVALID',
  'AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH',
  'AGENT_FLEET_CONFIG_FILE_INVALID',
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
  'SESSION_TRANSCRIPT_UNREADABLE',
  'STREAM_BUFFER_EVICTED',
  'CURSOR_OUT_OF_RANGE',
  'BRIDGE_COMMAND_INVALID',
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
  'SKILL_DISCOVERY_FAILED',
  'PACKAGE_RESOURCE_INVALID',
  'PACKAGE_RESOURCE_CONFLICT',
  'RUNTIME_FILESYSTEM_BINDING_DUPLICATE',
  'AR1_SHARE_NOT_FOUND',
  'AR1_SHARE_TOMBSTONED',
  'ERR_NOT_IMPLEMENTED_UNTIL_T1',
  'INTERNAL_ERROR',
] as const

/**
 * ERROR_CODES.md carries one table per registry. Codes are read per section so
 * the canonical `ERROR_CODES` enum and the credential enum stay independently
 * in sync instead of being conflated into one flat list.
 */
function docSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`)
  if (start < 0) throw new Error(`Missing ERROR_CODES.md section: ${heading}`)
  const rest = markdown.slice(start + heading.length + 3)
  const end = rest.indexOf('\n## ')
  return end < 0 ? rest : rest.slice(0, end)
}

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
    const docCodes = docCodesFromMarkdown(docSection(markdown, 'Registry'))

    expect(new Set(docCodes)).toEqual(new Set(ERROR_CODES))
    expect(docCodes).toHaveLength(ERROR_CODES.length)
  })

  test('ERROR_CODES.md documents every credential error code', () => {
    const docsPath = new URL('../../../docs/ERROR_CODES.md', import.meta.url)
    const markdown = readFileSync(docsPath, 'utf8')
    const docCodes = docCodesFromMarkdown(
      docSection(markdown, 'Credential registry'),
    )
    const credentialCodes = Object.values(CREDENTIAL_ERROR_CODES)

    expect(new Set(docCodes)).toEqual(new Set(credentialCodes))
    expect(docCodes).toHaveLength(credentialCodes.length)
  })
})

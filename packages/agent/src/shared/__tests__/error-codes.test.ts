import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  ApiErrorResponseSchema,
  ERROR_CODES,
  ErrorCode,
  ErrorLogFieldsSchema,
} from '../error-codes'

const EXPECTED_ERROR_CODES = [
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
  'BWRAP_UNAVAILABLE',
  'BWRAP_TIMEOUT',
  'OUTPUT_TRUNCATED',
  'SANDBOX_NOT_READY',
  'SANDBOX_EXPIRED',
  'VERCEL_API_ERROR',
  'CIRCUIT_OPEN',
  'ABORTED',
  'SESSION_NOT_FOUND',
  'SESSION_LOCKED',
  'STREAM_BUFFER_EVICTED',
  'CURSOR_OUT_OF_RANGE',
  'BRIDGE_COMMAND_INVALID',
  'TOOL_NOT_FOUND',
  'TOOL_INVALID_INPUT',
  'TOOL_EXECUTION_ERROR',
  'PLUGIN_LOAD_FAILED',
  'PLUGIN_NAME_COLLISION',
  'PROVISIONING_LAYOUT_FAILED',
  'PROVISIONING_SKILLS_FAILED',
  'PROVISIONING_TEMPLATES_FAILED',
  'PROVISIONING_NODE_PREFLIGHT_FAILED',
  'PROVISIONING_NPM_INSTALL_FAILED',
  'PROVISIONING_UV_BOOTSTRAP_FAILED',
  'PROVISIONING_UV_INSTALL_FAILED',
  'PROVISIONING_ARTIFACT_FAILED',
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

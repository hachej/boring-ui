import { describe, expect, test } from 'vitest'

import { createLogger } from '../../../logging'
import {
  bytesWritten,
  decode,
  decoder,
  DEFAULT_TOOL_LIMIT,
  makeError,
  MAX_PATTERN_LENGTH,
  MAX_TOOL_LIMIT,
  normalizeLimit,
  nowIso,
  type FileChangeMetadata,
} from '../_shared'

const logger = createLogger('[test:tools:_shared]')

function logStep(step: string, details: Record<string, unknown> = {}): void {
  logger.info('step', { suite: '_shared', step, ...details })
}

describe('tool _shared helpers', () => {
  test('makeError returns standard ToolResult error shape', () => {
    logStep('makeError:start')

    expect(makeError('boom')).toEqual({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    })
  })

  test('bytesWritten counts UTF-8 bytes, not JavaScript code units', () => {
    logStep('bytesWritten:utf8')

    expect(bytesWritten('hello')).toBe(5)
    expect(bytesWritten('cafe')).toBe(4)
    expect(bytesWritten('cafe\u0301')).toBe(6)
    expect(bytesWritten('😀')).toBe(4)
  })

  test('nowIso returns an ISO-8601 UTC timestamp', () => {
    logStep('nowIso:start')

    const timestamp = nowIso()

    expect(Number.isNaN(Date.parse(timestamp))).toBe(false)
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(timestamp.endsWith('Z')).toBe(true)
  })

  test('normalizeLimit uses defaults, truncates integers, and clamps max', () => {
    logStep('normalizeLimit:happy-path', { default: DEFAULT_TOOL_LIMIT, max: MAX_TOOL_LIMIT })

    expect(normalizeLimit(undefined, { default: 42, max: 99 })).toEqual({ limit: 42 })
    expect(normalizeLimit(10.9, { default: 42, max: 99 })).toEqual({ limit: 10 })
    expect(normalizeLimit(123, { default: 42, max: 99 })).toEqual({ limit: 99 })
  })

  test('normalizeLimit returns existing tool error phrasing for invalid limits', () => {
    logStep('normalizeLimit:invalid')

    expect(normalizeLimit('10', { default: 42, max: 99 })).toEqual({
      limit: 42,
      error: 'limit must be a number when provided',
    })
    expect(normalizeLimit(Number.NaN, { default: 42, max: 99 })).toEqual({
      limit: 42,
      error: 'limit must be a number when provided',
    })
    expect(normalizeLimit(Number.POSITIVE_INFINITY, { default: 42, max: 99 })).toEqual({
      limit: 42,
      error: 'limit must be a number when provided',
    })
    expect(normalizeLimit(0, { default: 42, max: 99 })).toEqual({
      limit: 42,
      error: 'limit must be >= 1 when provided',
    })
    expect(normalizeLimit(-1, { default: 42, max: 99 })).toEqual({
      limit: 42,
      error: 'limit must be >= 1 when provided',
    })
  })

  test('decode uses the shared non-fatal UTF-8 TextDecoder', () => {
    logStep('decode:utf8')

    expect(decoder).toBeInstanceOf(TextDecoder)
    expect(decode(new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe('café')
    expect(() => decode(new Uint8Array([0xe2, 0x28, 0xa1]))).not.toThrow()
    expect(decode(new Uint8Array([0xe2, 0x28, 0xa1]))).toContain('\uFFFD')
  })

  test('constants and FileChangeMetadata shape match Phase 0 contract', () => {
    logStep('contract:constants-and-metadata')

    const change = {
      op: 'write',
      path: 'src/index.ts',
      timestamp: '2026-04-28T00:00:00.000Z',
      size: 42,
      existsBefore: false,
    } satisfies FileChangeMetadata

    expect(DEFAULT_TOOL_LIMIT).toBe(200)
    expect(MAX_TOOL_LIMIT).toBe(5_000)
    expect(MAX_PATTERN_LENGTH).toBe(256)
    expect(change.existsBefore).toBe(false)
  })
})

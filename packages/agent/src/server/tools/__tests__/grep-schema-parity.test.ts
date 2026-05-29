import { createGrepToolDefinition } from '@mariozechner/pi-coding-agent'
import { describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../shared/sandbox'
import { createLogger } from '../../logging'
import { vercelGrepTool } from '../vercelGrepTool'

const logger = createLogger('[test:tools:grepSchemaParity]')

function execResult(): ExecResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 0,
    truncated: false,
  }
}

function createSandbox(): Sandbox {
  return {
    id: 'grep-schema-parity',
    placement: 'remote',
    provider: 'vercel-sandbox',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    exec: vi.fn(async () => execResult()),
  }
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

describe('vercelGrepTool schema parity', () => {
  test('matches pi grep TypeBox schema exactly', () => {
    const vercelSchema = vercelGrepTool(createSandbox()).parameters
    const piSchema = createGrepToolDefinition('/workspace').parameters
    const actual = stringify(vercelSchema)
    const expected = stringify(piSchema)

    logger.info('step', {
      suite: 'grep-schema-parity',
      step: 'compare-schema-json',
      actualBytes: actual.length,
      expectedBytes: expected.length,
    })

    expect(actual, [
      '[grep-schema-parity] vercelGrepTool schema drifted from pi grep schema.',
      'Expected pi schema:',
      expected,
      'Actual vercel schema:',
      actual,
    ].join('\n')).toBe(expected)
  })
})

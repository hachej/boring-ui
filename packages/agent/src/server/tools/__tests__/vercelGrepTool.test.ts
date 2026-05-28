import { createGrepTool } from '@mariozechner/pi-coding-agent'
import { describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../shared/sandbox'
import { createLogger } from '../../logging'
import { vercelGrepTool } from '../vercelGrepTool'

const logger = createLogger('[test:tools:vercelGrep]')

function logStep(step: string, data: Record<string, unknown> = {}): void {
  logger.info('step', { suite: 'vercelGrepTool', step, ...data })
}

function runContext(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    toolCallId: 'tool-call-1',
    abortSignal: controller.signal,
  }
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function execResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 10,
    truncated: false,
    ...overrides,
  }
}

function createSandbox(result: ExecResult): Sandbox {
  return {
    id: 'vercel-grep-test',
    placement: 'remote',
    provider: 'vercel-sandbox',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    exec: vi.fn().mockResolvedValue(result),
  }
}

function rgMatch(file: string, line: number, text: string): string {
  return JSON.stringify({
    type: 'match',
    data: {
      path: { text: file },
      line_number: line,
      lines: { text },
    },
  })
}

function rgContext(file: string, line: number, text: string): string {
  return JSON.stringify({
    type: 'context',
    data: {
      path: { text: file },
      line_number: line,
      lines: { text },
    },
  })
}

describe('vercelGrepTool', () => {
  test('matches pi grep name, description, and schema byte-for-byte', () => {
    const sandbox = createSandbox(execResult())
    const tool = vercelGrepTool(sandbox)
    const piTool = createGrepTool('/')

    logStep('schema-parity', { toolName: tool.name })
    expect(tool.name).toBe(piTool.name)
    expect(tool.description).toBe(piTool.description)
    expect(JSON.stringify(tool.parameters)).toBe(JSON.stringify(piTool.parameters))
  })

  test('forwards schema fields to ripgrep args inside sandbox.exec', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = vercelGrepTool(sandbox)

    await tool.execute(
      {
        pattern: 'useEffect',
        path: 'src',
        glob: '*.tsx',
        ignoreCase: true,
        literal: true,
        context: 2,
      },
      runContext(),
    )

    const command = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const options = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>
    logStep('rg-command', { command })
    expect(command).toContain('rg --json --line-number --color=never --hidden')
    expect(command).toContain('--ignore-case')
    expect(command).toContain('--fixed-strings')
    expect(command).toContain("--glob '*.tsx'")
    expect(command).toContain('--context 2')
    expect(command).toContain("'useEffect'")
    expect(command).toContain("'src'")
    expect(options).toMatchObject({
      signal: expect.any(AbortSignal),
      timeoutMs: 30_000,
      maxOutputBytes: 2_097_152,
    })
  })

  test('parses ripgrep json match output into pi-compatible content', async () => {
    const stdout = [
      rgMatch('src/index.ts', 5, 'export function main() {\n'),
      rgMatch('src/utils.ts', 12, '  return clamp(value, min, max)\n'),
    ].join('\n')
    const sandbox = createSandbox(execResult({ stdout: encode(stdout) }))
    const tool = vercelGrepTool(sandbox)

    const result = await tool.execute({ pattern: 'function' }, runContext())

    logStep('parse-matches', { isError: result.isError, text: result.content[0]?.text })
    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toContain('src/index.ts:5: export function main() {')
    expect(result.content[0]?.text).toContain('src/utils.ts:12:   return clamp(value, min, max)')
    expect(result.details).toBeUndefined()
  })

  test('parses ripgrep json context lines with pi separators', async () => {
    const stdout = [
      rgContext('src/index.ts', 4, 'before\n'),
      rgMatch('src/index.ts', 5, 'match\n'),
      rgContext('src/index.ts', 6, 'after\n'),
    ].join('\n')
    const sandbox = createSandbox(execResult({ stdout: encode(stdout) }))
    const tool = vercelGrepTool(sandbox)

    const result = await tool.execute({ pattern: 'match', context: 1 }, runContext())

    expect(result.content[0]?.text).toContain('src/index.ts-4- before')
    expect(result.content[0]?.text).toContain('src/index.ts:5: match')
    expect(result.content[0]?.text).toContain('src/index.ts-6- after')
  })

  test('honors limit truncation using GrepToolDetails shape', async () => {
    const stdout = [
      rgMatch('a.ts', 1, 'one\n'),
      rgMatch('b.ts', 2, 'two\n'),
      rgMatch('c.ts', 3, 'three\n'),
    ].join('\n')
    const sandbox = createSandbox(execResult({ stdout: encode(stdout) }))
    const tool = vercelGrepTool(sandbox)

    const result = await tool.execute({ pattern: 'line', limit: 2 }, runContext())

    expect(result.content[0]?.text).toContain('a.ts:1: one')
    expect(result.content[0]?.text).toContain('b.ts:2: two')
    expect(result.content[0]?.text).not.toContain('c.ts:3: three')
    expect(result.content[0]?.text).toContain('matches limit reached')
    expect(result.details).toEqual({ matchLimitReached: 2 })
  })

  test('treats ripgrep exit code 1 as successful no-match result', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = vercelGrepTool(sandbox)

    const result = await tool.execute({ pattern: 'not-there' }, runContext())

    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toBe('No matches found')
    expect(result.details).toBeUndefined()
  })

  test('surfaces ripgrep failures as useful errors', async () => {
    const sandbox = createSandbox(
      execResult({ exitCode: 2, stderr: encode('regex parse error') }),
    )
    const tool = vercelGrepTool(sandbox)

    const result = await tool.execute({ pattern: '[' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('grep failed: regex parse error')
  })

  test('honors already-aborted signals without executing', async () => {
    const sandbox = createSandbox(execResult())
    const tool = vercelGrepTool(sandbox)

    const result = await tool.execute({ pattern: 'test' }, runContext(true))

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe('grep aborted')
    expect(sandbox.exec).not.toHaveBeenCalled()
  })
})

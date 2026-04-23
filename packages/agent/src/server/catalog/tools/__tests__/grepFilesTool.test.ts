import { describe, expect, test, vi } from 'vitest'

import type { Sandbox, ExecResult } from '../../../../shared/sandbox'
import { createGrepFilesTool } from '../grepFilesTool'

function runContext(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    toolCallId: 'tool-call-1',
    abortSignal: controller.signal,
  }
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

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function createSandbox(result: ExecResult): Sandbox {
  return {
    id: 'test-sandbox',
    placement: 'server',
    capabilities: ['exec'],
    init: vi.fn(),
    exec: vi.fn().mockResolvedValue(result),
  }
}

describe('createGrepFilesTool', () => {
  test('returns structured matches from grep output', async () => {
    const stdout = [
      './src/index.ts:5:export function main() {',
      './src/utils.ts:12:  return clamp(value, min, max)',
    ].join('\n')
    const sandbox = createSandbox(execResult({ stdout: encode(stdout) }))
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'function' }, runContext())

    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toContain('./src/index.ts:5:export function main() {')
    expect(result.content[0]?.text).toContain('./src/utils.ts:12:  return clamp(value, min, max)')

    const details = result.details as any
    expect(details.matchCount).toBe(2)
    expect(details.matches[0]).toEqual({
      file: './src/index.ts',
      line: 5,
      text: 'export function main() {',
    })
    expect(details.matches[1]).toEqual({
      file: './src/utils.ts',
      line: 12,
      text: '  return clamp(value, min, max)',
    })
  })

  test('passes glob filter to grep command', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = createGrepFilesTool(sandbox)

    await tool.execute({ pattern: 'TODO', glob: '*.ts' }, runContext())

    const cmd = (sandbox.exec as any).mock.calls[0][0] as string
    expect(cmd).toContain('*.ts')
  })

  test('returns no matches found when grep exits 1', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'nonexistent' }, runContext())

    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toBe('no matches found')
    const details = result.details as any
    expect(details.matchCount).toBe(0)
  })

  test('uses default limit when omitted', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = createGrepFilesTool(sandbox)

    await tool.execute({ pattern: 'test' }, runContext())

    const details = (await tool.execute({ pattern: 'test' }, runContext())).details as any
    expect(details.limit).toBe(200)
  })

  test('clamps limit to 5000', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'test', limit: 999999 }, runContext())

    const details = result.details as any
    expect(details.limit).toBe(5000)
  })

  test('truncates matches beyond limit', async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      `./file.ts:${i + 1}:line ${i + 1}`,
    ).join('\n')
    const sandbox = createSandbox(execResult({ stdout: encode(lines) }))
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'line', limit: 3 }, runContext())

    const details = result.details as any
    expect(details.matchCount).toBe(3)
    expect(details.truncated).toBe(true)
  })

  test('validates required pattern', async () => {
    const sandbox = createSandbox(execResult())
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({}, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('pattern is required')
    expect(sandbox.exec).not.toHaveBeenCalled()
  })

  test('rejects null bytes in pattern', async () => {
    const sandbox = createSandbox(execResult())
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'foo\0bar' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('null bytes')
    expect(sandbox.exec).not.toHaveBeenCalled()
  })

  test('rejects empty glob', async () => {
    const sandbox = createSandbox(execResult())
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'test', glob: '' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('glob must be a non-empty string')
    expect(sandbox.exec).not.toHaveBeenCalled()
  })

  test('rejects invalid non-numeric limit', async () => {
    const sandbox = createSandbox(execResult())
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'test', limit: '10' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('limit must be a number')
    expect(sandbox.exec).not.toHaveBeenCalled()
  })

  test('aborts before exec when signal is already aborted', async () => {
    const sandbox = createSandbox(execResult())
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'test' }, runContext(true))

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('grep_files aborted')
    expect(sandbox.exec).not.toHaveBeenCalled()
  })

  test('returns error on non-0/1 exit code', async () => {
    const sandbox = createSandbox(
      execResult({ exitCode: 2, stderr: encode('grep: invalid regex') }),
    )
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: '[invalid' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('grep_files failed (exit 2)')
    expect(result.content[0]?.text).toContain('invalid regex')
  })

  test('returns clear failure when exec throws', async () => {
    const sandbox: Sandbox = {
      id: 'test-sandbox',
      placement: 'server',
      capabilities: ['exec'],
      init: vi.fn(),
      exec: vi.fn().mockRejectedValue(new Error('timeout')),
    }
    const tool = createGrepFilesTool(sandbox)

    const result = await tool.execute({ pattern: 'test' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('grep_files failed: timeout')
  })

  test('prefers ripgrep with fallback to grep in command', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = createGrepFilesTool(sandbox)

    await tool.execute({ pattern: 'test' }, runContext())

    const cmd = (sandbox.exec as any).mock.calls[0][0] as string
    expect(cmd).toContain('rg ')
    expect(cmd).toContain('|| grep')
  })

  test('passes abort signal and timeout to sandbox.exec', async () => {
    const sandbox = createSandbox(execResult({ exitCode: 1 }))
    const tool = createGrepFilesTool(sandbox)
    const ctx = runContext()

    await tool.execute({ pattern: 'test' }, ctx)

    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: ctx.abortSignal,
        timeoutMs: 30_000,
      }),
    )
  })
})

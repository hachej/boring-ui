import { describe, expect, test, vi } from 'vitest'

import { createBashTool } from '../bashTool'
import type { Sandbox, ExecResult, ExecOptions } from '../../../../shared/sandbox'

const encoder = new TextEncoder()

function encode(s: string): Uint8Array {
  return encoder.encode(s)
}

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: encode(''),
    stderr: encode(''),
    exitCode: 0,
    durationMs: 10,
    truncated: false,
    ...overrides,
  }
}

function createSandbox(
  execFn: (cmd: string, opts?: ExecOptions) => Promise<ExecResult>,
): Sandbox {
  return {
    id: 'test-sandbox',
    placement: 'server',
    capabilities: ['exec'],
    async init() {},
    exec: execFn,
  }
}

function makeCtx(abortSignal?: AbortSignal) {
  return {
    abortSignal: abortSignal ?? new AbortController().signal,
    toolCallId: 'tc-1',
  }
}

describe('createBashTool', () => {
  test('runs echo hi and returns decoded stdout', async () => {
    const sandbox = createSandbox(async () =>
      makeExecResult({ stdout: encode('hi\n'), exitCode: 0 }),
    )
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: 'echo hi' }, makeCtx())

    expect(result.isError).toBeFalsy()
    const output = JSON.parse(result.content[0].text)
    expect(output.stdout).toBe('hi\n')
    expect(output.exitCode).toBe(0)
    expect(output.truncated).toBe(false)
  })

  test('returns stderr and non-zero exit code on failure', async () => {
    const sandbox = createSandbox(async () =>
      makeExecResult({
        stdout: encode(''),
        stderr: encode('command not found\n'),
        exitCode: 127,
      }),
    )
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: 'nope' }, makeCtx())

    expect(result.isError).toBe(true)
    const output = JSON.parse(result.content[0].text)
    expect(output.stderr).toBe('command not found\n')
    expect(output.exitCode).toBe(127)
  })

  test('passes abort signal to sandbox.exec', async () => {
    const controller = new AbortController()
    const execSpy = vi.fn(async (_cmd: string, opts?: ExecOptions) => {
      expect(opts?.signal).toBe(controller.signal)
      return makeExecResult()
    })
    const sandbox = createSandbox(execSpy)
    const tool = createBashTool(sandbox)

    await tool.execute({ command: 'ls' }, makeCtx(controller.signal))

    expect(execSpy).toHaveBeenCalledOnce()
  })

  test('passes timeoutMs and maxOutputBytes to sandbox.exec', async () => {
    const execSpy = vi.fn(async (_cmd: string, opts?: ExecOptions) => {
      expect(opts?.timeoutMs).toBe(30_000)
      expect(opts?.maxOutputBytes).toBe(1_048_576)
      return makeExecResult()
    })
    const sandbox = createSandbox(execSpy)
    const tool = createBashTool(sandbox)

    await tool.execute({ command: 'ls' }, makeCtx())

    expect(execSpy).toHaveBeenCalledOnce()
  })

  test('truncated flag is forwarded from exec result', async () => {
    const sandbox = createSandbox(async () =>
      makeExecResult({
        stdout: encode('partial...'),
        truncated: true,
      }),
    )
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: 'cat bigfile' }, makeCtx())

    const output = JSON.parse(result.content[0].text)
    expect(output.truncated).toBe(true)
  })

  test('rejects empty command with isError', async () => {
    const sandbox = createSandbox(async () => makeExecResult())
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: '' }, makeCtx())

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('command is required')
  })

  test('rejects missing command param with isError', async () => {
    const sandbox = createSandbox(async () => makeExecResult())
    const tool = createBashTool(sandbox)

    const result = await tool.execute({}, makeCtx())

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('command is required')
  })

  test('details include durationMs', async () => {
    const sandbox = createSandbox(async () =>
      makeExecResult({ stdout: encode('ok\n'), durationMs: 42 }),
    )
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: 'echo ok' }, makeCtx())

    expect((result.details as any).durationMs).toBe(42)
  })

  test('sandbox.exec rejection returns structured error', async () => {
    const sandbox = createSandbox(async () => {
      throw new Error('spawn ENOENT')
    })
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: 'ls' }, makeCtx())

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('spawn ENOENT')
  })

  test('abort signal rejection returns structured error', async () => {
    const controller = new AbortController()
    const sandbox = createSandbox(async (_cmd, opts) => {
      controller.abort()
      if (opts?.signal?.aborted) {
        throw new Error('aborted')
      }
      return makeExecResult()
    })
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: 'sleep 30' }, makeCtx(controller.signal))

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('aborted')
  })

  test('timeout returns non-zero exit from sandbox', async () => {
    const sandbox = createSandbox(async () =>
      makeExecResult({ exitCode: 124, stderr: encode('timed out\n') }),
    )
    const tool = createBashTool(sandbox)

    const result = await tool.execute({ command: 'sleep 60' }, makeCtx())

    expect(result.isError).toBe(true)
    const output = JSON.parse(result.content[0].text)
    expect(output.exitCode).toBe(124)
    expect(output.stderr).toContain('timed out')
  })

  test('tool has correct name and schema', () => {
    const sandbox = createSandbox(async () => makeExecResult())
    const tool = createBashTool(sandbox)

    expect(tool.name).toBe('bash')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    })
  })
})

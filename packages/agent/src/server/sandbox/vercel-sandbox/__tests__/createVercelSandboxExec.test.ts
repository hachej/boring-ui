import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import { expect, test, vi } from 'vitest'

import { createVercelSandboxWorkspace } from '../../../workspace/createVercelSandboxWorkspace'
import { createMockVercelSandboxHarness } from '../../../workspace/__tests__/helpers/mockVercelSandbox'
import { createVercelSandboxExec } from '../createVercelSandboxExec'

const decoder = new TextDecoder()

test('exec echo returns hi newline', async () => {
  const runCommand = vi.fn(async () => {
    return {
      exitCode: 0,
      stdout: async () => 'hi\n',
      stderr: async () => '',
    }
  })

  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)

  const result = await adapter.exec('echo hi')

  expect(runCommand).toHaveBeenCalledTimes(1)
  expect(runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      cmd: 'sh',
      args: ['-c', 'echo hi'],
      signal: expect.any(AbortSignal),
    }),
  )
  expect(decoder.decode(result.stdout)).toBe('hi\n')
  expect(decoder.decode(result.stderr)).toBe('')
  expect(result.exitCode).toBe(0)
  expect(result.truncated).toBe(false)
})

test('workspace writes are visible through exec on same sandbox handle', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)
  const adapter = createVercelSandboxExec(harness.sandbox)

  try {
    await workspace.writeFile('shared/hello.txt', 'hello-from-workspace')

    const result = await adapter.exec('cat /vercel/sandbox/shared/hello.txt')

    expect(decoder.decode(result.stdout)).toBe('hello-from-workspace')
    expect(result.exitCode).toBe(0)
  } finally {
    await harness.cleanup()
  }
})

test('timeout is respected', async () => {
  const runCommand = vi.fn(async (params: { signal?: AbortSignal }) => {
    return await new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new Error('aborted'))
      if (params.signal?.aborted) {
        onAbort()
        return
      }
      params.signal?.addEventListener('abort', onAbort, { once: true })
    })
  })

  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)

  const result = await adapter.exec('sleep 60', { timeoutMs: 25 })

  expect(result.exitCode).toBe(124)
  expect(result.durationMs).toBeGreaterThanOrEqual(25)
  expect(result.durationMs).toBeLessThan(2_000)
  expect(result.stdout.length).toBe(0)
  expect(result.stderr.length).toBe(0)
})

test('maxOutputBytes truncates output post-hoc', async () => {
  const runCommand = vi.fn(async () => {
    return {
      exitCode: 0,
      stdout: async () => 'abcde',
      stderr: async () => 'vwxyz',
    }
  })

  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)

  const result = await adapter.exec('echo ignored', { maxOutputBytes: 6 })

  expect(result.truncated).toBe(true)
  expect(result.stdout.length + result.stderr.length).toBe(6)
  expect(decoder.decode(result.stdout)).toBe('abcde')
  expect(decoder.decode(result.stderr)).toBe('v')
})

import type { Writable } from 'node:stream'
import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import { expect, test, vi } from 'vitest'

import { createVercelSandboxWorkspace } from '../../../workspace/createVercelSandboxWorkspace'
import { createMockVercelSandboxHarness } from '../../../workspace/__tests__/helpers/mockVercelSandbox'
import { createVercelSandboxExec } from '../createVercelSandboxExec'

const decoder = new TextDecoder()

function mockRunCommand(stdoutData: string, stderrData: string, exitCode = 0) {
  return vi.fn(async (params: { stdout?: Writable; stderr?: Writable }) => {
    if (params.stdout) {
      params.stdout.write(Buffer.from(stdoutData, 'utf-8'))
      params.stdout.end()
    }
    if (params.stderr) {
      params.stderr.write(Buffer.from(stderrData, 'utf-8'))
      params.stderr.end()
    }
    return { exitCode }
  })
}

test('exec echo returns hi newline', async () => {
  const runCommand = mockRunCommand('hi\n', '')
  const onMutation = vi.fn()

  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox, { onMutation })

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
  expect(onMutation).toHaveBeenCalledTimes(1)
})

test('default Vercel exec cwd/env use /workspace runtime with safe system PATH', async () => {
  const runCommand = mockRunCommand('', '')
  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)

  await adapter.exec('command -v sh')

  expect(runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: '/workspace',
      env: expect.objectContaining({
        BORING_AGENT_WORKSPACE_ROOT: '/workspace',
        HOME: '/workspace',
        VIRTUAL_ENV: '/workspace/.boring-agent/venv',
        PATH: '/workspace/.boring-agent/node/node_modules/.bin:/workspace/.boring-agent/venv/bin:/workspace/.boring-agent/sdk/uv/bin:/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/vercel/runtimes/python/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      }),
    }),
  )
})

test('rejects explicit Vercel cwd outside the runtime workspace', async () => {
  const runCommand = mockRunCommand('', '')
  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)

  await expect(adapter.exec('pwd', { cwd: '/vercel/sandbox' })).rejects.toThrow('Vercel sandbox cwd must stay under /workspace')
  await expect(adapter.exec('pwd', { cwd: '/workspace/../vercel/sandbox' })).rejects.toThrow('Vercel sandbox cwd must stay under /workspace')
  expect(runCommand).not.toHaveBeenCalled()
})

test('workspace writes are visible through exec on same sandbox handle', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)
  const adapter = createVercelSandboxExec(harness.sandbox)

  try {
    await workspace.writeFile('shared/hello.txt', 'hello-from-workspace')

    const result = await adapter.exec('cat /workspace/shared/hello.txt')

    expect(decoder.decode(result.stdout)).toBe('hello-from-workspace')
    expect(result.exitCode).toBe(0)
  } finally {
    await harness.cleanup()
  }
})

test('keeps display /workspace command strings while forcing managed env prefixes', async () => {
  const runCommand = mockRunCommand('', '')
  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)

  const command = 'mkdir -p /workspace/deck && echo /workspace2 /workspace-old /workspace.backup /workspace@tmp /workspace'
  await adapter.exec(command, {
    cwd: '/workspace/nested',
    env: {
      BORING_AGENT_WORKSPACE_ROOT: '/plugin-root',
      EXAMPLE_API_URL: 'https://api.example.test/workspace',
      HOME: '/plugin-home',
      PATH: '/plugin/bin:/workspace/.boring-agent/bin:/usr/bin',
      PYTHONHOME: '/plugin-python-home',
      VIRTUAL_ENV: '/plugin-venv',
    },
  })

  expect(runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      args: ['-c', command],
      cwd: '/workspace/nested',
      env: {
        BORING_AGENT_WORKSPACE_ROOT: '/workspace',
        EXAMPLE_API_URL: 'https://api.example.test/workspace',
        HOME: '/workspace',
        PATH: '/workspace/.boring-agent/node/node_modules/.bin:/workspace/.boring-agent/venv/bin:/workspace/.boring-agent/sdk/uv/bin:/plugin/bin:/workspace/.boring-agent/bin:/usr/bin:/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/vercel/runtimes/python/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        VIRTUAL_ENV: '/workspace/.boring-agent/venv',
      },
    }),
  )
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

test('maxOutputBytes truncates via streaming cap', async () => {
  const runCommand = vi.fn(async (params: { stdout?: Writable; stderr?: Writable }) => {
    if (params.stdout) {
      params.stdout.write(Buffer.from('abcde', 'utf-8'))
      params.stdout.end()
    }
    if (params.stderr) {
      params.stderr.write(Buffer.from('vwxyz', 'utf-8'))
      params.stderr.end()
    }
    return { exitCode: 0 }
  })

  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)

  const result = await adapter.exec('echo ignored', { maxOutputBytes: 6 })

  expect(result.truncated).toBe(true)
  expect(result.stdout.length + result.stderr.length).toBe(6)
  expect(decoder.decode(result.stdout)).toBe('abcde')
  expect(decoder.decode(result.stderr)).toBe('v')
})

test('onStdout callback receives streamed chunks', async () => {
  const runCommand = vi.fn(async (params: { stdout?: Writable; stderr?: Writable }) => {
    if (params.stdout) {
      params.stdout.write(Buffer.from('chunk1'))
      params.stdout.write(Buffer.from('chunk2'))
      params.stdout.end()
    }
    if (params.stderr) params.stderr.end()
    return { exitCode: 0 }
  })

  const sandbox = { runCommand } as unknown as VercelSandbox
  const adapter = createVercelSandboxExec(sandbox)
  const chunks: Uint8Array[] = []

  const result = await adapter.exec('echo test', {
    onStdout: (chunk) => chunks.push(chunk),
  })

  expect(chunks.length).toBe(2)
  expect(Buffer.from(chunks[0]).toString()).toBe('chunk1')
  expect(Buffer.from(chunks[1]).toString()).toBe('chunk2')
  expect(decoder.decode(result.stdout)).toBe('chunk1chunk2')
})

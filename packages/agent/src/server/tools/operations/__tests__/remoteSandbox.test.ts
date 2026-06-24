import { describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import { remoteSandboxBashOps } from '../remoteSandbox'

function mockSandbox(execResult: Partial<ExecResult> = {}): Sandbox {
  const runtimeContext = { runtimeCwd: '/workspace' }
  const defaultResult: ExecResult = {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 10,
    truncated: false,
  }
  return {
    id: 'test-remote',
    placement: 'remote',
    provider: 'custom-remote',
    capabilities: ['exec'],
    runtimeContext,
    exec: vi.fn(async () => ({ ...defaultResult, ...execResult })),
  }
}

describe('remoteSandboxBashOps', () => {
  test('forwards command with cwd, env, signal, timeout', async () => {
    const sandbox = mockSandbox()
    const ops = remoteSandboxBashOps(sandbox)
    const onData = vi.fn()
    const signal = new AbortController().signal

    await ops.exec('echo hi', '/workspace', {
      onData,
      signal,
      timeout: 30,
      env: { FOO: 'bar' },
    })

    expect(sandbox.exec).toHaveBeenCalledWith('echo hi', {
      cwd: '/workspace',
      env: { FOO: 'bar' },
      signal,
      timeoutMs: 30_000,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function),
    })
  })

  test('builds remote-safe runtime env without forwarding caller env when runtime options are supplied', async () => {
    const sandbox = mockSandbox()
    const ops = remoteSandboxBashOps(sandbox, {
      defaultPath: '/remote/bin:/usr/bin:/bin',
      runtime: {
        env: { BORING_MACRO_API_URL: 'http://macro', PATH: '/runtime/base' },
        pathEntries: ['/workspace/.boring-agent/venv/bin'],
      },
      executionRuntimeEnv: { BORING_WORKSPACE_BRIDGE_TOKEN: 'bridge-token', PATH: '/execution/bin' },
    })

    await ops.exec('echo hi', '/workspace', {
      onData: vi.fn(),
      env: { HOST_SECRET: 'do-not-forward', PATH: '/host/bin' },
    })

    const execOptions = vi.mocked(sandbox.exec).mock.calls[0][1]
    expect(execOptions?.env).toEqual(expect.objectContaining({
      BORING_MACRO_API_URL: 'http://macro',
      BORING_WORKSPACE_BRIDGE_TOKEN: 'bridge-token',
    }))
    expect(execOptions?.env?.PATH).toBe('/workspace/.boring-agent/venv/bin:/runtime/base:/execution/bin:/remote/bin:/usr/bin:/bin')
    expect(execOptions?.env).not.toHaveProperty('HOST_SECRET')
  })

  test('streams stdout and stderr to onData', async () => {
    const sandbox: Sandbox = {
      id: 'test',
      placement: 'remote',
      provider: 'custom-remote',
      capabilities: ['exec'],
      runtimeContext: { runtimeCwd: '/workspace' },
      async exec(_cmd, opts) {
        opts?.onStdout?.(new Uint8Array(Buffer.from('out-chunk')))
        opts?.onStderr?.(new Uint8Array(Buffer.from('err-chunk')))
        return { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0, durationMs: 5, truncated: false }
      },
    }

    const ops = remoteSandboxBashOps(sandbox)
    const chunks: Buffer[] = []
    const result = await ops.exec('test', '/cwd', { onData: (d) => chunks.push(d) })

    expect(result.exitCode).toBe(0)
    expect(chunks.map((chunk) => chunk.toString())).toEqual(['out-chunk', 'err-chunk'])
  })

  test('converts timeout from seconds to milliseconds', async () => {
    const sandbox = mockSandbox()
    const ops = remoteSandboxBashOps(sandbox)

    await ops.exec('cmd', '/cwd', { onData: vi.fn(), timeout: 5 })

    expect(sandbox.exec).toHaveBeenCalledWith('cmd', expect.objectContaining({ timeoutMs: 5000 }))
  })

  test('omits timeoutMs when timeout is undefined', async () => {
    const sandbox = mockSandbox()
    const ops = remoteSandboxBashOps(sandbox)

    await ops.exec('cmd', '/cwd', { onData: vi.fn() })

    expect(sandbox.exec).toHaveBeenCalledWith('cmd', expect.objectContaining({ timeoutMs: undefined }))
  })
})

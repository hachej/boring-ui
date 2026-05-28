import { describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Entry, Stat, Workspace } from '../../../../shared/workspace'
import {
  vercelBashOps,
  vercelEditOps,
  vercelFindOps,
  vercelLsOps,
  vercelReadOps,
  vercelWriteOps,
} from '../vercel'

function mockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const root = overrides.root ?? '/workspace'
  const runtimeContext = overrides.runtimeContext ?? { runtimeCwd: root }
  return {
    root,
    runtimeContext,
    readFile: vi.fn(async () => 'file-content'),
    writeFile: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    readdir: vi.fn(async (): Promise<Entry[]> => [
      { name: 'foo.ts', kind: 'file' },
      { name: 'src', kind: 'dir' },
    ]),
    stat: vi.fn(async (): Promise<Stat> => ({ size: 100, mtimeMs: 1000, kind: 'file' })),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    ...overrides,
  }
}

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
    id: 'test-vercel',
    placement: 'remote',
    provider: 'vercel-sandbox',
    capabilities: ['exec'],
    runtimeContext,
    exec: vi.fn(async () => ({ ...defaultResult, ...execResult })),
  }
}

describe('vercelBashOps', () => {
  test('forwards command with cwd, env, signal, timeout', async () => {
    const sandbox = mockSandbox()
    const ops = vercelBashOps(sandbox)
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

  test('streams stdout and stderr to onData', async () => {
    const sandbox: Sandbox = {
      id: 'test',
      placement: 'remote',
      provider: 'vercel-sandbox',
      capabilities: ['exec'],
      runtimeContext: { runtimeCwd: '/workspace' },
      async exec(_cmd, opts) {
        opts?.onStdout?.(new Uint8Array(Buffer.from('out-chunk')))
        opts?.onStderr?.(new Uint8Array(Buffer.from('err-chunk')))
        return { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0, durationMs: 5, truncated: false }
      },
    }

    const ops = vercelBashOps(sandbox)
    const chunks: Buffer[] = []
    const result = await ops.exec('test', '/cwd', { onData: (d) => chunks.push(d) })

    expect(result.exitCode).toBe(0)
    expect(chunks.length).toBe(2)
    expect(chunks[0].toString()).toBe('out-chunk')
    expect(chunks[1].toString()).toBe('err-chunk')
  })

  test('converts timeout from seconds to milliseconds', async () => {
    const sandbox = mockSandbox()
    const ops = vercelBashOps(sandbox)

    await ops.exec('cmd', '/cwd', { onData: vi.fn(), timeout: 5 })

    expect(sandbox.exec).toHaveBeenCalledWith('cmd', expect.objectContaining({ timeoutMs: 5000 }))
  })

  test('omits timeoutMs when timeout is undefined', async () => {
    const sandbox = mockSandbox()
    const ops = vercelBashOps(sandbox)

    await ops.exec('cmd', '/cwd', { onData: vi.fn() })

    expect(sandbox.exec).toHaveBeenCalledWith('cmd', expect.objectContaining({ timeoutMs: undefined }))
  })
})

describe('vercelReadOps', () => {
  test('reads file via workspace with relative path', async () => {
    const workspace = mockWorkspace()
    const ops = vercelReadOps(workspace)

    const buf = await ops.readFile('/vercel/sandbox/src/hello.ts')

    expect(workspace.readFile).toHaveBeenCalledWith('src/hello.ts')
    expect(buf.toString()).toBe('file-content')
  })

  test('rejects path outside workspace without displaying Vercel internal root', async () => {
    const workspace = mockWorkspace({ root: '/workspace' })
    const ops = vercelReadOps(workspace)

    await expect(ops.readFile('/etc/passwd')).rejects.toThrow('is outside workspace')
    await expect(ops.readFile('/etc/passwd')).rejects.not.toThrow('/vercel/sandbox')
  })

  test('accepts in-workspace filenames that merely start with dotdot', async () => {
    const workspace = mockWorkspace()
    const ops = vercelReadOps(workspace)

    await ops.readFile('/vercel/sandbox/..notes.md')

    expect(workspace.readFile).toHaveBeenCalledWith('..notes.md')
  })

  test('access checks via stat', async () => {
    const workspace = mockWorkspace()
    const ops = vercelReadOps(workspace)

    await ops.access('/vercel/sandbox/file.txt')

    expect(workspace.stat).toHaveBeenCalledWith('file.txt')
  })

  test('accepts display /workspace aliases and host-rendered skill paths', async () => {
    const workspace = mockWorkspace({ root: '/workspace' })
    const ops = vercelReadOps(workspace)

    await ops.readFile('/vercel/sandbox/deck/labor.md')
    await ops.readFile('/data/workspaces/.agents/skills/macro-deck/SKILL.md')

    expect(workspace.readFile).toHaveBeenNthCalledWith(1, 'deck/labor.md')
    expect(workspace.readFile).toHaveBeenNthCalledWith(2, '.agents/skills/macro-deck/SKILL.md')
  })

  test('rejects traversal in host-rendered skill paths', async () => {
    const workspace = mockWorkspace({ root: '/workspace' })
    const ops = vercelReadOps(workspace)

    await expect(
      ops.readFile('/data/workspaces/.agents/skills/../../../etc/passwd'),
    ).rejects.toThrow('escapes the workspace skills directory')
    expect(workspace.readFile).not.toHaveBeenCalled()
  })
})

describe('vercelWriteOps', () => {
  test('writes file via workspace', async () => {
    const workspace = mockWorkspace()
    const ops = vercelWriteOps(workspace)

    await ops.writeFile('/vercel/sandbox/out.txt', 'hello')

    expect(workspace.writeFile).toHaveBeenCalledWith('out.txt', 'hello')
  })

  test('mkdir via workspace', async () => {
    const workspace = mockWorkspace()
    const ops = vercelWriteOps(workspace)

    await ops.mkdir('/vercel/sandbox/deep/dir')

    expect(workspace.mkdir).toHaveBeenCalledWith('deep/dir', { recursive: true })
  })

  test('rejects write outside workspace', async () => {
    const workspace = mockWorkspace()
    const ops = vercelWriteOps(workspace)

    await expect(ops.writeFile('/tmp/bad.txt', 'x')).rejects.toThrow('is outside workspace')
  })
})

describe('vercelEditOps', () => {
  test('readFile and writeFile route through workspace', async () => {
    const workspace = mockWorkspace()
    const ops = vercelEditOps(workspace)

    const buf = await ops.readFile('/vercel/sandbox/file.ts')
    expect(workspace.readFile).toHaveBeenCalledWith('file.ts')
    expect(buf.toString()).toBe('file-content')

    await ops.writeFile('/vercel/sandbox/file.ts', 'updated')
    expect(workspace.writeFile).toHaveBeenCalledWith('file.ts', 'updated')
  })

  test('access routes through workspace stat', async () => {
    const workspace = mockWorkspace()
    const ops = vercelEditOps(workspace)

    await ops.access('/vercel/sandbox/file.ts')
    expect(workspace.stat).toHaveBeenCalledWith('file.ts')
  })
})

describe('vercelFindOps', () => {
  test('exists runs test -e in sandbox', async () => {
    const sandbox = mockSandbox({ exitCode: 0 })
    const ops = vercelFindOps(sandbox)

    const result = await ops.exists('/vercel/sandbox/src')
    expect(result).toBe(true)
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining('test -e'),
      expect.objectContaining({ timeoutMs: 5_000 }),
    )
  })

  test('exists returns false when test fails', async () => {
    const sandbox = mockSandbox({ exitCode: 1 })
    const ops = vercelFindOps(sandbox)

    const result = await ops.exists('/vercel/sandbox/nope')
    expect(result).toBe(false)
  })

  test('glob runs fd and parses stdout', async () => {
    const stdout = Buffer.from('/vercel/sandbox/src/a.ts\n/vercel/sandbox/src/b.ts\n')
    const sandbox = mockSandbox({ exitCode: 0, stdout: new Uint8Array(stdout) })
    const ops = vercelFindOps(sandbox)

    const files = await ops.glob('*.ts', '/vercel/sandbox/src', { ignore: ['node_modules'], limit: 100 })

    expect(files).toEqual(['/workspace/src/a.ts', '/workspace/src/b.ts'])
    const execCall = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(execCall).toContain('fd')
    expect(execCall).toContain('--glob')
    expect(execCall).toContain('--max-results')
    expect(execCall).toContain('--exclude')
    expect(execCall).toContain('node_modules')
  })

  test('glob handles empty results', async () => {
    const sandbox = mockSandbox({ exitCode: 1, stdout: new Uint8Array() })
    const ops = vercelFindOps(sandbox)

    const files = await ops.glob('*.xyz', '/cwd', { ignore: [], limit: 50 })
    expect(files).toEqual([])
  })

  test('glob falls back to POSIX find when fd is unavailable', async () => {
    const sandbox = mockSandbox()
    ;(sandbox.exec as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        stdout: new Uint8Array(),
        stderr: new Uint8Array(Buffer.from('sh: 1: fd: not found')),
        exitCode: 127,
        durationMs: 5,
        truncated: false,
      })
      .mockResolvedValueOnce({
        stdout: new Uint8Array(Buffer.from('/vercel/sandbox/deck/labor.md\n')),
        stderr: new Uint8Array(),
        exitCode: 0,
        durationMs: 5,
        truncated: false,
      })
    const ops = vercelFindOps(sandbox)

    const files = await ops.glob('**/labor.md', '/workspace', { ignore: ['node_modules'], limit: 10 })

    expect(files).toEqual(['/workspace/deck/labor.md'])
    const calls = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toContain('/workspace')
    expect(calls[1][0]).toContain('find')
    expect(calls[1][0]).toContain('/workspace')
  })

  test('glob throws on unexpected exit code without displaying Vercel internal root', async () => {
    const stderr = Buffer.from('fd: /vercel/sandbox/private: permission denied')
    const sandbox = mockSandbox({ exitCode: 2, stderr: new Uint8Array(stderr) })
    const ops = vercelFindOps(sandbox)

    await expect(ops.glob('*', '/workspace', { ignore: [], limit: 10 })).rejects.toThrow(
      'fd: /workspace/private: permission denied',
    )
    await expect(ops.glob('*', '/workspace', { ignore: [], limit: 10 })).rejects.not.toThrow('/vercel/sandbox')
  })

  test('glob does not fallback for unrelated command-not-found text', async () => {
    const stderr = Buffer.from('custom helper not found')
    const sandbox = mockSandbox({ exitCode: 127, stderr: new Uint8Array(stderr) })
    const ops = vercelFindOps(sandbox)

    await expect(ops.glob('*', '/cwd', { ignore: [], limit: 10 })).rejects.toThrow('file search failed (exit 127)')
    expect(sandbox.exec).toHaveBeenCalledTimes(1)
  })
})

describe('vercelLsOps', () => {
  test('exists returns true for existing path', async () => {
    const workspace = mockWorkspace()
    const ops = vercelLsOps(workspace)

    expect(await ops.exists('/vercel/sandbox/file.txt')).toBe(true)
  })

  test('exists returns false when stat throws', async () => {
    const workspace = mockWorkspace({
      stat: vi.fn(async () => { throw new Error('ENOENT') }),
    })
    const ops = vercelLsOps(workspace)

    expect(await ops.exists('/vercel/sandbox/nope.txt')).toBe(false)
  })

  test('stat returns directory info from workspace', async () => {
    const workspace = mockWorkspace({
      stat: vi.fn(async (): Promise<Stat> => ({ size: 0, mtimeMs: 1000, kind: 'dir' })),
    })
    const ops = vercelLsOps(workspace)

    const s = await ops.stat('/vercel/sandbox/src')
    expect(s.isDirectory()).toBe(true)
  })

  test('readdir returns entry names', async () => {
    const workspace = mockWorkspace()
    const ops = vercelLsOps(workspace)

    const entries = await ops.readdir('/vercel/sandbox')
    expect(entries).toEqual(['foo.ts', 'src'])
    expect(workspace.readdir).toHaveBeenCalledWith('')
  })

  test('readdir rejects outside workspace', async () => {
    const workspace = mockWorkspace()
    const ops = vercelLsOps(workspace)

    await expect(ops.readdir('/etc')).rejects.toThrow('is outside workspace')
  })
})

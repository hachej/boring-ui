import { describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Entry, Stat, Workspace } from '../../../../shared/workspace'
import {
  remoteWorkspaceEditOps,
  remoteWorkspaceFindOps,
  remoteWorkspaceLsOps,
  type RemoteWorkspacePathOptions,
  remoteWorkspaceReadOps,
  remoteWorkspaceWriteOps,
} from '../remoteWorkspace'

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
    id: 'test-remote-workspace',
    placement: 'remote',
    provider: 'custom-remote',
    capabilities: ['exec'],
    runtimeContext,
    exec: vi.fn(async () => ({ ...defaultResult, ...execResult })),
  }
}

const legacyPathOptions: RemoteWorkspacePathOptions = {
  rootAliases: ['/legacy/root'],
  toRemotePath: (value) => value.replace('/workspace', '/legacy/root'),
  toRuntimePath: (value) => value.replace('/legacy/root', '/workspace'),
  sanitizeErrorText: (value) => value.replace('/legacy/root', '/workspace'),
}

describe('remoteWorkspaceReadOps', () => {
  test('reads file via workspace with relative path from configured aliases', async () => {
    const workspace = mockWorkspace()
    const ops = remoteWorkspaceReadOps(workspace, legacyPathOptions)

    const buf = await ops.readFile('/legacy/root/src/hello.ts')

    expect(workspace.readFile).toHaveBeenCalledWith('src/hello.ts')
    expect(buf.toString()).toBe('file-content')
  })

  test('rejects path outside workspace', async () => {
    const workspace = mockWorkspace({ root: '/workspace' })
    const ops = remoteWorkspaceReadOps(workspace)

    await expect(ops.readFile('/etc/passwd')).rejects.toThrow('is outside workspace')
  })

  test('accepts in-workspace filenames that merely start with dotdot', async () => {
    const workspace = mockWorkspace()
    const ops = remoteWorkspaceReadOps(workspace, legacyPathOptions)

    await ops.readFile('/legacy/root/..notes.md')

    expect(workspace.readFile).toHaveBeenCalledWith('..notes.md')
  })

  test('accepts host-rendered skill paths', async () => {
    const workspace = mockWorkspace({ root: '/workspace' })
    const ops = remoteWorkspaceReadOps(workspace)

    await ops.readFile('/data/workspaces/.agents/skills/macro-deck/SKILL.md')

    expect(workspace.readFile).toHaveBeenCalledWith('.agents/skills/macro-deck/SKILL.md')
  })

  test('rejects traversal in host-rendered skill paths', async () => {
    const workspace = mockWorkspace({ root: '/workspace' })
    const ops = remoteWorkspaceReadOps(workspace)

    await expect(
      ops.readFile('/data/workspaces/.agents/skills/../../../etc/passwd'),
    ).rejects.toThrow('escapes the workspace skills directory')
    expect(workspace.readFile).not.toHaveBeenCalled()
  })
})

describe('remoteWorkspaceWriteOps', () => {
  test('writes file via workspace', async () => {
    const workspace = mockWorkspace()
    const ops = remoteWorkspaceWriteOps(workspace, legacyPathOptions)

    await ops.writeFile('/legacy/root/out.txt', 'hello')

    expect(workspace.writeFile).toHaveBeenCalledWith('out.txt', 'hello')
  })

  test('mkdir via workspace', async () => {
    const workspace = mockWorkspace()
    const ops = remoteWorkspaceWriteOps(workspace, legacyPathOptions)

    await ops.mkdir('/legacy/root/deep/dir')

    expect(workspace.mkdir).toHaveBeenCalledWith('deep/dir', { recursive: true })
  })
})

describe('remoteWorkspaceEditOps', () => {
  test('readFile, writeFile, and access route through workspace', async () => {
    const workspace = mockWorkspace()
    const ops = remoteWorkspaceEditOps(workspace, legacyPathOptions)

    const buf = await ops.readFile('/legacy/root/file.ts')
    await ops.writeFile('/legacy/root/file.ts', 'updated')
    await ops.access('/legacy/root/file.ts')

    expect(workspace.readFile).toHaveBeenCalledWith('file.ts')
    expect(buf.toString()).toBe('file-content')
    expect(workspace.writeFile).toHaveBeenCalledWith('file.ts', 'updated')
    expect(workspace.stat).toHaveBeenCalledWith('file.ts')
  })
})

describe('remoteWorkspaceFindOps', () => {
  test('exists runs test -e in sandbox when workspace is absent', async () => {
    const sandbox = mockSandbox({ exitCode: 0 })
    const ops = remoteWorkspaceFindOps(sandbox)

    const result = await ops.exists('/workspace/src')
    expect(result).toBe(true)
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining('test -e'),
      expect.objectContaining({ timeoutMs: 5_000 }),
    )
  })

  test('exists routes through workspace when provided', async () => {
    const workspace = mockWorkspace()
    const sandbox = mockSandbox()
    const ops = remoteWorkspaceFindOps(sandbox, workspace, legacyPathOptions)

    expect(await ops.exists('/legacy/root/src')).toBe(true)
    expect(workspace.stat).toHaveBeenCalledWith('src')
    expect(sandbox.exec).not.toHaveBeenCalled()
  })

  test('glob runs fd and maps remote stdout paths back to runtime paths', async () => {
    const stdout = Buffer.from('/legacy/root/src/a.ts\n/legacy/root/src/b.ts\n')
    const sandbox = mockSandbox({ exitCode: 0, stdout: new Uint8Array(stdout) })
    const ops = remoteWorkspaceFindOps(sandbox, undefined, legacyPathOptions)

    const files = await ops.glob('*.ts', '/workspace/src', { ignore: ['node_modules'], limit: 100 })

    expect(files).toEqual(['/workspace/src/a.ts', '/workspace/src/b.ts'])
    const execCall = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(execCall).toContain('fd')
    expect(execCall).toContain('/legacy/root/src')
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
        stdout: new Uint8Array(Buffer.from('/legacy/root/deck/labor.md\n')),
        stderr: new Uint8Array(),
        exitCode: 0,
        durationMs: 5,
        truncated: false,
      })
    const ops = remoteWorkspaceFindOps(sandbox, undefined, legacyPathOptions)

    const files = await ops.glob('**/labor.md', '/workspace', { ignore: ['node_modules'], limit: 10 })

    expect(files).toEqual(['/workspace/deck/labor.md'])
    const calls = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[1][0]).toContain('find')
    expect(calls[1][0]).toContain('/legacy/root')
  })

  test('glob sanitizes unexpected exit text through path options', async () => {
    const stderr = Buffer.from('fd: /legacy/root/private: permission denied')
    const sandbox = mockSandbox({ exitCode: 2, stderr: new Uint8Array(stderr) })
    const ops = remoteWorkspaceFindOps(sandbox, undefined, legacyPathOptions)

    await expect(ops.glob('*', '/workspace', { ignore: [], limit: 10 })).rejects.toThrow(
      'fd: /workspace/private: permission denied',
    )
    await expect(ops.glob('*', '/workspace', { ignore: [], limit: 10 })).rejects.not.toThrow('/legacy/root')
  })
})

describe('remoteWorkspaceLsOps', () => {
  test('exists returns true for existing path', async () => {
    const workspace = mockWorkspace()
    const ops = remoteWorkspaceLsOps(workspace, legacyPathOptions)

    expect(await ops.exists('/legacy/root/file.txt')).toBe(true)
  })

  test('exists returns false when stat throws', async () => {
    const workspace = mockWorkspace({
      stat: vi.fn(async () => { throw new Error('ENOENT') }),
    })
    const ops = remoteWorkspaceLsOps(workspace, legacyPathOptions)

    expect(await ops.exists('/legacy/root/nope.txt')).toBe(false)
  })

  test('stat returns directory info from workspace', async () => {
    const workspace = mockWorkspace({
      stat: vi.fn(async (): Promise<Stat> => ({ size: 0, mtimeMs: 1000, kind: 'dir' })),
    })
    const ops = remoteWorkspaceLsOps(workspace, legacyPathOptions)

    const s = await ops.stat('/legacy/root/src')
    expect(s.isDirectory()).toBe(true)
  })

  test('readdir returns entry names', async () => {
    const workspace = mockWorkspace()
    const ops = remoteWorkspaceLsOps(workspace, legacyPathOptions)

    const entries = await ops.readdir('/legacy/root')
    expect(entries).toEqual(['foo.ts', 'src'])
    expect(workspace.readdir).toHaveBeenCalledWith('')
  })
})

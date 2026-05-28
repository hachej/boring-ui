import { symlink } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import type { WorkspaceChangeEvent } from '../../../shared/workspace'
import { createVercelSandboxExec } from '../../sandbox/vercel-sandbox/createVercelSandboxExec'
import { createVercelSandboxWorkspace } from '../createVercelSandboxWorkspace'
import { createMockVercelSandboxHarness } from './helpers/mockVercelSandbox'

const EPERM_CODE = 'EPERM'

test('writes via workspace are visible to paired exec on same sandbox handle', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    expect(workspace.root).toBe('/workspace')
    await workspace.mkdir('shared', { recursive: true })
    await workspace.writeFile('shared/hello.txt', 'hello-from-workspace')

    const command = await harness.sandbox.runCommand('sh', [
      '-c',
      'cat /workspace/shared/hello.txt',
    ])

    await expect(command.stdout()).resolves.toBe(
      'hello-from-workspace',
    )
    expect(command.exitCode).toBe(0)
  } finally {
    await harness.cleanup()
  }
})

test('writeFile delegates UTF-8 bytes via sandbox.writeFiles', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.writeFile('utf8.txt', 'snowman ☃')

    expect(harness.lastWriteFiles).toEqual([
      {
        path: '/workspace/utf8.txt',
        content: new Uint8Array(Buffer.from('snowman ☃', 'utf-8')),
      },
    ])
  } finally {
    await harness.cleanup()
  }
})

test('optimized read/write with stat helpers return content and metadata', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.mkdir('optimized', { recursive: true })
    const writeStat = await workspace.writeFileWithStat?.('optimized/a.txt', 'hello')
    expect(writeStat?.kind).toBe('file')
    expect(writeStat?.size).toBe(5)

    const read = await workspace.readFileWithStat?.('optimized/a.txt')
    expect(read?.content).toBe('hello')
    expect(read?.stat.kind).toBe('file')
    expect(read?.stat.size).toBe(5)
  } finally {
    await harness.cleanup()
  }
})

test('optimized small writes use the @vercel/sandbox fs write API', async () => {
  const harness = await createMockVercelSandboxHarness()
  const fsWriteSpy = vi.spyOn((harness.sandbox as any).fs, 'writeFile')
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.writeFileWithStat?.('single-call.txt', 'hello')

    expect(fsWriteSpy).toHaveBeenCalledTimes(1)
  } finally {
    await harness.cleanup()
  }
})

test('small write mutations are recorded before post-write stat', async () => {
  const harness = await createMockVercelSandboxHarness()
  const onMutation = vi.fn()
  const statSpy = vi.spyOn((harness.sandbox as any).fs, 'stat')
  const workspace = createVercelSandboxWorkspace(harness.sandbox, { onMutation })

  try {
    statSpy.mockRejectedValueOnce(new Error('stat unavailable'))

    await expect(workspace.writeFileWithStat?.('stat-fail.txt', 'hello')).rejects.toThrow('stat unavailable')

    await expect(workspace.readFile('stat-fail.txt')).resolves.toBe('hello')
    expect(onMutation).toHaveBeenCalledTimes(1)
  } finally {
    statSpy.mockRestore()
    await harness.cleanup()
  }
})

test('reuses stat/readdir cache entries inside ttl and refreshes after expiry', async () => {
  const harness = await createMockVercelSandboxHarness()
  const statSpy = vi.spyOn((harness.sandbox as any).fs, 'stat')
  const lstatSpy = vi.spyOn((harness.sandbox as any).fs, 'lstat')
  const readdirSpy = vi.spyOn((harness.sandbox as any).fs, 'readdir')
  const runSpy = vi.spyOn(harness.sandbox, 'runCommand')
  const workspace = createVercelSandboxWorkspace(harness.sandbox)
  const nowSpy = vi.spyOn(Date, 'now')

  try {
    nowSpy.mockReturnValue(0)
    await workspace.mkdir('cache', { recursive: true })
    await workspace.writeFile('cache/a.txt', 'a')

    await workspace.stat('cache/a.txt')
    await workspace.stat('cache/a.txt')
    expect(statSpy).toHaveBeenCalledTimes(1)

    await workspace.readdir('cache')
    await workspace.readdir('cache')
    expect(lstatSpy).toHaveBeenCalledTimes(2)
    expect(readdirSpy).not.toHaveBeenCalled()
    expect(runSpy).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(15_001)
    await workspace.stat('cache/a.txt')
    await workspace.readdir('cache')
    expect(statSpy).toHaveBeenCalledTimes(2)
    expect(lstatSpy).toHaveBeenCalledTimes(4)
    expect(readdirSpy).not.toHaveBeenCalled()
    expect(runSpy).toHaveBeenCalledTimes(2)
  } finally {
    nowSpy.mockRestore()
    await harness.cleanup()
  }
})

test('readdir preserves filenames containing pipe characters', async () => {
  const harness = await createMockVercelSandboxHarness()
  const readdirSpy = vi.spyOn((harness.sandbox as any).fs, 'readdir')
  const runSpy = vi.spyOn(harness.sandbox, 'runCommand')
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.mkdir('pipe', { recursive: true })
    await workspace.writeFile('pipe/a|b.txt', 'hello')

    await expect(workspace.readdir('pipe')).resolves.toContainEqual({ name: 'a|b.txt', kind: 'file' })
    expect(readdirSpy).not.toHaveBeenCalled()
    expect(runSpy).toHaveBeenCalledTimes(1)
  } finally {
    await harness.cleanup()
  }
})

test('readdir rejects regular file paths', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.writeFile('file.txt', 'hello')

    await expect(workspace.readdir('file.txt')).rejects.toMatchObject({ code: 'ENOTDIR' })
  } finally {
    await harness.cleanup()
  }
})

test('readdir rejects symlink roots and ancestors', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.mkdir('target', { recursive: true })
    await workspace.writeFile('target/a.txt', 'hello')
    await symlink(join(harness.hostRoot, 'target'), join(harness.hostRoot, 'link'), 'dir')
    await symlink('/', join(harness.hostRoot, 'escape'), 'dir')

    await expect(workspace.readdir('link')).rejects.toMatchObject({ code: 'ELOOP' })
    await expect(workspace.readdir('escape/tmp')).rejects.toMatchObject({ code: 'ELOOP' })
  } finally {
    await harness.cleanup()
  }
})

test('unlink removes leaf symlinks without deleting their target', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.mkdir('target-for-link', { recursive: true })
    await symlink(join(harness.hostRoot, 'target-for-link'), join(harness.hostRoot, 'delete-link'), 'dir')
    await workspace.unlink('delete-link')

    await expect(workspace.stat('delete-link')).rejects.toThrow()
    await expect(workspace.stat('target-for-link')).resolves.toMatchObject({ kind: 'dir' })
  } finally {
    await harness.cleanup()
  }
})

test('invalidates metadata cache after write/unlink/mkdir/rename', async () => {
  const harness = await createMockVercelSandboxHarness()
  const statSpy = vi.spyOn((harness.sandbox as any).fs, 'stat')
  const readdirSpy = vi.spyOn((harness.sandbox as any).fs, 'readdir')
  const runSpy = vi.spyOn(harness.sandbox, 'runCommand')
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.mkdir('cache', { recursive: true })
    await workspace.writeFile('cache/a.txt', 'a')

    await workspace.stat('cache/a.txt')
    await workspace.stat('cache/a.txt')
    expect(statSpy).toHaveBeenCalledTimes(1)

    await workspace.writeFile('cache/a.txt', 'b')
    await workspace.stat('cache/a.txt')
    expect(statSpy).toHaveBeenCalledTimes(2)
    statSpy.mockClear()

    await workspace.readdir('cache')
    await workspace.readdir('cache')
    expect(readdirSpy).not.toHaveBeenCalled()
    expect(runSpy).toHaveBeenCalledTimes(1)

    await workspace.mkdir('cache/nested', { recursive: true })
    await workspace.readdir('cache')
    expect(readdirSpy).not.toHaveBeenCalled()
    expect(runSpy).toHaveBeenCalledTimes(2)

    statSpy.mockClear()
    await workspace.rename('cache/a.txt', 'cache/b.txt')
    await workspace.stat('cache/b.txt')
    expect(statSpy).toHaveBeenCalledTimes(1)

    await workspace.unlink('cache/b.txt')
    await expect(workspace.stat('cache/b.txt')).rejects.toThrow()
    expect(statSpy).toHaveBeenCalledTimes(2)
  } finally {
    await harness.cleanup()
  }
})

test('unlink removes folders recursively', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.mkdir('tree/nested', { recursive: true })
    await workspace.writeFile('tree/nested/deep.txt', 'deep')
    await workspace.unlink('tree')

    await expect(workspace.stat('tree')).rejects.toThrow()
    await expect(workspace.readFile('tree/nested/deep.txt')).rejects.toThrow()
  } finally {
    await harness.cleanup()
  }
})

test('unlink rejects removing the workspace root', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.writeFile('keep.txt', 'x')

    await expect(workspace.unlink('.')).rejects.toMatchObject({ code: EPERM_CODE })
    await expect(workspace.readFile('keep.txt')).resolves.toBe('x')
  } finally {
    await harness.cleanup()
  }
})

test('unlink emits descendant events for recursive folder deletes', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)
  const events: WorkspaceChangeEvent[] = []
  const unsubscribe = workspace.watch!().subscribe((event) => events.push(event))

  try {
    await workspace.mkdir('tree/nested', { recursive: true })
    await workspace.writeFile('tree/file.txt', 'file')
    await workspace.writeFile('tree/nested/deep.txt', 'deep')
    events.length = 0

    await workspace.unlink('tree')

    expect(events.filter((event) => event.op === 'unlink').map((event) => event.path).sort()).toEqual([
      'tree',
      'tree/file.txt',
      'tree/nested',
      'tree/nested/deep.txt',
    ])
  } finally {
    unsubscribe?.()
    await harness.cleanup()
  }
})

test('calls onMutation after write/unlink/mkdir/rename', async () => {
  const harness = await createMockVercelSandboxHarness()
  const onMutation = vi.fn()
  const workspace = createVercelSandboxWorkspace(harness.sandbox, { onMutation })

  try {
    await workspace.mkdir('dirty', { recursive: true })
    await workspace.writeFile('dirty/a.txt', 'a')
    await workspace.rename('dirty/a.txt', 'dirty/b.txt')
    await workspace.unlink('dirty/b.txt')

    expect(onMutation).toHaveBeenCalledTimes(4)
  } finally {
    await harness.cleanup()
  }
})

test('invalidates metadata cache after sandbox exec on shared handle', async () => {
  const harness = await createMockVercelSandboxHarness()
  const statSpy = vi.spyOn((harness.sandbox as any).fs, 'stat')
  const workspace = createVercelSandboxWorkspace(harness.sandbox)
  const sandbox = createVercelSandboxExec(harness.sandbox)

  try {
    await workspace.writeFile('cache/exec.txt', 'before')

    await workspace.stat('cache/exec.txt')
    await workspace.stat('cache/exec.txt')
    expect(statSpy).toHaveBeenCalledTimes(1)

    const execResult = await sandbox.exec('echo cache-bust')
    expect(execResult.exitCode).toBe(0)

    await workspace.stat('cache/exec.txt')
    expect(statSpy).toHaveBeenCalledTimes(2)
  } finally {
    await harness.cleanup()
  }
})

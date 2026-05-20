import { expect, test, vi } from 'vitest'

import { createVercelSandboxExec } from '../../sandbox/vercel-sandbox/createVercelSandboxExec'
import { createVercelSandboxWorkspace } from '../createVercelSandboxWorkspace'
import { createMockVercelSandboxHarness } from './helpers/mockVercelSandbox'

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

test('fallback read errors expose runtime workspace root, not Vercel internal root', async () => {
  const workspace = createVercelSandboxWorkspace({
    writeFiles: vi.fn(async () => {}),
    readFileToBuffer: vi.fn(async () => null),
  } as any)

  await expect(workspace.readFile('missing.txt')).rejects.toThrow("/workspace/missing.txt")
  await expect(workspace.readFile('missing.txt')).rejects.not.toThrow('/vercel/sandbox')
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

test('optimized small writes return stat in a single sandbox command', async () => {
  const harness = await createMockVercelSandboxHarness()
  const runSpy = vi.spyOn(harness.sandbox, 'runCommand')
  const writeFilesSpy = vi.spyOn(harness.sandbox, 'writeFiles')
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.writeFileWithStat?.('single-call.txt', 'hello')

    expect(runSpy).toHaveBeenCalledTimes(1)
    expect(writeFilesSpy).not.toHaveBeenCalled()
  } finally {
    await harness.cleanup()
  }
})

test('reuses stat/readdir cache entries inside ttl and refreshes after expiry', async () => {
  const harness = await createMockVercelSandboxHarness()
  const statSpy = vi.spyOn((harness.sandbox as any).fs, 'stat')
  const readdirSpy = vi.spyOn((harness.sandbox as any).fs, 'readdir')
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
    expect(readdirSpy).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(15_001)
    await workspace.stat('cache/a.txt')
    await workspace.readdir('cache')
    expect(statSpy).toHaveBeenCalledTimes(2)
    expect(readdirSpy).toHaveBeenCalledTimes(2)
  } finally {
    nowSpy.mockRestore()
    await harness.cleanup()
  }
})

test('invalidates metadata cache after write/unlink/mkdir/rename', async () => {
  const harness = await createMockVercelSandboxHarness()
  const statSpy = vi.spyOn((harness.sandbox as any).fs, 'stat')
  const readdirSpy = vi.spyOn((harness.sandbox as any).fs, 'readdir')
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

    await workspace.readdir('cache')
    await workspace.readdir('cache')
    expect(readdirSpy).toHaveBeenCalledTimes(1)

    await workspace.mkdir('cache/nested', { recursive: true })
    await workspace.readdir('cache')
    expect(readdirSpy).toHaveBeenCalledTimes(2)

    await workspace.rename('cache/a.txt', 'cache/b.txt')
    await workspace.stat('cache/b.txt')
    expect(statSpy).toHaveBeenCalledTimes(3)

    await workspace.unlink('cache/b.txt')
    await expect(workspace.stat('cache/b.txt')).rejects.toThrow()
    expect(statSpy).toHaveBeenCalledTimes(4)
  } finally {
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

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { createNodeWorkspace } from '../../../workspace/createNodeWorkspace'
import { createBwrapSandbox } from '../createBwrapSandbox'

const tempDirs: string[] = []
const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

async function setupSandbox() {
  const root = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-sandbox-'))
  tempDirs.push(root)

  const workspace = createNodeWorkspace(root)
  const sandbox = createBwrapSandbox()
  await sandbox.init({ workspace, sessionId: 'session-1' })

  return { sandbox, workspace, root }
}

test('init verifies bwrap binary exists on PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boring-ui-bwrap-check-'))
  tempDirs.push(root)

  const sandbox = createBwrapSandbox()
  const workspace = createNodeWorkspace(root)

  const originalPath = process.env.PATH
  process.env.PATH = ''
  try {
    await expect(sandbox.init({ workspace, sessionId: 'session-check' }))
      .rejects
      .toThrow('not found on PATH')
  } finally {
    process.env.PATH = originalPath
  }
})

const describeIfBwrap = HAS_BWRAP ? describe : describe.skip

describeIfBwrap('createBwrapSandbox', () => {
  test('bwrap happy path executes command and returns stdout', async () => {
    const { sandbox } = await setupSandbox()

    const result = await sandbox.exec('echo hello')

    expect(Buffer.from(result.stdout).toString('utf-8')).toBe('hello\n')
    expect(result.exitCode).toBe(0)
    expect(result.truncated).toBe(false)
  })

  test('workspace writes are visible inside sandbox', async () => {
    const { sandbox, workspace } = await setupSandbox()
    await workspace.writeFile('note.txt', 'hello-from-workspace')

    const result = await sandbox.exec('cat /workspace/note.txt')

    expect(Buffer.from(result.stdout).toString('utf-8')).toBe('hello-from-workspace')
    expect(result.exitCode).toBe(0)
  })

  test('timeout is enforced', async () => {
    const { sandbox } = await setupSandbox()

    const result = await sandbox.exec('sleep 60', { timeoutMs: 1_000 })

    expect(result.exitCode).toBe(124)
    expect(result.durationMs).toBeGreaterThanOrEqual(1_000)
    expect(result.durationMs).toBeLessThan(4_000)
  }, 20_000)

  test('maxOutputBytes caps output and marks truncated', async () => {
    const { sandbox } = await setupSandbox()

    const result = await sandbox.exec('yes | head -c 10000000', {
      maxOutputBytes: 1_024,
    })

    expect(result.truncated).toBe(true)
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(1_024)
  })

  test('cwd maps from host workspace path to /workspace', async () => {
    const { sandbox, workspace, root } = await setupSandbox()
    await workspace.mkdir('nested', { recursive: true })
    await workspace.writeFile('nested/file.txt', 'cwd-ok')

    const result = await sandbox.exec('pwd && cat file.txt', { cwd: join(root, 'nested') })
    const output = Buffer.from(result.stdout).toString('utf-8')

    expect(output).toContain('/workspace/nested')
    expect(output).toContain('cwd-ok')
    expect(result.exitCode).toBe(0)
  })
})

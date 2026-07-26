import { spawnSync } from 'node:child_process'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'

import { createTempWorkspace, type TempWorkspaceHandle } from '../../__tests__/helpers'
import { createBwrapSandbox } from '../createBwrapSandbox'
import { createBwrapSandboxProvider } from '../createBwrapProvider'

const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()

const suite = HAS_BWRAP ? describe : describe.skip

suite('bwrap readonly workspace shell qualification', () => {
  let temp: TempWorkspaceHandle | undefined

  afterEach(async () => {
    await temp?.cleanup()
    temp = undefined
  })

  it('allows a nonexistent protected root during operations-only construction', async () => {
    temp = await createTempWorkspace('boring-bwrap-weak-readonly-shell-')
    const provider = createBwrapSandboxProvider()
    const pair = await provider.create({
      workspaceRoot: temp.root,
      sessionId: 'weak-readonly-shell',
      readonlyWorkspacePolicy: { readonlyPaths: ['future/protected'], revision: 'v1' },
    })
    try {
      await expect(pair.sandbox.exec('mkdir -p /workspace/future/protected && echo ok > /workspace/future/protected/file.txt'))
        .resolves.toMatchObject({ exitCode: 0 })
    } finally {
      await pair.dispose()
    }
  })

  it('rejects symlinks anywhere inside a requested strong protected root', async () => {
    temp = await createTempWorkspace('boring-bwrap-strong-symlink-')
    await mkdir(`${temp.root}/protected`, { recursive: true })
    await symlink('/etc', `${temp.root}/protected/escape`)
    const provider = createBwrapSandboxProvider()
    await expect(provider.create({
      workspaceRoot: temp.root,
      sessionId: 'strong-symlink',
      readonlyWorkspacePolicy: { readonlyPaths: ['protected'], revision: 'v1' },
      requestedReadonlyWorkspacePathEnforcement: 'operations-and-shell',
    })).rejects.toThrow(/symlink/i)
  })

  it('blocks leaf, replacement, symlink, and ancestor attacks while preserving reads and sibling writes', async () => {
    temp = await createTempWorkspace('boring-bwrap-readonly-shell-')
    await mkdir(`${temp.root}/mixed/protected`, { recursive: true })
    await writeFile(`${temp.root}/mixed/protected/locked.txt`, 'locked')
    await writeFile(`${temp.root}/mixed/free.txt`, 'free')

    const sandbox = createBwrapSandbox({
      hostWorkspaceRoot: temp.root,
      readonlyWorkspacePaths: ['mixed/protected'],
    })
    await sandbox.init?.({ workspace: temp.workspace, sessionId: 'readonly-shell' })

    const succeeds = await sandbox.exec('cat /workspace/mixed/protected/locked.txt && echo ok > /workspace/mixed/free.txt')
    expect(succeeds.exitCode).toBe(0)
    expect(new TextDecoder().decode(succeeds.stdout)).toContain('locked')
    expect(await readFile(`${temp.root}/mixed/free.txt`, 'utf8')).toContain('ok')

    const attacks = [
      'echo x > /workspace/mixed/protected/locked.txt',
      'echo x >> /workspace/mixed/protected/locked.txt',
      'echo x > /workspace/mixed/replacement && mv -f /workspace/mixed/replacement /workspace/mixed/protected/locked.txt',
      'mv /workspace/mixed/protected/locked.txt /workspace/mixed/out.txt',
      'rm -f /workspace/mixed/protected/locked.txt',
      'mkdir /workspace/mixed/protected/new-dir',
      'ln -s /workspace/mixed/protected/locked.txt /workspace/mixed/link && echo x > /workspace/mixed/link',
      'mv /workspace/mixed /workspace/mixed-moved',
    ]
    for (const command of attacks) {
      const result = await sandbox.exec(command)
      expect(result.exitCode, command).not.toBe(0)
      expect(await readFile(`${temp.root}/mixed/protected/locked.txt`, 'utf8')).toBe('locked')
    }
  })
})

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFsProvisioner } from '../fsProvisioner.js'

describe('createFsProvisioner', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-prov-'))
  })

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true })
  })

  it('provision creates dir with 0o700', async () => {
    const provisioner = createFsProvisioner({ rootDir })
    const result = await provisioner.provision({
      workspaceId: 'ws-1',
      workspaceName: 'Test',
      ownerId: 'u-1',
      appId: 'app-1',
    })

    const stat = await fs.stat(result.volumePath)
    expect(stat.isDirectory()).toBe(true)
    const mode = stat.mode & 0o777
    if (process.platform === 'linux') {
      expect(mode).toBe(0o700)
    }
  })

  it('provision is idempotent', async () => {
    const provisioner = createFsProvisioner({ rootDir })
    const ctx = {
      workspaceId: 'ws-2',
      workspaceName: 'Test',
      ownerId: 'u-1',
      appId: 'app-1',
    }

    const r1 = await provisioner.provision(ctx)
    const r2 = await provisioner.provision(ctx)
    expect(r1.volumePath).toBe(r2.volumePath)
  })

  it('destroy removes dir', async () => {
    const provisioner = createFsProvisioner({ rootDir })
    const result = await provisioner.provision({
      workspaceId: 'ws-3',
      workspaceName: 'Test',
      ownerId: 'u-1',
      appId: 'app-1',
    })

    await fs.writeFile(path.join(result.volumePath, 'test.txt'), 'hello')
    await provisioner.destroy('ws-3')

    await expect(fs.stat(result.volumePath)).rejects.toThrow('ENOENT')
  })

  it('destroy is idempotent on missing', async () => {
    const provisioner = createFsProvisioner({ rootDir })
    await provisioner.destroy('nonexistent')
    await provisioner.destroy('nonexistent')
  })

  it('destroy is recursive', async () => {
    const provisioner = createFsProvisioner({ rootDir })
    const result = await provisioner.provision({
      workspaceId: 'ws-4',
      workspaceName: 'Test',
      ownerId: 'u-1',
      appId: 'app-1',
    })

    const nested = path.join(result.volumePath, 'a', 'b', 'c')
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(path.join(nested, 'deep.txt'), 'nested')
    await provisioner.destroy('ws-4')

    await expect(fs.stat(result.volumePath)).rejects.toThrow('ENOENT')
  })

  it('rootDir must be absolute', () => {
    expect(() => createFsProvisioner({ rootDir: 'relative/path' })).toThrow(
      'rootDir must be absolute',
    )
  })

  it.each(['..', '.', '', '../' + path.basename('/tmp/fs-prov-test')])(
    'provision rejects traversal workspaceId %j',
    async (workspaceId) => {
      const provisioner = createFsProvisioner({ rootDir })
      await expect(
        provisioner.provision({
          workspaceId,
          workspaceName: 'Test',
          ownerId: 'u-1',
          appId: 'app-1',
        }),
      ).rejects.toThrow('Path traversal detected')
    },
  )

  it.each(['..', '.', '', '../' + path.basename('/tmp/fs-prov-test')])(
    'destroy rejects traversal workspaceId %j',
    async (workspaceId) => {
      const provisioner = createFsProvisioner({ rootDir })
      await expect(provisioner.destroy(workspaceId)).rejects.toThrow(
        'Path traversal detected',
      )
    },
  )

  it('provision returns resolved absolute path', async () => {
    const provisioner = createFsProvisioner({ rootDir })
    const result = await provisioner.provision({
      workspaceId: 'ws-5',
      workspaceName: 'Test',
      ownerId: 'u-1',
      appId: 'app-1',
    })

    expect(path.isAbsolute(result.volumePath)).toBe(true)
    expect(result.volumePath).toBe(path.resolve(result.volumePath))
    expect(result.volumePath).toBe(path.join(rootDir, 'ws-5'))
  })
})

import { lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  allocateFreeLoopbackPorts,
  buildHermeticDevSmokeEnv,
  devSmokeTempRootPrefix,
  removeOwnedDevSmokeTempRoot,
} from '../devSmoke'

function listen(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => resolve(server))
  })
}

describe('dev console smoke port allocation', () => {
  it('allocates distinct loopback ports that can be rebound after reservation', async () => {
    const ports = await allocateFreeLoopbackPorts(6)
    expect(new Set(ports).size).toBe(ports.length)
    expect(ports.every((port) => Number.isInteger(port) && port > 0)).toBe(true)

    const rebound = await Promise.all(ports.map(listen))
    await Promise.all(rebound.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })))
  })

  it('builds child env from the example and allowlisted system values only', () => {
    const env = buildHermeticDevSmokeEnv(
      { ENABLE_DEV_LOGIN: '1', MAIL_TRANSPORT_URL: 'console://' },
      { PORT: '41000', MAIL_TRANSPORT_URL: '' },
      {
        PATH: '/usr/bin',
        HOME: '/tmp/home',
        LANG: 'C.UTF-8',
        MAIL_FROM: 'ambient@example.test',
        MAIL_TRANSPORT_URL: 'smtp://ambient.invalid',
        BORING_AGENT_MODE: 'vercel-sandbox',
        INFOMANIAK_API_TOKEN: 'ambient-token',
      },
    )

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      LANG: 'C.UTF-8',
      ENABLE_DEV_LOGIN: '1',
      MAIL_TRANSPORT_URL: '',
      PORT: '41000',
    })
    expect(env).not.toHaveProperty('MAIL_FROM')
    expect(env).not.toHaveProperty('BORING_AGENT_MODE')
    expect(env).not.toHaveProperty('INFOMANIAK_API_TOKEN')
  })

  it('recursively removes only an inspected directory owned by this smoke PID', async () => {
    const root = await mkdtemp(join(tmpdir(), devSmokeTempRootPrefix(process.pid)))
    await mkdir(join(root, 'workspaces'), { recursive: true })
    await writeFile(join(root, 'workspaces', 'sentinel.txt'), 'owned by dev smoke')

    await removeOwnedDevSmokeTempRoot(root)

    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('propagates owned temp-root removal failure', async () => {
    const removalFailure = new Error('simulated removal failure')
    await expect(removeOwnedDevSmokeTempRoot('/tmp/boring-full-app-smoke-1234-abcdef', {
      ownerPid: 1234,
      tempDirectory: '/tmp',
      inspect: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      remove: async () => { throw removalFailure },
    })).rejects.toBe(removalFailure)
  })

  it('rejects unowned paths and symlinks before recursive removal', async () => {
    const remove = vi.fn(async () => {})
    await expect(removeOwnedDevSmokeTempRoot('/tmp/not-owned', {
      ownerPid: 1234,
      tempDirectory: '/tmp',
      remove,
    })).rejects.toThrow('unowned dev smoke temp root')
    await expect(removeOwnedDevSmokeTempRoot('/tmp/boring-full-app-smoke-1234-abcdef', {
      ownerPid: 1234,
      tempDirectory: '/tmp',
      inspect: async () => ({ isDirectory: () => true, isSymbolicLink: () => true }),
      remove,
    })).rejects.toThrow('unsafe dev smoke temp root')
    expect(remove).not.toHaveBeenCalled()
  })

  it('rejects invalid allocation counts', async () => {
    await expect(allocateFreeLoopbackPorts(0)).rejects.toThrow('positive integer')
  })
})

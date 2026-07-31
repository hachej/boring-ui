import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { allocateFreeLoopbackPorts, buildHermeticDevSmokeEnv } from '../devSmoke'

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

  it('rejects invalid allocation counts', async () => {
    await expect(allocateFreeLoopbackPorts(0)).rejects.toThrow('positive integer')
  })
})

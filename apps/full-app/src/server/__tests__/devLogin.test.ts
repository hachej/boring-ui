import { describe, expect, it, vi } from 'vitest'
import { devLoginEnabledFromEnv, isLoopbackAddress, registerDevLoginRoute } from '../devLogin'

type RouteRequest = { ip: string; headers: Record<string, string | string[] | undefined> }
type RouteHandler = (request: RouteRequest, reply: ReturnType<typeof replyMock>) => unknown

function replyMock() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  }
}

function appFixture(existing?: { emailVerified: boolean; password?: string }) {
  let route: RouteHandler | undefined
  const user = { id: 'dev-user', email: 'local@example.test', name: 'Local Dev', emailVerified: existing?.emailVerified ?? true }
  const internalAdapter = {
    findUserByEmail: vi.fn(async () => existing ? {
      user,
      accounts: [{ providerId: 'credential', password: existing.password ?? 'stored-hash' }],
    } : null),
    createUser: vi.fn(async (input) => ({ ...user, ...input })),
    linkAccount: vi.fn(async (input) => input),
    updateUser: vi.fn(async (_id, input) => ({ ...user, ...input })),
    deleteUser: vi.fn(async () => undefined),
  }
  const password = {
    hash: vi.fn(async () => 'fresh-hash'),
    verify: vi.fn(async ({ password: candidate, hash }) => candidate === 'local-development-password' && hash === 'stored-hash'),
  }
  const authHandler = vi.fn(async (request: Request) => {
    expect(new URL(request.url).pathname).toBe('/auth/sign-in/email')
    return new Response('{}', {
      status: 200,
      headers: { 'set-cookie': 'boring-app.session=opaque; Path=/; HttpOnly' },
    })
  })
  const app = {
    config: { auth: { url: 'http://localhost:3000' } },
    auth: { handler: authHandler, $context: Promise.resolve({ internalAdapter, password }) },
    get: vi.fn((_path: string, handler: RouteHandler) => { route = handler }),
  }
  return { app, authHandler, internalAdapter, password, getRoute: () => route }
}

const env = {
  ENABLE_DEV_LOGIN: '1',
  NODE_ENV: 'development',
  DEV_LOGIN_EMAIL: 'local@example.test',
  DEV_LOGIN_PASSWORD: 'local-development-password',
  DEV_LOGIN_NAME: 'Local Dev',
}

describe('dev login route', () => {
  it('is enabled only by explicit non-production configuration', () => {
    expect(devLoginEnabledFromEnv({ ENABLE_DEV_LOGIN: '1', NODE_ENV: 'development' })).toBe(true)
    expect(devLoginEnabledFromEnv({ ENABLE_DEV_LOGIN: '0', NODE_ENV: 'development' })).toBe(false)
    expect(devLoginEnabledFromEnv({ ENABLE_DEV_LOGIN: '1', NODE_ENV: 'production' })).toBe(false)
  })

  it('creates a verified credential user without invoking signup or mail and forwards the session cookie', async () => {
    const fixture = appFixture()
    registerDevLoginRoute(fixture.app as never, env)
    const reply = replyMock()
    await fixture.getRoute()?.({ ip: '127.0.0.1', headers: {} }, reply)

    expect(fixture.internalAdapter.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'local@example.test',
      emailVerified: true,
    }))
    expect(fixture.internalAdapter.linkAccount).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'credential',
      password: 'fresh-hash',
    }))
    expect(fixture.authHandler).toHaveBeenCalledOnce()
    expect(reply.header).toHaveBeenCalledWith('set-cookie', expect.stringContaining('boring-app.session=opaque'))
    expect(reply.redirect).toHaveBeenCalledWith('/')
  })

  it('verifies an existing matching local credential before signing in again', async () => {
    const fixture = appFixture({ emailVerified: false })
    registerDevLoginRoute(fixture.app as never, env)
    const reply = replyMock()
    await fixture.getRoute()?.({ ip: '::1', headers: {} }, reply)

    expect(fixture.password.verify).toHaveBeenCalledWith({
      password: 'local-development-password',
      hash: 'stored-hash',
    })
    expect(fixture.internalAdapter.updateUser).toHaveBeenCalledWith('dev-user', { emailVerified: true })
    expect(fixture.internalAdapter.createUser).not.toHaveBeenCalled()
    expect(reply.redirect).toHaveBeenCalledWith('/')
  })

  it('rejects credential mismatch and non-loopback clients before sign-in', async () => {
    const mismatch = appFixture({ emailVerified: false, password: 'different-hash' })
    registerDevLoginRoute(mismatch.app as never, env)
    const mismatchReply = replyMock()
    await mismatch.getRoute()?.({ ip: '127.0.0.1', headers: {} }, mismatchReply)
    expect(mismatchReply.status).toHaveBeenCalledWith(409)
    expect(mismatch.authHandler).not.toHaveBeenCalled()

    const remote = appFixture()
    registerDevLoginRoute(remote.app as never, env)
    const remoteReply = replyMock()
    await remote.getRoute()?.({ ip: '127.0.0.1', headers: { 'x-boring-dev-client-ip': '192.168.1.20' } }, remoteReply)
    expect(remoteReply.status).toHaveBeenCalledWith(403)
    expect(remote.authHandler).not.toHaveBeenCalled()
  })

  it('recognizes IPv4, mapped IPv4, and IPv6 loopback addresses only', () => {
    expect(isLoopbackAddress('127.42.0.9')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.20')).toBe(false)
  })

  it('does not mount in production even when the flag is present', () => {
    const fixture = appFixture()
    registerDevLoginRoute(fixture.app as never, { ENABLE_DEV_LOGIN: '1', NODE_ENV: 'production' })
    expect(fixture.app.get).not.toHaveBeenCalled()
  })
})

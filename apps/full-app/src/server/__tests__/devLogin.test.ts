import { describe, expect, it, vi } from 'vitest'
import { devLoginEnabledFromEnv, registerDevLoginRoute } from '../devLogin'

type RouteHandler = (request: unknown, reply: {
  status(code: number): unknown
  send(body: unknown): unknown
  header(name: string, value: string | string[]): unknown
  redirect(location: string): unknown
}) => unknown

function appWithResponses(responses: Response[]) {
  let handler: RouteHandler | undefined
  const authHandler = vi.fn<(request: Request) => Promise<Response>>(async () => (
    responses.shift() ?? new Response(null, { status: 500 })
  ))
  const app = {
    config: { auth: { url: 'http://localhost:3000' } },
    auth: { handler: authHandler },
    get: vi.fn((_path: string, routeHandler: RouteHandler) => {
      handler = routeHandler
    }),
  }
  return { app, authHandler, getHandler: () => handler }
}

describe('dev login route', () => {
  it('is enabled only by explicit non-production configuration', () => {
    expect(devLoginEnabledFromEnv({ ENABLE_DEV_LOGIN: '1', NODE_ENV: 'development' })).toBe(true)
    expect(devLoginEnabledFromEnv({ ENABLE_DEV_LOGIN: '0', NODE_ENV: 'development' })).toBe(false)
    expect(devLoginEnabledFromEnv({ ENABLE_DEV_LOGIN: '1', NODE_ENV: 'production' })).toBe(false)
  })

  it('falls back to signup, forwards the normal session cookie, and redirects to the frontend root', async () => {
    const { app, authHandler, getHandler } = appWithResponses([
      new Response('{}', { status: 401 }),
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'boring-app.session=opaque; Path=/; HttpOnly' },
      }),
    ])
    registerDevLoginRoute(app as never, {
      ENABLE_DEV_LOGIN: '1',
      NODE_ENV: 'development',
      DEV_LOGIN_EMAIL: 'local@example.test',
      DEV_LOGIN_PASSWORD: 'local-development-password',
      DEV_LOGIN_NAME: 'Local Dev',
    })

    expect(app.get).toHaveBeenCalledWith('/dev-login', expect.any(Function))
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn(),
    }
    await getHandler()?.({}, reply)

    expect(authHandler).toHaveBeenCalledTimes(2)
    const signupRequest = authHandler.mock.calls[1]![0]
    expect(new URL(signupRequest.url).pathname).toBe('/auth/sign-up/email')
    expect(await signupRequest.json()).toEqual({
      email: 'local@example.test',
      password: 'local-development-password',
      name: 'Local Dev',
    })
    expect(reply.header).toHaveBeenCalledWith('set-cookie', expect.stringContaining('boring-app.session=opaque'))
    expect(reply.redirect).toHaveBeenCalledWith('/')
  })

  it('does not mount in production even when the flag is present', () => {
    const { app } = appWithResponses([])
    registerDevLoginRoute(app as never, { ENABLE_DEV_LOGIN: '1', NODE_ENV: 'production' })
    expect(app.get).not.toHaveBeenCalled()
  })
})

import type { FastifyReply, FastifyRequest } from 'fastify'

const DEFAULT_DEV_LOGIN_EMAIL = 'dev@example.test'
const DEFAULT_DEV_LOGIN_PASSWORD = 'Dev-local-2026!!x9'

type DevLoginApp = {
  readonly config: { readonly auth: { readonly url: string } }
  readonly auth: { handler(request: Request): Promise<Response> }
  get(path: string, handler: (request: FastifyRequest, reply: FastifyReply) => unknown): void
}

export function devLoginEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_DEV_LOGIN === '1' && env.NODE_ENV !== 'production'
}

function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }

  const value = headers.get('set-cookie')
  return value ? [value] : []
}

export function registerDevLoginRoute(
  app: DevLoginApp,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!devLoginEnabledFromEnv(env)) return

  async function authPost(pathname: string, body: Record<string, unknown>): Promise<Response> {
    return app.auth.handler(new Request(new URL(pathname, app.config.auth.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  app.get('/dev-login', async (_request, reply) => {
    const email = env.DEV_LOGIN_EMAIL?.trim() || DEFAULT_DEV_LOGIN_EMAIL
    const password = env.DEV_LOGIN_PASSWORD?.trim() || DEFAULT_DEV_LOGIN_PASSWORD
    const name = env.DEV_LOGIN_NAME?.trim() || 'Dev'

    let response = await authPost('/auth/sign-in/email', { email, password })
    if (!response.ok) {
      response = await authPost('/auth/sign-up/email', { email, password, name })
    }

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      reply.status(response.status)
      return reply.send({
        error: 'dev_login_failed',
        message: message || 'Dev login failed. If the user already exists with a different password, restart the local dev Postgres service or set DEV_LOGIN_PASSWORD to match it.',
      })
    }

    const setCookies = extractSetCookies(response.headers)
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies.length === 1 ? setCookies[0] : setCookies)
    }

    return reply.redirect('/')
  })
}

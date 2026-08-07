import type { FastifyReply, FastifyRequest } from 'fastify'
import type { BetterAuthInstance } from '@hachej/boring-core/server'

const DEFAULT_DEV_LOGIN_EMAIL = 'dev@example.test'
const DEFAULT_DEV_LOGIN_PASSWORD = 'Dev-local-2026!!x9'
const DEV_CLIENT_IP_HEADER = 'x-boring-dev-client-ip'

interface DevLoginApp {
  readonly config: { readonly auth: { readonly url: string } }
  readonly auth: BetterAuthInstance
  get(path: string, handler: (request: FastifyRequest, reply: FastifyReply) => unknown): void
}

const provisioningByEmail = new Map<string, Promise<void>>()

export function devLoginEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_DEV_LOGIN === '1' && env.NODE_ENV !== 'production'
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase()
  if (normalized === '::1') return true
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized
  const octets = ipv4.split('.')
  return octets.length === 4
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    && octets[0] === '127'
}

function requestIsLoopback(request: FastifyRequest): boolean {
  if (!isLoopbackAddress(request.ip)) return false
  const forwarded = request.headers[DEV_CLIENT_IP_HEADER]
  const clientIp = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return typeof clientIp === 'string' ? isLoopbackAddress(clientIp) : true
}

function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') return withGetSetCookie.getSetCookie()
  const value = headers.get('set-cookie')
  return value ? [value] : []
}

async function provisionVerifiedCredentialUser(
  app: DevLoginApp,
  input: { email: string; password: string; name: string },
): Promise<void> {
  const key = `${app.config.auth.url}\n${input.email.toLowerCase()}`
  const existing = provisioningByEmail.get(key)
  if (existing) return await existing

  const provisioning = (async () => {
    const context = await app.auth.$context
    const found = await context.internalAdapter.findUserByEmail(input.email, { includeAccounts: true })
    if (found) {
      const credential = found.accounts.find((account) => account.providerId === 'credential')
      if (!credential?.password || !await context.password.verify({
        password: input.password,
        hash: credential.password,
      })) {
        throw new Error('the development user already exists with a different credential')
      }
      if (!found.user.emailVerified) {
        await context.internalAdapter.updateUser(found.user.id, { emailVerified: true })
      }
      return
    }

    const password = await context.password.hash(input.password)
    const user = await context.internalAdapter.createUser({
      email: input.email,
      name: input.name,
      emailVerified: true,
    })
    try {
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password,
      })
    } catch (error) {
      await context.internalAdapter.deleteUser(user.id).catch(() => undefined)
      throw error
    }
  })()
  provisioningByEmail.set(key, provisioning)
  try {
    await provisioning
  } finally {
    if (provisioningByEmail.get(key) === provisioning) provisioningByEmail.delete(key)
  }
}

export function registerDevLoginRoute(app: DevLoginApp, env: NodeJS.ProcessEnv = process.env): void {
  if (!devLoginEnabledFromEnv(env)) return

  const authPost = async (pathname: string, body: Record<string, unknown>): Promise<Response> => (
    await app.auth.handler(new Request(new URL(pathname, app.config.auth.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
  )

  app.get('/dev-login', async (request, reply) => {
    if (!requestIsLoopback(request)) {
      return reply.status(403).send({
        error: 'dev_login_loopback_only',
        message: 'Dev login is available only from the local machine.',
      })
    }

    const email = env.DEV_LOGIN_EMAIL?.trim() || DEFAULT_DEV_LOGIN_EMAIL
    const password = env.DEV_LOGIN_PASSWORD?.trim() || DEFAULT_DEV_LOGIN_PASSWORD
    const name = env.DEV_LOGIN_NAME?.trim() || 'Dev'

    try {
      await provisionVerifiedCredentialUser(app, { email, password, name })
    } catch (error) {
      return reply.status(409).send({
        error: 'dev_login_failed',
        message: error instanceof Error ? error.message : 'Dev login failed.',
      })
    }

    const response = await authPost('/auth/sign-in/email', { email, password })
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      return reply.status(response.status).send({
        error: 'dev_login_failed',
        message: message || 'Dev login failed.',
      })
    }

    const setCookies = extractSetCookies(response.headers)
    if (setCookies.length > 0) reply.header('set-cookie', setCookies.length === 1 ? setCookies[0] : setCookies)
    return reply.redirect('/')
  })
}

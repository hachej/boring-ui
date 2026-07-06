import { Buffer } from 'node:buffer'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CoreConfig } from '../../shared/types.js'
import type { BetterAuthInstance } from '../../server/auth/index.js'
import { AUTH_PROXY_RATE_LIMITED_ROUTES } from '../../server/security/rateLimit.js'

const AUTH_PROXY_BLOCKED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
])

// Pages that are served as the SPA shell (catch-all) AND get explicit GET routes
// so the browser can navigate directly to them without hitting the auth proxy.
export const FRONTEND_AUTH_PAGES = new Set([
  '/auth/signin',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
])

// Pages that still belong to the SPA for browser navigation, but must NOT get
// explicit GET shell routes because doing so would shadow real auth proxy GETs.
// /auth/verify-email, /auth/error, and social callback routes are in this bucket:
// browser GETs with Accept: text/html should fall through to the catch-all shell
// when that is the intended UX, but the proxy must still be able to handle real
// auth GETs.
export const FRONTEND_AUTH_PAGES_SPA_ONLY = new Set([
  '/auth/verify-email',
  '/auth/error',
  '/auth/callback/github',
  '/auth/callback/google',
])

type AuthProxyApp = FastifyInstance & {
  auth: BetterAuthInstance
  config: CoreConfig
}

function toHeaders(source: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers()

  for (const [key, value] of Object.entries(source)) {
    if (!value) continue
    headers.set(key, Array.isArray(value) ? value[0] : value)
  }

  return headers
}

function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[]
  }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }

  const value = headers.get('set-cookie')
  return value ? [value] : []
}

function encodeAuthRequestBody(request: {
  method: string
  body?: unknown
  headers?: Record<string, string | string[] | undefined>
}): string | Uint8Array | URLSearchParams | undefined {
  const isBodyless = request.method === 'GET' || request.method === 'HEAD'
  if (isBodyless) return undefined

  const bodyValue = request.body
  if (bodyValue == null) return undefined
  if (typeof bodyValue === 'string') return bodyValue
  if (bodyValue instanceof Uint8Array) return bodyValue
  if (bodyValue instanceof URLSearchParams) return bodyValue

  const requestContentType = String(request.headers?.['content-type'] ?? '').toLowerCase()
  if (requestContentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(bodyValue as Record<string, unknown>)) {
      if (value == null) continue
      params.append(key, String(value))
    }
    return params
  }

  return JSON.stringify(bodyValue)
}

export async function registerAuthProxy(
  app: AuthProxyApp,
  options?: {
    serveSpaShell?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  },
) {
  const handleAuthProxy = async (request: FastifyRequest, reply: FastifyReply) => {
    const accept = String(request.headers?.accept ?? '')
    const pathname = request.url.split('?')[0] ?? '/'
    const isSpaOnlyAuthPage = FRONTEND_AUTH_PAGES_SPA_ONLY.has(pathname)
    const isExplicitShellAuthPage = FRONTEND_AUTH_PAGES.has(pathname)

    if (
      request.method === 'GET' &&
      accept.includes('text/html') &&
      (isExplicitShellAuthPage ||
        (isSpaOnlyAuthPage && pathname !== '/auth/callback/github' && pathname !== '/auth/callback/google'))
    ) {
      if (options?.serveSpaShell) {
        return options.serveSpaShell(request, reply)
      }
      return reply.callNotFound()
    }

    const body = encodeAuthRequestBody(request)
    const targetUrl = new URL(request.url, app.config.auth.url).toString()

    const response = await app.auth.handler(
      new Request(targetUrl, {
        method: request.method,
        headers: toHeaders(request.headers),
        body: body as BodyInit | undefined,
      }),
    )

    for (const [key, value] of response.headers.entries()) {
      const lowered = key.toLowerCase()
      if (lowered === 'set-cookie') continue
      if (AUTH_PROXY_BLOCKED_RESPONSE_HEADERS.has(lowered)) continue
      reply.header(key, value)
    }

    const setCookies = extractSetCookies(response.headers)
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies.length === 1 ? setCookies[0] : setCookies)
    }

    reply.status(response.status)
    const responseBody = Buffer.from(await response.arrayBuffer())
    return reply.send(responseBody)
  }

  for (const route of AUTH_PROXY_RATE_LIMITED_ROUTES) {
    app.route({
      method: route.method,
      url: route.url,
      handler: handleAuthProxy,
    })
  }
  app.all('/auth/*', handleAuthProxy)
}

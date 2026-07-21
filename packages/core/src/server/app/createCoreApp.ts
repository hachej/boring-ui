import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import proxyAddr from '@fastify/proxy-addr'
import type { IncomingMessage } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { ERROR_CODES, HttpError } from '../../shared/errors.js'
import type { CoreConfig } from '../../shared/types.js'
import type { CreateCoreAppOptions } from './types.js'
import {
  assertTypedDomainModeCompatible,
  CoreProductRoutingError,
  createCoreProductRouting,
  validateSharedAuthCookieDomain,
} from '../productDeclarations.js'
import { registerErrorHandler } from './errorHandler.js'
import { registerCapabilities } from './capabilities.js'
import { registerRateLimits } from '../security/rateLimit.js'

const DEFAULT_REDACTION_KEYWORDS = [
  'secret',
  'token',
  'clientsecret',
  'password',
  'authorization',
  'cookie',
]
const SHUTDOWN_GRACE_MS = 30_000
const CSP_NONCE_SIZE_BYTES = 16
const C1_TYPED_PUBLIC_API_PATHS = new Set([
  '/api/v1/capabilities',
  '/api/v1/config',
  '/api/v1/me',
])

type Closable = {
  close?: () => Promise<unknown> | unknown
  end?: () => Promise<unknown> | unknown
}

type IncomingMessageWithNonce = IncomingMessage & {
  cspNonce?: string
}

function redactObject(
  obj: Record<string, unknown>,
  keywords: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase()
    if (keywords.some((kw) => keyLower.includes(kw))) {
      result[key] = '[REDACTED]'
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactObject(
        value as Record<string, unknown>,
        keywords,
      )
    } else {
      result[key] = value
    }
  }
  return result
}

async function closeDbPoolIfPresent(app: FastifyInstance): Promise<void> {
  const maybeDb = (app as FastifyInstance & { db?: unknown }).db
  if (!maybeDb || typeof maybeDb !== 'object') return

  const db = maybeDb as Closable
  const closeFn =
    typeof db.end === 'function'
      ? db.end.bind(db)
      : typeof db.close === 'function'
        ? db.close.bind(db)
        : null

  if (!closeFn) return
  await closeFn()
}

function installShutdownHandlers(app: FastifyInstance): void {
  let shuttingDown = false
  const activeRequests = new Set<unknown>()
  const drainWaiters = new Set<() => void>()

  const notifyRequestDrained = () => {
    if (activeRequests.size > 0) return
    for (const resolve of drainWaiters) resolve()
    drainWaiters.clear()
  }

  app.addHook('onRequest', async (request) => {
    activeRequests.add(request.id)
  })
  app.addHook('onResponse', async (request) => {
    activeRequests.delete(request.id)
    notifyRequestDrained()
  })
  app.addHook('onError', async (request) => {
    activeRequests.delete(request.id)
    notifyRequestDrained()
  })

  const waitForInflightRequests = async () => {
    if (activeRequests.size === 0) return
    await new Promise<void>((resolve) => {
      drainWaiters.add(resolve)
    })
  }

  const onSignal = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true

    app.log.info({ signal }, 'shutdown:start')

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        Promise.all([app.close(), waitForInflightRequests()]).then(() => 'closed' as const),
        new Promise<'timeout'>((resolve) => {
          timeoutHandle = setTimeout(() => {
            resolve('timeout')
          }, SHUTDOWN_GRACE_MS)
        }),
      ])
      if (timeoutHandle) clearTimeout(timeoutHandle)

      if (result === 'timeout') {
        app.log.warn(
          { signal, timeoutMs: SHUTDOWN_GRACE_MS },
          'shutdown:grace-exceeded',
        )
        try {
          await closeDbPoolIfPresent(app)
        } catch (error) {
          app.log.error(
            { err: error, signal },
            'shutdown:db-close-failed',
          )
        }
        process.exit(1)
        return
      }

      try {
        await closeDbPoolIfPresent(app)
      } catch (error) {
        app.log.error({ err: error, signal }, 'shutdown:db-close-failed')
        process.exit(1)
        return
      }

      app.log.info({ signal }, 'shutdown:complete')
      process.exit(0)
    } catch (error) {
      app.log.error({ err: error, signal }, 'shutdown:error')
      try {
        await closeDbPoolIfPresent(app)
      } catch (dbError) {
        app.log.error({ err: dbError, signal }, 'shutdown:db-close-failed')
      }
      process.exit(1)
    }
  }

  const sigtermHandler = () => {
    void onSignal('SIGTERM')
  }
  const sigintHandler = () => {
    void onSignal('SIGINT')
  }

  process.once('SIGTERM', sigtermHandler)
  process.once('SIGINT', sigintHandler)

  app.addHook('onClose', async () => {
    process.removeListener('SIGTERM', sigtermHandler)
    process.removeListener('SIGINT', sigintHandler)
  })
}

export async function createCoreApp(
  config: CoreConfig,
  options?: CreateCoreAppOptions,
) {
  assertTypedDomainModeCompatible(options ?? {})
  if (
    options?.coreProductRouting === undefined
    && options?.sharedAuthCookieDomain !== undefined
  ) {
    throw new CoreProductRoutingError(
      ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG,
      'sharedAuthCookieDomain requires coreProductRouting',
    )
  }
  const coreProductRoutingInput = options?.coreProductRouting
  const coreProductRouting = coreProductRoutingInput !== undefined
    ? createCoreProductRouting(coreProductRoutingInput)
    : null
  const sharedAuthCookieDomain = coreProductRouting
    ? validateSharedAuthCookieDomain({
        domain: options?.sharedAuthCookieDomain,
        routing: coreProductRouting,
        authUrl: config.auth.url,
        sessionCookieSecure: config.auth.sessionCookieSecure,
        corsOrigins: config.cors.origins,
      })
    : null
  const sharedAuthTrustedOrigins = coreProductRouting
    ? Object.freeze(coreProductRouting.domains.map(({ hostname }) => `https://${hostname}`))
    : null
  const redactionKeywords = [...DEFAULT_REDACTION_KEYWORDS]
  const proxyPolicy = config.security?.trustedProxy
  if (coreProductRouting && proxyPolicy === 'legacy-unsafe') {
    throw new CoreProductRoutingError(
      ERROR_CODES.TYPED_DOMAIN_UNSAFE_PROXY,
      'Typed-domain routing requires bounded trusted-proxy policy',
    )
  }
  const trustedProxy = proxyPolicy && proxyPolicy !== 'legacy-unsafe'
    ? { hops: proxyPolicy.hops, matches: proxyAddr.compile([...proxyPolicy.cidrs]) }
    : null

  const app = Fastify({
    // Temporary compatibility is deliberately impossible to enable by omission.
    trustProxy: proxyPolicy === 'legacy-unsafe'
      ? true
      : trustedProxy
      ? (address, index) => index < trustedProxy.hops && trustedProxy.matches(address, index)
      : false,
    bodyLimit: config.bodyLimit,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id']
      if (typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128) {
        return incoming
      }
      return randomUUID()
    },
    logger: {
      level: config.logLevel,
      serializers: {
        req(req) {
          return redactObject(
            {
              method: req.method,
              url: req.url,
              hostname: req.hostname,
              remoteAddress: req.ip,
              headers: req.headers,
            },
            redactionKeywords,
          )
        },
        res(res) {
          return { statusCode: res.statusCode }
        },
      },
    },
  })

  app.decorate('config', config)
  app.decorate('provisioner', options?.provisioner ?? null)
  app.decorate('coreProductRouting', coreProductRouting)
  app.decorate('sharedAuthCookieDomain', sharedAuthCookieDomain)
  app.decorate('sharedAuthTrustedOrigins', sharedAuthTrustedOrigins)

  if (coreProductRouting) {
    app.decorateRequest('productScope')
    app.addHook('onRequest', async (request) => {
      request.productScope = coreProductRouting.resolveRequestScope(request)
    })
    app.addHook('preHandler', async (request) => {
      const pathname = request.url.split('?', 1)[0] ?? request.url
      const method = request.method.toUpperCase()
      const publicApiRequest = C1_TYPED_PUBLIC_API_PATHS.has(pathname)
        && ['GET', 'HEAD', 'OPTIONS'].includes(method)
      if (pathname.startsWith('/api/v1/') && !publicApiRequest) {
        throw new HttpError({
          status: 503,
          code: ERROR_CODES.TYPED_WORKSPACE_AUTHORIZATION_NOT_AVAILABLE,
          message: 'Typed Workspace authorization is unavailable until the C2 guard is installed',
          requestId: request.id,
        })
      }
    })
  }

  app.decorate('addRedactionPaths', function (paths: string[]) {
    for (const p of paths) {
      redactionKeywords.push(p.toLowerCase())
    }
  })

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  app.addHook('onRequest', async (request) => {
    const nonce = randomBytes(CSP_NONCE_SIZE_BYTES).toString('base64')
    request.cspNonce = nonce
    ;(request.raw as IncomingMessageWithNonce).cspNonce = nonce
  })

  await app.register(cors, {
    origin: config.cors.origins.length > 0 ? config.cors.origins : true,
    credentials: config.cors.credentials,
  })

  const cspEnabled = config.security?.csp?.enabled ?? true
  const cspUpgradeInsecureRequests =
    config.security?.csp?.upgradeInsecureRequests ?? config.auth.url.startsWith('https://')

  await app.register(helmet, {
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: {
      action: 'deny',
    },
    noSniff: true,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    contentSecurityPolicy: cspEnabled
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
              "'self'",
              (request) => `'nonce-${(request as IncomingMessageWithNonce).cspNonce ?? ''}'`,
            ],
            styleSrc: [
              "'self'",
              'https://fonts.googleapis.com',
              (request) => `'nonce-${(request as IncomingMessageWithNonce).cspNonce ?? ''}'`,
            ],
            // React/DockView use style attributes for runtime layout sizing.
            // Keep stylesheet loading nonce/domain-bound, but allow attributes
            // so production CSP does not collapse workspace/workbench panes.
            styleSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            frameSrc: ["'self'", 'https://calendly.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: cspUpgradeInsecureRequests ? [] : null,
          },
        }
      : false,
  })

  registerErrorHandler(app)
  if (options?.requestScopeResolver) {
    const resolveRequestScope = options.requestScopeResolver
    app.decorateRequest('requestScope')
    app.addHook('onRequest', async (request) => {
      let scope
      try {
        scope = await resolveRequestScope(request)
      } catch (error) {
        if (
          typeof error === 'object'
          && error !== null
          && 'code' in error
          && error.code === ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION
        ) {
          throw new HttpError({
            status: 421,
            code: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
            message: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
          })
        }
        throw error
      }
      if (scope === undefined) return
      request.requestScope = Object.freeze({
        bindingId: scope.bindingId,
        workspaceId: scope.workspaceId,
        defaultDeploymentId: scope.defaultDeploymentId,
        activeRevision: scope.activeRevision,
        resolvedDigest: scope.resolvedDigest,
      })
    })
  }
  registerCapabilities(app)
  await registerRateLimits(app)

  const manageShutdown = options?.manageShutdown ?? true
  if (manageShutdown) {
    installShutdownHandlers(app)
  }

  return app
}

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import type { IncomingMessage } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import type { CoreConfig } from '../../shared/types.js'
import type { CreateCoreAppOptions } from './types.js'
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

  const onSignal = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true

    app.log.info({ signal }, 'shutdown:start')

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        app.close(),
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
  const redactionKeywords = [...DEFAULT_REDACTION_KEYWORDS]

  const app = Fastify({
    trustProxy: true,
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
              (request) => `'nonce-${(request as IncomingMessageWithNonce).cspNonce ?? ''}'`,
            ],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
  })

  registerErrorHandler(app)
  registerCapabilities(app)
  await registerRateLimits(app)

  const manageShutdown = options?.manageShutdown ?? true
  if (manageShutdown) {
    installShutdownHandlers(app)
  }

  return app
}

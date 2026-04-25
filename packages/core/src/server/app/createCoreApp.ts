import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import closeWithGrace from 'close-with-grace'
import { randomUUID } from 'node:crypto'
import type { CoreConfig } from '../../shared/types.js'
import type { CreateCoreAppOptions } from './types.js'
import { registerErrorHandler } from './errorHandler.js'

const DEFAULT_REDACTION_KEYWORDS = [
  'secret',
  'token',
  'clientsecret',
  'password',
  'authorization',
  'cookie',
]

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

  await app.register(cors, {
    origin: config.cors.origins.length > 0 ? config.cors.origins : true,
    credentials: config.cors.credentials,
  })

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })

  registerErrorHandler(app)

  const manageShutdown = options?.manageShutdown ?? true
  if (manageShutdown) {
    closeWithGrace({ delay: 30_000 }, async ({ signal, err }) => {
      if (err) {
        app.log.error({ err, signal }, 'shutdown:error')
      }
      await app.close()
    })
  }

  return app
}

import type { FastifyInstance } from 'fastify'

export interface ReadinessState {
  sandboxReady: boolean
  harnessReady: boolean
  degradedReason?: string
}

export interface HealthRouteOptions {
  version: string
  getReadiness: () => ReadinessState
}

export function healthRoutes(
  app: FastifyInstance,
  opts: HealthRouteOptions,
  done: (err?: Error) => void,
): void {
  const startTime = Date.now()

  app.get('/health', async () => {
    return {
      status: 'ok',
      version: opts.version,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    }
  })

  app.get('/ready', async (_request, reply) => {
    const state = opts.getReadiness()

    if (state.degradedReason) {
      return reply.code(503).send({
        status: 'degraded',
        reason: state.degradedReason,
      })
    }

    if (!state.sandboxReady || !state.harnessReady) {
      return reply.code(503).send({
        status: 'provisioning',
        retryAfter: 2,
      })
    }

    return { status: 'ready' }
  })

  done()
}

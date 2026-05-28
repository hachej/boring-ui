import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ReadyStatusTracker } from '../../sandbox/vercel-sandbox/readyStatus'
import { ERROR_CODE_INTERNAL } from '../middleware'

export interface ReadyStatusRouteOptions {
  tracker?: ReadyStatusTracker
  getTracker?: (request: FastifyRequest) => ReadyStatusTracker | Promise<ReadyStatusTracker>
}

export function readyStatusRoutes(
  app: FastifyInstance,
  opts: ReadyStatusRouteOptions,
  done: (err?: Error) => void,
): void {
  app.get('/api/v1/ready-status', async (request, reply) => {
    let tracker: ReadyStatusTracker | undefined
    try {
      tracker = opts.getTracker ? await opts.getTracker(request) : opts.tracker
    } catch (err) {
      const statusCode = (err as { statusCode?: unknown })?.statusCode
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
        return reply.code(statusCode).send({
          error: {
            code: typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : ERROR_CODE_INTERNAL,
            message: err instanceof Error ? err.message : 'ready-status failed',
            details: (err as { details?: unknown }).details,
          },
        })
      }
      throw err
    }
    if (!tracker) throw new Error('ready-status route requires tracker or getTracker')

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    reply.raw.write(':\n\n')

    let closed = false
    let unsubscribe: (() => void) | null = null
    const closeStream = () => {
      if (closed) return
      closed = true
      unsubscribe?.()
      reply.raw.end()
    }

    unsubscribe = tracker.subscribe((event) => {
      if (closed) return
      reply.raw.write(`event: status\ndata: ${JSON.stringify(event)}\n\n`)
      if (event.state === 'ready' || event.state === 'degraded') closeStream()
    })

    request.raw.on('close', closeStream)
    reply.hijack()
    return reply
  })

  done()
}

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ReadyStatusTracker } from '../../runtime/readyStatus'

export interface ReadyStatusRouteOptions {
  tracker?: ReadyStatusTracker
  getTracker?: (request: FastifyRequest) => ReadyStatusTracker | Promise<ReadyStatusTracker>
  deferLeaseRelease?: (request: FastifyRequest) => void
}

export function readyStatusRoutes(
  app: FastifyInstance,
  opts: ReadyStatusRouteOptions,
  done: (err?: Error) => void,
): void {
  app.get('/api/v1/ready-status', async (request, reply) => {
    let transportClosed = false
    let cleanupStream: (() => void) | undefined
    reply.raw.once('close', () => {
      transportClosed = true
      cleanupStream?.()
    })

    const tracker = opts.getTracker ? await opts.getTracker(request) : opts.tracker
    if (!tracker) throw new Error('ready-status route requires tracker or getTracker')
    if (transportClosed) return reply

    const initial = tracker.getReadiness()
    const initialEvent = {
      state: tracker.state,
      sandboxReady: initial.sandboxReady,
      harnessReady: initial.harnessReady,
      capabilities: initial.capabilities,
      message: initial.degradedReason,
      timestamp: new Date().toISOString(),
    }
    const initialRuntimePending = initialEvent.capabilities.runtimeDependencies.state === 'preparing'
    if (initialEvent.state === 'degraded' || (initialEvent.state === 'ready' && !initialRuntimePending)) {
      return reply
        .type('text/event-stream')
        .headers({ 'Cache-Control': 'no-cache' })
        .send(`:\n\nevent: status\ndata: ${JSON.stringify(initialEvent)}\n\n`)
    }

    let closed = false
    let unsubscribe: (() => void) | null = null
    const closeStream = () => {
      if (closed) return
      closed = true
      unsubscribe?.()
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
    }
    cleanupStream = closeStream

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    reply.raw.write(`:\n\nevent: status\ndata: ${JSON.stringify(initialEvent)}\n\n`)

    if (transportClosed) {
      closeStream()
      return reply
    }
    reply.hijack()
    opts.deferLeaseRelease?.(request)

    unsubscribe = tracker.subscribe((event) => {
      if (closed) return
      reply.raw.write(`event: status\ndata: ${JSON.stringify(event)}\n\n`)
      const runtimePending = event.capabilities.runtimeDependencies.state === 'preparing'
      if (event.state === 'degraded' || (event.state === 'ready' && !runtimePending)) {
        queueMicrotask(closeStream)
      }
    })
    if (transportClosed) closeStream()

    return reply
  })

  done()
}

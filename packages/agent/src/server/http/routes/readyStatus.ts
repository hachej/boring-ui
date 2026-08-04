import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ReadyStatusTracker } from '../../runtime/readyStatus'

export interface ReadyStatusRouteOptions {
  path?: string
  authorizeRequest?: (request: FastifyRequest) => void | Promise<void>
  tracker?: ReadyStatusTracker
  getTracker?: (request: FastifyRequest) => ReadyStatusTracker | Promise<ReadyStatusTracker>
  deferLeaseRelease?: (request: FastifyRequest) => void
  registerStreamClose?: (close: () => void | Promise<void>) => () => void
}

export function readyStatusRoutes(
  app: FastifyInstance,
  opts: ReadyStatusRouteOptions,
  done: (err?: Error) => void,
): void {
  app.get(opts.path ?? '/api/v1/ready-status', async (request, reply) => {
    let transportClosed = request.raw.aborted
    let cleanupStream: (() => void) | undefined
    const onTransportClose = () => {
      request.raw.off('aborted', onTransportClose)
      reply.raw.off('close', onTransportClose)
      transportClosed = true
      cleanupStream?.()
    }
    request.raw.once('aborted', onTransportClose)
    reply.raw.once('close', onTransportClose)
    let setupComplete = false
    try {
      await opts.authorizeRequest?.(request)
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
        request.raw.off('aborted', onTransportClose)
        reply.raw.off('close', onTransportClose)
        setupComplete = true
        return reply
          .type('text/event-stream')
          .headers({ 'Cache-Control': 'no-cache' })
          .send(`:\n\nevent: status\ndata: ${JSON.stringify(initialEvent)}\n\n`)
      }

      let closed = false
      let unsubscribe: (() => void) | null = null
      let unregisterHost: (() => void) | null = null
      const closeStream = () => {
        if (closed) return
        closed = true
        request.raw.off('aborted', onTransportClose)
        reply.raw.off('close', onTransportClose)
        unsubscribe?.()
        unsubscribe = null
        unregisterHost?.()
        unregisterHost = null
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
      }
      cleanupStream = closeStream
      unregisterHost = opts.registerStreamClose?.(closeStream) ?? null

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      reply.raw.write(`:\n\nevent: status\ndata: ${JSON.stringify(initialEvent)}\n\n`)

      if (transportClosed) {
        closeStream()
        setupComplete = true
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
      if (closed) unsubscribe()
      if (transportClosed) closeStream()
      setupComplete = true

      return reply
    } catch (error) {
      cleanupStream?.()
      throw error
    } finally {
      if (!setupComplete && !cleanupStream) {
        request.raw.off('aborted', onTransportClose)
        reply.raw.off('close', onTransportClose)
      }
    }
  })

  done()
}

import type { FastifyInstance } from 'fastify'

import type { StageEvent } from '../shared/stage.js'

export const STAGE_STREAM_ROUTE = '/api/one-chat/stage/stream'
export const STAGE_CLEAR_ROUTE = '/api/one-chat/stage/clear'
export const ACTIVITY_CLEAR_ROUTE = '/api/one-chat/activity/clear'

/**
 * One in-process fan-out from the agent tools to every open browser tab.
 *
 * Deliberately not the agent event stream: the stage is host UI state, not
 * conversation content, and keeping it on its own channel means the chat can be
 * rendered messages-only without losing the screen.
 */
export interface StageBus {
  emit(event: StageEvent): void
  subscribe(listener: (event: StageEvent) => void): () => void
  readonly subscriberCount: number
}

export function createStageBus(): StageBus {
  const listeners = new Set<(event: StageEvent) => void>()
  let currentActivity: StageEvent | null = null
  return {
    emit(event) {
      if (event.type === 'activity.clear' || event.type === 'activity.done') currentActivity = null
      else if (event.type === 'activity.started' || event.type === 'activity.verifying') currentActivity = event
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          // A dead response must never take down the tool call that emitted.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      // Builder work outlives browser connections. Replay its latest milestone
      // so a reload or SSE reconnect does not make active work disappear.
      if (currentActivity) {
        try {
          listener(currentActivity)
        } catch {
          // The normal emit path will tolerate this dead listener too.
        }
      }
      return () => {
        listeners.delete(listener)
      }
    },
    get subscriberCount() {
      return listeners.size
    },
  }
}

/** SSE endpoint the stage subscribes to. Text frames with current activity replay. */
export function registerStageRoutes(app: FastifyInstance, bus: StageBus): void {
  app.get(STAGE_STREAM_ROUTE, (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    reply.raw.write(': stage stream open\n\n')

    const unsubscribe = bus.subscribe((event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    // Proxies and browsers drop an idle event-stream; a comment frame is enough.
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000)

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  // "Back to my app" goes through the bus rather than local state so every open
  // tab agrees on what is on screen.
  app.post(STAGE_CLEAR_ROUTE, async () => {
    bus.emit({ type: 'stage.clear' })
    return { ok: true }
  })

  // The browser clears completed builder activity when the colleague starts
  // speaking, and fans that clear to every open tab.
  app.post(ACTIVITY_CLEAR_ROUTE, async () => {
    bus.emit({ type: 'activity.clear' })
    return { ok: true }
  })
}

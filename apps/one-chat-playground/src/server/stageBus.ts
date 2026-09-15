import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createInMemoryBridge } from '@hachej/boring-workspace/server'

import type { StageEvent } from '../shared/stage.js'

export const STAGE_STREAM_ROUTE = '/api/one-chat/stage/stream'
export const STAGE_CLEAR_ROUTE = '/api/one-chat/stage/clear'
export const ACTIVITY_CLEAR_ROUTE = '/api/one-chat/activity/clear'
const STAGE_UI_COMMAND = 'oneChat.stageEvent'

/**
 * A narrow adapter from the canonical UiBridge command seam to stage SSE.
 * Stage state is host UI state rather than conversation content, so browsers
 * consume it separately while every agent-authored UI effect still enters via
 * UiBridge.postCommand.
 */
export interface StageBus {
  emit(event: StageEvent): void
  subscribe(listener: (event: StageEvent) => void): () => void
  readonly subscriberCount: number
}

export function createStageBus(): StageBus {
  const bridge = createInMemoryBridge()
  const listeners = new Set<(event: StageEvent) => void>()
  let currentScreen: StageEvent | null = null
  let currentActivity: StageEvent | null = null

  bridge.subscribeCommands((command) => {
    if (command.kind !== STAGE_UI_COMMAND) return false
    const event = command.params.event as StageEvent
    if (event.type === 'stage.show') currentScreen = event
    else if (event.type === 'stage.clear') currentScreen = null
    if (event.type === 'activity.clear' || event.type === 'activity.done') currentActivity = null
    else if (event.type === 'activity.started' || event.type === 'activity.verifying') currentActivity = event
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // A dead response must never take down the command dispatch.
      }
    }
    return true
  })

  return {
    emit(event) {
      void bridge.postCommand({ kind: STAGE_UI_COMMAND, params: { event } })
    },
    subscribe(listener) {
      listeners.add(listener)
      // Stage overlays and builder work outlive browser connections. Replay
      // both so reload/reconnect cannot silently return to a stale screen.
      for (const event of [currentScreen, currentActivity]) {
        if (!event) continue
        try {
          listener(event)
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
export function registerStageRoutes(
  app: FastifyInstance,
  source: StageBus | ((request: FastifyRequest) => StageBus | Promise<StageBus>),
): void {
  const resolve = (request: FastifyRequest) => typeof source === 'function' ? source(request) : source
  app.get(STAGE_STREAM_ROUTE, async (request, reply) => {
    const bus = await resolve(request)
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
  app.post(STAGE_CLEAR_ROUTE, async (request) => {
    const bus = await resolve(request)
    bus.emit({ type: 'stage.clear' })
    return { ok: true }
  })

  // The browser clears completed builder activity when the colleague starts
  // speaking, and fans that clear to every open tab.
  app.post(ACTIVITY_CLEAR_ROUTE, async (request) => {
    const bus = await resolve(request)
    bus.emit({ type: 'activity.clear' })
    return { ok: true }
  })
}

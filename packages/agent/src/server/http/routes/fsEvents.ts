import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Workspace } from '../../../shared/workspace'
import {
  createFsEventBroadcaster,
  type FsEventBroadcaster,
  type FsEventEnvelope,
} from '../fsEventBroadcaster'

/**
 * Server-Sent Events stream of workspace file-change events.
 *
 * GET /api/v1/fs/events
 *
 * Wire format (one envelope per `change`):
 *   id: <seq>             — sequence number, drives Last-Event-ID replay
 *   event: change
 *   data: { eventId, seq, ts, change: { op, path, oldPath?, mtimeMs? } }
 *
 *   event: unsupported    — workspace.watch is not implemented; client falls back
 *   data: { reason }
 *
 *   event: resync-required — gap between client's Last-Event-ID and our buffer;
 *   data: {}                  client should drop caches and refetch on demand
 *
 * Reliability primitives (step 3b):
 *   - Each event carries a UUID `eventId` for client-side dedupe.
 *   - `seq` is monotonic per workspace; the SSE `id:` line uses it
 *     so EventSource auto-sends `Last-Event-ID` on reconnect.
 *   - On reconnect with a stale `Last-Event-ID`, the server emits
 *     `resync-required` and closes — clients invalidate everything.
 *
 * One broadcaster per workspace, shared across all SSE connections.
 */

interface FsEventsRouteOptions {
  workspace: Workspace
}

export function fsEventsRoutes(
  app: FastifyInstance,
  opts: FsEventsRouteOptions,
  done: (err?: Error) => void,
): void {
  const { workspace } = opts

  // Lazy because workspaces without `watch?` shouldn't allocate a
  // broadcaster they'll never use.
  let broadcaster: FsEventBroadcaster | null = null

  const ensureBroadcaster = (): FsEventBroadcaster | null => {
    if (broadcaster) return broadcaster
    if (typeof workspace.watch !== 'function') return null
    broadcaster = createFsEventBroadcaster(workspace.watch())
    return broadcaster
  }

  app.addHook('onClose', async () => {
    broadcaster?.close()
    broadcaster = null
  })

  app.get('/api/v1/fs/events', async (request, reply) => {
    setupSse(request, reply.raw)

    const b = ensureBroadcaster()
    if (!b) {
      writeSse(reply.raw, 'unsupported', { reason: 'watch_not_implemented' })
      reply.raw.end()
      return reply
    }

    const lastSeenSeq = parseLastEventId(request.headers['last-event-id'])

    const sub = b.subscribe(
      (env) => writeChange(reply.raw, env),
      lastSeenSeq != null ? { lastSeenSeq } : undefined,
    )

    if (sub.resyncRequired) {
      writeSse(reply.raw, 'resync-required', {})
      sub.unsubscribe()
      reply.raw.end()
      return reply
    }

    // Drain the replay backlog before any live event can interleave.
    // We're already on the route handler's microtask, so listener
    // invocations from `subscribe` are queued — but subscribing
    // returns synchronously, so we hold the invariant simply by
    // writing replay before yielding.
    for (const env of sub.replay) writeChange(reply.raw, env)

    // Heartbeat — proxies (Vercel, nginx) idle-close SSE connections
    // after ~30s. A comment line keeps the socket alive without
    // showing up in the EventSource stream.
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': heartbeat\n\n') } catch { /* ignore */ }
    }, 25_000)

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      sub.unsubscribe()
    })

    return reply
  })

  done()
}

function parseLastEventId(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function setupSse(_request: FastifyRequest, res: import('node:http').ServerResponse): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

function writeChange(
  res: import('node:http').ServerResponse,
  env: FsEventEnvelope,
): void {
  try {
    res.write(`id: ${env.seq}\n`)
    res.write(`event: change\n`)
    res.write(`data: ${JSON.stringify(env)}\n\n`)
  } catch {
    /* client gone */
  }
}

function writeSse(
  res: import('node:http').ServerResponse,
  event: string,
  data: unknown,
): void {
  try {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  } catch {
    /* client gone */
  }
}

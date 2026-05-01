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
  workspace?: Workspace
  getWorkspace?: (request: FastifyRequest) => Workspace | Promise<Workspace>
}

interface BroadcasterEntry {
  broadcaster: FsEventBroadcaster
  subscribers: number
}

export function fsEventsRoutes(
  app: FastifyInstance,
  opts: FsEventsRouteOptions,
  done: (err?: Error) => void,
): void {
  // Lazy because workspaces without `watch?` shouldn't allocate a broadcaster
  // they'll never use. Dynamic embedded mode keeps one broadcaster per
  // request-scoped workspace id.
  const broadcasters = new Map<string, BroadcasterEntry>()

  const ensureBroadcaster = async (request: FastifyRequest): Promise<{
    workspaceId: string
    entry: BroadcasterEntry
  } | null> => {
    const workspace = opts.getWorkspace
      ? await opts.getWorkspace(request)
      : opts.workspace
    if (!workspace) throw new Error('fs event route requires workspace or getWorkspace')
    if (typeof workspace.watch !== 'function') return null
    const workspaceId = request.workspaceContext?.workspaceId ?? 'default'
    const existing = broadcasters.get(workspaceId)
    if (existing) return { workspaceId, entry: existing }
    const broadcaster = createFsEventBroadcaster(workspace.watch())
    const entry = { broadcaster, subscribers: 0 }
    broadcasters.set(workspaceId, entry)
    return { workspaceId, entry }
  }

  function releaseBroadcaster(workspaceId: string, entry: BroadcasterEntry): void {
    entry.subscribers = Math.max(0, entry.subscribers - 1)
    if (entry.subscribers > 0) return
    if (broadcasters.get(workspaceId) !== entry) return
    entry.broadcaster.close()
    broadcasters.delete(workspaceId)
  }

  app.addHook('onClose', async () => {
    for (const entry of broadcasters.values()) entry.broadcaster.close()
    broadcasters.clear()
  })

  app.get('/api/v1/fs/events', async (request, reply) => {
    const resolved = await ensureBroadcaster(request)
    reply.hijack()
    setupSse(request, reply.raw)

    if (!resolved) {
      writeSse(reply.raw, 'unsupported', { reason: 'watch_not_implemented' })
      reply.raw.end()
      return
    }
    const { workspaceId, entry } = resolved
    entry.subscribers += 1

    const lastSeenSeq = parseLastEventId(request.headers['last-event-id'])

    let sub: ReturnType<FsEventBroadcaster['subscribe']>
    try {
      sub = entry.broadcaster.subscribe(
        (env) => writeChange(reply.raw, env),
        lastSeenSeq != null ? { lastSeenSeq } : undefined,
      )
    } catch (error) {
      releaseBroadcaster(workspaceId, entry)
      request.log.error({ err: error }, 'fs events subscribe failed')
      writeSse(reply.raw, 'error', { reason: 'subscribe_failed' })
      reply.raw.end()
      return
    }

    if (sub.resyncRequired) {
      writeSse(reply.raw, 'resync-required', {})
      sub.unsubscribe()
      releaseBroadcaster(workspaceId, entry)
      reply.raw.end()
      return
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
      releaseBroadcaster(workspaceId, entry)
    })
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

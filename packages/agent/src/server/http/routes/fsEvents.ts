import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Workspace, WorkspaceWatcherReadiness } from '../../../shared/workspace'
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
 *   event: unsupported    — workspace.watch is not implemented, or the
 *   data: { reason, message? }  watcher refused the workspace (e.g.
 *                           `workspace_too_large`); client falls back
 *
 *   event: resync-required — gap between client's Last-Event-ID and our buffer;
 *   data: {}                  client should drop caches and refetch on demand
 *
 * Reliability primitives (step 3b):
 *   - Each event carries a UUID `eventId` for client-side dedupe.
 *   - `seq` is monotonic per workspace; the SSE `id:` line uses it
 *     so EventSource auto-sends `Last-Event-ID` on reconnect.
 *   - On reconnect with a stale `Last-Event-ID`, the server emits
 *     `resync-required` — clients invalidate everything while the
 *     stream remains open for future live events.
 *
 * One broadcaster per workspace, shared across all SSE connections.
 */

interface FsEventsRouteOptions {
  workspace?: Workspace
  getWorkspace?: (request: FastifyRequest) => Workspace | Promise<Workspace>
  deferLeaseRelease?: (request: FastifyRequest) => void
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

  const ensureBroadcaster = async (request: FastifyRequest): Promise<
    | { workspaceId: string; entry: BroadcasterEntry }
    | { unsupported: { reason: string; message?: string } }
  > => {
    const workspace = opts.getWorkspace
      ? await opts.getWorkspace(request)
      : opts.workspace
    if (!workspace) throw new Error('fs event route requires workspace or getWorkspace')
    if (typeof workspace.watch !== 'function') {
      return { unsupported: { reason: 'watch_not_implemented' } }
    }
    const workspaceId = request.workspaceContext?.workspaceId ?? 'default'
    const existing = broadcasters.get(workspaceId)
    if (existing) return { workspaceId, entry: existing }
    const watcher = workspace.watch()
    // Watchers with a startup guard (workspace-size check) refuse to
    // observe over-sized trees — relay that to the client as
    // `unsupported` so it falls back instead of waiting forever.
    const readiness: WorkspaceWatcherReadiness = (await watcher.whenReady?.()) ?? { ok: true }
    if (!readiness.ok) {
      return { unsupported: { reason: readiness.reason, ...(readiness.message ? { message: readiness.message } : {}) } }
    }
    // Two first-connects can race here: both pass the pre-await lookup
    // and share the watcher's readiness promise. Re-check after the
    // await so only one of them constructs (and registers) the
    // broadcaster — a duplicate would double-subscribe the watcher.
    const existingAfterWait = broadcasters.get(workspaceId)
    if (existingAfterWait) return { workspaceId, entry: existingAfterWait }
    const broadcaster = createFsEventBroadcaster(watcher)
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
    let transportClosed = request.raw.aborted
    let closeStream: (() => void) | undefined
    const onTransportClose = () => {
      request.raw.off('aborted', onTransportClose)
      reply.raw.off('close', onTransportClose)
      transportClosed = true
      closeStream?.()
    }
    request.raw.once('aborted', onTransportClose)
    reply.raw.once('close', onTransportClose)

    const resolved = await ensureBroadcaster(request)

    if ('unsupported' in resolved) {
      if (transportClosed) return
      reply.hijack()
      setupSse(request, reply.raw)
      writeSse(reply.raw, 'unsupported', resolved.unsupported)
      reply.raw.end()
      return
    }
    const { workspaceId, entry } = resolved
    entry.subscribers += 1

    let sub: ReturnType<FsEventBroadcaster['subscribe']> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      if (heartbeat) clearInterval(heartbeat)
      sub?.unsubscribe()
      releaseBroadcaster(workspaceId, entry)
    }
    closeStream = cleanup
    if (transportClosed) {
      cleanup()
      return
    }

    reply.hijack()
    setupSse(request, reply.raw)

    const lastSeenSeq = parseLastEventId(request.headers['last-event-id'])

    try {
      sub = entry.broadcaster.subscribe(
        (env) => writeChange(reply.raw, env),
        {
          ...(lastSeenSeq != null ? { lastSeenSeq } : {}),
          onResyncRequired: () => writeSse(reply.raw, 'resync-required', {}),
        },
      )
    } catch (error) {
      cleanup()
      request.log.error({ err: error }, 'fs events subscribe failed')
      if (!transportClosed) {
        writeSse(reply.raw, 'error', { reason: 'subscribe_failed' })
        reply.raw.end()
      }
      return
    }

    if (transportClosed) {
      cleanup()
      return
    }

    opts.deferLeaseRelease?.(request)

    if (sub.resyncRequired) {
      writeSse(reply.raw, 'resync-required', {})
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
    heartbeat = setInterval(() => {
      try { reply.raw.write(': heartbeat\n\n') } catch { /* ignore */ }
    }, 25_000)
    if (transportClosed) cleanup()
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

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { DataService } from '../services/clickhouse'
import { FredRefreshService } from '../services/fredRefresh'
import { tabBus } from '../services/tabBus'
import { loadMacroConfig } from '../config'

// ---------------------------------------------------------------------------
// Query param helpers
// ---------------------------------------------------------------------------

function parseCommaSep(raw: string | undefined): string[] | null {
  if (!raw) return null
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : null
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function optionalInt(val: unknown, min?: number, max?: number): number | null {
  if (val == null || val === '') return null
  const n = Number(val)
  if (Number.isNaN(n)) return null
  let result = Math.floor(n)
  if (min != null) result = Math.max(min, result)
  if (max != null) result = Math.min(max, result)
  return result
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerMacroRoutes(app: FastifyInstance): Promise<void> {
  // Register @fastify/websocket plugin for /ws/tabs
  const websocketPlugin = await import('@fastify/websocket')
  await app.register(websocketPlugin.default || websocketPlugin)

  const macroConfig = await loadMacroConfig()
  const svc = macroConfig.clickhouse ? new DataService(macroConfig.clickhouse) : null

  // FRED refresh service — initialized only when ClickHouse is available
  let refreshSvc: FredRefreshService | null = null
  if (svc) {
    refreshSvc = new FredRefreshService(
      svc.getClient(),
      (msg) => app.log.info(msg),
    )
  }

  // Auth is handled by the host app's global middleware. Macro routes only
  // need the localhost-skip so the agent's bash tool can call these endpoints.
  const localhostBypass = async (request: FastifyRequest, _reply: FastifyReply) => {
    const remoteAddr = request.ip || request.raw.socket?.remoteAddress || ''
    if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
      ;(request as any).user = (request as any).user ?? { id: 'pi-agent', email: 'pi-agent@boring-macro.local', name: 'PI Agent' }
    }
  }

  // -----------------------------------------------------------------------
  // Scoped plugin with auth + /api/v1/macro prefix
  // -----------------------------------------------------------------------
  app.register(async (scoped: FastifyInstance) => {
    scoped.addHook('onRequest', localhostBypass)

    // Helper for endpoints that need ClickHouse
    function requireCH(_req: FastifyRequest, reply: FastifyReply): boolean {
      if (svc !== null) return true
      reply.code(503).send({ error: 'Macro data backend is not configured' })
      return false
    }

    // ---- Catalog ---------------------------------------------------------

    scoped.get('/catalog', async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>
      if (svc === null) return { results: [], total: 0 }
      try {
        return await svc.catalog({
          limit: clampInt(q.limit, 1, 1000, 100),
          offset: clampInt(q.offset, 0, Infinity, 0),
          sourceType: parseCommaSep(q.source_type),
          frequency: parseCommaSep(q.frequency),
          includeTotal: q.include_total !== 'false',
        })
      } catch {
        return { results: [], total: 0 }
      }
    })

    scoped.get('/catalog/facets', async (req: FastifyRequest, _reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>
      if (svc === null) return { frequency: [], source_type: [] }
      try {
        return await svc.catalogFacets({
          sourceType: parseCommaSep(q.source_type),
        })
      } catch {
        return { frequency: [], source_type: [] }
      }
    })

    scoped.get('/catalog/search', async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>
      if (!q.q) {
        reply.code(400).send({ error: 'Missing required query parameter: q' })
        return
      }
      if (svc === null) return { results: [], total: 0 }
      try {
        return await svc.search(q.q, {
          limit: clampInt(q.limit, 1, 1000, 100),
          offset: clampInt(q.offset, 0, Infinity, 0),
          sourceType: parseCommaSep(q.source_type),
          frequency: parseCommaSep(q.frequency),
        })
      } catch {
        return { results: [], total: 0 }
      }
    })

    // ---- Series ----------------------------------------------------------

    scoped.get('/series/:seriesId', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireCH(req, reply)) return
      const { seriesId } = req.params as { seriesId: string }
      try {
        const result = await svc!.seriesMetadata(seriesId)
        if (result === null) {
          reply.code(404).send({ error: `Series ${seriesId} not found` })
          return
        }
        return result
      } catch {
        reply.code(503).send({ error: 'Macro data backend is not configured' })
      }
    })

    scoped.get('/series/:seriesId/lineage', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireCH(req, reply)) return
      const { seriesId } = req.params as { seriesId: string }
      try {
        const result = await svc!.seriesLineage(seriesId)
        if (result === null) {
          reply.code(404).send({ error: `Series ${seriesId} not found` })
          return
        }
        return result
      } catch {
        reply.code(503).send({ error: 'Macro data backend is not configured' })
      }
    })

    scoped.get('/series/:seriesId/data', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireCH(req, reply)) return
      const { seriesId } = req.params as { seriesId: string }
      const q = req.query as Record<string, string | undefined>
      try {
        const result = await svc!.seriesData(seriesId, {
          dateFrom: q.from || null,
          dateTo: q.to || null,
          limit: optionalInt(q.limit, 1),
          order: q.order === 'desc' ? 'desc' : 'asc',
          downsample: optionalInt(q.downsample, 100, 10000),
        })

        // Fire-and-forget: check staleness and queue background refresh for FRED series
        if (refreshSvc) {
          svc!.seriesFrequency(seriesId).then((meta) => {
            if (meta && meta.sourceType === 'fred') {
              refreshSvc!.checkAndRefresh(seriesId, meta.frequency)
            }
          }).catch(() => { /* staleness check is best-effort */ })
        }

        return result
      } catch {
        reply.code(503).send({ error: 'Macro data backend is not configured' })
      }
    })

    // ---- Refresh status / manual trigger ----------------------------------

    scoped.get('/refresh/status', async (_req: FastifyRequest, _reply: FastifyReply) => {
      return {
        enabled: refreshSvc !== null,
        pending: refreshSvc?.pendingCount ?? 0,
      }
    })

    scoped.post('/refresh/:seriesId', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!refreshSvc) {
        reply.code(503).send({ error: 'Refresh service not available' })
        return
      }
      const { seriesId } = req.params as { seriesId: string }
      refreshSvc.enqueue(seriesId)
      return { ok: true, queued: seriesId }
    })

    // ---- SQL passthrough -------------------------------------------------

    scoped.post('/sql', async (req: FastifyRequest, _reply: FastifyReply) => {
      if (svc === null) {
        return { ok: false, error: 'Macro data backend is not configured' }
      }
      const body = req.body as { query?: string }
      return await svc.executeSql(body.query || '')
    })

    // ---- Transform persist -----------------------------------------------

    scoped.post('/transform/persist', async (req: FastifyRequest, _reply: FastifyReply) => {
      if (svc === null) {
        return { ok: false, error: 'Macro data backend is not configured' }
      }
      const body = req.body as {
        output_id?: string
        title?: string
        input_ids?: string[]
        transform_name?: string
        data?: unknown[][]
      }
      if (!body.output_id || !body.title || !body.input_ids || !body.transform_name || !body.data) {
        return { ok: false, error: 'Missing required fields: output_id, title, input_ids, transform_name, data' }
      }
      try {
        return await svc.persistTransform({
          outputId: body.output_id,
          title: body.title,
          inputIds: body.input_ids,
          transformName: body.transform_name,
          data: body.data,
        })
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })

    // ---- Tab command queue -----------------------------------------------

    scoped.post('/tabs', async (req: FastifyRequest, _reply: FastifyReply) => {
      const body = req.body as { seriesId?: string; mode?: string }
      return tabBus.push(body.seriesId || '', body.mode || 'chart')
    })

    scoped.get('/tabs', async (_req: FastifyRequest, _reply: FastifyReply) => {
      return tabBus.listPending()
    })

    scoped.delete('/tabs/:cmdId', async (req: FastifyRequest, reply: FastifyReply) => {
      const { cmdId } = req.params as { cmdId: string }
      const id = parseInt(cmdId, 10)
      if (!tabBus.markProcessed(id)) {
        reply.code(404).send({ error: `Tab command ${id} not found` })
        return
      }
      return { ok: true, deleted: id }
    })

    // ---- CH query proxy --------------------------------------------------

    scoped.post('/ch-query', async (req: FastifyRequest, reply: FastifyReply) => {
      if (svc === null) {
        reply.code(503).send({ error: 'Macro data backend is not configured' })
        return
      }

      const chConfig = svc.getConfig()
      const scheme = chConfig.secure ? 'https' : 'http'
      const chBaseUrl = `${scheme}://${chConfig.host}:${chConfig.port}/`

      // Forward the raw body to ClickHouse with server-side credentials
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)

      try {
        const response = await fetch(chBaseUrl, {
          method: 'POST',
          headers: {
            'X-ClickHouse-User': chConfig.username,
            'X-ClickHouse-Key': chConfig.password,
            'X-ClickHouse-Database': chConfig.database,
            'Content-Type': req.headers['content-type'] || 'text/plain',
          },
          body,
          signal: AbortSignal.timeout(30_000),
        })

        const contentType = response.headers.get('content-type') || 'application/json'
        const responseBody = await response.arrayBuffer()

        reply
          .code(response.status)
          .header('content-type', contentType)
          .send(Buffer.from(responseBody))
      } catch (err) {
        reply.code(502).send({
          error: 'Failed to proxy request to ClickHouse',
          details: err instanceof Error ? err.message : String(err),
        })
      }
    })

  }, { prefix: '/api/v1/macro' })

  // -----------------------------------------------------------------------
  // WebSocket endpoint — registered at root level (NOT under prefix)
  // -----------------------------------------------------------------------
  tabBus.registerWebSocket(app)
}

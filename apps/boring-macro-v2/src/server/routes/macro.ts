import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { DataService } from '../services/clickhouse'
import { FredRefreshService } from '../services/fredRefresh'
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

  // Auth is handled by the host app's global middleware. In dev, allow
  // loopback requests through with a synthetic pi-agent user so the local
  // agent's bash tool can call these endpoints without a real session.
  // Gated on BM_DEV_AUTO_SESSION so prod can't accidentally accept anything
  // routed via 127.0.0.1 (reverse proxy, sidecar, etc.).
  const localhostBypass = macroConfig.devAutoSession
    ? async (request: FastifyRequest, _reply: FastifyReply) => {
        const remoteAddr = request.ip || request.raw.socket?.remoteAddress || ''
        if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
          ;(request as any).user = (request as any).user ?? { id: 'pi-agent', email: 'pi-agent@boring-macro.local', name: 'PI Agent' }
        }
      }
    : null

  // -----------------------------------------------------------------------
  // Scoped plugin with auth + /api/v1/macro prefix
  // -----------------------------------------------------------------------
  app.register(async (scoped: FastifyInstance) => {
    if (localhostBypass) scoped.addHook('onRequest', localhostBypass)

    // Helper for endpoints that need ClickHouse
    function requireCH(_req: FastifyRequest, reply: FastifyReply): boolean {
      if (svc !== null) return true
      reply.code(503).send({ error: 'Macro data backend is not configured' })
      return false
    }

    // ---- Catalog ---------------------------------------------------------

    // Frontend contract: returns { items, total, hasMore } where each item is
    // { id, title, frequency, source, units, derived } (renamed from the
    // ClickHouse column shape — the DB has `series_id`, `frequency_short`,
    // `source_type`, etc.). Honors `q` (full-text search) by routing to
    // svc.search() instead of svc.catalog() when provided. The DataCatalog
    // adapter in src/front/macroSeriesAdapter.ts depends on this shape.
    scoped.get('/catalog', async (req: FastifyRequest, _reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>
      if (svc === null) return { items: [], total: 0, hasMore: false }

      const limit = clampInt(q.limit, 1, 1000, 100)
      const offset = clampInt(q.offset, 0, Number.MAX_SAFE_INTEGER, 0)
      const frequency = parseCommaSep(q.frequency)
      const source = parseCommaSep(q.source)
      const queryStr = typeof q.q === 'string' ? q.q.trim() : ''

      try {
        const result = queryStr
          ? await svc.search(queryStr, { limit, offset, frequency, sourceType: source })
          : await svc.catalog({
              limit,
              offset,
              frequency,
              sourceType: source,
              includeTotal: true,
            })
        const items = result.results.map((r) => ({
          id: r.series_id,
          title: r.title,
          frequency: r.frequency_short || r.frequency,
          source: r.source_type,
          units: r.units_short || r.units,
          derived: r.source_type === 'derived',
        }))
        return {
          items,
          total: result.total,
          hasMore: offset + items.length < result.total,
        }
      } catch {
        return { items: [], total: 0, hasMore: false }
      }
    })

    // Frontend contract: { frequency, source } — `source` (not `source_type`)
    // matches the catalog adapter's filter UI.
    scoped.get('/facets', async (req: FastifyRequest, _reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>
      if (svc === null) return { frequency: [], source: [] }
      try {
        const facets = await svc.catalogFacets({
          sourceType: parseCommaSep(q.source),
        })
        return {
          frequency: facets.frequency,
          source: facets.source_type,
        }
      } catch {
        return { frequency: [], source: [] }
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

    // Combined observations + metadata response. Frontend ChartCanvasPane
    // calls this once and expects { observations, metadata } in one shot.
    scoped.get('/series/:seriesId', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireCH(req, reply)) return
      const { seriesId } = req.params as { seriesId: string }
      try {
        const [data, metadata] = await Promise.all([
          svc!.seriesData(seriesId, { downsample: 2000 }),
          svc!.seriesMetadata(seriesId),
        ])
        if (!data || data.observations.length === 0) {
          reply.code(404).send({ error: `Series ${seriesId} not found` })
          return
        }
        const m = metadata as Record<string, unknown> | null
        // ClickHouse retains the `s.` table-alias prefix on JOIN-ambiguous
        // columns (e.g. `s.title` survives because `title` also lives on
        // `derived_series`). Try both forms so the response stays clean.
        const pick = (k: string): string | null => {
          const v = m?.[k] ?? m?.[`s.${k}`]
          return v == null || v === '' ? null : String(v)
        }
        return {
          observations: data.observations,
          metadata: m
            ? {
                id: seriesId,
                title: pick('title') ?? seriesId,
                units: pick('units_short') ?? pick('units'),
                frequency: pick('frequency_short') ?? pick('frequency'),
                source: pick('source_type'),
                seasonal_adjustment: pick('seasonal_adjustment'),
                observation_start: pick('observation_start'),
                observation_end: pick('observation_end'),
                observation_count:
                  m.observation_count != null ? Number(m.observation_count) : null,
                transform_name: pick('transform_name'),
                transform_file: pick('transform_file'),
                notes: pick('notes'),
              }
            : null,
        }
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

    // ---- Deck (markdown file read/write) -----------------------------------
    // Path-traversal guard: `requested` must resolve INSIDE deckRoot, not
    // anywhere else (e.g. ../../etc/passwd). `safeDeckPath` returns null on
    // traversal attempts so each handler can 400-out with a clear message.
    const normalizeDeckRequestPath = (requested: string): string => {
      const trimmed = requested.trim().replace(/^\.\//, '')
      return trimmed.startsWith('deck/') ? trimmed.slice('deck/'.length) : trimmed
    }

    const safeDeckPath = (requested: string): string | null => {
      const normalized = normalizeDeckRequestPath(requested)
      const resolved = resolve(macroConfig.deckRoot, normalized)
      return resolved.startsWith(resolve(macroConfig.deckRoot) + '/') ? resolved : null
    }

    scoped.get('/deck', async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { path?: string }
      const requested = (q.path ?? '').trim()
      if (!requested) {
        reply.code(400).send({ error: 'Missing path' })
        return
      }
      const resolved = safeDeckPath(requested)
      if (!resolved) {
        reply.code(400).send({ error: 'Path outside deck root' })
        return
      }
      try {
        const text = await readFile(resolved, 'utf8')
        reply.type('text/markdown').send(text)
      } catch {
        reply.code(404).send({ error: `Deck not found: ${requested}` })
      }
    })

    scoped.put('/deck', async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { path?: string }
      const requested = (q.path ?? '').trim()
      if (!requested) {
        reply.code(400).send({ error: 'Missing path' })
        return
      }
      if (!requested.endsWith('.md')) {
        reply.code(400).send({ error: 'Deck files must end in .md' })
        return
      }
      const resolved = safeDeckPath(requested)
      if (!resolved) {
        reply.code(400).send({ error: 'Path outside deck root' })
        return
      }
      const body = req.body as { content?: string } | string | undefined
      const content = typeof body === 'string' ? body : body?.content
      if (typeof content !== 'string') {
        reply.code(400).send({ error: 'Missing string content' })
        return
      }
      await mkdir(dirname(resolved), { recursive: true })
      await writeFile(resolved, content, 'utf8')
      return { ok: true, path: requested, bytes: Buffer.byteLength(content, 'utf8') }
    })

    scoped.get('/deck/list', async () => {
      try {
        const root = resolve(macroConfig.deckRoot)
        const ents = await readdir(root, { withFileTypes: true })
        const files = ents
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) => e.name)
          .sort()
        return { items: files }
      } catch {
        return { items: [] }
      }
    })

  }, { prefix: '/api/macro' })
}

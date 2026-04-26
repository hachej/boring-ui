/**
 * ClickHouse data service — ported from boring-macro DataService (service.py).
 *
 * Read-only access to FRED + derived series data via the @clickhouse/client SDK.
 * Includes caching for catalog totals, first-page catalog, and facets.
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client'
import type { ClickHouseConfig } from '../config'

const CATALOG_TABLE = 'series_catalog'
const TOTAL_CACHE_TTL_MS = 60_000 // 60 seconds

const CATALOG_COLS = [
  'series_id', 'title', 'frequency', 'frequency_short',
  'units', 'units_short', 'seasonal_adjustment',
  'observation_start', 'observation_end', 'popularity',
  'source_type',
] as const

const MAX_CHART_POINTS = 2000

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T
  ts: number
}

function isFresh<T>(entry: CacheEntry<T> | null, ttl: number): entry is CacheEntry<T> {
  return entry !== null && (Date.now() - entry.ts) < ttl
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogItem {
  series_id: string
  title: string
  frequency: string
  frequency_short: string
  units: string
  units_short: string
  seasonal_adjustment: string
  observation_start: string
  observation_end: string
  popularity: number
  source_type: string
}

export interface CatalogResult {
  results: CatalogItem[]
  total: number
}

export interface FacetEntry {
  value: string
  count: number
}

export interface FacetsResult {
  frequency: FacetEntry[]
  source_type: FacetEntry[]
}

export interface Observation {
  date: string
  value: number
}

export interface SeriesDataResult {
  series_id: string
  observations: Observation[]
  count: number
  from: string | null
  to: string | null
}

export interface SqlResult {
  ok: boolean
  columns?: string[]
  rows?: Record<string, unknown>[]
  row_count?: number
  error?: string
}

export interface PersistResult {
  ok: boolean
  output_id?: string
  title?: string
  obs_count?: number
  action?: string
  error?: string
}

export interface CatalogOpts {
  limit?: number
  offset?: number
  sourceType?: string[] | null
  frequency?: string[] | null
  includeTotal?: boolean
}

export interface SearchOpts {
  limit?: number
  offset?: number
  sourceType?: string[] | null
  frequency?: string[] | null
}

export interface SeriesDataOpts {
  dateFrom?: string | null
  dateTo?: string | null
  limit?: number | null
  order?: string
  downsample?: number | null
}

export interface PersistOpts {
  outputId: string
  title: string
  inputIds: string[]
  transformName: string
  data: unknown[][]
}

// ---------------------------------------------------------------------------
// LTTB downsampling
// ---------------------------------------------------------------------------

function lttbDownsample(data: [string, number][], target: number): [string, number][] {
  const n = data.length
  if (n <= target || target < 3) return data

  const sampled: [string, number][] = [data[0]]
  const bucketSize = (n - 2) / (target - 2)

  let aIdx = 0
  for (let i = 1; i < target - 1; i++) {
    const start = Math.floor((i - 1) * bucketSize) + 1
    const end = Math.floor(i * bucketSize) + 1
    const nextStart = Math.floor(i * bucketSize) + 1
    const nextEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n)

    // Average y of next bucket
    let avgY = 0
    const nextCount = nextEnd - nextStart
    for (let j = nextStart; j < nextEnd; j++) {
      avgY += data[j][1]
    }
    avgY = nextCount > 0 ? avgY / nextCount : 0

    // Pick point in current bucket that maximises triangle area
    let bestIdx = start
    let maxArea = -1
    const aVal = data[aIdx][1]
    for (let j = start; j < Math.min(end, n); j++) {
      const area = Math.abs(
        (j - aIdx) * (avgY - aVal) - (nextEnd - aIdx) * (data[j][1] - aVal),
      )
      if (area > maxArea) {
        maxArea = area
        bestIdx = j
      }
    }

    sampled.push(data[bestIdx])
    aIdx = bestIdx
  }

  sampled.push(data[n - 1])
  return sampled
}

// ---------------------------------------------------------------------------
// Transform spec helpers
// ---------------------------------------------------------------------------

function parseTransformSpec(rawSpec: unknown): Record<string, unknown> | null {
  if (!rawSpec) return null
  if (typeof rawSpec === 'string') {
    try {
      const parsed = JSON.parse(rawSpec)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  if (typeof rawSpec === 'object' && rawSpec !== null && !Array.isArray(rawSpec)) {
    return rawSpec as Record<string, unknown>
  }
  return null
}

interface TransformInfo {
  transform_name: string | null
  transform_tool_id: string | null
  transform_tool_type: string | null
  transform_params: Record<string, unknown> | null
  transform_file: string | null
  transform_spec: Record<string, unknown> | null
}

function transformInfoFromSpec(spec: Record<string, unknown> | null): TransformInfo {
  if (!spec) {
    return {
      transform_name: null,
      transform_tool_id: null,
      transform_tool_type: null,
      transform_params: null,
      transform_file: null,
      transform_spec: null,
    }
  }

  const params = typeof spec.params === 'object' && spec.params !== null && !Array.isArray(spec.params)
    ? spec.params as Record<string, unknown>
    : null

  return {
    transform_name: (spec.name as string) || (spec.type as string) || null,
    transform_tool_id: (spec.tool_id as string) || null,
    transform_tool_type: (spec.tool_type as string) || (spec.mode as string) || null,
    transform_params: params,
    transform_file: (spec.file as string) || null,
    transform_spec: spec,
  }
}

// ---------------------------------------------------------------------------
// DataService
// ---------------------------------------------------------------------------

export class DataService {
  private client: ClickHouseClient
  private chConfig: ClickHouseConfig
  private totalCache: CacheEntry<number> | null = null
  private catalogCache: CacheEntry<CatalogResult> | null = null
  private facetsCache: CacheEntry<FacetsResult> | null = null

  constructor(chConfig: ClickHouseConfig) {
    this.chConfig = chConfig
    const scheme = chConfig.secure ? 'https' : 'http'
    this.client = createClient({
      url: `${scheme}://${chConfig.host}:${chConfig.port}`,
      username: chConfig.username,
      password: chConfig.password,
      database: chConfig.database,
    })
  }

  /** Expose the underlying ClickHouse client (used by FredRefreshService). */
  getClient(): ClickHouseClient {
    return this.client
  }

  /** Execute a query and return typed rows. */
  private async query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const result = await this.client.query({
      query: sql,
      format: 'JSONEachRow',
      query_params: params,
    })
    return result.json<T>()
  }

  /** Cached total count of catalog entries. */
  private async getTotal(): Promise<number> {
    if (isFresh(this.totalCache, TOTAL_CACHE_TTL_MS)) {
      return this.totalCache.value
    }
    const rows = await this.query<{ 'count()': string }>(
      `SELECT count() FROM ${CATALOG_TABLE}`,
    )
    const total = rows.length > 0 ? parseInt(String(rows[0]['count()']), 10) : 0
    this.totalCache = { value: total, ts: Date.now() }
    return total
  }

  // ------------------------------------------------------------------
  // Catalog
  // ------------------------------------------------------------------

  async catalog(opts: CatalogOpts = {}): Promise<CatalogResult> {
    const {
      limit = 100,
      offset = 0,
      sourceType = null,
      frequency = null,
      includeTotal = true,
    } = opts

    const hasFilters = !!(sourceType?.length || frequency?.length)

    // Fast path: cached first page (unfiltered only)
    if (includeTotal && !hasFilters && offset === 0 && limit === 100 && isFresh(this.catalogCache, TOTAL_CACHE_TTL_MS)) {
      return this.catalogCache.value
    }

    // Build WHERE clause
    const conditions: string[] = []
    const params: Record<string, unknown> = { limit, offset }

    if (sourceType?.length) {
      conditions.push(`source_type IN {st:Array(String)}`)
      params.st = sourceType
    }
    if (frequency?.length) {
      conditions.push(`frequency_short IN {freq:Array(String)}`)
      params.freq = frequency
    }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    const rows = await this.query<CatalogItem>(
      `SELECT series_id, title, frequency, frequency_short,
              units, units_short, seasonal_adjustment,
              toString(observation_start) AS observation_start,
              toString(observation_end) AS observation_end,
              popularity, source_type
       FROM ${CATALOG_TABLE}
       ${whereClause}
       ORDER BY popularity DESC, series_id ASC
       LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
      params,
    )

    let total: number
    if (!includeTotal) {
      total = offset + rows.length
    } else if (hasFilters) {
      const filterParams: Record<string, unknown> = {}
      if (sourceType?.length) filterParams.st = sourceType
      if (frequency?.length) filterParams.freq = frequency
      const countRows = await this.query<{ 'count()': string }>(
        `SELECT count() FROM ${CATALOG_TABLE} ${whereClause}`,
        filterParams,
      )
      total = countRows.length > 0 ? parseInt(String(countRows[0]['count()']), 10) : 0
    } else {
      total = await this.getTotal()
    }

    const result: CatalogResult = { results: rows, total }

    // Cache first page (unfiltered only)
    if (includeTotal && !hasFilters && offset === 0 && limit === 100) {
      this.catalogCache = { value: result, ts: Date.now() }
    }

    return result
  }

  // ------------------------------------------------------------------
  // Facets
  // ------------------------------------------------------------------

  async catalogFacets(opts: { sourceType?: string[] | null } = {}): Promise<FacetsResult> {
    const { sourceType = null } = opts
    const hasFilter = !!(sourceType?.length)

    // Fast path: cached unfiltered facets
    if (!hasFilter && isFresh(this.facetsCache, TOTAL_CACHE_TTL_MS)) {
      return this.facetsCache.value
    }

    let where = ''
    const params: Record<string, unknown> = {}
    if (sourceType?.length) {
      where = 'WHERE source_type IN {st:Array(String)}'
      params.st = sourceType
    }

    const freqRows = await this.query<{ frequency_short: string; cnt: string }>(
      `SELECT frequency_short, count() AS cnt FROM ${CATALOG_TABLE}
       ${where} GROUP BY frequency_short ORDER BY cnt DESC`,
      Object.keys(params).length > 0 ? params : undefined,
    )

    const sourceRows = await this.query<{ source_type: string; cnt: string }>(
      `SELECT source_type, count() AS cnt FROM ${CATALOG_TABLE}
       GROUP BY source_type ORDER BY cnt DESC`,
    )

    const result: FacetsResult = {
      frequency: freqRows.map((r) => ({
        value: r.frequency_short || '?',
        count: parseInt(String(r.cnt), 10),
      })),
      source_type: sourceRows.map((r) => ({
        value: r.source_type,
        count: parseInt(String(r.cnt), 10),
      })),
    }

    if (!hasFilter) {
      this.facetsCache = { value: result, ts: Date.now() }
    }

    return result
  }

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------

  async search(q: string, opts: SearchOpts = {}): Promise<CatalogResult> {
    const {
      limit = 100,
      offset = 0,
      sourceType = null,
      frequency = null,
    } = opts

    const wildcard = `%${q.trim()}%`

    const filterParts: string[] = []
    const params: Record<string, unknown> = { q: wildcard, limit, offset }
    if (sourceType?.length) {
      filterParts.push('AND source_type IN {st:Array(String)}')
      params.st = sourceType
    }
    if (frequency?.length) {
      filterParts.push('AND frequency_short IN {freq:Array(String)}')
      params.freq = frequency
    }
    const filterClause = filterParts.join(' ')

    const rows = await this.query<CatalogItem & { _total: string }>(
      `SELECT series_id, title, frequency, frequency_short,
              units, units_short, seasonal_adjustment,
              toString(observation_start) AS observation_start,
              toString(observation_end) AS observation_end,
              popularity, source_type,
              count() OVER () AS _total
       FROM ${CATALOG_TABLE}
       WHERE (series_id ILIKE {q:String}
          OR title ILIKE {q:String}
          OR units ILIKE {q:String}
          OR frequency ILIKE {q:String}
          OR notes ILIKE {q:String})
         ${filterClause}
       ORDER BY
         multiIf(
           series_id ILIKE {q:String}, 0,
           title ILIKE {q:String}, 1,
           2
         ),
         popularity DESC,
         series_id ASC
       LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
      params,
    )

    const total = rows.length > 0 ? parseInt(String(rows[0]._total), 10) : 0
    // Strip _total from results
    const results: CatalogItem[] = rows.map(({ _total, ...rest }) => rest)
    return { results, total }
  }

  // ------------------------------------------------------------------
  // Series metadata
  // ------------------------------------------------------------------

  async seriesMetadata(seriesId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT s.series_id, s.title, s.frequency, s.frequency_short,
              s.units, s.units_short, s.seasonal_adjustment,
              s.seasonal_adjustment_short,
              toString(s.observation_start) AS observation_start,
              toString(s.observation_end) AS observation_end,
              s.popularity, s.notes, s.source_type,
              coalesce(ts.observation_count, 0) AS observation_count,
              d.transform_spec AS transform_spec
       FROM ${CATALOG_TABLE} AS s
       LEFT JOIN (
         SELECT series_id, count() AS observation_count
         FROM timeseries FINAL
         WHERE series_id = {sid:String}
         GROUP BY series_id
       ) AS ts ON s.series_id = ts.series_id
       LEFT JOIN derived_series AS d ON s.series_id = d.series_id
       WHERE s.series_id = {sid:String}`,
      { sid: seriesId },
    )

    if (rows.length === 0) return null

    const row = rows[0]
    const spec = parseTransformSpec(row.transform_spec)
    const info = transformInfoFromSpec(spec)

    return {
      ...row,
      ...info,
    }
  }

  // ------------------------------------------------------------------
  // Lineage
  // ------------------------------------------------------------------

  async seriesLineage(seriesId: string): Promise<Record<string, unknown> | null> {
    // Verify series exists
    const checkRows = await this.query<{ series_id: string; source_type: string }>(
      `SELECT series_id, source_type FROM ${CATALOG_TABLE}
       WHERE series_id = {sid:String}`,
      { sid: seriesId },
    )
    if (checkRows.length === 0) return null

    const nodes: Map<string, Record<string, unknown>> = new Map()
    const edges: Record<string, unknown>[] = []
    const visitedUp = new Set<string>()
    const visitedDown = new Set<string>()
    const transformCache = new Map<string, TransformInfo>()

    await this.walkAncestors(seriesId, nodes, edges, visitedUp, transformCache)
    await this.addNode(seriesId, nodes, transformCache)
    await this.walkDescendants(seriesId, nodes, edges, visitedDown, transformCache)

    return {
      series_id: seriesId,
      nodes: Array.from(nodes.values()),
      edges,
    }
  }

  private async getTransformInfo(
    sid: string,
    cache: Map<string, TransformInfo>,
  ): Promise<TransformInfo> {
    if (cache.has(sid)) return cache.get(sid)!

    const rows = await this.query<{ transform_spec: string }>(
      `SELECT transform_spec FROM derived_series FINAL
       WHERE series_id = {sid:String}`,
      { sid },
    )

    const spec = rows.length > 0 ? parseTransformSpec(rows[0].transform_spec) : null
    const info = transformInfoFromSpec(spec)
    cache.set(sid, info)
    return info
  }

  private async addNode(
    sid: string,
    nodes: Map<string, Record<string, unknown>>,
    transformCache: Map<string, TransformInfo>,
  ): Promise<void> {
    if (nodes.has(sid)) return

    const rows = await this.query<{ series_id: string; title: string; source_type: string }>(
      `SELECT series_id, title, source_type FROM ${CATALOG_TABLE}
       WHERE series_id = {sid:String}`,
      { sid },
    )

    if (rows.length > 0) {
      const r = rows[0]
      const tInfo = r.source_type === 'derived'
        ? await this.getTransformInfo(sid, transformCache)
        : transformInfoFromSpec(null)
      nodes.set(sid, {
        series_id: r.series_id,
        title: r.title,
        source_type: r.source_type,
        ...tInfo,
      })
    } else {
      nodes.set(sid, {
        series_id: sid,
        title: sid,
        source_type: 'unknown',
        ...transformInfoFromSpec(null),
      })
    }
  }

  private async getImmediateSources(sid: string): Promise<{ sourceId: string; step: number }[]> {
    const rows = await this.query<{ source_series_id: string; transform_step: number }>(
      `SELECT source_series_id, transform_step FROM lineage
       WHERE derived_series_id = {sid:String}
       ORDER BY transform_step`,
      { sid },
    )
    return rows.map((r) => ({ sourceId: r.source_series_id, step: r.transform_step }))
  }

  private async getImmediateDescendants(sid: string): Promise<{ derivedId: string; step: number }[]> {
    const rows = await this.query<{ derived_series_id: string; step: number }>(
      `SELECT derived_series_id, min(transform_step) AS step
       FROM lineage
       WHERE source_series_id = {sid:String}
       GROUP BY derived_series_id
       ORDER BY derived_series_id`,
      { sid },
    )
    return rows.map((r) => ({ derivedId: r.derived_series_id, step: r.step }))
  }

  private async walkAncestors(
    sid: string,
    nodes: Map<string, Record<string, unknown>>,
    edges: Record<string, unknown>[],
    visited: Set<string>,
    transformCache: Map<string, TransformInfo>,
  ): Promise<void> {
    if (visited.has(sid)) return
    visited.add(sid)

    const sources = await this.getImmediateSources(sid)
    for (const { sourceId, step } of sources) {
      await this.addNode(sourceId, nodes, transformCache)
      const tInfo = await this.getTransformInfo(sid, transformCache)
      edges.push({
        source: sourceId,
        target: sid,
        transform: tInfo.transform_name,
        tool_id: tInfo.transform_tool_id,
        tool_type: tInfo.transform_tool_type,
        step,
      })
      await this.walkAncestors(sourceId, nodes, edges, visited, transformCache)
    }
  }

  private async walkDescendants(
    sid: string,
    nodes: Map<string, Record<string, unknown>>,
    edges: Record<string, unknown>[],
    visited: Set<string>,
    transformCache: Map<string, TransformInfo>,
  ): Promise<void> {
    if (visited.has(sid)) return
    visited.add(sid)

    const children = await this.getImmediateDescendants(sid)
    for (const { derivedId, step } of children) {
      await this.addNode(derivedId, nodes, transformCache)
      const tInfo = await this.getTransformInfo(derivedId, transformCache)
      edges.push({
        source: sid,
        target: derivedId,
        transform: tInfo.transform_name,
        tool_id: tInfo.transform_tool_id,
        tool_type: tInfo.transform_tool_type,
        step,
      })
      await this.walkDescendants(derivedId, nodes, edges, visited, transformCache)
    }
  }

  // ------------------------------------------------------------------
  // Series frequency lookup (for TTL-based refresh)
  // ------------------------------------------------------------------

  async seriesFrequency(seriesId: string): Promise<{ frequency: string; sourceType: string } | null> {
    const rows = await this.query<{ frequency: string; source_type: string }>(
      `SELECT frequency, source_type FROM ${CATALOG_TABLE}
       WHERE series_id = {sid:String}`,
      { sid: seriesId },
    )
    if (rows.length === 0) return null
    return { frequency: rows[0].frequency, sourceType: rows[0].source_type }
  }

  // ------------------------------------------------------------------
  // Series data
  // ------------------------------------------------------------------

  async seriesData(seriesId: string, opts: SeriesDataOpts = {}): Promise<SeriesDataResult> {
    const {
      dateFrom = null,
      dateTo = null,
      limit = null,
      order = 'asc',
      downsample = null,
    } = opts

    let where = 'series_id = {sid:String}'
    const params: Record<string, unknown> = { sid: seriesId }

    if (dateFrom) {
      where += ' AND date >= {d_from:String}'
      params.d_from = dateFrom
    }
    if (dateTo) {
      where += ' AND date <= {d_to:String}'
      params.d_to = dateTo
    }

    const direction = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    let sql = `SELECT toString(date) AS date, value FROM timeseries FINAL WHERE ${where} ORDER BY date ${direction}`
    if (limit) {
      sql += ` LIMIT ${Math.floor(limit)}`
    }

    const rows = await this.query<{ date: string; value: number }>(sql, params)

    // Downsample large series for chart rendering
    const target = downsample || MAX_CHART_POINTS
    let resultRows: [string, number][] = rows.map((r) => [r.date, r.value])

    if (resultRows.length > target && !limit) {
      resultRows = lttbDownsample(resultRows, target)
    }

    return {
      series_id: seriesId,
      observations: resultRows.map(([date, value]) => ({ date: String(date), value })),
      count: resultRows.length,
      from: dateFrom,
      to: dateTo,
    }
  }

  // ------------------------------------------------------------------
  // SQL passthrough (read-only)
  // ------------------------------------------------------------------

  private static ALLOWED_SQL_TOKENS = new Set(['SELECT', 'WITH', 'EXPLAIN', 'DESCRIBE', 'SHOW'])

  async executeSql(query: string): Promise<SqlResult> {
    const q = query.trim().replace(/;+$/, '').trim()
    if (!q) {
      return { ok: false, error: 'Empty query' }
    }

    const firstToken = q.split(/\s+/)[0].toUpperCase()
    if (!DataService.ALLOWED_SQL_TOKENS.has(firstToken)) {
      const allowed = Array.from(DataService.ALLOWED_SQL_TOKENS).sort().join(', ')
      return { ok: false, error: `Only read-only queries allowed (${allowed})` }
    }

    if (q.includes(';')) {
      return { ok: false, error: 'Multi-statement queries not allowed' }
    }

    try {
      const result = await this.client.query({ query: q, format: 'JSON' })
      const json = await result.json<Record<string, unknown>>() as {
        meta?: { name: string }[]
        data?: Record<string, unknown>[]
      }

      // JSON format returns { meta: [{name, type}], data: [{...}], ... }
      const columns = (json.meta || []).map((m) => m.name)
      const dataRows = json.data || []

      return {
        ok: true,
        columns,
        rows: dataRows,
        row_count: dataRows.length,
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ------------------------------------------------------------------
  // Persist transform results
  // ------------------------------------------------------------------

  async persistTransform(opts: PersistOpts): Promise<PersistResult> {
    const { outputId, title, inputIds, transformName, data } = opts

    // Safety: reject if output_id is a FRED series
    const fredCheck = await this.query<{ 'count()': string }>(
      `SELECT count() FROM metadata WHERE series_id = {sid:String}`,
      { sid: outputId },
    )
    if (fredCheck.length > 0 && parseInt(String(fredCheck[0]['count()']), 10) > 0) {
      return { ok: false, error: `Cannot overwrite FRED series '${outputId}'` }
    }

    const transformSpec = JSON.stringify({
      name: transformName,
      input_ids: inputIds,
    })

    // Check for collision
    const existing = await this.query<{ transform_spec: string }>(
      `SELECT transform_spec FROM derived_series FINAL WHERE series_id = {sid:String}`,
      { sid: outputId },
    )

    let action: string
    if (existing.length > 0) {
      const existingSpecStr = existing[0].transform_spec || ''
      let oldName = ''
      try {
        oldName = JSON.parse(existingSpecStr)?.name || ''
      } catch { /* ignore */ }

      if (oldName !== transformName) {
        return {
          ok: false,
          error: `Collision: '${outputId}' exists from transform '${oldName}'. Use a different output_id.`,
        }
      }

      // Delete old data for replacement
      await this.client.command({ query: `ALTER TABLE lineage DELETE WHERE derived_series_id = '${outputId}'` })
      await this.client.command({ query: `ALTER TABLE timeseries DELETE WHERE series_id = '${outputId}'` })
      await this.client.command({ query: `ALTER TABLE derived_series DELETE WHERE series_id = '${outputId}'` })
      action = 'replaced'
    } else {
      action = 'created'
    }

    // Insert derived_series
    await this.client.insert({
      table: 'derived_series',
      values: [{
        series_id: outputId,
        title,
        transform_spec: transformSpec,
        source_series_ids: inputIds,
      }],
      format: 'JSONEachRow',
    })

    // Insert timeseries rows
    const tsRows: { series_id: string; date: string; value: number }[] = []
    for (const row of data) {
      if (Array.isArray(row) && row.length >= 2) {
        try {
          const dateStr = String(row[0]).slice(0, 10)
          const value = Number(row[1])
          if (Number.isNaN(value) || !Number.isFinite(value)) continue
          tsRows.push({ series_id: outputId, date: dateStr, value })
        } catch {
          continue
        }
      }
    }

    if (tsRows.length > 0) {
      await this.client.insert({
        table: 'timeseries',
        values: tsRows,
        format: 'JSONEachRow',
      })
    }

    // Insert lineage records
    const idRows = await this.query<{ next_id: string }>(
      `SELECT coalesce(max(id), 0) + 1 AS next_id FROM lineage`,
    )
    let nextId = idRows.length > 0 ? parseInt(String(idRows[0].next_id), 10) : 1

    const lineageRows = inputIds.map((sid, i) => ({
      id: nextId + i,
      derived_series_id: outputId,
      source_series_id: sid,
      transform_step: i + 1,
    }))

    if (lineageRows.length > 0) {
      await this.client.insert({
        table: 'lineage',
        values: lineageRows,
        format: 'JSONEachRow',
      })
    }

    // Invalidate caches
    this.totalCache = null
    this.catalogCache = null
    this.facetsCache = null

    return {
      ok: true,
      output_id: outputId,
      title,
      obs_count: tsRows.length,
      action,
    }
  }

  /** Get the raw ClickHouse config (for ch-query proxy). */
  getConfig(): ClickHouseConfig {
    return this.chConfig
  }

  /** Execute a raw query and return rows (for billing/metering). */
  async rawQuery(sql: string): Promise<Record<string, unknown>[]> {
    return this.query(sql)
  }

  /** Execute a raw command (DDL/DML, no result rows). */
  async rawCommand(sql: string): Promise<void> {
    await this.client.command({ query: sql })
  }

  /** Close the underlying client connection. */
  async close(): Promise<void> {
    await this.client.close()
  }
}

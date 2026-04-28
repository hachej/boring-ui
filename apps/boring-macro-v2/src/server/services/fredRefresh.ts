/**
 * Event-driven FRED refresh service.
 *
 * Provides on-demand, TTL-based refresh of individual FRED series.
 * When a user queries series data and the cached version is stale
 * (based on frequency-dependent TTL), a background refresh is queued.
 * The user gets the cached data immediately — refreshes never block requests.
 *
 * Rate limiting: FRED allows 120 requests/minute. Each series refresh
 * requires 2 API calls (metadata + observations), so we process at most
 * 1 series per second (60 series/min × 2 calls = 120 calls/min).
 */

import type { ClickHouseClient } from '@clickhouse/client'

// ---------------------------------------------------------------------------
// FRED API
// ---------------------------------------------------------------------------

const FRED_BASE = 'https://api.stlouisfed.org/fred'

function getFredApiKey(): string {
  const key = process.env.FRED_API_KEY || ''
  if (!key) {
    throw new Error(
      'FRED_API_KEY not set. Load from Vault (secret/agent/fred -> api_key) ' +
      'or export FRED_API_KEY before running the server.',
    )
  }
  return key
}

interface FredSeriesInfo {
  series_id: string
  title: string
  frequency: string
  frequency_short: string
  units: string
  units_short: string
  seasonal_adjustment: string
  seasonal_adjustment_short: string
  observation_start: string
  observation_end: string
  popularity: number
  notes: string
}

interface FredObservation {
  date: string
  value: number
}

async function fetchSeriesInfo(seriesId: string): Promise<FredSeriesInfo | null> {
  const url = new URL(`${FRED_BASE}/series`)
  url.searchParams.set('api_key', getFredApiKey())
  url.searchParams.set('series_id', seriesId)
  url.searchParams.set('file_type', 'json')

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) })
  if (!resp.ok) throw new Error(`FRED /series ${seriesId}: HTTP ${resp.status}`)

  const data = await resp.json() as { seriess?: Record<string, unknown>[] }
  const s = data.seriess?.[0]
  if (!s) return null

  return {
    series_id: seriesId,
    title: String(s.title ?? seriesId),
    frequency: String(s.frequency ?? ''),
    frequency_short: String(s.frequency_short ?? ''),
    units: String(s.units ?? ''),
    units_short: String(s.units_short ?? ''),
    seasonal_adjustment: String(s.seasonal_adjustment ?? ''),
    seasonal_adjustment_short: String(s.seasonal_adjustment_short ?? ''),
    observation_start: String(s.observation_start ?? ''),
    observation_end: String(s.observation_end ?? ''),
    popularity: Number(s.popularity ?? 0),
    notes: String(s.notes ?? ''),
  }
}

async function fetchObservations(seriesId: string): Promise<FredObservation[]> {
  const url = new URL(`${FRED_BASE}/series/observations`)
  url.searchParams.set('api_key', getFredApiKey())
  url.searchParams.set('series_id', seriesId)
  url.searchParams.set('file_type', 'json')
  url.searchParams.set('observation_start', '1776-07-04')
  url.searchParams.set('observation_end', '9999-12-31')

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) })
  if (!resp.ok) throw new Error(`FRED /series/observations ${seriesId}: HTTP ${resp.status}`)

  const data = await resp.json() as { observations?: { date: string; value: string }[] }
  const rows: FredObservation[] = []
  for (const obs of data.observations ?? []) {
    const raw = obs.value
    if (raw == null || raw === '.') continue
    const value = parseFloat(raw)
    if (Number.isNaN(value) || !Number.isFinite(value)) continue
    rows.push({ date: obs.date, value })
  }
  return rows
}

// ---------------------------------------------------------------------------
// TTL configuration (milliseconds)
// ---------------------------------------------------------------------------

/** Frequencies exempt from on-demand refresh (data changes too infrequently). */
const REFRESH_EXEMPT: Set<string> = new Set(['Annual', 'Semiannual'])

const TTL_MS: Record<string, number> = {
  Daily: 24 * 60 * 60 * 1000,        // 24h
  Weekly: 24 * 60 * 60 * 1000,       // 24h
  Monthly: 7 * 24 * 60 * 60 * 1000,  // 7d
  Quarterly: 30 * 24 * 60 * 60 * 1000, // 30d
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7d fallback

/** Returns true if a series frequency is exempt from on-demand refresh. */
export function isRefreshExempt(frequency: string): boolean {
  return REFRESH_EXEMPT.has(frequency)
}

export function ttlForFrequency(frequency: string): number {
  return TTL_MS[frequency] ?? DEFAULT_TTL_MS
}

// ---------------------------------------------------------------------------
// Refresh queue — rate-limited, in-memory, deduped
// ---------------------------------------------------------------------------

/** Minimum delay between FRED API bursts (1 series = 2 calls). */
const QUEUE_INTERVAL_MS = 1_000

const REFRESH_LOG_DDL = `
CREATE TABLE IF NOT EXISTS series_refresh_log (
    series_id String,
    last_refreshed_at DateTime DEFAULT now(),
    refresh_source String DEFAULT 'on_demand'
) ENGINE = ReplacingMergeTree(last_refreshed_at)
ORDER BY series_id
`

export class FredRefreshService {
  private client: ClickHouseClient
  private queue: Set<string> = new Set()
  private processing = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private log: (msg: string) => void
  private schemaReady = false

  constructor(client: ClickHouseClient, log?: (msg: string) => void) {
    this.client = client
    this.log = log ?? ((msg) => console.log(`[fred-refresh] ${msg}`))
    // Fire-and-forget schema creation
    this.ensureSchema().catch(() => {})
  }

  /** Create the series_refresh_log table if it doesn't exist. */
  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return
    try {
      await this.client.command({ query: REFRESH_LOG_DDL })
      this.schemaReady = true
      this.log('series_refresh_log table ready')
    } catch (err) {
      this.log(`schema init failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Check if a FRED series is stale and queue a background refresh if so.
   * Returns true if a refresh was queued, false if data is fresh or non-FRED.
   */
  async checkAndRefresh(seriesId: string, frequency: string): Promise<boolean> {
    // Annual/semiannual series are exempt — no on-demand refresh
    if (isRefreshExempt(frequency)) return false

    await this.ensureSchema()
    const ttl = ttlForFrequency(frequency)
    const isStale = await this.isSeriesStale(seriesId, ttl)
    if (!isStale) return false

    this.enqueue(seriesId)
    return true
  }

  /** Enqueue a series for background refresh (deduped). */
  enqueue(seriesId: string): void {
    this.queue.add(seriesId)
    this.startProcessing()
  }

  /** Number of series waiting in the refresh queue. */
  get pendingCount(): number {
    return this.queue.size
  }

  /** Shut down: clear queue and cancel pending timer. */
  shutdown(): void {
    this.queue.clear()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  // -----------------------------------------------------------------------
  // Staleness check
  // -----------------------------------------------------------------------

  private async isSeriesStale(seriesId: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.client.query({
        query: `SELECT last_refreshed_at
                FROM series_refresh_log FINAL
                WHERE series_id = {sid:String}`,
        query_params: { sid: seriesId },
        format: 'JSONEachRow',
      })
      const rows = await result.json<{ last_refreshed_at: string }>()

      if (rows.length === 0) return true // never refreshed on-demand

      const lastRefreshed = new Date(rows[0].last_refreshed_at).getTime()
      return (Date.now() - lastRefreshed) > ttlMs
    } catch {
      // Table might not exist yet — treat as stale
      return true
    }
  }

  // -----------------------------------------------------------------------
  // Queue processing
  // -----------------------------------------------------------------------

  private startProcessing(): void {
    if (this.processing) return
    this.processing = true
    this.processNext()
  }

  private processNext(): void {
    const next = this.queue.values().next()
    if (next.done) {
      this.processing = false
      return
    }

    const seriesId = next.value
    this.queue.delete(seriesId)

    this.refreshSeries(seriesId)
      .then(() => {
        this.log(`refreshed ${seriesId}`)
      })
      .catch((err) => {
        this.log(`failed to refresh ${seriesId}: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        // Rate limit: wait before processing next
        this.timer = setTimeout(() => {
          this.timer = null
          this.processNext()
        }, QUEUE_INTERVAL_MS)
      })
  }

  // -----------------------------------------------------------------------
  // Single-series refresh (metadata + observations → ClickHouse)
  // -----------------------------------------------------------------------

  private async refreshSeries(seriesId: string): Promise<void> {
    await this.ensureSchema()

    // 1. Fetch metadata from FRED
    const info = await fetchSeriesInfo(seriesId)
    if (!info) {
      this.log(`series ${seriesId} not found on FRED`)
      return
    }

    // 2. Fetch observations from FRED
    const observations = await fetchObservations(seriesId)

    // 3. Upsert metadata into ClickHouse (ReplacingMergeTree handles dedup)
    await this.client.insert({
      table: 'metadata',
      values: [{
        series_id: info.series_id,
        title: info.title,
        frequency: info.frequency,
        frequency_short: info.frequency_short,
        units: info.units,
        units_short: info.units_short,
        seasonal_adjustment: info.seasonal_adjustment,
        seasonal_adjustment_short: info.seasonal_adjustment_short,
        observation_start: info.observation_start,
        observation_end: info.observation_end,
        popularity: info.popularity,
        notes: info.notes,
      }],
      format: 'JSONEachRow',
    })

    // 4. Upsert timeseries into ClickHouse
    if (observations.length > 0) {
      // Batch insert in chunks of 5000
      const CHUNK = 5000
      for (let i = 0; i < observations.length; i += CHUNK) {
        const chunk = observations.slice(i, i + CHUNK).map((obs) => ({
          series_id: seriesId,
          date: obs.date,
          value: obs.value,
        }))
        await this.client.insert({
          table: 'timeseries',
          values: chunk,
          format: 'JSONEachRow',
        })
      }
    }

    // 5. Record refresh timestamp
    await this.client.insert({
      table: 'series_refresh_log',
      values: [{
        series_id: seriesId,
        last_refreshed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        refresh_source: 'on_demand',
      }],
      format: 'JSONEachRow',
    })
  }
}

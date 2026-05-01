/**
 * Shared series-data fetcher for macro panes (ChartCanvasPane, DeckPane).
 *
 * Module-level Map caches keep two panes opening the same series from
 * issuing two roundtrips. In-flight de-dup means simultaneous mounts
 * (e.g. user clicks a row that opens both a chart and a deck preview)
 * share one promise instead of racing.
 *
 * Not a React-Query hook because the existing panes manage their own
 * state machines (loading/error flags around a `result | null`); a
 * vanilla async function fits cleanly into both. Migrating to
 * useFileData / useQuery is a separate refactor.
 */

import type { SeriesPayload } from "./macroSeriesTypes"

const SERIES_CACHE = new Map<string, SeriesPayload>()
const SERIES_REQUESTS = new Map<string, Promise<SeriesPayload>>()

export async function fetchMacroSeries(seriesId: string): Promise<SeriesPayload> {
  const cached = SERIES_CACHE.get(seriesId)
  if (cached) return cached

  let pending = SERIES_REQUESTS.get(seriesId)
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`/api/macro/series/${encodeURIComponent(seriesId)}`)
      if (!res.ok) throw new Error(`series ${seriesId}: ${res.status}`)
      const data = (await res.json()) as SeriesPayload
      SERIES_CACHE.set(seriesId, data)
      return data
    })().finally(() => {
      SERIES_REQUESTS.delete(seriesId)
    })
    SERIES_REQUESTS.set(seriesId, pending)
  }
  return pending
}

/** Imperative cache reset, used by tests or by the user's "reload" gesture. */
export function clearMacroSeriesCache(seriesId?: string): void {
  if (seriesId) SERIES_CACHE.delete(seriesId)
  else SERIES_CACHE.clear()
}

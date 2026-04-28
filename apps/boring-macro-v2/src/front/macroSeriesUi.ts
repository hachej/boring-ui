/**
 * UI constants and small helpers shared by the macro panes (charts, deck,
 * catalog adapter). Kept separate from `macroSeriesData.ts` so fetch/cache
 * logic and presentation primitives don't bleed into each other.
 */

export const FREQ_LABELS: Record<string, string> = {
  D: "Daily",
  W: "Weekly",
  M: "Monthly",
  Q: "Quarterly",
  SA: "Semiannual",
  A: "Annual",
}

/**
 * Palette is ordered so deck mini-charts (which take the first 5) get the
 * highest-contrast set; the chart canvas uses the full 10 for overlays.
 */
export const SERIES_COLORS = [
  "#ff6600", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444",
  "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#6366f1",
]

interface FormatOptions {
  /** Decimal places for values < 1000 (default: 2). */
  precision?: number
  /** Decimal places for K/M scaled values (default: matches `precision`). */
  scaledPrecision?: number
  /** Returned when `v` is null/undefined (default: "N/A"). */
  emptyLabel?: string
}

export function formatSeriesValue(
  v: number | null | undefined,
  opts: FormatOptions = {},
): string {
  const { precision = 2, scaledPrecision, emptyLabel = "N/A" } = opts
  const scaled = scaledPrecision ?? precision
  if (v == null) return emptyLabel
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(scaled) + "M"
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(scaled) + "K"
  return v.toFixed(precision)
}

interface OpenSeriesOptions {
  /** Tab title; defaults to the series id. */
  title?: string
}

/**
 * Push an openPanel command through the workspace UI bridge. Used by panes
 * that want to open a chart for a related series (deck embeds, lineage
 * graph, etc.) without holding a SurfaceShellApi reference.
 */
export function openSeriesPane(seriesId: string, opts: OpenSeriesOptions = {}): void {
  if (!seriesId) return
  void fetch("/api/v1/ui/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "openPanel",
      params: {
        id: `chart:${seriesId}`,
        component: "chart-canvas",
        title: opts.title ?? seriesId,
        params: { seriesId },
      },
    }),
  })
}

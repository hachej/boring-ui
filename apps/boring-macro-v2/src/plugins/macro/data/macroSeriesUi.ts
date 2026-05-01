/**
 * UI constants and small helpers shared by the macro panes (charts, deck,
 * catalog adapter). Kept separate from `macroSeriesData.ts` so fetch/cache
 * logic and presentation primitives don't bleed into each other.
 */
import { postUiCommand } from "@boring/workspace"
import { MACRO_OPEN_SERIES_SURFACE_KIND } from "../constants"

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
 * Push a macro-owned surface target through the workspace UI bridge. Used by
 * panes that want to open a chart for a related series (deck embeds, lineage
 * graph, etc.) without holding a SurfaceShellApi reference.
 */
export function openSeriesPane(seriesId: string, opts: OpenSeriesOptions = {}): void {
  const target = seriesId.trim()
  if (!target) return
  postUiCommand({
    kind: "openSurface",
    params: {
      kind: MACRO_OPEN_SERIES_SURFACE_KIND,
      target,
      meta: opts.title ? { title: opts.title } : {},
    },
  })
}

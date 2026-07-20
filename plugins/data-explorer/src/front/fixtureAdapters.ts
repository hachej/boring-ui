// ---------------------------------------------------------------------------
// Deterministic visual-review fixture adapters.
//
// Tiny in-memory implementations that exercise the full async contract
// (search/loadMore/fetchFacets) without a backend. Exported only through the
// package's explicit testing subpath.
// ---------------------------------------------------------------------------

import type { ExplorerDataSource, ExplorerItem, Facets } from "./types"

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

type FacetExtractor = (row: ExplorerItem) => Record<string, string>

function makeAdapter(
  rows: ExplorerItem[],
  extractFacets: FacetExtractor,
  opts: { latencyMs?: number } = {},
): ExplorerDataSource {
  const latency = opts.latencyMs ?? 80

  const matchFilters = (row: ExplorerItem, filters: Record<string, string[]>) => {
    const facetValues = extractFacets(row)
    for (const [key, vs] of Object.entries(filters)) {
      if (!vs.length) continue
      if (!vs.includes(facetValues[key] ?? "")) return false
    }
    return true
  }

  return {
    async search(args) {
      await wait(latency)
      let pool = rows
      if (args.group) {
        pool = pool.filter((r) => extractFacets(r)[args.group!.key] === args.group!.value)
      }
      if (args.query) {
        const q = args.query.toLowerCase()
        pool = pool.filter(
          (r) =>
            r.id.toLowerCase().includes(q) ||
            r.title.toLowerCase().includes(q) ||
            (r.subtitle?.toLowerCase().includes(q) ?? false),
        )
      }
      pool = pool.filter((r) => matchFilters(r, args.filters))
      const slice = pool.slice(args.offset, args.offset + args.limit)
      return {
        items: slice,
        total: pool.length,
        hasMore: args.offset + slice.length < pool.length,
      }
    },
    async fetchFacets(args) {
      await wait(latency / 2)
      const pool = rows.filter((r) => matchFilters(r, args.filters))
      const facets: Facets = {}
      for (const row of pool) {
        const values = extractFacets(row)
        for (const [key, value] of Object.entries(values)) {
          if (!facets[key]) facets[key] = []
          const entry = facets[key].find((e) => e.value === value)
          if (entry) entry.count += 1
          else facets[key].push({ value, count: 1 })
        }
      }
      return facets
    },
  }
}

// ---------------------------------------------------------------------------
// FRED-style mock series — ~600 rows across 6 frequencies, mixed sources.
// ---------------------------------------------------------------------------

const FREQ_LABELS: Record<string, string> = {
  D: "Daily",
  W: "Weekly",
  M: "Monthly",
  Q: "Quarterly",
  SA: "Semiannual",
  A: "Annual",
}

const FREQ_DISTRIBUTION: Array<{ code: string; n: number }> = [
  { code: "D", n: 120 },
  { code: "W", n: 60 },
  { code: "M", n: 240 },
  { code: "Q", n: 90 },
  { code: "SA", n: 30 },
  { code: "A", n: 60 },
]

const SERIES_NAMES = [
  "Real GDP",
  "Nominal GDP",
  "Personal Consumption",
  "Industrial Production",
  "Capacity Utilization",
  "Unemployment Rate",
  "Initial Claims",
  "Nonfarm Payrolls",
  "CPI All Urban",
  "Core CPI",
  "PCE Price Index",
  "Federal Funds Rate",
  "10-Year Treasury",
  "30-Year Mortgage",
  "Crude Oil WTI",
  "Brent Crude",
  "S&P 500",
  "Trade Weighted Dollar",
  "Retail Sales",
  "Housing Starts",
]

function generateSeriesRows(): ExplorerItem[] {
  const rows: ExplorerItem[] = []
  let i = 0
  for (const { code, n } of FREQ_DISTRIBUTION) {
    for (let k = 0; k < n; k++) {
      const baseName = SERIES_NAMES[(i + k) % SERIES_NAMES.length]
      const idx = i + k
      const id = `${code}${String(idx).padStart(4, "0")}`
      const derived = idx % 13 === 0
      rows.push({
        id,
        title: `${baseName}${k > SERIES_NAMES.length ? ` v${k}` : ""}`,
        subtitle: `${FREQ_LABELS[code]} · seasonally adjusted`,
        group: code,
        leading: { code, tooltip: FREQ_LABELS[code] },
        trailing: derived ? [{ code: "D", tooltip: "Derived series" }] : undefined,
      })
    }
    i += n
  }
  return rows
}

export function createMockSeriesAdapter(): ExplorerDataSource {
  const rows = generateSeriesRows()
  return makeAdapter(
    rows,
    (row) => ({
      frequency: row.group ?? "",
      source: row.trailing?.some((b) => b.code === "D") ? "derived" : "fred",
    }),
    { latencyMs: 60 },
  )
}

// ---------------------------------------------------------------------------
// Tables-style mock — proves genericness against a different domain.
// Schemas as groups, kind chip per row, trailing LIVE indicator on streams.
// ---------------------------------------------------------------------------

const TABLE_DEFS: Array<{
  schema: string
  name: string
  kind: "TBL" | "VW" | "MAT" | "STR"
  rows: string
}> = [
  { schema: "public", name: "users", kind: "TBL", rows: "1.2M" },
  { schema: "public", name: "events", kind: "TBL", rows: "84M" },
  { schema: "public", name: "sessions", kind: "TBL", rows: "240k" },
  { schema: "public", name: "active_users", kind: "VW", rows: "—" },
  { schema: "public", name: "live_orders", kind: "STR", rows: "live" },
  { schema: "analytics", name: "daily_revenue", kind: "MAT", rows: "365" },
  { schema: "analytics", name: "weekly_cohort", kind: "MAT", rows: "52" },
  { schema: "analytics", name: "session_funnel", kind: "VW", rows: "—" },
  { schema: "billing", name: "invoices", kind: "TBL", rows: "412k" },
  { schema: "billing", name: "subscriptions", kind: "TBL", rows: "38k" },
  { schema: "billing", name: "open_invoices", kind: "VW", rows: "—" },
  { schema: "audit", name: "access_log", kind: "TBL", rows: "16M" },
  { schema: "audit", name: "auth_events", kind: "STR", rows: "live" },
]

export function createMockTablesAdapter(): ExplorerDataSource {
  const rows: ExplorerItem[] = TABLE_DEFS.map((t) => ({
    id: `${t.schema}.${t.name}`,
    title: t.name,
    subtitle: t.schema,
    group: t.schema,
    leading: { code: t.kind },
    trailing: t.kind === "STR" ? [{ code: "LIVE" }] : undefined,
    meta: t.rows,
  }))
  return makeAdapter(
    rows,
    (row) => ({
      schema: row.group ?? "",
      kind: row.leading?.code ?? "",
    }),
    { latencyMs: 40 },
  )
}

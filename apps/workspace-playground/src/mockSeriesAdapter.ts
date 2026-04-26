// Macro-style mock series adapter for the playground.
// Generates ~600 records across frequency groups, supports search/filter/page.

import type { ExplorerAdapter, ExplorerRow, Facets } from "@boring/workspace"

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

function generateRows(): ExplorerRow[] {
  const rows: ExplorerRow[] = []
  let i = 0
  for (const { code, n } of FREQ_DISTRIBUTION) {
    for (let k = 0; k < n; k++) {
      const baseName = SERIES_NAMES[(i + k) % SERIES_NAMES.length]
      const idx = i + k
      const id = `${code}${String(idx).padStart(4, "0")}`
      const derived = idx % 13 === 0
      rows.push({
        id,
        title: baseName,
        subtitle: id,
        group: code,
        leading: { code, tooltip: FREQ_LABELS[code] },
        trailing: derived ? [{ code: "D", tooltip: "Derived series" }] : undefined,
      })
    }
    i += n
  }
  return rows
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function createPlaygroundSeriesAdapter(): ExplorerAdapter {
  const rows = generateRows()
  return {
    async search(args) {
      await wait(60)
      let pool = rows
      if (args.group) {
        pool = pool.filter((r) => r.group === args.group!.value)
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
      for (const [k, vs] of Object.entries(args.filters)) {
        if (k === "frequency") pool = pool.filter((r) => vs.includes(r.group ?? ""))
        if (k === "source") {
          pool = pool.filter((r) => {
            const isDerived = r.trailing?.some((b) => b.code === "D") ?? false
            return vs.includes(isDerived ? "derived" : "fred")
          })
        }
      }
      const slice = pool.slice(args.offset, args.offset + args.limit)
      return {
        items: slice,
        total: pool.length,
        hasMore: args.offset + slice.length < pool.length,
      }
    },
    async fetchFacets(args) {
      await wait(30)
      let pool = rows
      for (const [k, vs] of Object.entries(args.filters)) {
        if (k === "source") {
          pool = pool.filter((r) => {
            const isDerived = r.trailing?.some((b) => b.code === "D") ?? false
            return vs.includes(isDerived ? "derived" : "fred")
          })
        }
      }
      const facets: Facets = { frequency: [], source: [] }
      for (const r of pool) {
        const freq = r.group ?? "?"
        const fEntry = facets.frequency.find((e) => e.value === freq)
        if (fEntry) fEntry.count += 1
        else facets.frequency.push({ value: freq, count: 1 })
        const isDerived = r.trailing?.some((b) => b.code === "D") ?? false
        const src = isDerived ? "derived" : "fred"
        const sEntry = facets.source.find((e) => e.value === src)
        if (sEntry) sEntry.count += 1
        else facets.source.push({ value: src, count: 1 })
      }
      return facets
    },
  }
}

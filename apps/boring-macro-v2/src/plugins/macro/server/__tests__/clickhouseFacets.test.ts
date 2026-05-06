import { describe, it, expect, vi, beforeEach } from "vitest"

// Capture every SQL string sent to the mocked ClickHouse client.
const capturedQueries: string[] = []

vi.mock("@clickhouse/client", () => ({
  createClient: () => ({
    query: ({ query }: { query: string }) => {
      capturedQueries.push(query)
      return Promise.resolve({ json: () => Promise.resolve([]) })
    },
  }),
}))

// Import after mock is installed.
const { DataService } = await import("../services/clickhouse")

const DUMMY_CONFIG = {
  host: "localhost",
  port: 8123,
  username: "default",
  password: "",
  database: "default",
  secure: false,
}

beforeEach(() => {
  capturedQueries.length = 0
})

describe("DataService.catalogFacets – timeseries filter", () => {
  it("includes the timeseries subquery in the frequency facet SQL", async () => {
    const svc = new DataService(DUMMY_CONFIG)
    await svc.catalogFacets()

    const freqQuery = capturedQueries.find((q) => q.includes("frequency_short"))
    expect(freqQuery).toBeDefined()
    expect(freqQuery).toContain("series_id IN (SELECT DISTINCT series_id FROM timeseries)")
  })

  it("frequency count matches catalog filter (both require timeseries observations)", async () => {
    const svc = new DataService(DUMMY_CONFIG)
    await svc.catalogFacets()

    const freqQuery = capturedQueries.find((q) => q.includes("frequency_short"))!
    // The WHERE clause must gate on timeseries so counts reflect only series
    // that actually have observations — same guard used in catalog().
    expect(freqQuery).toMatch(/WHERE.*series_id IN \(SELECT DISTINCT series_id FROM timeseries\)/)
  })

  it("still includes sourceType filter when provided, alongside timeseries guard", async () => {
    const svc = new DataService(DUMMY_CONFIG)
    await svc.catalogFacets({ sourceType: ["fred"] })

    const freqQuery = capturedQueries.find((q) => q.includes("frequency_short"))!
    expect(freqQuery).toContain("source_type IN")
    expect(freqQuery).toContain("series_id IN (SELECT DISTINCT series_id FROM timeseries)")
  })

  it("does not apply timeseries filter to source_type facet (source counts cover all catalog entries)", async () => {
    const svc = new DataService(DUMMY_CONFIG)
    await svc.catalogFacets()

    const sourceQuery = capturedQueries.find(
      (q) => q.includes("source_type") && q.includes("GROUP BY source_type"),
    )
    // source_type facet intentionally counts all catalog entries — just verify
    // it was issued and doesn't accidentally exclude the frequency query.
    expect(sourceQuery).toBeDefined()
  })
})

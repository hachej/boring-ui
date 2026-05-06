import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMacroSeriesAdapter } from "../data/macroSeriesAdapter"

function mockFetch(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  })
}

const EMPTY_RESULT = { items: [], total: 0, hasMore: false }

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("createMacroSeriesAdapter – group expansion", () => {
  it("sends frequency=<value> when a frequency group is expanded", async () => {
    const fetch = mockFetch(EMPTY_RESULT)
    vi.stubGlobal("fetch", fetch)

    const adapter = createMacroSeriesAdapter()
    await adapter.search({
      query: "",
      filters: {},
      group: { key: "frequency", value: "M" },
      offset: 0,
      limit: 50,
    })

    const url = fetch.mock.calls[0][0] as string
    const params = new URL(url, "http://localhost").searchParams
    expect(params.get("frequency")).toBe("M")
    expect(params.has("group")).toBe(false)
  })

  it("does not send a group param to the server", async () => {
    const fetch = mockFetch(EMPTY_RESULT)
    vi.stubGlobal("fetch", fetch)

    const adapter = createMacroSeriesAdapter()
    await adapter.search({
      query: "",
      filters: {},
      group: { key: "frequency", value: "Q" },
      offset: 0,
      limit: 50,
    })

    const url = fetch.mock.calls[0][0] as string
    expect(url).not.toContain("group=")
  })

  it("uses the explicit frequency filter when no group is active", async () => {
    const fetch = mockFetch(EMPTY_RESULT)
    vi.stubGlobal("fetch", fetch)

    const adapter = createMacroSeriesAdapter()
    await adapter.search({
      query: "",
      filters: { frequency: ["D", "W"] },
      offset: 0,
      limit: 50,
    })

    const url = fetch.mock.calls[0][0] as string
    const params = new URL(url, "http://localhost").searchParams
    expect(params.getAll("frequency")).toEqual(["D", "W"])
  })

  it("group value overrides explicit frequency filter when both are present", async () => {
    const fetch = mockFetch(EMPTY_RESULT)
    vi.stubGlobal("fetch", fetch)

    const adapter = createMacroSeriesAdapter()
    await adapter.search({
      query: "",
      filters: { frequency: ["M"] },
      group: { key: "frequency", value: "M" },
      offset: 0,
      limit: 50,
    })

    const url = fetch.mock.calls[0][0] as string
    const params = new URL(url, "http://localhost").searchParams
    expect(params.getAll("frequency")).toEqual(["M"])
    expect(params.has("group")).toBe(false)
  })

  it("passes source filter alongside group frequency filter", async () => {
    const fetch = mockFetch(EMPTY_RESULT)
    vi.stubGlobal("fetch", fetch)

    const adapter = createMacroSeriesAdapter()
    await adapter.search({
      query: "",
      filters: { source: ["fred"] },
      group: { key: "frequency", value: "A" },
      offset: 0,
      limit: 50,
    })

    const url = fetch.mock.calls[0][0] as string
    const params = new URL(url, "http://localhost").searchParams
    expect(params.get("frequency")).toBe("A")
    expect(params.get("source")).toBe("fred")
  })
})

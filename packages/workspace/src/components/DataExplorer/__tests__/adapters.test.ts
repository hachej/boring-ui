import { describe, it, expect } from "vitest"
import { createSourcesAdapter, type SourceEntry } from "../adapters"

const sources: SourceEntry[] = [
  { id: "users", name: "users", type: "table", schema: "public", description: "Account rows" },
  { id: "events", name: "events", type: "stream", schema: "public" },
  { id: "daily_revenue", name: "daily_revenue", type: "view", schema: "analytics" },
  { id: "auth_events", name: "auth_events", type: "stream", schema: "audit" },
]

describe("createSourcesAdapter", () => {
  it("returns rows shaped as ExplorerRow with type as leading code", async () => {
    const adapter = createSourcesAdapter(sources)
    const result = await adapter.search({ query: "", filters: {}, offset: 0, limit: 50 })
    expect(result.total).toBe(4)
    const users = result.items.find((r) => r.id === "users")!
    expect(users.title).toBe("users")
    expect(users.subtitle).toBe("Account rows")
    expect(users.leading?.code).toBe("TAB")
  })

  it("maps the schema field onto row.group", async () => {
    const adapter = createSourcesAdapter(sources)
    const { items } = await adapter.search({ query: "", filters: {}, offset: 0, limit: 50 })
    expect(items.find((r) => r.id === "users")?.group).toBe("public")
    expect(items.find((r) => r.id === "auth_events")?.group).toBe("audit")
  })

  it("scopes search to a group when args.group is provided", async () => {
    const adapter = createSourcesAdapter(sources)
    const result = await adapter.search({
      query: "",
      filters: {},
      group: { key: "schema", value: "public" },
      offset: 0,
      limit: 50,
    })
    expect(result.total).toBe(2)
    expect(result.items.map((r) => r.id).sort()).toEqual(["events", "users"])
  })

  it("filters by query against id, title, and description", async () => {
    const adapter = createSourcesAdapter(sources)
    const result = await adapter.search({ query: "rev", filters: {}, offset: 0, limit: 50 })
    expect(result.items.map((r) => r.id)).toEqual(["daily_revenue"])
  })

  it("paginates correctly", async () => {
    const adapter = createSourcesAdapter(sources)
    const page1 = await adapter.search({ query: "", filters: {}, offset: 0, limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    const page2 = await adapter.search({ query: "", filters: {}, offset: 2, limit: 2 })
    expect(page2.items).toHaveLength(2)
    expect(page2.hasMore).toBe(false)
  })

  it("exposes a fetchFacets when at least one source has a schema", async () => {
    const adapter = createSourcesAdapter(sources)
    expect(adapter.fetchFacets).toBeDefined()
    const facets = await adapter.fetchFacets!({ filters: {} })
    const counts = Object.fromEntries(
      (facets.schema ?? []).map((f) => [f.value, f.count]),
    )
    expect(counts).toEqual({ public: 2, analytics: 1, audit: 1 })
  })

  it("omits fetchFacets when no source has a schema", () => {
    const adapter = createSourcesAdapter([
      { id: "x", name: "x", type: "table" },
      { id: "y", name: "y", type: "view" },
    ])
    expect(adapter.fetchFacets).toBeUndefined()
  })
})

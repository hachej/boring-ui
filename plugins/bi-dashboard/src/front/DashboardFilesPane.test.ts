import { describe, expect, it } from "vitest"
import { createDashboardFilesAdapter } from "./DashboardFilesPane"

describe("createDashboardFilesAdapter", () => {
  it("maps, filters, deduplicates, and sorts user dashboard files", async () => {
    const adapter = createDashboardFilesAdapter(async () => ({
      resources: [
        { filesystem: "user", path: "dashboards/z-last.dashboard.json" },
        { filesystem: "system", path: "dashboards/hidden.dashboard.json" },
        { filesystem: "user", path: "notes/readme.md" },
        { filesystem: "user", path: "dashboards/a-first.dashboard.json" },
        { filesystem: "user", path: "dashboards/a-first.dashboard.json" },
      ],
    }))

    const result = await adapter.search({ query: "first", limit: 500, offset: 0 })
    expect(result.total).toBe(2)
    expect(result.items).toEqual([{
      id: "dashboards/a-first.dashboard.json",
      title: "a first",
      subtitle: "dashboards/a-first.dashboard.json",
      params: { path: "dashboards/a-first.dashboard.json" },
    }])
    expect(result.hasMore).toBe(false)
  })
})

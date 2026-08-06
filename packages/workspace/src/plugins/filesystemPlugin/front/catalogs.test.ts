import { describe, expect, it, vi } from "vitest"
import { createFilesCatalog } from "./catalogs"

describe("createFilesCatalog", () => {
  it("keeps duplicate paths distinct by filesystem and selects the full resource", async () => {
    const resources = [
      { filesystem: "user", path: "same.md" },
      { filesystem: "company_context", path: "same.md" },
    ]
    const onSelect = vi.fn()
    const catalog = createFilesCatalog({
      client: { searchResources: vi.fn(async () => resources) },
      onSelect,
    })

    const result = await catalog.adapter.search({
      query: "same",
      filters: {},
      limit: 10,
      offset: 0,
    })

    expect(result.items).toEqual([
      {
        id: "user:same.md",
        title: "same.md",
        meta: "Workspace",
        resource: { filesystem: "user", path: "same.md" },
      },
      {
        id: "company_context:same.md",
        title: "same.md",
        meta: "company_context",
        resource: { filesystem: "company_context", path: "same.md" },
      },
    ])

    catalog.onSelect(result.items[1])
    expect(onSelect).toHaveBeenCalledWith(
      { filesystem: "company_context", path: "same.md" },
      result.items[1],
    )
  })
})

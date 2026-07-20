import { afterEach, describe, expect, it, vi } from "vitest"
import { WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT } from "@hachej/boring-workspace/plugin"
import { createTaskCatalog } from "./taskCatalog"
import { TASK_SEARCH_QUERY_EVENT } from "./taskSearchEvents"

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe("task command-palette catalog", () => {
  it("searches all task sources and opens Tasks filtered to the selected task", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        sources: [{ id: "github:workspace", label: "GitHub", capabilities: { move: true, delete: false } }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        tasks: [
          { id: "776", number: "#776", title: "Bind native Pi sessions", description: "Exact durable links", statusId: "ready", adapterId: "github:workspace", tags: ["enhancement"] },
          { id: "777", number: "#777", title: "Unrelated task", statusId: "ready", adapterId: "github:workspace" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }))
    const openOverlay = vi.fn()
    const setSearch = vi.fn()
    window.addEventListener(WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT, openOverlay)
    window.addEventListener(TASK_SEARCH_QUERY_EVENT, setSearch)

    const catalog = createTaskCatalog()
    const result = await catalog.adapter.search({ query: "durable 776", filters: {}, limit: 8, offset: 0 })
    expect(result).toMatchObject({ total: 1, hasMore: false })
    expect(result.items[0]).toMatchObject({ title: "#776 Bind native Pi sessions", subtitle: "enhancement" })
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/boring-tasks/sources/tasks/list", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sourceIds: ["github:workspace"] }),
    }))

    catalog.onSelect(result.items[0]!)
    expect(setSearch).toHaveBeenCalledWith(expect.objectContaining({ detail: { query: "#776" } }))
    expect(openOverlay).toHaveBeenCalledWith(expect.objectContaining({ detail: { id: "tasks" } }))

    window.removeEventListener(WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT, openOverlay)
    window.removeEventListener(TASK_SEARCH_QUERY_EVENT, setSearch)
  })
})

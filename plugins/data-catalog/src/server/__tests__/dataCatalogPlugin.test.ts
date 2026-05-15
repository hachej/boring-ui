import { describe, expect, it, vi } from "vitest"
import type { ExplorerDataSource, ExplorerItem } from "@hachej/boring-data-explorer/shared"
import {
  createDataCatalogAgentTool,
  createDataCatalogServerPlugin,
  createDataCatalogSkillPrompt,
  formatDataCatalogSearchResult,
} from "../index"

const rows: ExplorerItem[] = [
  {
    id: "orders_daily",
    title: "Daily Orders",
    subtitle: "Operational order counts",
    leading: { code: "OPS", tooltip: "Operations" },
    meta: "310",
  },
  {
    id: "customers",
    title: "Customers",
    subtitle: "Customer dimension table",
    leading: { code: "DIM", tooltip: "Dimension" },
  },
]

const adapter: ExplorerDataSource = {
  async search(args) {
    const q = args.query.toLowerCase()
    const pool = rows.filter((row) =>
      [row.id, row.title, row.subtitle ?? ""].some((value) =>
        value.toLowerCase().includes(q),
      ),
    )
    const items = pool.slice(args.offset, args.offset + args.limit)
    return {
      items,
      total: pool.length,
      hasMore: args.offset + items.length < pool.length,
    }
  },
}

describe("data catalog server helpers", () => {
  it("formats search results for the agent", () => {
    expect(
      formatDataCatalogSearchResult("orders", {
        items: [rows[0]!],
        total: 12,
        hasMore: true,
      }),
    ).toContain("Found 12 results")
    expect(
      formatDataCatalogSearchResult("orders", {
        items: [rows[0]!],
        total: 12,
        hasMore: true,
      }),
    ).toContain("orders_daily: Daily Orders")
  })

  it("creates an agent tool backed by the catalog adapter", async () => {
    const tool = createDataCatalogAgentTool({
      name: "catalog_search",
      label: "workspace data catalog",
      adapter,
      defaultLimit: 5,
      maxLimit: 10,
    })

    const result = await tool.execute(
      { query: "orders", limit: 50 },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "tool-1",
      },
    )

    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toContain("orders_daily: Daily Orders")
    expect((result.details as { items: ExplorerItem[] }).items).toHaveLength(1)
  })

  it("normalizes invalid tool limit options", () => {
    const tool = createDataCatalogAgentTool({
      adapter,
      defaultLimit: 100,
      maxLimit: 2,
    })
    const limitSchema = (tool.parameters.properties as Record<string, unknown>).limit as {
      description: string
      maximum: number
    }

    expect(limitSchema.maximum).toBe(2)
    expect(limitSchema.description).toContain("Default 2")
  })

  it("accepts numeric string limits from tool callers", async () => {
    const search = vi.fn(adapter.search)
    const tool = createDataCatalogAgentTool({
      adapter: { search },
      defaultLimit: 1,
      maxLimit: 10,
    })

    const result = await tool.execute(
      { query: "orders", limit: "5" },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "tool-1",
      },
    )

    expect(result.isError).toBeFalsy()
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }))
    expect((result.details as { items: ExplorerItem[] }).items).toHaveLength(1)
  })

  it("returns a validation error when the agent tool query is blank", async () => {
    const tool = createDataCatalogAgentTool({ adapter })
    const result = await tool.execute(
      { query: "" },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "tool-1",
      },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe("query is required")
  })

  it("creates server plugin metadata with skill text and a tool", () => {
    const plugin = createDataCatalogServerPlugin({
      id: "warehouse-catalog",
      label: "warehouse catalog",
      adapter,
      name: "catalog_search",
    })

    expect(plugin.id).toBe("warehouse-catalog")
    expect(plugin.agentTools.map((tool) => tool.name)).toEqual(["catalog_search"])
    expect(plugin.systemPrompt).toContain("## Data Catalog Plugin")
    expect(plugin.systemPrompt).toContain("catalog_search")
  })

  it("builds a standalone skill prompt", () => {
    const prompt = createDataCatalogSkillPrompt({
      label: "warehouse catalog",
      toolName: "catalog_search",
      guidance: "Prefer exact dataset ids when possible.",
    })
    expect(prompt).toContain("Prefer exact dataset ids")
    expect(prompt).toContain("openSurface")
    expect(prompt).not.toContain("openPanel")
  })

  it("uses the configured surface kind in the skill prompt", () => {
    const prompt = createDataCatalogSkillPrompt({
      toolName: "search_metrics",
      surfaceKind: "metrics.open-row",
    })

    expect(prompt).toContain("kind: 'metrics.open-row'")
    expect(prompt).not.toContain("kind: 'data-catalog.open-row'")
  })
})

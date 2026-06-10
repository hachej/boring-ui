import type { ComponentType } from "react"
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type {
  BoringFrontAPI,
  BoringFrontLeftTabRegistration,
  BoringFrontPanelRegistration,
  BoringFrontSurfaceResolverRegistration,
} from "@hachej/boring-workspace/plugin"
import type { CatalogConfig } from "@hachej/boring-workspace"
import { workspaceEvents } from "@hachej/boring-workspace/events"
import { events } from "@hachej/boring-workspace"
import type { ExplorerDataSource, ExplorerItem } from "@hachej/boring-data-explorer/shared"
import {
  DATA_CATALOG_ROW_SURFACE_KIND,
  createDataCatalogPlugin,
  dataCatalogPanelInstanceId,
  openDataCatalogVisualization,
  useDataCatalogQuery,
  useDataCatalogVisualizationState,
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

interface CapturedRegistrations {
  leftTabs: BoringFrontLeftTabRegistration<any>[]
  panels: BoringFrontPanelRegistration<any>[]
  catalogs: CatalogConfig[]
  surfaceResolvers: BoringFrontSurfaceResolverRegistration[]
}

function makeMockApi(): { api: BoringFrontAPI; captured: CapturedRegistrations } {
  const captured: CapturedRegistrations = {
    leftTabs: [],
    panels: [],
    catalogs: [],
    surfaceResolvers: [],
  }
  const api: BoringFrontAPI = {
    registerProvider: vi.fn(),
    registerBinding: vi.fn(),
    registerCatalog: vi.fn((c) => {
      captured.catalogs.push(c)
    }),
    registerPanel: vi.fn((p) => {
      captured.panels.push(p)
    }),
    registerPanelCommand: vi.fn(),
    registerLeftTab: vi.fn((t) => {
      captured.leftTabs.push(t)
    }),
    registerSurfaceResolver: vi.fn((r) => {
      captured.surfaceResolvers.push(r)
    }),
    registerToolRenderer: vi.fn(),
  }
  return { api, captured }
}

describe("createDataCatalogPlugin (BoringFrontFactory)", () => {
  it("registers left tab, visualization panel, catalog, and surface resolver by default", async () => {
    const factory = createDataCatalogPlugin({
      id: "warehouse-data",
      label: "Data",
      adapter,
      groupBy: "category",
    })
    const { api, captured } = makeMockApi()
    await factory(api)

    expect(captured.leftTabs).toHaveLength(1)
    expect(captured.leftTabs[0]).toEqual(
      expect.objectContaining({
        id: "warehouse-data-tab",
        title: "Data",
        panelId: "warehouse-data-tab",
      }),
    )

    expect(captured.panels).toHaveLength(1)
    expect(captured.panels[0]).toEqual(
      expect.objectContaining({
        id: "warehouse-data-visualization",
        placement: "center",
      }),
    )

    expect(captured.catalogs).toHaveLength(1)
    expect(captured.catalogs[0]).toEqual(
      expect.objectContaining({ id: "warehouse-data", label: "Data" }),
    )

    expect(captured.surfaceResolvers).toHaveLength(1)
    expect(captured.surfaceResolvers[0]).toEqual(
      expect.objectContaining({
        id: "warehouse-data-row",
        kind: DATA_CATALOG_ROW_SURFACE_KIND,
      }),
    )
  })

  it("passes workbench bridge context to left-tab row selection", async () => {
    const onSelect = vi.fn()
    const factory = createDataCatalogPlugin({
      id: "metrics",
      label: "Metrics",
      adapter,
      onSelect,
    })
    const { api, captured } = makeMockApi()
    await factory(api)

    const tab = captured.leftTabs[0]
    if (!tab) throw new Error("missing left tab")
    const Component = tab.component as ComponentType<any>
    const bridge = { openFile: vi.fn() }

    render(<Component params={{ bridge }} />)
    await screen.findByText("Daily Orders")
    fireEvent.click(screen.getByRole("button", { name: /Daily Orders/ }))

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(rows[0], {
        params: { bridge },
        bridge,
      }),
    )
  })

  it("can explicitly add a resolver for a host-registered visualization panel", async () => {
    const factory = createDataCatalogPlugin({
      id: "warehouse-data",
      label: "Data",
      adapter,
      visualizationPanelId: "insight-panel",
      includeVisualizationPanel: false,
      includeSurfaceResolver: true,
    })
    const { api, captured } = makeMockApi()
    await factory(api)

    expect(captured.panels).toHaveLength(0)
    expect(captured.leftTabs).toHaveLength(1)
    expect(captured.catalogs).toHaveLength(1)
    expect(captured.surfaceResolvers).toHaveLength(1)

    const resolver = captured.surfaceResolvers[0]
    expect(
      resolver?.resolve({
        kind: DATA_CATALOG_ROW_SURFACE_KIND,
        target: "orders_daily",
        meta: { catalogId: "warehouse-data", row: rows[0] },
      }),
    ).toEqual(expect.objectContaining({ component: "insight-panel" }))
  })

  it("catalog selection posts an openSurface ui command by default", async () => {
    const observed: unknown[] = []
    const unsubscribe = events.on(workspaceEvents.uiCommand, (payload) =>
      observed.push(payload.command),
    )

    try {
      const factory = createDataCatalogPlugin({
        id: "metrics",
        label: "Metrics",
        adapter,
      })
      const { api, captured } = makeMockApi()
      await factory(api)
      const catalog = captured.catalogs[0]

      expect(catalog).toBeDefined()
      catalog!.onSelect(rows[0]!)

      expect(observed).toEqual([
        {
          kind: "openSurface",
          params: {
            kind: DATA_CATALOG_ROW_SURFACE_KIND,
            target: "orders_daily",
            meta: {
              catalogId: "metrics",
              row: rows[0],
            },
          },
        },
      ])
    } finally {
      unsubscribe()
    }
  })

  it("protects reserved routing metadata when opening a visualization", () => {
    const observed: unknown[] = []
    const unsubscribe = events.on(workspaceEvents.uiCommand, (payload) =>
      observed.push(payload.command),
    )

    try {
      openDataCatalogVisualization(rows[0]!, {
        catalogId: "metrics",
        title: "Orders",
        params: {
          catalogId: "other",
          row: rows[1],
          extra: "kept",
        },
      })

      expect(observed).toEqual([
        {
          kind: "openSurface",
          params: {
            kind: DATA_CATALOG_ROW_SURFACE_KIND,
            target: "orders_daily",
            meta: {
              catalogId: "metrics",
              row: rows[0],
              title: "Orders",
              extra: "kept",
            },
          },
        },
      ])
    } finally {
      unsubscribe()
    }
  })

  it("resolves catalog row targets into visualization panels", async () => {
    const factory = createDataCatalogPlugin({
      id: "metrics",
      label: "Metrics",
      adapter,
    })
    const { api, captured } = makeMockApi()
    await factory(api)
    const resolver = captured.surfaceResolvers[0]

    expect(
      resolver?.resolve({
        kind: DATA_CATALOG_ROW_SURFACE_KIND,
        target: "orders_daily",
        meta: { catalogId: "metrics", row: rows[0] },
      }),
    ).toEqual({
      id: dataCatalogPanelInstanceId("orders_daily", "metrics"),
      component: "metrics-visualization",
      title: "Daily Orders",
      params: { row: rows[0] },
      score: 0,
    })
    expect(
      resolver?.resolve({
        kind: DATA_CATALOG_ROW_SURFACE_KIND,
        target: "orders_daily",
        meta: { catalogId: "other", row: rows[0] },
      }),
    ).toBeUndefined()
  })

  it("keeps data catalog param resolution in plugin hooks", () => {
    const query = renderHook(() =>
      useDataCatalogQuery({ searchQuery: "orders", rootDir: "/repo" }),
    )
    expect(query.result.current).toEqual({ query: "orders", controlled: true })

    const visualization = renderHook(() =>
      useDataCatalogVisualizationState({ row: rows[0] }, "Data Preview"),
    )
    expect(visualization.result.current).toEqual({
      row: rows[0],
      query: "orders_daily",
      controlled: true,
      title: "Daily Orders",
    })

    const emptyQuery = renderHook(() =>
      useDataCatalogVisualizationState({ query: "" }, "Data Preview"),
    )
    expect(emptyQuery.result.current).toEqual({
      row: undefined,
      query: "",
      controlled: true,
      title: "Data Preview",
    })
  })

  it("creates stable bridge-safe panel instance ids", () => {
    const id = dataCatalogPanelInstanceId("warehouse/orders daily", "warehouse.data")
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(id).toBe(
      dataCatalogPanelInstanceId("warehouse/orders daily", "warehouse.data"),
    )
    expect(id.length).toBeLessThanOrEqual(64)

    const longPrefix = "warehouse.data.catalog.prefix.with.many.parts".repeat(3)
    const first = dataCatalogPanelInstanceId("row-one", longPrefix)
    const second = dataCatalogPanelInstanceId("row-two", longPrefix)
    expect(first).not.toBe(second)
    expect(first).toContain("row-one")
    expect(first.length).toBeLessThanOrEqual(64)
    expect(second.length).toBeLessThanOrEqual(64)
  })

  it("is the default callable factory shape required by BoringFrontFactory", () => {
    const factory = createDataCatalogPlugin({
      id: "metrics",
      label: "Metrics",
      adapter,
    })
    expect(typeof factory).toBe("function")
  })
})

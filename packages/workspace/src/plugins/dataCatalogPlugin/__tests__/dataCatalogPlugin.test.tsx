import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CommandRegistry } from "../../../front/registry/CommandRegistry"
import { PanelRegistry } from "../../../front/registry/PanelRegistry"
import { SurfaceResolverRegistry } from "../../../front/registry/SurfaceResolverRegistry"
import { CatalogRegistry } from "../../../front/plugin/CatalogRegistry"
import { events, workspaceEvents } from "../../../front/events"
import { bootstrap, defineFrontPlugin } from "../../../shared/plugins"
import type { ExplorerAdapter, ExplorerRow } from "../../../front/components/DataExplorer"
import {
  DATA_CATALOG_ROW_SURFACE_KIND,
  appendDataCatalogOutputs,
  createDataCatalogOutputs,
  createDataCatalogPlugin,
  dataCatalogPanelInstanceId,
  openDataCatalogVisualization,
  useDataCatalogQuery,
  useDataCatalogVisualizationState,
} from "../index"

const DummyChatPanel = () => null

const rows: ExplorerRow[] = [
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

const adapter: ExplorerAdapter = {
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

function makeRegistries() {
  return {
    panels: new PanelRegistry(),
    commands: new CommandRegistry(),
    catalogs: new CatalogRegistry({ warnOnDuplicate: false }),
    surfaceResolvers: new SurfaceResolverRegistry(),
  }
}

describe("dataCatalogPlugin", () => {
  it("creates left-tab, visualization panel, and catalog outputs", () => {
    const outputs = createDataCatalogOutputs({
      id: "warehouse-data",
      label: "Data",
      adapter,
      groupBy: "category",
    })

    expect(outputs.map((output) => output.type)).toEqual([
      "left-tab",
      "panel",
      "catalog",
      "surface-resolver",
    ])
    expect(outputs[0]).toEqual(
      expect.objectContaining({
        type: "left-tab",
        id: "warehouse-data-tab",
        title: "Data",
      }),
    )
    expect(outputs[1]).toEqual(
      expect.objectContaining({
        type: "panel",
        panel: expect.objectContaining({
          id: "warehouse-data-visualization",
          placement: "center",
        }),
      }),
    )
    expect(outputs[2]).toEqual(
      expect.objectContaining({
        type: "catalog",
        catalog: expect.objectContaining({ id: "warehouse-data", label: "Data" }),
      }),
    )
    expect(outputs[3]).toEqual(
      expect.objectContaining({
        type: "surface-resolver",
        resolver: expect.objectContaining({ id: "warehouse-data-row" }),
      }),
    )
  })

  it("registers outputs through plugin bootstrap", () => {
    const registries = makeRegistries()
    const plugin = createDataCatalogPlugin({
      id: "metrics",
      label: "Metrics",
      adapter,
    })

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [plugin],
      defaults: [],
      registries,
    })

    expect(registries.panels.get("metrics-tab")).toEqual(
      expect.objectContaining({
        id: "metrics-tab",
        placement: "left-tab",
        pluginId: "metrics",
      }),
    )
    expect(registries.panels.get("metrics-visualization")).toEqual(
      expect.objectContaining({
        id: "metrics-visualization",
        placement: "center",
        pluginId: "metrics",
      }),
    )
    expect(registries.catalogs.get("metrics")).toEqual(
      expect.objectContaining({ id: "metrics", pluginId: "metrics" }),
    )
    expect(registries.surfaceResolvers.get("metrics-row")).toEqual(
      expect.objectContaining({
        id: "metrics-row",
        pluginId: "metrics",
      }),
    )
  })

  it("appends outputs to a child app plugin without replacing its own panels", () => {
    const child = defineFrontPlugin({
      id: "analytics-host",
      label: "Analytics",
      panels: [
        {
          id: "insight-panel",
          title: "Insight",
          component: () => null,
          placement: "center",
          source: "app",
        },
      ],
    })

    const plugin = appendDataCatalogOutputs(child, {
      id: "warehouse-data",
      label: "Data",
      adapter,
      visualizationPanelId: "insight-panel",
      includeVisualizationPanel: false,
    })

    expect(plugin.id).toBe("analytics-host")
    expect(plugin.panels?.map((panel) => panel.id)).toEqual(["insight-panel"])
    expect(plugin.outputs?.map((output) => output.type)).toEqual(["left-tab", "catalog"])
  })

  it("can explicitly add a resolver for a host-registered visualization panel", () => {
    const outputs = createDataCatalogOutputs({
      id: "warehouse-data",
      label: "Data",
      adapter,
      visualizationPanelId: "insight-panel",
      includeVisualizationPanel: false,
      includeSurfaceResolver: true,
    })

    expect(outputs.map((output) => output.type)).toEqual([
      "left-tab",
      "catalog",
      "surface-resolver",
    ])
    const resolver = outputs.find((output) => output.type === "surface-resolver")?.resolver
    expect(resolver?.resolve({
      kind: DATA_CATALOG_ROW_SURFACE_KIND,
      target: "orders_daily",
      meta: { catalogId: "warehouse-data", row: rows[0] },
    })).toEqual(expect.objectContaining({ component: "insight-panel" }))
  })

  it("catalog selection posts an openSurface ui command by default", () => {
    const observed: unknown[] = []
    const unsubscribe = events.on(workspaceEvents.uiCommand, (payload) =>
      observed.push(payload.command),
    )

    try {
      const outputs = createDataCatalogOutputs({
        id: "metrics",
        label: "Metrics",
        adapter,
      })
      const catalog = outputs.find((output) => output.type === "catalog")?.catalog

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

  it("resolves catalog row targets into visualization panels", () => {
    const outputs = createDataCatalogOutputs({
      id: "metrics",
      label: "Metrics",
      adapter,
    })
    const resolver = outputs.find((output) => output.type === "surface-resolver")?.resolver

    expect(resolver?.resolve({
      kind: DATA_CATALOG_ROW_SURFACE_KIND,
      target: "orders_daily",
      meta: { catalogId: "metrics", row: rows[0] },
    })).toEqual({
      id: dataCatalogPanelInstanceId("orders_daily", "metrics"),
      component: "metrics-visualization",
      title: "Daily Orders",
      params: { row: rows[0] },
      score: 0,
    })
    expect(resolver?.resolve({
      kind: DATA_CATALOG_ROW_SURFACE_KIND,
      target: "orders_daily",
      meta: { catalogId: "other", row: rows[0] },
    })).toBeUndefined()
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
})

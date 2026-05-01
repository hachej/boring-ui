import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  createExplorerOutputs,
  createExplorerPlugin,
  ExplorerView,
  type SectionedExplorerAdapter,
} from "../index"
import type { ExplorerAdapter, ExplorerRow } from "../../../front/components/DataExplorer"

const rows: ExplorerRow[] = [
  { id: "GDPC1", title: "Real GDP", group: "Q", leading: { code: "Q" } },
]

const adapter: ExplorerAdapter = {
  async search() {
    return { items: rows, total: rows.length, hasMore: false }
  },
  async fetchFacets() {
    return { frequency: [{ value: "Q", count: 1 }] }
  },
}

describe("explorerPlugin", () => {
  it("creates left-tab and catalog outputs for grouped explorer usage", () => {
    const onSelect = vi.fn()
    const outputs = createExplorerOutputs({
      id: "macro-series",
      label: "Data",
      mode: "grouped",
      adapter,
      groupBy: "frequency",
      facets: [{ key: "frequency", label: "Frequency" }],
      leftTab: { id: "macro-series", title: "Data" },
      catalog: { id: "macro-series", label: "Macro Series", onSelect },
    })

    expect(outputs.map((output) => output.type)).toEqual(["left-tab", "catalog"])
    expect(outputs[0]).toEqual(expect.objectContaining({ type: "left-tab", id: "macro-series", title: "Data" }))
    expect(outputs[1]).toEqual(
      expect.objectContaining({
        type: "catalog",
        catalog: expect.objectContaining({ id: "macro-series", label: "Macro Series" }),
      }),
    )
  })

  it("creates a plugin from explorer outputs", () => {
    const plugin = createExplorerPlugin({
      id: "macro-series",
      label: "Data",
      adapter,
      catalog: { id: "macro-series", label: "Macro Series" },
    })

    expect(plugin.id).toBe("macro-series")
    expect(plugin.outputs?.map((output) => output.type)).toEqual(["left-tab", "catalog"])
  })

  it("passes scoped section filters to sectioned adapters", async () => {
    const searchSection = vi.fn(async (_sectionId, args) => ({
      items: args.filters.status?.includes("pending")
        ? [{ id: "doc-1", title: "Pending doc" }]
        : [{ id: "doc-2", title: "Any doc" }],
      total: 1,
      hasMore: false,
    }))
    const sections = vi.fn(async () => [
      {
        id: "sources",
        title: "Sources",
        defaultExpanded: true,
        filters: [
          {
            key: "status",
            label: "Status",
            values: [{ value: "pending", count: 1 }],
          },
        ],
      },
    ])
    const sectionedAdapter: SectionedExplorerAdapter = {
      sections,
      searchSection,
    }

    render(<ExplorerView mode="sectioned" sectionedAdapter={sectionedAdapter} />)

    expect(await screen.findByText("Any doc")).toBeInTheDocument()
    fireEvent.click(screen.getByText("pending"))

    await waitFor(() => expect(screen.getByText("Pending doc")).toBeInTheDocument())
    expect(searchSection).toHaveBeenLastCalledWith(
      "sources",
      expect.objectContaining({ filters: { status: ["pending"] } }),
    )
    expect(sections).toHaveBeenCalledTimes(1)
  })
})

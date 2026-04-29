import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DataCatalogPane } from "../DataCatalogPane"

vi.mock("../../../front/dock", () => ({
  PanelChrome: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="panel-chrome" data-title={title}>{children}</div>
  ),
}))

describe("DataCatalogPane", () => {
  it("wraps DataCatalog in PanelChrome with title", async () => {
    render(<DataCatalogPane sources={[{ id: "1", name: "DB", type: "pg" }]} />)
    const chrome = screen.getByTestId("panel-chrome")
    expect(chrome).toHaveAttribute("data-title", "Data Sources")
    expect(await screen.findByText("DB")).toBeInTheDocument()
  })

  it("defaults sources to empty array", async () => {
    render(<DataCatalogPane />)
    expect(await screen.findByText("No data sources")).toBeInTheDocument()
  })

  it("forwards onSelect to DataCatalog", async () => {
    const onSelect = vi.fn()
    render(
      <DataCatalogPane
        sources={[{ id: "x", name: "Test", type: "csv" }]}
        onSelect={onSelect}
      />,
    )
    const card = await screen.findByText("Test")
    card.click()
    expect(onSelect).toHaveBeenCalledWith("x")
  })
})

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DataCatalog, type DataSource } from "../DataCatalog"

const sampleSources: DataSource[] = [
  { id: "pg-1", name: "Users DB", type: "postgres", description: "Primary users database" },
  { id: "csv-1", name: "Sales Data", type: "csv" },
]

describe("DataCatalog", () => {
  it("renders empty state when sources is empty", () => {
    render(<DataCatalog sources={[]} />)
    expect(screen.getByText("No data sources")).toBeInTheDocument()
  })

  it("renders list of data source cards", () => {
    render(<DataCatalog sources={sampleSources} />)
    expect(screen.getByText("Users DB")).toBeInTheDocument()
    expect(screen.getByText("Sales Data")).toBeInTheDocument()
  })

  it("shows source name and type badge on each card", () => {
    render(<DataCatalog sources={sampleSources} />)
    expect(screen.getByText("postgres")).toBeInTheDocument()
    expect(screen.getByText("csv")).toBeInTheDocument()
  })

  it("shows description when provided", () => {
    render(<DataCatalog sources={sampleSources} />)
    expect(screen.getByText("Primary users database")).toBeInTheDocument()
  })

  it("calls onSelect with source ID on click", () => {
    const onSelect = vi.fn()
    render(<DataCatalog sources={sampleSources} onSelect={onSelect} />)
    fireEvent.click(screen.getByText("Users DB"))
    expect(onSelect).toHaveBeenCalledWith("pg-1")
  })

  it("calls onSelect on Enter key", () => {
    const onSelect = vi.fn()
    render(<DataCatalog sources={sampleSources} onSelect={onSelect} />)
    const card = screen.getByText("Sales Data").closest("[role=button]")!
    fireEvent.keyDown(card, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledWith("csv-1")
  })

  it("calls onSelect on Space key", () => {
    const onSelect = vi.fn()
    render(<DataCatalog sources={sampleSources} onSelect={onSelect} />)
    const card = screen.getByText("Users DB").closest("[role=button]")!
    fireEvent.keyDown(card, { key: " " })
    expect(onSelect).toHaveBeenCalledWith("pg-1")
  })

  it("cards are non-interactive when onSelect is omitted", () => {
    const { container } = render(<DataCatalog sources={sampleSources} />)
    expect(container.querySelectorAll("[role=button]")).toHaveLength(0)
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0)
  })

  it("uses shadcn Card components", () => {
    const { container } = render(<DataCatalog sources={sampleSources} />)
    expect(container.querySelectorAll("[data-slot=card]")).toHaveLength(2)
    expect(container.querySelectorAll("[data-slot=card-header]")).toHaveLength(2)
  })
})

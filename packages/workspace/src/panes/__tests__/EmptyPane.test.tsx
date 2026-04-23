import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { EmptyPane } from "../EmptyPane"

describe("EmptyPane", () => {
  it("renders welcome message", () => {
    render(<EmptyPane />)
    expect(screen.getByText("No file open")).toBeInTheDocument()
    expect(screen.getByText("Open a file to get started")).toBeInTheDocument()
  })

  it("shows keyboard shortcut hints", () => {
    render(<EmptyPane />)
    expect(screen.getByText("⌘P")).toBeInTheDocument()
    expect(screen.getByText("Open file")).toBeInTheDocument()
    expect(screen.getByText("⌘⇧P")).toBeInTheDocument()
    expect(screen.getByText("Command palette")).toBeInTheDocument()
    expect(screen.getByText("⌘B")).toBeInTheDocument()
    expect(screen.getByText("Toggle sidebar")).toBeInTheDocument()
  })

  it("renders standalone without any provider", () => {
    const { container } = render(<EmptyPane />)
    expect(container.firstChild).toBeTruthy()
  })

  it("accepts className prop", () => {
    const { container } = render(<EmptyPane className="custom-empty" />)
    expect(container.querySelector(".custom-empty")).toBeInTheDocument()
  })

  it("renders Open file button when onOpenFile is provided", () => {
    const onOpenFile = vi.fn()
    render(<EmptyPane onOpenFile={onOpenFile} />)
    const btn = screen.getByRole("button", { name: "Open file" })
    fireEvent.click(btn)
    expect(onOpenFile).toHaveBeenCalledOnce()
  })

  it("does not render Open file button when onOpenFile is omitted", () => {
    render(<EmptyPane />)
    expect(screen.queryByRole("button", { name: "Open file" })).not.toBeInTheDocument()
  })
})

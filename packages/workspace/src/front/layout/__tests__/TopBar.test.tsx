import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { TopBar } from "../TopBar"

describe("TopBar", () => {
  it("renders the provided right-side chrome", () => {
    render(<TopBar topBarRight={<div data-testid="sentinel-slot">User menu</div>} />)

    expect(screen.getByTestId("sentinel-slot")).toBeInTheDocument()
  })

  it("renders no host chrome when topBarRight is omitted", () => {
    render(<TopBar />)

    expect(screen.queryByTestId("sentinel-slot")).toBeNull()
  })
})

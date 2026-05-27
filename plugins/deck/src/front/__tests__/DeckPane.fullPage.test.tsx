import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@hachej/boring-workspace", async () => {
  const actual = await vi.importActual<typeof import("@hachej/boring-workspace")>("@hachej/boring-workspace")
  return {
    ...actual,
    useIsFullPagePanel: () => true,
  }
})

import { DeckPane } from "../DeckPane"

describe("DeckPane full-page presentation", () => {
  it("hides deck controls by default while keeping keyboard slide navigation", () => {
    render(<DeckPane content={`# Intro

Hello deck
---
## Second

Next slide`} />)

    expect(screen.getByTestId("deck-shell-present")).toBeInTheDocument()
    expect(screen.getByText("Hello deck")).toBeInTheDocument()
    expect(screen.queryByTestId("deck-toggle-present")).not.toBeInTheDocument()
    expect(screen.queryByTestId("deck-next")).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: "ArrowRight" })

    expect(screen.getByText("Next slide")).toBeInTheDocument()
  })

  it("can opt full-page controls back in through params", () => {
    render(
      <DeckPane
        content={`# Intro

Hello deck
---
## Second

Next slide`}
        params={{ controls: "visible" }}
      />,
    )

    expect(screen.getByTestId("deck-toggle-present")).toBeInTheDocument()
    expect(screen.getByTestId("deck-next")).toBeInTheDocument()
  })
})

import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TopBarSlotProvider } from "@boring/core/front/top-bar-slot"
import { TopBar } from "../TopBar"

vi.mock("@boring/core/front/top-bar-slot", () => {
  const TopBarSlotContext = React.createContext<React.ReactNode | null>(null)

  return {
    TopBarSlotProvider({
      children,
      slot,
    }: {
      children: React.ReactNode
      slot: React.ReactNode
    }) {
      return (
        <TopBarSlotContext.Provider value={slot}>
          {children}
        </TopBarSlotContext.Provider>
      )
    },
    useTopBarSlot() {
      return React.useContext(TopBarSlotContext)
    },
  }
})

describe("TopBar", () => {
  it("renders the provided top bar slot when no explicit right override is passed", () => {
    render(
      <TopBarSlotProvider slot={<div data-testid="sentinel-slot">User menu</div>}>
        <TopBar />
      </TopBarSlotProvider>,
    )

    expect(screen.getByTestId("sentinel-slot")).toBeInTheDocument()
  })

  it("prefers topBarRight over the shared slot", () => {
    render(
      <TopBarSlotProvider slot={<div data-testid="sentinel-slot">User menu</div>}>
        <TopBar topBarRight={<div data-testid="explicit-slot">Override</div>} />
      </TopBarSlotProvider>,
    )

    expect(screen.getByTestId("explicit-slot")).toBeInTheDocument()
    expect(screen.queryByTestId("sentinel-slot")).toBeNull()
  })
})

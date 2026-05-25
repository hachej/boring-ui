import { render, screen } from "@testing-library/react"
import type { ComponentType } from "react"
import { describe, expect, it, vi } from "vitest"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import { createDeckPlugin } from "../index"
import type { DeckWidgetDefinition } from "../../shared"

describe("createDeckPlugin passthrough", () => {
  it("forwards widgets and onError into the deck panel component", () => {
    const widgets: DeckWidgetDefinition[] = [
      {
        name: "Badge",
        display: "inline",
        render: ({ attrs }) => <span>badge:{attrs.text}</span>,
      },
    ]
    const onError = vi.fn()
    const captured = captureFrontPlugin(createDeckPlugin({ widgets, onError }))
    const panel = captured.registrations.panels[0]

    if (!panel) throw new Error("expected deck panel registration")

    const PanelComponent = panel.component as ComponentType<{
      params?: { path?: string }
      content?: string
    }>

    render(
      <PanelComponent
        params={{ path: "deck/intro.md" }}
        content={`Status {{Badge text="draft"}} ready`}
      />,
    )

    expect(screen.getByText("badge:draft")).toBeInTheDocument()
    expect(onError).not.toHaveBeenCalled()
  })
})

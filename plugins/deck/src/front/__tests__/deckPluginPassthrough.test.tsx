import { render, screen } from "@testing-library/react"
import type { ComponentType } from "react"
import { describe, expect, it, vi } from "vitest"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import { createDeckPlugin } from "../index"
import type { DeckWidgetDefinition } from "../../shared"
import * as deckParser from "../../shared/parser"

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
    const parseSpy = vi.spyOn(deckParser, "parseDeckMarkdown").mockImplementation(() => {
      throw new Error("Parse exploded")
    })

    render(
      <PanelComponent
        params={{ path: "deck/intro.md" }}
        content={`Status {{Badge text="draft"}} ready`}
      />,
    )

    expect(screen.getByTestId("deck-error-state")).toHaveTextContent("Parse exploded")
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "parse",
        path: "deck/intro.md",
        message: "Parse exploded",
      }),
    )

    parseSpy.mockRestore()
  })

  it("forwards theme options into the deck panel component", () => {
    const captured = captureFrontPlugin(
      createDeckPlugin({
        theme: {
          aspectRatio: "4:3",
          className: "theme-shell",
          slideClassName: "theme-slide",
        },
      }),
    )
    const panel = captured.registrations.panels[0]
    if (!panel) throw new Error("expected deck panel registration")

    const PanelComponent = panel.component as ComponentType<{
      params?: { path?: string }
      content?: string
    }>

    render(<PanelComponent content="# Deck\n\nBody" params={{ path: "deck/theme.md" }} />)

    expect(screen.getByTestId("deck-shell-read")).toHaveClass("theme-shell")
    expect(screen.getByTestId("deck-slide-frame")).toHaveClass("theme-slide")
    expect(screen.getByTestId("deck-slide-frame")).toHaveStyle({ aspectRatio: "4 / 3" })
  })
})

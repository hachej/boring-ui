import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DeckPane } from "../DeckPane"
import { StandaloneDeckRoute } from "../StandaloneDeckRoute"
import * as deckParser from "../../shared/parser"
import type { DeckWidgetDefinition } from "../../shared"

describe("DeckPane", () => {
  it("renders parsed slide content and navigates between slides with shared chrome", () => {
    render(
      <DeckPane
        content={`# Intro\n\nHello deck\n---\n## Second\n\nNext slide`}
        params={{ path: "deck/intro.md" }}
      />,
    )

    expect(screen.getByText("Hello deck")).toBeInTheDocument()
    expect(screen.getByText("Slide 1 of 2")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("deck-next"))

    expect(screen.getByText("Next slide")).toBeInTheDocument()
    expect(screen.getByText("Slide 2 of 2")).toBeInTheDocument()
  })

  it("toggles present mode and composes host theme classes with the slide frame", () => {
    render(
      <DeckPane
        content="# Intro\n\nHello"
        theme={{
          aspectRatio: "4:3",
          className: "custom-deck-theme",
          slideClassName: "custom-slide-theme",
        }}
      />,
    )

    expect(screen.getByTestId("deck-shell-read")).toHaveClass("custom-deck-theme")
    expect(screen.getByTestId("deck-slide-frame")).toHaveClass("custom-slide-theme")
    expect(screen.getByTestId("deck-slide-frame")).toHaveStyle({ aspectRatio: "4 / 3" })

    fireEvent.click(screen.getByTestId("deck-toggle-present"))

    expect(screen.getByTestId("deck-shell-present")).toBeInTheDocument()
  })

  it("renders widgets inside the slide shell", () => {
    const widgets: DeckWidgetDefinition[] = [
      {
        name: "Badge",
        display: "inline",
        render: ({ attrs }) => <span>badge:{attrs.text}</span>,
      },
      {
        name: "Stat",
        display: "block",
        render: ({ attrs }) => <div>stat:{attrs.label}</div>,
      },
    ]

    render(
      <DeckPane
        content={`Hello {{Badge text="draft"}}\n\n{{Stat label="GDP"}}`}
        widgets={widgets}
      />,
    )

    expect(screen.getByText("badge:draft")).toBeInTheDocument()
    expect(screen.getByText("stat:GDP")).toBeInTheDocument()
  })

  it("keeps inline widgets in the same paragraph flow without adding spaces", () => {
    const widgets: DeckWidgetDefinition[] = [
      {
        name: "Badge",
        display: "inline",
        render: ({ attrs }) => <span>badge:{attrs.text}</span>,
      },
    ]

    const { container } = render(
      <DeckPane content={`foo{{Badge text="draft"}}bar`} widgets={widgets} />,
    )

    const paragraphs = container.querySelectorAll("p")
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]).toHaveTextContent("foobadge:draftbar")
    expect(within(paragraphs[0]).getByText("badge:draft")).toBeInTheDocument()
  })

  it("shows a render-state error and reports parse failures via onError", () => {
    const onError = vi.fn()
    const parseSpy = vi.spyOn(deckParser, "parseDeckMarkdown").mockImplementation(() => {
      throw new Error("Parse exploded")
    })

    render(<DeckPane content="# broken" onError={onError} params={{ path: "deck/broken.md" }} />)

    expect(screen.getByTestId("deck-error-state")).toHaveTextContent("Parse exploded")
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "parse",
        path: "deck/broken.md",
        message: "Parse exploded",
      }),
    )

    parseSpy.mockRestore()
  })

  it("renders very long slide content without breaking the fixed canvas shell", () => {
    const content = Array.from({ length: 120 }, (_, index) => `- bullet ${index + 1}`).join("\n")

    render(<DeckPane content={content} />)

    expect(screen.getByText("bullet 1")).toBeInTheDocument()
    expect(screen.getByText("bullet 120")).toBeInTheDocument()
    expect(screen.getByTestId("deck-slide-frame")).toBeInTheDocument()
  })

  it("supports keyboard slide navigation outside edit mode", () => {
    render(
      <DeckPane
        content={`# Intro\n\nHello deck\n---\n## Second\n\nNext slide`}
        params={{ path: "deck/intro.md" }}
      />,
    )

    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(screen.getByText("Next slide")).toBeInTheDocument()

    fireEvent.keyDown(window, { key: "ArrowLeft" })
    expect(screen.getByText("Hello deck")).toBeInTheDocument()
  })
})

describe("StandaloneDeckRoute", () => {
  it("boots directly into present mode using the shared deck shell", () => {
    render(<StandaloneDeckRoute path="deck/intro.md" content="# Intro\n\nPresent me" />)

    expect(screen.getByTestId("deck-shell-present")).toBeInTheDocument()
    expect(screen.getByTestId("deck-slide-content")).toHaveTextContent("Present me")
    expect(screen.getByLabelText("Exit present mode")).toBeInTheDocument()
  })
})

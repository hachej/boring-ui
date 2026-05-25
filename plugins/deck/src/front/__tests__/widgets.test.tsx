import { render, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { DeckWidgetSlot, indexDeckWidgets, validateDeckWidgets } from "../widgets"
import type { DeckWidgetDefinition } from "../../shared"

const baseContext = {
  path: "deck/briefing.md",
  slideIndex: 1,
  slideCount: 3,
  mode: "present" as const,
}

describe("deck widget registry", () => {
  it("fails fast on duplicate widget names", () => {
    const dupes = [
      { name: "Badge", render: () => null },
      { name: "Badge", render: () => null },
    ] satisfies DeckWidgetDefinition[]

    expect(() => validateDeckWidgets(dupes)).toThrow("Duplicate deck widget name: Badge")
  })

  it("renders inline widgets with parsed attrs and runtime context", () => {
    const widgets = indexDeckWidgets([
      {
        name: "Badge",
        display: "inline",
        parse: (attrs) => ({ text: attrs.text?.toUpperCase() ?? "" }),
        render: ({ attrs, rawAttrs, context }) => (
          <span>
            {attrs.text}:{rawAttrs.text}:{context.path}:{context.slideIndex}:{context.slideCount}:{context.mode}
          </span>
        ),
      },
    ])

    render(
      <DeckWidgetSlot
        widgets={widgets}
        context={baseContext}
        segment={{
          type: "widget",
          name: "Badge",
          attrs: { text: "draft" },
          raw: '{{Badge text="draft"}}',
          position: "inline",
        }}
      />,
    )

    expect(screen.getByTestId("deck-widget-inline")).toHaveTextContent(
      "DRAFT:draft:deck/briefing.md:1:3:present",
    )
  })

  it("renders block widgets in a block frame", () => {
    const widgets = indexDeckWidgets([
      {
        name: "Chart",
        display: "block",
        render: () => <div>Chart body</div>,
      },
    ])

    render(
      <DeckWidgetSlot
        widgets={widgets}
        context={baseContext}
        segment={{
          type: "widget",
          name: "Chart",
          attrs: {},
          raw: "{{Chart}}",
          position: "block",
        }}
      />,
    )

    expect(screen.getByTestId("deck-widget-block")).toHaveTextContent("Chart body")
  })

  it("shows a visible placeholder for unknown widgets", () => {
    render(
      <DeckWidgetSlot
        widgets={indexDeckWidgets([])}
        context={baseContext}
        segment={{
          type: "widget",
          name: "MissingWidget",
          attrs: {},
          raw: "{{MissingWidget}}",
          position: "block",
        }}
      />,
    )

    expect(screen.getByTestId("deck-widget-placeholder")).toHaveTextContent(
      "Unknown widget: MissingWidget",
    )
  })

  it("shows a placeholder when widget parse fails", () => {
    const widgets = indexDeckWidgets([
      {
        name: "StrictWidget",
        parse: () => {
          throw new Error("Bad attrs")
        },
        render: () => <div>never</div>,
      },
    ])

    render(
      <DeckWidgetSlot
        widgets={widgets}
        context={baseContext}
        segment={{
          type: "widget",
          name: "StrictWidget",
          attrs: { foo: "bar" },
          raw: '{{StrictWidget foo="bar"}}',
          position: "inline",
        }}
      />,
    )

    expect(screen.getByTestId("deck-widget-placeholder")).toHaveTextContent(
      "Bad attrs: StrictWidget",
    )
  })

  it("keeps a render failure local to the widget", () => {
    const widgets = indexDeckWidgets([
      {
        name: "BrokenWidget",
        render: () => {
          throw new Error("Render exploded")
        },
      },
    ])

    render(
      <DeckWidgetSlot
        widgets={widgets}
        context={baseContext}
        segment={{
          type: "widget",
          name: "BrokenWidget",
          attrs: {},
          raw: "{{BrokenWidget}}",
          position: "block",
        }}
      />,
    )

    expect(screen.getByTestId("deck-widget-placeholder")).toHaveTextContent(
      "Render exploded: BrokenWidget",
    )
  })

  it("recovers from a render failure when rerendered with healthy content", () => {
    const renderImpl = vi.fn<() => ReactElement>()
    renderImpl.mockImplementationOnce(() => {
      throw new Error("Render exploded")
    })
    renderImpl.mockImplementation(() => <span>Recovered widget</span>)

    const widgets = indexDeckWidgets([
      {
        name: "RecoveringWidget",
        render: renderImpl,
      },
    ])

    const segment = {
      type: "widget" as const,
      name: "RecoveringWidget",
      attrs: {},
      raw: "{{RecoveringWidget}}",
      position: "block" as const,
    }

    const { rerender } = render(
      <DeckWidgetSlot widgets={widgets} context={baseContext} segment={segment} />,
    )

    expect(screen.getByTestId("deck-widget-placeholder")).toHaveTextContent(
      "Render exploded: RecoveringWidget",
    )

    rerender(<DeckWidgetSlot widgets={widgets} context={baseContext} segment={segment} />)

    expect(screen.getByTestId("deck-widget-block")).toHaveTextContent("Recovered widget")
  })
})

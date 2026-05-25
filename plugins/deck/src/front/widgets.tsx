import { Component, type ErrorInfo, type ReactNode } from "react"
import type { DeckSegment, DeckWidgetDefinition, DeckWidgetRenderContext } from "../shared"

export interface IndexedDeckWidgets {
  get(name: string): DeckWidgetDefinition | undefined
  entries(): IterableIterator<[string, DeckWidgetDefinition]>
}

export function validateDeckWidgets<T extends DeckWidgetDefinition>(widgets: T[]): T[] {
  const seen = new Set<string>()
  for (const widget of widgets) {
    if (seen.has(widget.name)) {
      throw new Error(`Duplicate deck widget name: ${widget.name}`)
    }
    seen.add(widget.name)
  }
  return widgets
}

export function indexDeckWidgets<T extends DeckWidgetDefinition>(widgets: T[]): IndexedDeckWidgets {
  const indexed = new Map<string, DeckWidgetDefinition>()
  for (const widget of validateDeckWidgets(widgets)) indexed.set(widget.name, widget)
  return {
    get(name) {
      return indexed.get(name)
    },
    entries() {
      return indexed.entries()
    },
  }
}

export interface DeckWidgetSlotProps {
  segment: Extract<DeckSegment, { type: "widget" }>
  widgets: IndexedDeckWidgets
  context: DeckWidgetRenderContext
}

export function DeckWidgetSlot({ segment, widgets, context }: DeckWidgetSlotProps) {
  const widget = widgets.get(segment.name)
  if (!widget) {
    return <DeckWidgetPlaceholder name={segment.name} position={segment.position} reason="Unknown widget" />
  }

  const display = widget.display ?? segment.position

  try {
    const attrs = widget.parse ? widget.parse(segment.attrs) : segment.attrs
    return (
      <DeckWidgetErrorBoundary name={segment.name} position={display}>
        <DeckWidgetFrame position={display}>
          {widget.render({ attrs, rawAttrs: segment.attrs, context })}
        </DeckWidgetFrame>
      </DeckWidgetErrorBoundary>
    )
  } catch (error) {
    return (
      <DeckWidgetPlaceholder
        name={segment.name}
        position={display}
        reason={error instanceof Error ? error.message : "Widget failed"}
      />
    )
  }
}

function DeckWidgetFrame({ position, children }: { position: "block" | "inline"; children: ReactNode }) {
  if (position === "inline") {
    return <span data-testid="deck-widget-inline">{children}</span>
  }
  return <div data-testid="deck-widget-block">{children}</div>
}

function DeckWidgetPlaceholder({
  name,
  position,
  reason,
}: {
  name: string
  position: "block" | "inline"
  reason: string
}) {
  const content = (
    <span className="text-xs text-muted-foreground" data-testid="deck-widget-placeholder">
      {reason}: {name}
    </span>
  )
  return position === "inline" ? <span>{content}</span> : <div>{content}</div>
}

class DeckWidgetErrorBoundary extends Component<
  { name: string; position: "block" | "inline"; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    if (this.state.error) {
      return (
        <DeckWidgetPlaceholder
          name={this.props.name}
          position={this.props.position}
          reason={this.state.error.message || "Widget failed"}
        />
      )
    }
    return this.props.children
  }
}

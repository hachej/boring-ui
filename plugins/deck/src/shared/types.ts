import type { ReactNode } from "react"

export interface DeckError {
  type: "storage" | "parse" | "render" | "widget" | "conflict"
  path?: string
  message: string
  cause?: unknown
}

export interface DeckThemeOptions {
  aspectRatio?: "16:9" | "4:3"
  className?: string
  slideClassName?: string
}

export interface DeckWidgetRenderContext {
  path?: string
  slideIndex: number
  slideCount: number
  mode: "read" | "edit" | "present"
}

export interface DeckWidgetRenderProps<TAttrs = Record<string, string>> {
  attrs: TAttrs
  rawAttrs: Record<string, string>
  context: DeckWidgetRenderContext
}

export interface DeckWidgetDefinition<TAttrs = Record<string, string>> {
  name: string
  display?: "block" | "inline"
  parse?: (attrs: Record<string, string>) => TAttrs
  render: (props: DeckWidgetRenderProps<TAttrs>) => ReactNode
}

export interface CreateDeckPluginOptions {
  pathPrefix?: string
  widgets?: DeckWidgetDefinition[]
  theme?: DeckThemeOptions
  onError?: (error: DeckError) => void
}

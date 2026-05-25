import { cn, type PaneProps } from "@hachej/boring-workspace"
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type {
  DeckError,
  DeckSegment,
  DeckThemeOptions,
  DeckWidgetDefinition,
  ParsedDeck,
  ParsedSlide,
} from "../shared"
import * as deckParser from "../shared/parser"
import {
  DeckErrorState,
  DeckScaffoldState,
  DeckShell,
  DeckSlideFrame,
  DeckToolbar,
} from "./components"
import { DeckWidgetSlot, indexDeckWidgets } from "./widgets"

const DEFAULT_SCAFFOLD_CONTENT = `# Deck scaffold\n\nDeck rendering shell is ready. File-state wiring lands in a follow-up bead.`

export interface DeckPaneProps {
  params?: { path?: string }
  api?: PaneProps<{ path?: string }>["api"]
  containerApi?: PaneProps<{ path?: string }>["containerApi"]
  content?: string
  pathPrefix?: string
  theme?: DeckThemeOptions
  widgets?: DeckWidgetDefinition[]
  onError?: (error: DeckError) => void
  initialMode?: "read" | "present"
}

export function DeckPane({
  params,
  content = DEFAULT_SCAFFOLD_CONTENT,
  pathPrefix = "deck/",
  theme,
  widgets = [],
  onError,
  initialMode = "read",
}: DeckPaneProps) {
  const [mode, setMode] = useState<"read" | "present">(initialMode)
  const [slideIndex, setSlideIndex] = useState(0)
  const indexedWidgets = useMemo(() => indexDeckWidgets(widgets), [widgets])

  const parsed = useMemo<
    | { ok: true; deck: ParsedDeck }
    | { ok: false; error: DeckError }
  >(() => {
    try {
      return { ok: true, deck: deckParser.parseDeckMarkdown(content) }
    } catch (cause) {
      const error: DeckError = {
        type: "parse",
        path: params?.path,
        message: cause instanceof Error ? cause.message : "Failed to parse deck",
        cause,
      }
      return { ok: false, error }
    }
  }, [content, params?.path])

  useEffect(() => {
    if (!parsed.ok) onError?.(parsed.error)
  }, [onError, parsed])

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    setSlideIndex(0)
  }, [content, params?.path])

  if (!content) {
    return (
      <DeckShell theme={theme} presentMode={mode === "present"}>
        <DeckScaffoldState>
          Deck shell for {pathPrefix}
          {params?.path ? ` (${params.path})` : ""}
        </DeckScaffoldState>
      </DeckShell>
    )
  }

  if (!parsed.ok) {
    return (
      <DeckShell theme={theme} presentMode={mode === "present"}>
        <DeckErrorState title="Failed to render deck" description={parsed.error.message} />
      </DeckShell>
    )
  }

  const slides = parsed.deck.slides
  const safeIndex = Math.min(Math.max(slideIndex, 0), Math.max(slides.length - 1, 0))
  const currentSlide = slides[safeIndex]
  const title = parsed.deck.title ?? params?.path ?? "Deck"
  const presentMode = mode === "present"

  return (
    <DeckShell theme={theme} presentMode={presentMode}>
      <DeckToolbar
        title={title}
        presentMode={presentMode}
        slideIndex={safeIndex}
        slideCount={slides.length}
        canGoPrevious={safeIndex > 0}
        canGoNext={safeIndex < slides.length - 1}
        onPrevious={() => setSlideIndex((current) => Math.max(current - 1, 0))}
        onNext={() => setSlideIndex((current) => Math.min(current + 1, slides.length - 1))}
        onTogglePresentMode={() => setMode((current) => (current === "present" ? "read" : "present"))}
      />
      <DeckSlideFrame theme={theme}>
        <article
          className={cn("prose prose-slate max-w-none dark:prose-invert", presentMode && "text-base")}
          data-testid="deck-slide-content"
        >
          <DeckSlideContent
            slide={currentSlide}
            slideCount={slides.length}
            path={params?.path}
            mode={mode}
            widgets={indexedWidgets}
          />
        </article>
      </DeckSlideFrame>
    </DeckShell>
  )
}

interface DeckSlideContentProps {
  slide: ParsedSlide
  slideCount: number
  path?: string
  mode: "read" | "present"
  widgets: ReturnType<typeof indexDeckWidgets>
}

function DeckSlideContent({ slide, slideCount, path, mode, widgets }: DeckSlideContentProps) {
  const blocks: ReactNode[] = []
  let inlineRun: ReactNode[] = []
  let previousInlineSegment: ParsedSlide["segments"][number] | null = null

  const flushInlineRun = () => {
    if (inlineRun.length === 0) return
    blocks.push(
      <p key={`inline-run-${slide.index}-${blocks.length}`}>
        {inlineRun}
      </p>,
    )
    inlineRun = []
    previousInlineSegment = null
  }

  slide.segments.forEach((segment, index) => {
    const context = {
      path,
      slideIndex: slide.index,
      slideCount,
      mode,
    } as const

    if (segment.type === "markdown") {
      if (isInlineCompatibleMarkdown(segment.text)) {
        if (previousInlineSegment) {
          inlineRun.push(<span key={`inline-space-${slide.index}-${index}`}> </span>)
        }
        inlineRun.push(
          <InlineMarkdownSegment key={`inline-markdown-${slide.index}-${index}`} text={segment.text} />,
        )
        previousInlineSegment = segment
        return
      }

      flushInlineRun()
      blocks.push(<MarkdownSegment key={`markdown-${slide.index}-${index}`} text={segment.text} />)
      return
    }

    const widget = widgets.get(segment.name)
    const display = widget?.display ?? segment.position

    if (display === "inline") {
      if (previousInlineSegment) {
        inlineRun.push(<span key={`inline-space-${slide.index}-${index}`}> </span>)
      }
      inlineRun.push(
        <DeckWidgetSlot
          key={`widget-${slide.index}-${index}`}
          segment={segment}
          widgets={widgets}
          context={context}
        />,
      )
      previousInlineSegment = segment
      return
    }

    flushInlineRun()
    blocks.push(
      <DeckWidgetSlot
        key={`widget-${slide.index}-${index}`}
        segment={segment}
        widgets={widgets}
        context={context}
      />,
    )
  })

  flushInlineRun()

  return <div className="space-y-4" data-testid={`deck-slide-${slide.index}`}>{blocks}</div>
}

function MarkdownSegment({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
}

function InlineMarkdownSegment({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <Fragment>{children}</Fragment>,
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  )
}

function isInlineCompatibleMarkdown(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.includes("\n\n")) return false

  return !/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|~~~|\|)|^---$/m.test(trimmed)
}


export function renderDeckSegmentsForTest(slide: ParsedSlide): DeckSegment[] {
  return slide.segments
}

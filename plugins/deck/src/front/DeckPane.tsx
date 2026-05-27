import {
  cn,
  MarkdownEditor,
  useFilePane,
  type PaneProps,
} from "@hachej/boring-workspace"
import { Button } from "@hachej/boring-ui-kit"
import { ExternalLink } from "lucide-react"
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
  DeckNotice,
  DeckScaffoldState,
  DeckShell,
  DeckSlideFrame,
  DeckSlideRail,
  DeckToolbar,
} from "./components"
import { DeckWidgetSlot, indexDeckWidgets } from "./widgets"

const DEFAULT_SCAFFOLD_CONTENT = `# Deck scaffold\n\nDeck rendering shell is ready.`

function useDeckKeyboardNavigation({
  enabled,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
}: {
  enabled: boolean
  canGoPrevious: boolean
  canGoNext: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return
      }

      if ((event.key === "ArrowRight" || event.key === "PageDown") && canGoNext) {
        event.preventDefault()
        onNext()
        return
      }

      if ((event.key === "ArrowLeft" || event.key === "PageUp") && canGoPrevious) {
        event.preventDefault()
        onPrevious()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, canGoNext, canGoPrevious, onNext, onPrevious])
}

export interface DeckPaneProps {
  params?: { path?: string }
  api?: PaneProps<{ path?: string }>["api"]
  containerApi?: PaneProps<{ path?: string }> ["containerApi"]
  content?: string
  pathPrefix?: string
  theme?: DeckThemeOptions
  widgets?: DeckWidgetDefinition[]
  onError?: (error: DeckError) => void
  initialMode?: "read" | "edit" | "present"
  getPresentHref?: (path: string) => string
}

export function DeckPane(props: DeckPaneProps) {
  if (props.content === undefined && props.params?.path) {
    return <FileBackedDeckPane {...props} />
  }

  return (
    <DeckRenderedPane
      {...props}
      content={props.content ?? DEFAULT_SCAFFOLD_CONTENT}
      initialMode={props.initialMode === "edit" ? "read" : props.initialMode ?? "read"}
    />
  )
}

function DeckRenderedPane({
  params,
  content,
  pathPrefix = "deck/",
  theme,
  widgets = [],
  onError,
  initialMode = "read",
}: Omit<DeckPaneProps, "content" | "initialMode" | "getPresentHref"> & {
  content: string
  initialMode?: "read" | "present"
}) {
  const [mode, setMode] = useState<"read" | "present">(initialMode)
  const [slideIndex, setSlideIndex] = useState(0)
  const indexedWidgets = useMemo(() => indexDeckWidgets(widgets), [widgets])
  const parsed = useMemo(() => parseDeckContent(content, params?.path), [content, params?.path])

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

  useDeckKeyboardNavigation({
    enabled: true,
    canGoPrevious: safeIndex > 0,
    canGoNext: safeIndex < slides.length - 1,
    onPrevious: () => setSlideIndex((current) => Math.max(current - 1, 0)),
    onNext: () => setSlideIndex((current) => Math.min(current + 1, slides.length - 1)),
  })

  return (
    <DeckShell theme={theme} presentMode={presentMode}>
      <DeckToolbar
        title={title}
        path={params?.path}
        presentMode={presentMode}
        slideIndex={safeIndex}
        slideCount={slides.length}
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
      <DeckSlideRail
        slideIndex={safeIndex}
        slideCount={slides.length}
        canGoPrevious={safeIndex > 0}
        canGoNext={safeIndex < slides.length - 1}
        onPrevious={() => setSlideIndex((current) => Math.max(current - 1, 0))}
        onNext={() => setSlideIndex((current) => Math.min(current + 1, slides.length - 1))}
        onSelect={setSlideIndex}
      />
    </DeckShell>
  )
}

function FileBackedDeckPane({
  params,
  api,
  theme,
  widgets = [],
  onError,
  initialMode = "read",
  getPresentHref,
}: DeckPaneProps) {
  const path = params?.path ?? ""
  const hasSelectedPath = /\S/.test(path)
  const [mode, setMode] = useState<"read" | "edit" | "present">(initialMode)
  const [slideIndex, setSlideIndex] = useState(0)
  const indexedWidgets = useMemo(() => indexDeckWidgets(widgets), [widgets])
  const {
    content,
    conflict,
    error,
    fileName,
    isLoading,
    onOverwrite,
    onReloadFromServer,
    setContent,
    tabTitle,
  } = useFilePane({ path, panelId: api?.id })
  const parsed = useMemo(() => (content == null ? null : parseDeckContent(content, path)), [content, path])

  useEffect(() => {
    if (error) {
      onError?.({
        type: "storage",
        path,
        message: error.message,
        cause: error,
      })
    }
  }, [error, onError, path])

  useEffect(() => {
    if (conflict) {
      onError?.({
        type: "conflict",
        path,
        message: conflict.message,
        cause: conflict,
      })
    }
  }, [conflict, onError, path])

  useEffect(() => {
    if (parsed && !parsed.ok) onError?.(parsed.error)
  }, [onError, parsed])

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    setSlideIndex(0)
  }, [content, path])

  useEffect(() => {
    if (api && tabTitle) {
      api.setTitle(tabTitle)
    }
  }, [api, tabTitle])

  const deck = parsed && parsed.ok ? parsed.deck : null
  const fallbackContent = content ?? ""
  const slides = deck?.slides ?? [{ index: 0, raw: fallbackContent, segments: [{ type: "markdown" as const, text: fallbackContent }] }]
  const slideCount = slides.length
  const safeIndex = Math.min(Math.max(slideIndex, 0), Math.max(slideCount - 1, 0))
  const currentSlide = slides[safeIndex]
  const title = deck?.title ?? fileName ?? path
  const canNavigateSlides = mode !== "edit"
  const presentHref = getPresentHref && path ? getPresentHref(path) : null

  useDeckKeyboardNavigation({
    enabled: hasSelectedPath && !error && content != null && mode !== "edit",
    canGoPrevious: safeIndex > 0,
    canGoNext: safeIndex < slideCount - 1,
    onPrevious: () => setSlideIndex((current) => Math.max(current - 1, 0)),
    onNext: () => setSlideIndex((current) => Math.min(current + 1, slideCount - 1)),
  })

  if (!hasSelectedPath) {
    return (
      <DeckShell theme={theme}>
        <DeckScaffoldState>No deck file selected.</DeckScaffoldState>
      </DeckShell>
    )
  }

  if (isLoading && content == null) {
    return (
      <DeckShell theme={theme}>
        <DeckScaffoldState>Loading deck…</DeckScaffoldState>
      </DeckShell>
    )
  }

  if (error || content == null) {
    return (
      <DeckShell theme={theme}>
        <DeckErrorState title="Failed to load deck" description={error?.message ?? "Preview unavailable."} />
      </DeckShell>
    )
  }

  return (
    <DeckShell theme={theme} presentMode={mode === "present"}>
      <DeckToolbar
        title={title}
        path={path}
        mode={mode === "present" ? "read" : mode}
        onModeChange={setMode}
        presentMode={mode === "present"}
        slideIndex={safeIndex}
        slideCount={slideCount}
        onTogglePresentMode={mode === "edit" ? undefined : () => setMode((current) => (current === "present" ? "read" : "present"))}
        actions={
          <>
            {presentHref ? (
              <Button
                variant="ghost"
                size="icon-xs"
                asChild
                aria-label="Open in new tab"
                title="Open deck in new tab"
              >
                <a href={presentHref} target="_blank" rel="noopener noreferrer" data-testid="deck-open-present">
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ) : null}
          </>
        }
      />
      {conflict ? (
        <DeckNotice
          title="Deck changed on disk"
          description="Choose whether to reload the server version or overwrite it with your current draft."
          testId="deck-conflict-notice"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void onReloadFromServer()}
                data-testid="deck-reload"
              >
                Reload
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void onOverwrite()}
                data-testid="deck-overwrite"
              >
                Overwrite
              </Button>
            </>
          }
        />
      ) : null}
      {mode === "edit" ? (
        <div className="min-h-0 flex-1 overflow-hidden" data-testid="deck-edit-mode">
          {parsed && !parsed.ok ? (
            <DeckNotice
              title="Deck markdown has parse errors"
              description={parsed.error.message}
              tone="error"
              testId="deck-parse-notice"
            />
          ) : null}
          <MarkdownEditor
            content={content}
            onChange={setContent}
            documentPath={path}
            className="min-h-0 h-full"
          />
        </div>
      ) : parsed && !parsed.ok ? (
        <DeckErrorState title="Failed to render deck" description={parsed.error.message} />
      ) : (
        <DeckSlideFrame theme={theme}>
          <article
            className={cn("prose prose-slate max-w-none dark:prose-invert", mode === "present" && "text-base")}
            data-testid="deck-slide-content"
          >
            <DeckSlideContent
              slide={currentSlide}
              slideCount={slideCount}
              path={path}
              mode={mode === "present" ? "present" : "read"}
              widgets={indexedWidgets}
            />
          </article>
        </DeckSlideFrame>
      )}
      {mode !== "edit" ? (
        <DeckSlideRail
          slideIndex={safeIndex}
          slideCount={slideCount}
          canGoPrevious={canNavigateSlides && safeIndex > 0}
          canGoNext={canNavigateSlides && safeIndex < slideCount - 1}
          onPrevious={() => setSlideIndex((current) => Math.max(current - 1, 0))}
          onNext={() => setSlideIndex((current) => Math.min(current + 1, slideCount - 1))}
          onSelect={setSlideIndex}
        />
      ) : null}
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

  const flushInlineRun = () => {
    if (inlineRun.length === 0) return
    blocks.push(<p key={`inline-run-${slide.index}-${blocks.length}`}>{inlineRun}</p>)
    inlineRun = []
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
        inlineRun.push(
          <InlineMarkdownSegment key={`inline-markdown-${slide.index}-${index}`} text={segment.text} />,
        )
        return
      }

      flushInlineRun()
      blocks.push(<MarkdownSegment key={`markdown-${slide.index}-${index}`} text={segment.text} />)
      return
    }

    const widget = widgets.get(segment.name)
    const display = widget?.display ?? segment.position

    if (display === "inline") {
      inlineRun.push(
        <DeckWidgetSlot
          key={`widget-${slide.index}-${index}`}
          segment={segment}
          widgets={widgets}
          context={context}
        />,
      )
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

  return (
    <div className="space-y-4" data-testid={`deck-slide-${slide.index}`}>
      {blocks}
    </div>
  )
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

function parseDeckContent(
  content: string,
  path?: string,
): { ok: true; deck: ParsedDeck } | { ok: false; error: DeckError } {
  try {
    return { ok: true, deck: deckParser.parseDeckMarkdown(content) }
  } catch (cause) {
    return {
      ok: false,
      error: {
        type: "parse",
        path,
        message: cause instanceof Error ? cause.message : "Failed to parse deck",
        cause,
      },
    }
  }
}

export function renderDeckSegmentsForTest(slide: ParsedSlide): DeckSegment[] {
  return slide.segments
}

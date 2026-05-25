import { cn } from "@hachej/boring-workspace"
import type { ReactNode } from "react"
import type { DeckThemeOptions } from "../shared"

export interface DeckScaffoldStateProps {
  children: ReactNode
}

export function DeckScaffoldState({ children }: DeckScaffoldStateProps) {
  return <div className="p-4 text-sm text-muted-foreground">{children}</div>
}

export interface DeckErrorStateProps {
  title: string
  description: string
}

export function DeckErrorState({ title, description }: DeckErrorStateProps) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-6"
      data-testid="deck-error-state"
    >
      <div className="max-w-lg rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
        <div className="font-medium text-foreground">{title}</div>
        <div className="mt-1 text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}

export interface DeckShellProps {
  children: ReactNode
  theme?: DeckThemeOptions
  presentMode?: boolean
}

export function DeckShell({ children, theme, presentMode = false }: DeckShellProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-background text-foreground",
        presentMode && "min-h-screen bg-background",
        theme?.className,
      )}
      data-testid={presentMode ? "deck-shell-present" : "deck-shell-read"}
    >
      {children}
    </div>
  )
}

export interface DeckSlideFrameProps {
  children: ReactNode
  theme?: DeckThemeOptions
}

export function DeckSlideFrame({ children, theme }: DeckSlideFrameProps) {
  const aspectRatio = theme?.aspectRatio === "4:3" ? "4 / 3" : "16 / 9"
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
      <div
        className={cn(
          "flex w-full max-w-6xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm",
          theme?.slideClassName,
        )}
        data-testid="deck-slide-frame"
        style={{ aspectRatio }}
      >
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6 sm:p-10">{children}</div>
      </div>
    </div>
  )
}

export interface DeckToolbarProps {
  title?: string
  presentMode: boolean
  slideIndex: number
  slideCount: number
  canGoPrevious: boolean
  canGoNext: boolean
  onPrevious: () => void
  onNext: () => void
  onTogglePresentMode?: () => void
}

export function DeckToolbar({
  title,
  presentMode,
  slideIndex,
  slideCount,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onTogglePresentMode,
}: DeckToolbarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {title || "Deck"}
        </div>
        <div className="text-xs text-muted-foreground">
          Slide {slideIndex + 1} of {slideCount}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canGoPrevious}
          onClick={onPrevious}
          data-testid="deck-prev"
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canGoNext}
          onClick={onNext}
          data-testid="deck-next"
        >
          Next
        </button>
        {onTogglePresentMode ? (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground"
            onClick={onTogglePresentMode}
            data-testid="deck-toggle-present"
          >
            {presentMode ? "Exit present" : "Present"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

import { cn } from "@hachej/boring-workspace"
import { Button, SegmentedControl, SegmentedControlItem, Separator } from "@hachej/boring-ui-kit"
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react"
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
        "deck-root flex min-h-0 flex-1 flex-col bg-background text-foreground",
        presentMode && "min-h-screen bg-background",
        theme?.className,
      )}
      data-testid={presentMode ? "deck-shell-present" : "deck-shell-read"}
    >
      {children}
      <style>{`
        .deck-root { --deck-accent: oklch(0.62 0.14 65); }
        .dark .deck-root { --deck-accent: oklch(0.76 0.16 68); }
        .deck-slide-frame-shell {
          animation: deck-slide-enter 240ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes deck-slide-enter {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .deck-slide-frame-shell { animation: none; }
        }
      `}</style>
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
          "deck-slide-frame-shell flex w-full max-w-6xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_0_oklch(from_var(--foreground)_l_c_h/0.04),0_24px_60px_-30px_oklch(from_var(--foreground)_l_c_h/0.45)]",
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
  path?: string
  mode?: "read" | "edit"
  onModeChange?: (mode: "read" | "edit") => void
  presentMode: boolean
  slideIndex: number
  slideCount: number
  onTogglePresentMode?: () => void
  actions?: ReactNode
}

export function DeckToolbar({
  title,
  path,
  mode,
  onModeChange,
  presentMode,
  slideIndex,
  slideCount,
  onTogglePresentMode,
  actions,
}: DeckToolbarProps) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/60 px-4 py-2 backdrop-blur-[2px]">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--deck-accent)]">
          Deck
        </span>
        <span className="truncate text-[13px] font-medium tracking-tight text-foreground">
          {title || "Deck"}
        </span>
        {path ? (
          <span className="hidden truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
            {path}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onModeChange ? (
          <SegmentedControl aria-label="Deck mode" className="bg-background">
            {(["read", "edit"] as const).map((nextMode) => (
              <SegmentedControlItem
                key={nextMode}
                type="button"
                selected={mode === nextMode}
                onClick={() => onModeChange(nextMode)}
                aria-pressed={mode === nextMode}
                className="px-2.5 py-1 text-[11px]"
                data-testid={nextMode === "read" ? "deck-mode-read" : "deck-mode-edit"}
              >
                {nextMode === "read" ? "Read" : "Edit"}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        ) : null}

        {actions}

        {slideCount > 0 ? (
          <span className="hidden font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground sm:inline">
            Slide {slideIndex + 1} of {slideCount}
          </span>
        ) : null}

        {onTogglePresentMode ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onTogglePresentMode}
            aria-label={presentMode ? "Exit present mode" : "Present"}
            title={presentMode ? "Exit present mode" : "Present"}
            data-testid="deck-toggle-present"
          >
            {presentMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        ) : null}
      </div>
    </header>
  )
}

export interface DeckSlideRailProps {
  slideIndex: number
  slideCount: number
  canGoPrevious: boolean
  canGoNext: boolean
  onPrevious: () => void
  onNext: () => void
  onSelect?: (slideIndex: number) => void
}

export function DeckSlideRail({
  slideIndex,
  slideCount,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onSelect,
}: DeckSlideRailProps) {
  if (slideCount <= 1) return null

  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-background/60 px-4 py-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onPrevious}
        disabled={!canGoPrevious}
        aria-label="Previous slide"
        data-testid="deck-prev"
      >
        <ChevronLeft className="size-3.5" />
        Prev
      </Button>

      <div className="flex flex-1 items-center justify-center gap-2.5">
        <span className="font-mono text-[11px] tabular-nums tracking-tight text-foreground">
          {String(slideIndex + 1).padStart(2, "0")}
        </span>
        <div
          role="group"
          aria-label="Slide navigation"
          className="flex max-w-[60%] flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {Array.from({ length: slideCount }, (_, index) => {
            const isActive = index === slideIndex
            const label = `Slide ${index + 1}`
            return (
              <Button
                key={index}
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-current={isActive ? "true" : undefined}
                aria-label={label}
                onClick={() => onSelect?.(index)}
                className="group flex flex-1 min-w-[28px] max-w-[56px] cursor-pointer items-center justify-center px-0.5 py-2.5"
              >
                <span className="sr-only">{label}</span>
                <span
                  aria-hidden
                  className={cn(
                    "block h-1 w-full rounded-full transition-colors",
                    isActive
                      ? "bg-[color:var(--deck-accent)]"
                      : "bg-border group-hover:bg-muted-foreground/40 group-focus-visible:bg-muted-foreground/40",
                  )}
                />
              </Button>
            )
          })}
        </div>
        <span className="font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
          {String(slideCount).padStart(2, "0")}
        </span>
      </div>

      <Separator orientation="vertical" className="!h-5" />

      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label="Next slide"
        data-testid="deck-next"
      >
        Next
        <ChevronRight className="size-3.5" />
      </Button>
    </footer>
  )
}

export interface DeckNoticeProps {
  title: string
  description: string
  actions?: ReactNode
  tone?: "warning" | "error"
  testId?: string
}

export function DeckNotice({
  title,
  description,
  actions,
  tone = "warning",
  testId,
}: DeckNoticeProps) {
  return (
    <div
      className={cn(
        "mx-3 mt-3 rounded-xl border p-3 text-sm",
        tone === "error" ? "border-destructive/20 bg-destructive/5" : "border-amber-500/20 bg-amber-500/5",
      )}
      data-testid={testId}
    >
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 text-muted-foreground">{description}</div>
      {actions ? <div className="mt-3 flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

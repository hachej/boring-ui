/**
 * Shared presentational status banner rendered above the composer. It owns the
 * three visual tones (running / success / error) and nothing else — no state,
 * no timers, no domain copy. Callers map their own state onto these props and
 * own any auto-dismiss timing.
 *
 * Used by:
 *  - `PluginUpdateStatus` — the `/reload` banner (restart warnings + diagnostics
 *    passed as `children`).
 *  - `CommandRunStatus` — server slash-command runs (e.g. `/open-<plugin>`).
 *
 * Keeping a single component here means both surfaces stay visually identical:
 * a server command and a reload report through the same status bar.
 */
import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib"

export type ComposerStatusTone = "running" | "success" | "error"

export interface ComposerStatusBannerProps {
  tone: ComposerStatusTone
  /**
   * Full data attribute name (e.g. "data-boring-plugin-update"). Its value is
   * set to the tone so existing selectors like
   * `[data-boring-plugin-update="success"]` keep working.
   */
  dataAttribute: string
  /** running tone: inline content next to the pulse. */
  runningContent?: ReactNode
  /** success/error tone: the bold title line. */
  title?: ReactNode
  /** success tone: optional muted detail line under the title. */
  detail?: ReactNode
  /** error tone: monospace body (the failure message). */
  message?: ReactNode
  /** Extra content rendered below the success header (diagnostics/warnings). */
  children?: ReactNode
  onDismiss?: () => void
  onRetry?: () => void
  retryLabel?: string
  dismissAriaLabel?: string
  maxWidthClassName?: string
}

export function ComposerStatusBanner({
  tone,
  dataAttribute,
  runningContent,
  title,
  detail,
  message,
  children,
  onDismiss,
  onRetry,
  retryLabel = "Try again",
  dismissAriaLabel = "Dismiss status",
  maxWidthClassName = "max-w-3xl",
}: ComposerStatusBannerProps): ReactElement {
  const toneAttr = { [dataAttribute]: tone }

  if (tone === "running") {
    return (
      <div
        {...toneAttr}
        role="status"
        aria-live="polite"
        className={cn(
          "mx-auto mb-2 w-full rounded-[var(--radius-md)] border border-accent/30 bg-[color:var(--accent-soft)]",
          "px-3 py-2 text-xs text-foreground flex items-center gap-2",
          maxWidthClassName,
        )}
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        <span>{runningContent}</span>
      </div>
    )
  }

  if (tone === "success") {
    return (
      <div
        {...toneAttr}
        role="status"
        aria-live="polite"
        className={cn(
          "mx-auto mb-2 w-full rounded-[var(--radius-md)] border border-[oklch(0.78_0.13_148)]/35 bg-[oklch(0.95_0.05_148/0.28)]",
          "px-3 py-2 text-xs text-foreground shadow-sm",
          maxWidthClassName,
        )}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-[oklch(0.45_0.13_148)]" aria-hidden="true">✓</span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-5">{title}</span>
            {detail ? <span className="block leading-4 text-muted-foreground">{detail}</span> : null}
          </span>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="-mr-1 rounded border border-transparent px-1.5 py-0.5 text-[13px] leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={dismissAriaLabel}
            >
              ×
            </button>
          ) : null}
        </div>
        {children}
      </div>
    )
  }

  return (
    <div
      {...toneAttr}
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto mb-2 w-full rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10",
        "px-3 py-2 text-xs text-foreground",
        maxWidthClassName,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-destructive" aria-hidden="true">⚠</span>
        <span className="flex-1 font-medium">{title}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-destructive/40 px-2 py-0.5 text-[11px] font-medium hover:bg-destructive/10"
          >
            {retryLabel}
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-transparent px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={dismissAriaLabel}
          >
            Dismiss
          </button>
        ) : null}
      </div>
      {message ? (
        <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-destructive/90">{message}</pre>
      ) : null}
    </div>
  )
}

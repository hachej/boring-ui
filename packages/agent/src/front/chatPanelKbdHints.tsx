import { cn } from './lib'

/**
 * Keyboard hint chips rendered between the left-side actions and the
 * send button. Small, muted, ornamental — pure discoverability aid.
 * Hidden on narrow widths so the composer doesn't feel crowded.
 */
export function KbdHints() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden items-center gap-1.5 text-[11px] text-muted-foreground/80",
        "sm:flex",
      )}
    >
      <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-sm)] border border-border/60 bg-background/60 px-1 font-mono text-[10px]">
        ↵
      </kbd>
      <span>send</span>
      <span className="text-muted-foreground/30">·</span>
      <kbd className="inline-flex h-[18px] items-center rounded-[var(--radius-sm)] border border-border/60 bg-background/60 px-1 font-mono text-[10px]">
        ⇧↵
      </kbd>
      <span>new line</span>
    </div>
  )
}

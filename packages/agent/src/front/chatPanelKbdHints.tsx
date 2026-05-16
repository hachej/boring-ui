import { cn } from './lib'

/**
 * Keyboard hint chip — single subtle kbd badge near the send button.
 * Hidden on narrow widths. Just the key, no prose.
 */
export function KbdHints() {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "hidden h-5 items-center rounded-[var(--radius-sm)] border border-border/50 bg-background/50 px-1 font-mono text-[10px] text-muted-foreground/50",
        "sm:inline-flex",
      )}
    >
      ↵
    </kbd>
  )
}

import { cn } from './lib'

/**
 * Keyboard hint — shows the non-obvious shortcut (shift+enter for newline).
 * Enter-to-send is obvious; this is the discoverability aid people actually need.
 */
export function KbdHints() {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "hidden h-5 items-center gap-0.5 rounded-[var(--radius-sm)] border border-border/50",
        "bg-background/50 px-1.5 font-mono text-[10px] text-muted-foreground/40",
        "sm:inline-flex",
      )}
    >
      <span className="not-mono text-[9px]">⇧</span>↵
    </kbd>
  )
}

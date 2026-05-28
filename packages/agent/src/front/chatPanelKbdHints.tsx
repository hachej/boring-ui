import { Kbd } from '@hachej/boring-ui-kit'
import { cn } from './lib'

/**
 * Keyboard hint — shows the non-obvious shortcut (shift+enter for newline).
 * Enter-to-send is obvious; this is the discoverability aid people actually need.
 */
export function KbdHints() {
  return (
    <Kbd
      aria-hidden="true"
      title="Shift + Enter for newline"
      className={cn(
        "hidden gap-0.5 border-border/60 bg-muted/40 leading-none shadow-none",
        "sm:inline-flex",
      )}
    >
      <span className="not-mono text-[9px]">⇧</span>↵
    </Kbd>
  )
}

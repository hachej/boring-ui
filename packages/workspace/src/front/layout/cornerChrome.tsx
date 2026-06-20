"use client"

import type { ReactNode } from "react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ControlTooltip } from "../components/ControlTooltip"
import { cn } from "../lib/utils"

/**
 * Shared fixed-position corner chrome control.
 *
 * Design-system contract (see `.impeccable.md`):
 * - Sized to the in-header chrome family: `IconButton size="icon-xs"` → 24px
 *   button, `rounded-md` (8px, ramp step), 12px icon at stroke 1.75. This
 *   matches WorkbenchCloseAction / session-list header buttons so the corner
 *   controls read as part of the same family, not a larger foreign element.
 * - Opaque `bg-muted` (one lightness step above `--background`) + 1px `border`
 *   for separation. No glassmorphism blur, no soft drop shadows (design
 *   system: "separation via borders and opacity, not big elevation jumps";
 *   "no glassmorphism blur for chrome"). The muted fill lifts the control off
 *   same-background content without an elevation jump.
 * - Resting `text-muted-foreground` so chrome recedes; hover/pressed lift to
 *   `text-foreground` on a darker fill (`bg-foreground/[0.06]` →
 *   `bg-foreground/[0.09]`) — a monotonic step, no shadow.
 * - Vertical position is set per-corner at the call site so each control
 *   centers in its own header band (44px workbench strip / 61px app-nav
 *   header), since those bands have different heights.
 * - Visible focus ring is provided by the `IconButton` base
 *   (`focus-visible:ring-[3px] ring-ring/50`) — keyboard-accessible by default.
 *
 * Used by the top-right workbench/chat toggles (`ChatLayout`) and the top-left
 * app-navigation toggle (`PluginTabsWorkspaceShell`). One component = one
 * family, no drift.
 */

const CORNER_CHROME_CLASS =
  "pointer-events-auto relative border border-border/70 bg-muted text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"

const CORNER_CHROME_PRESSED_CLASS =
  "border-border bg-foreground/[0.09] text-foreground"

export function CornerChromeButton({
  label,
  hint,
  side = "bottom",
  onClick,
  pressed,
  pulse = false,
  children,
}: {
  label: string
  hint?: string
  side?: "top" | "bottom" | "left" | "right"
  onClick: () => void
  pressed: boolean
  pulse?: boolean
  children: ReactNode
}) {
  return (
    <ControlTooltip label={label} hint={hint} side={side}>
      <IconButton
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        title={label}
        className={cn(
          CORNER_CHROME_CLASS,
          pressed && CORNER_CHROME_PRESSED_CLASS,
        )}
      >
        {children}
        {pulse ? (
          <span
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[color:var(--accent)] ring-1 ring-background"
            aria-hidden="true"
          />
        ) : null}
      </IconButton>
    </ControlTooltip>
  )
}
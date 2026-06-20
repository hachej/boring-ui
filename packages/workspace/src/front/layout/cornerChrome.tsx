"use client"

import type { ReactNode } from "react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ControlTooltip } from "../components/ControlTooltip"
import { cn } from "../lib/utils"

/**
 * Shared fixed-position corner chrome control.
 *
 * Design-system contract (see `.impeccable.md`):
 * - Opaque `bg-muted` (one lightness step above `--background`) + 1px `border`
 *   for separation. No glassmorphism blur, no soft drop shadows (design
 *   system: "separation via borders and opacity, not big elevation jumps";
 *   "no glassmorphism blur for chrome"). The muted fill lifts the control off
 *   same-background content without an elevation jump.
 * - `rounded-lg` (ramp step) — matches the sibling `FloatingEdgeButton` rail
 *   controls so all corner chrome reads as one family.
 * - 36px hit target (`!h-9 !w-9`), resting `text-muted-foreground` so chrome
 *   recedes; hover/pressed lift to `text-foreground` on a darker fill
 *   (`bg-foreground/[0.06]` → `bg-foreground/[0.09]`) — a monotonic step, no shadow.
 * - Visible focus ring is provided by the `IconButton` base
 *   (`focus-visible:ring-[3px] ring-ring/50`) — keyboard-accessible by default.
 *
 * Used by the top-right workbench/chat toggles (`ChatLayout`) and the top-left
 * app-navigation toggle (`PluginTabsWorkspaceShell`). One component = one
 * family, no drift.
 */

const CORNER_CHROME_CLASS =
  "pointer-events-auto relative !h-9 !w-9 rounded-lg border border-border/70 bg-muted text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"

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
        size="icon-sm"
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
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[color:var(--accent)] ring-2 ring-background"
            aria-hidden="true"
          />
        ) : null}
      </IconButton>
    </ControlTooltip>
  )
}
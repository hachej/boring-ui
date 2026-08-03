"use client"

import type { ReactNode } from "react"
import { IconButton } from "@hachej/boring-ui-kit"
import { ControlTooltip } from "../components/ControlTooltip"
import { cn } from "../lib/utils"

const CORNER_CHROME_CLASS =
  "pointer-events-auto relative border border-border/70 bg-muted text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"

const CORNER_CHROME_PRESSED_CLASS =
  "border-border bg-foreground/[0.09] text-foreground"

const CHAT_CHROME_CLASS =
  "border-transparent bg-transparent hover:bg-muted/70"

export function CornerChromeButton({
  label,
  hint,
  side = "bottom",
  onClick,
  pressed,
  disabled = false,
  appearance = "default",
  pulse = false,
  children,
}: {
  label: string
  hint?: string
  side?: "top" | "bottom" | "left" | "right"
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  appearance?: "default" | "chat"
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
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed === undefined ? undefined : pressed}
        title={label}
        className={cn(
          CORNER_CHROME_CLASS,
          appearance === "chat" && CHAT_CHROME_CLASS,
          pressed && CORNER_CHROME_PRESSED_CLASS,
          disabled && "cursor-not-allowed opacity-50 hover:bg-muted hover:text-muted-foreground",
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

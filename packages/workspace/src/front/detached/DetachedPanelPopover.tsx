"use client"

import { Maximize2, X } from "lucide-react"
import { cn } from "../lib/utils"
import type { DetachedPanelPopoverProps } from "./detachedPanelTypes"
import { useDetachedPanelPosition } from "./useDetachedPanelPosition"

export function DetachedPanelPopover({
  title,
  subtitle,
  icon,
  initialPosition,
  size,
  ariaLabel,
  onClose,
  onDock,
  children,
  footer,
}: DetachedPanelPopoverProps) {
  const { position, size: resolvedSize, startDrag } = useDetachedPanelPosition(initialPosition, size)
  return (
    <div
      data-boring-workspace-part="detached-panel-popover"
      className="absolute z-[90] flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
      style={{
        left: position.left,
        top: position.top,
        width: `min(${resolvedSize.width}px, calc(100vw - 2rem))`,
        height: `min(${resolvedSize.height}px, calc(100vh - 2rem))`,
      }}
      role="dialog"
      aria-label={ariaLabel}
    >
      <div
        className="flex h-11 shrink-0 cursor-grab items-center justify-between border-b border-border/60 bg-[color:oklch(from_var(--background)_calc(l-0.01)_c_h)] px-3 active:cursor-grabbing"
        onPointerDown={startDrag}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="grid size-7 place-items-center rounded-lg bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-[color:var(--accent)]">{icon}</span> : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</div>
            {subtitle ? <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onDock ? (
            <button
              type="button"
              aria-label="Dock panel"
              title="Dock"
              className={cn("grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40")}
              onClick={onDock}
            >
              <Maximize2 className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close panel"
            title="Close"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={onClose}
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {footer ? <div className="shrink-0 border-t border-border/60">{footer}</div> : null}
    </div>
  )
}

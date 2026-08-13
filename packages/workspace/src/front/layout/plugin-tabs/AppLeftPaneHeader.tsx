"use client"

import type { ReactNode } from "react"

export function AppLeftPaneHeader({
  appTitle,
  workspaceLabel,
  topSlot,
  showBrand = true,
}: {
  appTitle?: string
  workspaceLabel?: string
  topSlot?: ReactNode
  showBrand?: boolean
}) {
  const title = appTitle || "Boring UI"
  const workspace = topSlot ?? (!showBrand && workspaceLabel ? <span className="truncate">{workspaceLabel}</span> : null)

  return (
    <div className="flex h-[50px] shrink-0 items-center border-b border-border/50 px-2 pr-3" data-boring-workspace-part="app-left-header">
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-10">
        {showBrand ? (
          <>
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background"
            >
              {(title[0] ?? "B").toUpperCase()}
            </span>
            <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground" data-boring-workspace-part="app-left-pane-brand">
              {title}
            </span>
          </>
        ) : null}
        {workspace ? (
          <div
            className={showBrand
              ? "ml-auto min-w-0 max-w-[45%] truncate text-right text-[11px] font-normal text-muted-foreground"
              : "min-w-0 flex-1 text-left text-[11px] font-normal text-muted-foreground"}
            data-boring-workspace-part="app-left-pane-workspace"
          >
            {workspace}
          </div>
        ) : null}
      </div>
    </div>
  )
}

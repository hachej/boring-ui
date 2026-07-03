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

  return (
    <div className="shrink-0 px-2 pb-2 pt-2">
      {showBrand ? (
        <div className="flex h-8 min-w-0 items-center gap-2 pr-1" style={{ paddingLeft: "2.5rem" }}>
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-foreground text-[12px] font-semibold text-background"
          >
            {(title[0] ?? "B").toUpperCase()}
          </span>
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground" data-boring-workspace-part="app-left-pane-brand">
            {title}
          </span>
        </div>
      ) : null}
      {topSlot ? (
        <div
          className={showBrand ? "mt-1 min-w-0" : "min-w-0 pr-1"}
          style={showBrand ? undefined : { paddingLeft: "2.5rem" }}
          data-boring-workspace-part="app-left-pane-workspace"
        >
          {topSlot}
        </div>
      ) : workspaceLabel ? (
        <div
          className="mt-0.5 flex min-h-8 items-center gap-2 rounded-md px-2 text-[13px] text-foreground/72"
          data-boring-workspace-part="app-left-pane-workspace"
        >
          <span className="truncate">{workspaceLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

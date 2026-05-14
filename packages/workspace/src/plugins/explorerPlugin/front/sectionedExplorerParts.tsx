"use client"

import type { DragEvent, KeyboardEvent } from "react"
import type { Badge, DragPayload, ExplorerRow, Facets } from "../../../front/components/DataExplorer"
import { cn } from "../../../front/lib/utils"
import type { ExplorerSectionFilter } from "./index"

export function SectionFilters({
  configs,
  facets,
  selected,
  onToggle,
}: {
  configs: ExplorerSectionFilter[]
  facets: Facets
  selected: Record<string, string[]>
  onToggle: (key: string, value: string) => void
}) {
  if (!configs.length) return null
  return (
    <div className="space-y-1 px-7 py-1">
      {configs.map((config) => {
        const values = facets[config.key] ?? config.values ?? []
        if (!values.length) return null
        return (
          <div key={config.key} className="flex flex-wrap gap-1">
            {values.map((value) => {
              const active = selected[config.key]?.includes(value.value) ?? false
              const label = config.formatValue ? config.formatValue(value.value) : value.value
              return (
                <button
                  key={value.value}
                  type="button"
                  onClick={() => onToggle(config.key, value.value)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10.5px] transition-colors",
                    active
                      ? "border-foreground/30 bg-foreground/10 text-foreground"
                      : "border-border/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  <span className="ml-1 font-mono opacity-70">{value.count}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function ExplorerRowItem({
  row,
  indent,
  onActivate,
  getDragPayload,
}: {
  row: ExplorerRow
  indent?: boolean
  onActivate?: (row: ExplorerRow) => void
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
}) {
  const interactive = !!onActivate
  const payload = getDragPayload?.(row)

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!interactive) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onActivate?.(row)
    }
  }

  const handleDragStart = (event: DragEvent<HTMLLIElement>) => {
    if (!payload) return
    event.dataTransfer.setData(payload.mimeType, payload.value)
    event.dataTransfer.setData("text/plain", payload.value)
    event.dataTransfer.effectAllowed = "copy"
  }

  return (
    <li
      {...(interactive
        ? { role: "button", tabIndex: 0, onClick: () => onActivate?.(row), onKeyDown: handleKeyDown }
        : {})}
      {...(payload ? { draggable: true, onDragStart: handleDragStart } : {})}
      className={cn(
        "group mx-1 flex items-start gap-2 rounded-md px-1.5 py-1",
        "transition-colors duration-120 ease-[cubic-bezier(0.22,1,0.36,1)]",
        interactive && "cursor-pointer hover:bg-foreground/5",
        indent && "pl-7",
      )}
      title={row.title}
    >
      {row.leading ? <ExplorerChip badge={row.leading} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] font-medium leading-tight text-foreground">
          {row.title}
        </span>
        {row.subtitle ? (
          <span className="truncate text-[11.5px] leading-snug text-muted-foreground/85">
            {row.subtitle}
          </span>
        ) : null}
      </span>
      {row.trailing?.length ? (
        <span className="flex shrink-0 items-center gap-1">
          {row.trailing.map((badge, index) => (
            <ExplorerChip key={index} badge={badge} />
          ))}
        </span>
      ) : null}
      {row.meta ? (
        <span className="shrink-0 self-center font-mono text-[10.5px] text-muted-foreground/80">
          {row.meta}
        </span>
      ) : null}
    </li>
  )
}

export function ExplorerChip({ badge }: { badge: Badge }) {
  return (
    <span
      aria-hidden="true"
      title={badge.tooltip}
      className="mt-[1px] inline-flex h-[16px] min-w-[24px] shrink-0 items-center justify-center rounded-[3px] bg-muted/60 px-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground group-hover:text-foreground"
    >
      {badge.code}
    </span>
  )
}

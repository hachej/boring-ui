import { cn } from "../../lib/utils"

export interface DataSource {
  id: string
  name: string
  type: string
  description?: string
}

export interface DataCatalogProps {
  sources: DataSource[]
  onSelect?: (sourceId: string) => void
  className?: string
}

const TYPE_LABELS: Record<string, string> = {
  table: "TBL",
  view: "VW",
  stream: "STR",
  index: "IDX",
}

export function DataCatalog({ sources, onSelect, className }: DataCatalogProps) {
  if (sources.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center p-6 text-[12px] text-muted-foreground", className)}>
        No data sources
      </div>
    )
  }

  return (
    <ul className={cn("flex flex-col px-1 py-1", className)}>
      {sources.map((source) => {
        const interactive = Boolean(onSelect)
        const label = TYPE_LABELS[source.type] ?? source.type.slice(0, 3).toUpperCase()
        return (
          <li
            key={source.id}
            className={cn(
              "group mx-1 flex items-start gap-2.5 rounded-md px-2 py-1.5",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              interactive && "cursor-pointer hover:bg-foreground/5",
            )}
            {...(interactive
              ? {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => onSelect?.(source.id),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelect?.(source.id)
                    }
                  },
                }
              : {})}
          >
            <span
              aria-hidden="true"
              className="mt-[2.5px] inline-flex h-[17px] min-w-[26px] items-center justify-center rounded-[3px] bg-muted/60 px-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground group-hover:text-foreground"
            >
              {label}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="truncate text-[13.5px] font-medium leading-tight text-foreground">
                {source.name}
              </span>
              {source.description && (
                <span className="truncate text-[12px] leading-snug text-muted-foreground/85">
                  {source.description}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

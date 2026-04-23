import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card"
import { Badge } from "./ui/badge"
import { cn } from "../lib/utils"

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

export function DataCatalog({ sources, onSelect, className }: DataCatalogProps) {
  if (sources.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center text-muted-foreground", className)}>
        <p>No data sources</p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-3 p-4", className)}>
      {sources.map((source) => (
        <Card
          key={source.id}
          className={cn(
            "transition-colors",
            onSelect && "cursor-pointer hover:bg-accent/50",
          )}
          {...(onSelect
            ? {
                role: "button",
                tabIndex: 0,
                onClick: () => onSelect(source.id),
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect(source.id)
                  }
                },
              }
            : {})}
        >
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">{source.name}</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {source.type}
              </Badge>
            </div>
            {source.description && (
              <CardDescription>{source.description}</CardDescription>
            )}
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

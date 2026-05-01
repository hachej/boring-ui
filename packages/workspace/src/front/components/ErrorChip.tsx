import { AlertTriangleIcon } from "lucide-react"

export interface ErrorChipProps {
  pluginId: string
  message: string
  kind: "panel" | "catalog-row" | "chat-suggestion"
}

export function ErrorChip({ pluginId, message, kind }: ErrorChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 truncate">
        <span className="font-medium">[{pluginId}]</span>{" "}
        {kind} error: {message}
      </span>
    </div>
  )
}

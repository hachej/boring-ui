import { AlertTriangleIcon } from "lucide-react"
import { Notice } from "@hachej/boring-ui-kit"

export interface ErrorChipProps {
  pluginId: string
  message: string
  kind: "panel" | "workspace-source" | "catalog-row" | "chat-suggestion"
}

export function ErrorChip({ pluginId, message, kind }: ErrorChipProps) {
  return (
    <Notice
      tone="error"
      icon={<AlertTriangleIcon className="size-4" />}
      className="py-2"
      description={
        <span className="block min-w-0 truncate">
          <span className="font-medium">[{pluginId}]</span>{" "}
          {kind} error: {message}
        </span>
      }
    />
  )
}

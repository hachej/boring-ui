import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  RadioIcon,
  RefreshCwIcon,
} from "lucide-react"
import { cn } from "../../../../front/lib/utils"
import type { FilePaneDocumentStatus } from "../fileDocumentStatus"

interface StatusPresentation {
  label: string
  tone: string
  icon: typeof CheckCircle2Icon
}

function documentStatusPresentation(status: FilePaneDocumentStatus): StatusPresentation {
  switch (status.kind) {
    case "fallback":
      return { label: "Watching for file changes", tone: "text-muted-foreground", icon: RadioIcon }
    case "checking":
      return { label: "Checking for updates…", tone: "text-muted-foreground", icon: RefreshCwIcon }
    case "updated":
      return {
        label: status.source === "agent" ? "Updated by agent" : "Updated from disk",
        tone: "text-emerald-600 dark:text-emerald-400",
        icon: CheckCircle2Icon,
      }
    case "conflict":
      return {
        label: status.source === "agent"
          ? "Agent update conflicts with your edits"
          : "Disk update conflicts with your edits",
        tone: "text-amber-700 dark:text-amber-400",
        icon: AlertTriangleIcon,
      }
    case "resolved":
      return {
        label: status.action === "reloaded" ? "Reloaded from disk" : "Overwrote disk version",
        tone: "text-emerald-600 dark:text-emerald-400",
        icon: CheckCircle2Icon,
      }
  }
}

export function MarkdownDocumentFooter({
  status,
  wordCountLabel,
}: {
  status?: FilePaneDocumentStatus | null
  wordCountLabel: string
}) {
  const presentation = status ? documentStatusPresentation(status) : null
  const StatusIcon = presentation?.icon

  return (
    <div className="flex items-center justify-end gap-3 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
      {presentation && StatusIcon && (
        <span
          role="status"
          aria-live="polite"
          data-testid="markdown-document-status"
          className={cn("flex min-w-0 items-center gap-1.5", presentation.tone)}
          title={presentation.label}
        >
          <StatusIcon
            className={cn("size-3 shrink-0", status?.kind === "checking" && "animate-spin")}
            aria-hidden
          />
          <span className="truncate">{presentation.label}</span>
        </span>
      )}
      <span className="shrink-0" data-testid="markdown-word-count">
        {wordCountLabel}
      </span>
    </div>
  )
}

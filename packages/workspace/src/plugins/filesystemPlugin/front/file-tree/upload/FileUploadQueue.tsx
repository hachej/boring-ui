import { useMemo, useState } from "react"
import { Button, IconButton } from "@hachej/boring-ui-kit"
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react"
import type { UploadQueueRow, UploadStatus } from "./uploadTypes"

export function FileUploadQueue({
  rows,
  onRetry,
  onDismiss,
}: {
  rows: UploadQueueRow[]
  onRetry: (row: UploadQueueRow) => void
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const counts = useMemo(() => rows.reduce(
    (value, row) => ({ ...value, [row.status]: value[row.status] + 1 }),
    { queued: 0, uploading: 0, done: 0, failed: 0, skipped: 0, canceled: 0 } as Record<UploadStatus, number>,
  ), [rows])
  const active = counts.queued + counts.uploading > 0
  const summary = active
    ? `Uploading ${counts.uploading + counts.done + counts.failed + counts.skipped + counts.canceled} of ${rows.length}`
    : counts.failed > 0
      ? `${counts.failed} failed`
      : counts.canceled > 0 && counts.done === 0 && counts.skipped === 0
        ? `${counts.canceled} canceled`
        : counts.skipped > 0 && counts.done === 0 && counts.canceled === 0
          ? `${counts.skipped} skipped`
          : [
              `${counts.done} uploaded`,
              counts.skipped > 0 ? `${counts.skipped} skipped` : "",
              counts.canceled > 0 ? `${counts.canceled} canceled` : "",
            ].filter(Boolean).join(", ")

  if (rows.length === 0) return null
  return (
    <section className="shrink-0 border-t bg-background" aria-label="File upload queue">
      <div className="flex h-8 items-center gap-1 px-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-xs font-medium"
          aria-expanded={expanded}
          aria-controls="file-upload-queue-rows"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronUpIcon className="size-3.5" />}
          <span className="truncate" aria-live="polite">{summary}</span>
        </Button>
        {!active && (
          <IconButton type="button" variant="ghost" size="icon-xs" aria-label="Dismiss upload queue" onClick={onDismiss}>
            <XIcon className="size-3.5" />
          </IconButton>
        )}
      </div>
      {expanded && (
        <div id="file-upload-queue-rows" className="max-h-40 overflow-y-auto border-t px-2 py-1">
          {rows.map((row) => (
            <div key={row.id} className="py-0.5 text-xs">
              <div className="flex min-h-6 items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={row.file.name}>{row.file.name}</span>
                <span className="shrink-0 text-muted-foreground">{row.status}</span>
                {row.status === "failed" && row.retryable !== false && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" aria-label={`Retry ${row.file.name}`} onClick={() => onRetry(row)}>
                    Retry
                  </Button>
                )}
              </div>
              {row.message && <p className="truncate text-[11px] text-muted-foreground" title={row.message}>{row.message}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

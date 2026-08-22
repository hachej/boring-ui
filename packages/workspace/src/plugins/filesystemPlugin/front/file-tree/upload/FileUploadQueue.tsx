import { useMemo, useState } from "react"
import { Button, IconButton } from "@hachej/boring-ui-kit"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleSlash2Icon,
  Clock3Icon,
  LoaderCircleIcon,
  MinusCircleIcon,
  XIcon,
} from "lucide-react"
import { cn } from "../../../../../front/lib/utils"
import type { UploadQueueRow, UploadStatus } from "./uploadTypes"

const EMPTY_COUNTS: Record<UploadStatus, number> = {
  queued: 0,
  uploading: 0,
  done: 0,
  failed: 0,
  skipped: 0,
  canceled: 0,
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: "waiting",
  uploading: "uploading",
  done: "uploaded",
  failed: "failed",
  skipped: "skipped",
  canceled: "canceled",
}

function UploadStatusIcon({ status }: { status: UploadStatus }) {
  const className = cn(
    "size-3.5 shrink-0",
    status === "failed" ? "text-destructive" : "text-muted-foreground",
  )
  if (status === "uploading") return <LoaderCircleIcon className={cn(className, "animate-spin")} />
  if (status === "done") return <CheckCircle2Icon className={className} />
  if (status === "failed") return <CircleAlertIcon className={className} />
  if (status === "skipped") return <MinusCircleIcon className={className} />
  if (status === "canceled") return <CircleSlash2Icon className={className} />
  return <Clock3Icon className={className} />
}

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
    { ...EMPTY_COUNTS },
  ), [rows])
  const active = counts.queued + counts.uploading > 0
  const settled = rows.length - counts.queued - counts.uploading
  const handled = rows.length - counts.queued
  const progress = rows.length > 0 ? settled / rows.length : 0
  const summary = active
    ? `Uploading ${handled} of ${rows.length}`
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
    <section className="shrink-0 border-t bg-background/95" aria-label="File upload queue">
      <div className="flex h-10 items-center gap-1 px-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-1.5 text-xs"
          aria-label={summary}
          aria-expanded={expanded}
          aria-controls="file-upload-queue-rows"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted/60">
            {active
              ? <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
              : counts.failed > 0
                ? <CircleAlertIcon className="size-3.5 text-destructive" />
                : <CheckCircle2Icon className="size-3.5 text-muted-foreground" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground" aria-live="polite">
            {summary}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
            {settled}/{rows.length}
          </span>
          {expanded
            ? <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            : <ChevronUpIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        </Button>
        {!active && (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="Dismiss upload queue"
            onClick={onDismiss}
          >
            <XIcon className="size-3.5" />
          </IconButton>
        )}
      </div>
      <div className="h-px overflow-hidden bg-border/60" aria-hidden="true">
        <div
          className="h-full origin-left bg-foreground/50 transition-transform duration-150 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      {expanded && (
        <div id="file-upload-queue-rows" className="max-h-56 overflow-y-auto border-t border-border/60 px-2">
          <div className="divide-y divide-border/50">
            {rows.map((row) => (
              <div key={row.id} className="flex min-h-11 items-center gap-2 py-1.5 text-xs">
                <UploadStatusIcon status={row.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground" title={row.file.name}>{row.file.name}</p>
                  <p className={cn(
                    "truncate text-[10px] leading-4 text-muted-foreground",
                    row.status === "failed" && "text-destructive/80",
                  )} title={row.message ?? row.destination}>
                    {row.message ?? row.destination}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] capitalize text-muted-foreground">{STATUS_LABEL[row.status]}</span>
                {row.status === "failed" && row.retryable !== false && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px]"
                    aria-label={`Retry ${row.file.name}`}
                    onClick={() => onRetry(row)}
                  >
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

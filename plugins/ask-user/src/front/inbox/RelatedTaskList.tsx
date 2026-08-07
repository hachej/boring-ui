import { ExternalLink } from "lucide-react"
import type { RelatedTaskRef } from "./taskProvenanceClient"

export function RelatedTaskList({ tasks, className }: { tasks: readonly RelatedTaskRef[]; className?: string }) {
  if (tasks.length === 0) return null
  return (
    <div className={className}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Related tasks</div>
      <div className="flex flex-wrap gap-1.5">
        {tasks.map((task) => {
          const content = <><span>{task.number}</span><span className="max-w-48 truncate text-muted-foreground">{task.title}</span></>
          const key = `${task.adapterId}:${task.taskId}`
          return task.url ? (
            <a
              key={key}
              href={task.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
              aria-label={`Open task ${task.number} ${task.title}`}
            >
              {content}<ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : (
            <span key={key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium">
              {content}
            </span>
          )
        })}
      </div>
    </div>
  )
}

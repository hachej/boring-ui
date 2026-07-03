import type { DragEvent } from "react"
import type { BoringTaskCard } from "../shared"

interface TaskCardProps {
  task: BoringTaskCard
  draggable: boolean
  unmapped?: boolean
  onDragStart: (event: DragEvent<HTMLElement>, task: BoringTaskCard) => void
  onDragEnd: () => void
}

export function TaskCard({ task, draggable, unmapped = false, onDragStart, onDragEnd }: TaskCardProps) {
  return (
    <article
      draggable={draggable}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      className={[
        "group rounded-xl border bg-background p-3 shadow-sm transition",
        draggable ? "cursor-grab hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-md active:cursor-grabbing" : "cursor-default",
        unmapped ? "border-dashed border-amber-400/60 bg-amber-500/5" : "border-border",
      ].join(" ")}
      data-task-id={task.id}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {task.number}
        </span>
        {unmapped ? (
          <span className="rounded-full border border-amber-400/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">
            Unmapped
          </span>
        ) : null}
      </div>
      <h3 className="text-sm font-semibold leading-snug text-foreground">{task.title}</h3>
      {task.description ? (
        <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">{task.description}</p>
      ) : null}
    </article>
  )
}

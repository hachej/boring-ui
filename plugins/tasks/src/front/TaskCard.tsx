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
  const tags = task.tags?.slice(0, 4) ?? []
  const hiddenTagCount = Math.max((task.tags?.length ?? 0) - tags.length, 0)

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
      <h3 className="text-sm font-semibold leading-snug text-foreground">{task.title}</h3>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {task.number}
        </span>
        {unmapped ? (
          <span className="rounded-full border border-amber-400/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">
            Unmapped
          </span>
        ) : null}
        {tags.map((tag) => (
          <span key={tag} className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {tag}
          </span>
        ))}
        {hiddenTagCount > 0 ? (
          <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            +{hiddenTagCount}
          </span>
        ) : null}
      </div>
    </article>
  )
}

import type { DragEvent } from "react"
import type { BoringTaskCard } from "../shared"

interface TaskCardProps {
  task: BoringTaskCard
  draggable: boolean
  unmapped?: boolean
  onDragStart: (event: DragEvent<HTMLElement>, task: BoringTaskCard) => void
  onDragEnd: () => void
}

function ExternalLinkGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-9 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
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
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">{task.title}</h3>
        {task.url ? (
          <a
            href={task.url}
            target="_blank"
            rel="noreferrer"
            draggable={false}
            onClick={(event) => event.stopPropagation()}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            aria-label={`Open ${task.number} in native task system`}
            title="Open in native task system"
          >
            <ExternalLinkGlyph className="size-3.5" />
          </a>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {task.number}
        </span>
        {unmapped ? (
          <span className="rounded-full border border-amber-400/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">
            Unmapped
          </span>
        ) : null}
        {task.epic ? (
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {task.epic.title}
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

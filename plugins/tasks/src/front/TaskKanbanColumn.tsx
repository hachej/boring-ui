import type { DragEvent } from "react"
import type { BoringTaskCard } from "../shared"
import type { BoringTaskColumnView } from "./taskBoardModel"
import { canDropInColumn } from "./taskBoardModel"
import { TaskCard } from "./TaskCard"
import { taskAttentionKey, type TaskAttentionItem } from "./useTaskAttention"

interface TaskKanbanColumnProps {
  column: BoringTaskColumnView
  moveEnabled: boolean
  activeTaskRef: { taskId: string; adapterId: string } | null
  onTaskDragStart: (event: DragEvent<HTMLElement>, task: BoringTaskCard) => void
  onTaskDragEnd: () => void
  onTaskDrop: (taskId: string, adapterId: string, statusId: string) => void
  onTaskDelete?: (task: BoringTaskCard) => void
  canDragTask?: (task: BoringTaskCard) => boolean
  canDeleteTask?: (task: BoringTaskCard) => boolean
  attentionByTask?: ReadonlyMap<string, readonly TaskAttentionItem[]>
}

export function TaskKanbanColumn({
  column,
  moveEnabled,
  activeTaskRef,
  onTaskDragStart,
  onTaskDragEnd,
  onTaskDrop,
  onTaskDelete,
  canDragTask = () => moveEnabled,
  canDeleteTask = () => false,
  attentionByTask = new Map(),
}: TaskKanbanColumnProps) {
  const acceptsDrop = moveEnabled && canDropInColumn(column)

  const hasTaskDragPayload = (event: DragEvent<HTMLElement>) => {
    const types = Array.from(event.dataTransfer.types)
    return types.includes("application/x-boring-task-ref") || types.includes("application/x-boring-task-id")
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop || !hasTaskDragPayload(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop || !hasTaskDragPayload(event)) return
    event.preventDefault()
    const rawRef = event.dataTransfer.getData("application/x-boring-task-ref")
    const fallbackTaskId = event.dataTransfer.getData("application/x-boring-task-id")
    let ref: { taskId?: unknown; adapterId?: unknown } | undefined
    try {
      ref = rawRef ? JSON.parse(rawRef) as { taskId?: unknown; adapterId?: unknown } : undefined
    } catch {
      ref = undefined
    }
    const taskId = typeof ref?.taskId === "string" ? ref.taskId : fallbackTaskId || activeTaskRef?.taskId
    const adapterId = typeof ref?.adapterId === "string" ? ref.adapterId : activeTaskRef?.adapterId
    if (taskId && adapterId) onTaskDrop(taskId, adapterId, column.id)
  }

  return (
    <section
      className={[
        "flex min-h-0 w-72 shrink-0 flex-col rounded-2xl border bg-muted/20",
        column.unmapped ? "border-dashed border-amber-400/50" : "border-border/80",
      ].join(" ")}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      aria-label={`${column.title} column`}
    >
      <header className="border-b border-border/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{column.title}</h2>
            {column.description ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{column.description}</p>
            ) : null}
          </div>
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
            {column.tasks.length}
          </span>
        </div>
        {column.color ? (
          <div className="mt-3 h-1 rounded-full" style={{ backgroundColor: column.color }} />
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-3 text-center text-xs text-muted-foreground">
            Drop tasks here
          </div>
        ) : column.tasks.map((task) => (
          <TaskCard
            key={`${task.adapterId}:${task.id}`}
            task={task}
            draggable={!column.unmapped && canDragTask(task)}
            unmapped={column.unmapped}
            deleteEnabled={canDeleteTask(task)}
            attention={attentionByTask.get(taskAttentionKey(task))}
            onDelete={onTaskDelete}
            onDragStart={onTaskDragStart}
            onDragEnd={onTaskDragEnd}
          />
        ))}
      </div>
    </section>
  )
}

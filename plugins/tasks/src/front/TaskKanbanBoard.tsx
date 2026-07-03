import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react"
import type { BoringTaskAdapter, BoringTaskBoardConfig, BoringTaskCard } from "../shared"
import { groupTasksByColumn } from "./taskBoardModel"
import { TaskKanbanColumn } from "./TaskKanbanColumn"

interface TaskKanbanBoardProps {
  adapters: readonly BoringTaskAdapter[]
}

interface BoardState {
  config: BoringTaskBoardConfig
  tasks: BoringTaskCard[]
}

function adapterSummary(adapter: BoringTaskAdapter): string {
  return adapter.description ?? `${adapter.label} task adapter`
}

export function TaskKanbanBoard({ adapters }: TaskKanbanBoardProps) {
  const [adapterId, setAdapterId] = useState(adapters[0]?.id ?? "")
  const [state, setState] = useState<BoardState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null)

  const adapter = useMemo(
    () => adapters.find((candidate) => candidate.id === adapterId) ?? adapters[0],
    [adapterId, adapters],
  )

  const load = useCallback(async () => {
    if (!adapter) {
      setState(null)
      setLoading(false)
      setError("No task adapters are registered.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [config, tasks] = await Promise.all([adapter.getBoardConfig(), adapter.listTasks()])
      setState({ config, tasks })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setState(null)
    } finally {
      setLoading(false)
    }
  }, [adapter])

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo(
    () => state ? groupTasksByColumn(state.config, state.tasks) : [],
    [state],
  )

  const handleTaskDragStart = (event: DragEvent<HTMLElement>, task: BoringTaskCard) => {
    setActiveTaskId(task.id)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("application/x-boring-task-id", task.id)
    event.dataTransfer.setData("text/plain", task.number)
  }

  const moveTask = async (taskId: string, statusId: string) => {
    if (!adapter || !state || !adapter.capabilities.move || !adapter.moveTask) return
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task || task.statusId === statusId) return

    const previous = state.tasks
    setMovingTaskId(taskId)
    setError(null)
    setState({ ...state, tasks: previous.map((candidate) => candidate.id === taskId ? { ...candidate, statusId } : candidate) })

    try {
      const moved = await adapter.moveTask({ taskId, statusId })
      setState((current) => current ? {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === taskId ? moved : candidate),
      } : current)
    } catch (cause) {
      setState((current) => current ? { ...current, tasks: previous } : current)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMovingTaskId(null)
      setActiveTaskId(null)
    }
  }

  const moveEnabled = Boolean(adapter?.capabilities.move && adapter.moveTask)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-card/70 p-3 shadow-sm">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground">A lean Kanban surface. Adapters map GitHub, Linear, Kata, or DB task actions into this board.</p>
        </div>
        <label className="flex min-w-48 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Adapter
          <select
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground shadow-sm outline-none focus:border-foreground/40"
            value={adapter?.id ?? ""}
            onChange={(event) => setAdapterId(event.target.value)}
          >
            {adapters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {adapter ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-muted/40 px-2 py-1">{adapterSummary(adapter)}</span>
          <span className="rounded-full border border-border bg-muted/40 px-2 py-1">Move: {moveEnabled ? "adapter mapped" : "read-only"}</span>
          {movingTaskId ? <span className="rounded-full border border-border bg-muted/40 px-2 py-1">Moving {movingTaskId}…</span> : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && !state ? (
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">Loading task board…</div>
        ) : columns.length === 0 ? (
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">No task columns are available.</div>
        ) : (
          <div className="flex h-full gap-3 overflow-x-auto pb-2">
            {columns.map((column) => (
              <TaskKanbanColumn
                key={column.id}
                column={column}
                moveEnabled={moveEnabled}
                activeTaskId={activeTaskId}
                onTaskDragStart={handleTaskDragStart}
                onTaskDrop={(taskId, statusId) => void moveTask(taskId, statusId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

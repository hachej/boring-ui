import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react"
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

function uniqueTags(tasks: readonly BoringTaskCard[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort((a, b) => a.localeCompare(b))
}

export function TaskKanbanBoard({ adapters }: TaskKanbanBoardProps) {
  const [adapterId, setAdapterId] = useState(adapters[0]?.id ?? "")
  const [state, setState] = useState<BoardState | null>(null)
  const [visibleColumnIds, setVisibleColumnIds] = useState<ReadonlySet<string>>(new Set())
  const [tagFilter, setTagFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const adapterIdRef = useRef(adapterId)

  useEffect(() => {
    adapterIdRef.current = adapterId
  }, [adapterId])

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
    const requestId = requestSeq.current + 1
    requestSeq.current = requestId
    setLoading(true)
    setError(null)
    try {
      const [config, tasks] = await Promise.all([adapter.getBoardConfig(), adapter.listTasks()])
      if (requestSeq.current === requestId) {
        setState({ config, tasks })
        setVisibleColumnIds(new Set(config.columns.map((column) => column.id)))
        setTagFilter("all")
      }
    } catch (cause) {
      if (requestSeq.current === requestId) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setState(null)
      }
    } finally {
      if (requestSeq.current === requestId) setLoading(false)
    }
  }, [adapter])

  useEffect(() => {
    void load()
  }, [load])

  const tags = useMemo(() => uniqueTags(state?.tasks ?? []), [state])

  const filteredTasks = useMemo(() => {
    if (!state) return []
    const configuredStatusIds = new Set(state.config.columns.map((column) => column.id))
    return state.tasks.filter((task) => {
      if (tagFilter !== "all" && !(task.tags ?? []).includes(tagFilter)) return false
      if (!configuredStatusIds.has(task.statusId)) return true
      return visibleColumnIds.has(task.statusId)
    })
  }, [state, tagFilter, visibleColumnIds])

  const visibleConfig = useMemo(() => {
    if (!state) return null
    return {
      ...state.config,
      columns: state.config.columns.filter((column) => visibleColumnIds.has(column.id)),
    }
  }, [state, visibleColumnIds])

  const columns = useMemo(
    () => visibleConfig ? groupTasksByColumn(visibleConfig, filteredTasks) : [],
    [filteredTasks, visibleConfig],
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
    if (!task || task.statusId === statusId) {
      setActiveTaskId(null)
      return
    }

    const previous = state.tasks
    const movingAdapterId = state.config.adapterId
    setMovingTaskId(taskId)
    setError(null)
    setState((current) => current && current.config.adapterId === movingAdapterId ? {
      ...current,
      tasks: current.tasks.map((candidate) => candidate.id === taskId ? { ...candidate, statusId } : candidate),
    } : current)

    try {
      const moved = await adapter.moveTask({ taskId, statusId })
      setState((current) => current && current.config.adapterId === movingAdapterId ? {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === taskId ? moved : candidate),
      } : current)
    } catch (cause) {
      setState((current) => current && current.config.adapterId === movingAdapterId ? { ...current, tasks: previous } : current)
      if (adapterIdRef.current === movingAdapterId) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setMovingTaskId(null)
      setActiveTaskId(null)
    }
  }

  const toggleColumn = (columnId: string) => {
    setVisibleColumnIds((current) => {
      const next = new Set(current)
      if (next.has(columnId)) next.delete(columnId)
      else next.add(columnId)
      return next
    })
  }

  const showAllColumns = () => {
    if (!state) return
    setVisibleColumnIds(new Set(state.config.columns.map((column) => column.id)))
  }

  const moveEnabled = Boolean(adapter?.capabilities.move && adapter.moveTask)
  const visibleCount = visibleColumnIds.size
  const totalCount = state?.config.columns.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/70 p-2 shadow-sm">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Source
          <select
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground/40"
            value={adapter?.id ?? ""}
            onChange={(event) => setAdapterId(event.target.value)}
          >
            {adapters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Tag
          <select
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground/40"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="all">All tags</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
        <details className="relative">
          <summary className="flex h-8 cursor-pointer list-none items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted">
            Columns {visibleCount}/{totalCount}
          </summary>
          <div className="absolute left-0 z-20 mt-2 w-64 rounded-xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visible columns</span>
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={showAllColumns}>All</button>
            </div>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {state?.config.columns.map((column) => (
                <label key={column.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/70">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={visibleColumnIds.has(column.id)}
                    onChange={() => toggleColumn(column.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{column.title}</span>
                    {column.description ? <span className="block truncate text-xs text-muted-foreground">{column.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </details>
        <button
          type="button"
          className="h-8 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {adapter ? <span className="rounded-full border border-border bg-muted/40 px-2 py-1">{adapterSummary(adapter)}</span> : null}
          <span className="rounded-full border border-border bg-muted/40 px-2 py-1">Move: {moveEnabled ? "drag/drop" : "read-only"}</span>
          {movingTaskId ? <span className="rounded-full border border-border bg-muted/40 px-2 py-1">Moving…</span> : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && !state ? (
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">Loading task board…</div>
        ) : columns.length === 0 ? (
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">No tasks match the current filters.</div>
        ) : (
          <div className="flex h-full gap-3 overflow-x-auto pb-2">
            {columns.map((column) => (
              <TaskKanbanColumn
                key={column.id}
                column={column}
                moveEnabled={moveEnabled}
                activeTaskId={activeTaskId}
                onTaskDragStart={handleTaskDragStart}
                onTaskDragEnd={() => setActiveTaskId(null)}
                onTaskDrop={(taskId, statusId) => void moveTask(taskId, statusId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

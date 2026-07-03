import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import type { BoringTaskAdapter, BoringTaskBoardConfig, BoringTaskCard, BoringTaskColumn } from "../shared"
import { groupTasksByColumn } from "./taskBoardModel"
import { TaskKanbanColumn } from "./TaskKanbanColumn"

interface TaskKanbanBoardProps {
  adapters: readonly BoringTaskAdapter[]
}

interface BoardState {
  configs: Record<string, BoringTaskBoardConfig>
  tasks: BoringTaskCard[]
}

function adapterSummary(adapters: readonly BoringTaskAdapter[], selectedCount: number): string {
  if (selectedCount === adapters.length) return "All sources"
  if (selectedCount === 1) return adapters.find((adapter) => adapter.id)?.description ?? "1 source"
  return `${selectedCount} sources`
}

function uniqueTags(tasks: readonly BoringTaskCard[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort((a, b) => a.localeCompare(b))
}

function mergeColumns(configs: readonly BoringTaskBoardConfig[], visibleColumnIds: ReadonlySet<string>): BoringTaskColumn[] {
  const byId = new Map<string, BoringTaskColumn>()
  for (const config of configs) {
    for (const column of config.columns) {
      if (!visibleColumnIds.has(column.id) || byId.has(column.id)) continue
      byId.set(column.id, column)
    }
  }
  return [...byId.values()]
}

export function TaskKanbanBoard({ adapters }: TaskKanbanBoardProps) {
  const allAdapterIds = useMemo(() => adapters.map((adapter) => adapter.id), [adapters])
  const [selectedAdapterIds, setSelectedAdapterIds] = useState<ReadonlySet<string>>(() => new Set(allAdapterIds))
  const [state, setState] = useState<BoardState | null>(null)
  const [visibleColumnIds, setVisibleColumnIds] = useState<ReadonlySet<string>>(new Set())
  const [tagFilter, setTagFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<"sources" | "columns" | null>(null)
  const requestSeq = useRef(0)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const adaptersById = useMemo(() => new Map(adapters.map((adapter) => [adapter.id, adapter])), [adapters])

  useEffect(() => {
    setSelectedAdapterIds((current) => {
      const next = new Set([...current].filter((id) => adaptersById.has(id)))
      if (next.size === 0) for (const id of allAdapterIds) next.add(id)
      return next
    })
  }, [adaptersById, allAdapterIds])

  const load = useCallback(async () => {
    if (adapters.length === 0) {
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
      const entries = await Promise.all(adapters.map(async (adapter) => {
        const [config, tasks] = await Promise.all([adapter.getBoardConfig(), adapter.listTasks()])
        return { adapterId: adapter.id, config, tasks }
      }))
      if (requestSeq.current !== requestId) return
      const configs = Object.fromEntries(entries.map((entry) => [entry.adapterId, entry.config]))
      const tasks = entries.flatMap((entry) => entry.tasks)
      const columnIds = new Set(entries.flatMap((entry) => entry.config.columns.map((column) => column.id)))
      setState({ configs, tasks })
      setVisibleColumnIds(columnIds)
      setTagFilter("all")
    } catch (cause) {
      if (requestSeq.current === requestId) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setState(null)
      }
    } finally {
      if (requestSeq.current === requestId) setLoading(false)
    }
  }, [adapters])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  const selectedTasks = useMemo(() => {
    if (!state) return []
    return state.tasks.filter((task) => selectedAdapterIds.has(task.adapterId))
  }, [selectedAdapterIds, state])

  const tags = useMemo(() => uniqueTags(selectedTasks), [selectedTasks])

  const selectedConfigs = useMemo(() => {
    if (!state) return []
    return [...selectedAdapterIds].map((id) => state.configs[id]).filter((config): config is BoringTaskBoardConfig => Boolean(config))
  }, [selectedAdapterIds, state])

  const allColumns = useMemo(() => mergeColumns(selectedConfigs, new Set(selectedConfigs.flatMap((config) => config.columns.map((column) => column.id)))), [selectedConfigs])

  const filteredTasks = useMemo(() => {
    const configuredStatusIds = new Set(allColumns.map((column) => column.id))
    return selectedTasks.filter((task) => {
      if (tagFilter !== "all" && !(task.tags ?? []).includes(tagFilter)) return false
      if (!configuredStatusIds.has(task.statusId)) return true
      return visibleColumnIds.has(task.statusId)
    })
  }, [allColumns, selectedTasks, tagFilter, visibleColumnIds])

  const visibleConfig = useMemo<BoringTaskBoardConfig | null>(() => {
    if (!state) return null
    return {
      adapterId: "combined",
      columns: mergeColumns(selectedConfigs, visibleColumnIds),
    }
  }, [selectedConfigs, state, visibleColumnIds])

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
    if (!state) return
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task || task.statusId === statusId) {
      setActiveTaskId(null)
      return
    }
    const adapter = adaptersById.get(task.adapterId)
    if (!adapter?.capabilities.move || !adapter.moveTask) return

    const previous = state.tasks
    const movingAdapterId = task.adapterId
    setMovingTaskId(taskId)
    setError(null)
    setState((current) => current ? {
      ...current,
      tasks: current.tasks.map((candidate) => candidate.id === taskId ? { ...candidate, statusId } : candidate),
    } : current)

    try {
      const moved = await adapter.moveTask({ taskId, statusId })
      setState((current) => current ? {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === taskId ? moved : candidate),
      } : current)
    } catch (cause) {
      setState((current) => current ? { ...current, tasks: previous } : current)
      if (selectedAdapterIds.has(movingAdapterId)) {
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

  const toggleSource = (adapterId: string) => {
    setSelectedAdapterIds((current) => {
      const next = new Set(current)
      if (next.has(adapterId)) next.delete(adapterId)
      else next.add(adapterId)
      return next.size === 0 ? current : next
    })
  }

  const showAllColumns = () => {
    setVisibleColumnIds(new Set(allColumns.map((column) => column.id)))
  }

  const showAllSources = () => {
    setSelectedAdapterIds(new Set(allAdapterIds))
  }

  const selectedCount = selectedAdapterIds.size
  const visibleCount = visibleColumnIds.size
  const totalCount = allColumns.length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div ref={toolbarRef} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/70 p-2 shadow-sm">
        <div className="relative">
          <button
            type="button"
            className="flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
            onClick={() => setOpenMenu((current) => current === "sources" ? null : "sources")}
            aria-expanded={openMenu === "sources"}
          >
            Sources {selectedCount}/{adapters.length}
          </button>
          {openMenu === "sources" ? <div className="absolute left-0 z-20 mt-2 w-72 rounded-xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Task sources</span>
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={showAllSources}>All</button>
            </div>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {adapters.map((adapter) => (
                <label key={adapter.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/70">
                  <input type="checkbox" className="mt-0.5" checked={selectedAdapterIds.has(adapter.id)} onChange={() => toggleSource(adapter.id)} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{adapter.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{adapter.description ?? adapter.id}</span>
                  </span>
                </label>
              ))}
            </div>
          </div> : null}
        </div>
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
        <div className="relative">
          <button
            type="button"
            className="flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
            onClick={() => setOpenMenu((current) => current === "columns" ? null : "columns")}
            aria-expanded={openMenu === "columns"}
          >
            Columns {visibleCount}/{totalCount}
          </button>
          {openMenu === "columns" ? <div className="absolute left-0 z-20 mt-2 w-64 rounded-xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visible columns</span>
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={showAllColumns}>All</button>
            </div>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {allColumns.map((column) => (
                <label key={column.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/70">
                  <input type="checkbox" className="mt-0.5" checked={visibleColumnIds.has(column.id)} onChange={() => toggleColumn(column.id)} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{column.title}</span>
                    {column.description ? <span className="block truncate text-xs text-muted-foreground">{column.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </div> : null}
        </div>
        <button
          type="button"
          className="h-8 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-muted/40 px-2 py-1">{adapterSummary(adapters, selectedCount)}</span>
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
                moveEnabled={true}
                activeTaskId={activeTaskId}
                onTaskDragStart={handleTaskDragStart}
                onTaskDragEnd={() => setActiveTaskId(null)}
                onTaskDrop={(taskId, statusId) => void moveTask(taskId, statusId)}
                canDragTask={(task) => Boolean(adaptersById.get(task.adapterId)?.capabilities.move && adaptersById.get(task.adapterId)?.moveTask)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

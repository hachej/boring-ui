import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { Columns3, List } from "lucide-react"
import type { BoringTaskAdapter, BoringTaskBoardConfig, BoringTaskCard, BoringTaskColumn } from "../shared"
import { groupTasksByColumn } from "./taskBoardModel"
import { TaskCard } from "./TaskCard"
import { TaskKanbanColumn } from "./TaskKanbanColumn"
import { taskAttentionKey, useTaskAttention } from "./useTaskAttention"

interface TaskKanbanBoardProps {
  adapters: readonly BoringTaskAdapter[]
}

interface BoardState {
  configs: Record<string, BoringTaskBoardConfig>
  tasks: BoringTaskCard[]
}

interface CachedBoardState extends BoardState {
  cachedAt: number
}

interface EpicOption {
  id: string
  title: string
}

const TASK_BOARD_CACHE_TTL_MS = 2 * 60 * 1000
type TaskBoardViewMode = "kanban" | "list"

function adapterSummary(adapters: readonly BoringTaskAdapter[], selectedCount: number): string {
  if (selectedCount === adapters.length) return "All sources"
  if (selectedCount === 1) return adapters.find((adapter) => adapter.id)?.description ?? "1 source"
  return `${selectedCount} sources`
}

function uniqueTags(tasks: readonly BoringTaskCard[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort((a, b) => a.localeCompare(b))
}

function uniqueEpics(tasks: readonly BoringTaskCard[]): EpicOption[] {
  const byId = new Map<string, EpicOption>()
  for (const task of tasks) {
    if (!task.epic) continue
    const id = `${task.adapterId}:${task.epic.id}`
    if (!byId.has(id)) byId.set(id, { id, title: task.epic.title })
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title))
}

function epicFilterId(task: BoringTaskCard): string | undefined {
  return task.epic ? `${task.adapterId}:${task.epic.id}` : undefined
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

function readCachedBoardState(cacheKey: string): CachedBoardState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedBoardState>
    if (!parsed || typeof parsed !== "object" || !parsed.configs || !Array.isArray(parsed.tasks)) return null
    return {
      configs: parsed.configs as Record<string, BoringTaskBoardConfig>,
      tasks: parsed.tasks as BoringTaskCard[],
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : 0,
    }
  } catch {
    return null
  }
}

function writeCachedBoardState(cacheKey: string, state: BoardState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify({ ...state, cachedAt: Date.now() } satisfies CachedBoardState))
  } catch {
    // Best-effort cache only.
  }
}

function readViewMode(cacheKey: string): TaskBoardViewMode {
  if (typeof window === "undefined") return "kanban"
  try {
    return window.localStorage.getItem(`${cacheKey}:view`) === "list" ? "list" : "kanban"
  } catch {
    return "kanban"
  }
}

function writeViewMode(cacheKey: string, mode: TaskBoardViewMode): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(`${cacheKey}:view`, mode)
  } catch {
    // Best-effort preference only.
  }
}

export function TaskKanbanBoard({ adapters }: TaskKanbanBoardProps) {
  const allAdapterIds = useMemo(() => adapters.map((adapter) => adapter.id), [adapters])
  const cacheKey = useMemo(() => `boring-tasks:board-cache:v1:${allAdapterIds.join("|")}`, [allAdapterIds])
  const cachedState = useMemo(() => readCachedBoardState(cacheKey), [cacheKey])
  const cachedColumnIds = useMemo(
    () => cachedState ? new Set(Object.values(cachedState.configs).flatMap((config) => config.columns.map((column) => column.id))) : new Set<string>(),
    [cachedState],
  )
  const [selectedAdapterIds, setSelectedAdapterIds] = useState<ReadonlySet<string>>(() => new Set(allAdapterIds))
  const [state, setState] = useState<BoardState | null>(() => cachedState ? { configs: cachedState.configs, tasks: cachedState.tasks } : null)
  const [visibleColumnIds, setVisibleColumnIds] = useState<ReadonlySet<string>>(cachedColumnIds)
  const [tagFilter, setTagFilter] = useState("all")
  const [epicFilter, setEpicFilter] = useState("all")
  const [loading, setLoading] = useState(!cachedState)
  const [error, setError] = useState<string | null>(null)
  const [activeTaskRef, setActiveTaskRef] = useState<{ taskId: string; adapterId: string } | null>(null)
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<"sources" | "columns" | null>(null)
  const [viewMode, setViewModeState] = useState<TaskBoardViewMode>(() => readViewMode(cacheKey))
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<ReadonlySet<string>>(new Set())
  const requestSeq = useRef(0)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const adaptersById = useMemo(() => new Map(adapters.map((adapter) => [adapter.id, adapter])), [adapters])
  const attentionByTask = useTaskAttention(state?.tasks ?? [])

  const setViewMode = (mode: TaskBoardViewMode) => {
    setViewModeState(mode)
    writeViewMode(cacheKey, mode)
  }

  useEffect(() => {
    setSelectedAdapterIds((current) => {
      const next = new Set([...current].filter((id) => adaptersById.has(id)))
      if (next.size === 0) for (const id of allAdapterIds) next.add(id)
      return next
    })
  }, [adaptersById, allAdapterIds])

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    if (adapters.length === 0) {
      setState(null)
      setLoading(false)
      setError("No task adapters are registered.")
      return
    }
    const cached = readCachedBoardState(cacheKey)
    const cacheFresh = cached && Date.now() - cached.cachedAt < TASK_BOARD_CACHE_TTL_MS
    if (cached && !options.force) {
      const columnIds = new Set(Object.values(cached.configs).flatMap((config) => config.columns.map((column) => column.id)))
      setState({ configs: cached.configs, tasks: cached.tasks })
      setVisibleColumnIds((current) => current.size > 0 ? current : columnIds)
      if (cacheFresh) {
        setLoading(false)
        setError(null)
        return
      }
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
      const nextState = { configs, tasks }
      setState(nextState)
      writeCachedBoardState(cacheKey, nextState)
      setVisibleColumnIds(columnIds)
      setTagFilter("all")
      setEpicFilter("all")
    } catch (cause) {
      if (requestSeq.current === requestId) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setState((current) => current ?? null)
      }
    } finally {
      if (requestSeq.current === requestId) setLoading(false)
    }
  }, [adapters, cacheKey])

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
  const epics = useMemo(() => uniqueEpics(selectedTasks), [selectedTasks])

  const selectedConfigs = useMemo(() => {
    if (!state) return []
    return [...selectedAdapterIds].map((id) => state.configs[id]).filter((config): config is BoringTaskBoardConfig => Boolean(config))
  }, [selectedAdapterIds, state])

  const allColumns = useMemo(() => mergeColumns(selectedConfigs, new Set(selectedConfigs.flatMap((config) => config.columns.map((column) => column.id)))), [selectedConfigs])

  const filteredTasks = useMemo(() => {
    const configuredStatusIds = new Set(allColumns.map((column) => column.id))
    return selectedTasks.filter((task) => {
      if (tagFilter !== "all" && !(task.tags ?? []).includes(tagFilter)) return false
      if (epicFilter !== "all" && epicFilterId(task) !== epicFilter) return false
      if (!configuredStatusIds.has(task.statusId)) return true
      return visibleColumnIds.has(task.statusId)
    })
  }, [allColumns, epicFilter, selectedTasks, tagFilter, visibleColumnIds])

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
    setActiveTaskRef({ taskId: task.id, adapterId: task.adapterId })
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("application/x-boring-task-ref", JSON.stringify({ taskId: task.id, adapterId: task.adapterId }))
    event.dataTransfer.setData("application/x-boring-task-id", task.id)
    event.dataTransfer.setData("text/plain", task.number)
  }

  const moveTask = async (taskId: string, adapterId: string, statusId: string) => {
    if (!state) return
    const task = state.tasks.find((candidate) => candidate.id === taskId && candidate.adapterId === adapterId)
    if (!task || task.statusId === statusId) {
      setActiveTaskRef(null)
      return
    }
    const adapter = adaptersById.get(task.adapterId)
    if (!adapter?.capabilities.move || !adapter.moveTask) {
      setActiveTaskRef(null)
      return
    }

    const previous = state.tasks
    const movingAdapterId = task.adapterId
    setMovingTaskId(taskId)
    setError(null)
    setState((current) => current ? {
      ...current,
      tasks: current.tasks.map((candidate) => candidate.id === taskId && candidate.adapterId === adapterId ? { ...candidate, statusId } : candidate),
    } : current)

    try {
      const moved = await adapter.moveTask({ taskId, statusId })
      setState((current) => current ? {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === taskId && candidate.adapterId === adapterId ? moved : candidate),
      } : current)
    } catch (cause) {
      setState((current) => current ? { ...current, tasks: previous } : current)
      if (selectedAdapterIds.has(movingAdapterId)) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setMovingTaskId(null)
      setActiveTaskRef(null)
    }
  }

  const deleteTask = async (task: BoringTaskCard) => {
    const adapter = adaptersById.get(task.adapterId)
    if (!adapter?.capabilities.delete || !adapter.deleteTask) {
      setError(`Task source does not support issue deletion: ${task.adapterId}`)
      return
    }
    const previous = state?.tasks ?? []
    setDeletingTaskId(task.id)
    setError(null)
    setState((current) => current ? {
      ...current,
      tasks: current.tasks.filter((candidate) => !(candidate.id === task.id && candidate.adapterId === task.adapterId)),
    } : current)
    try {
      await adapter.deleteTask({ taskId: task.id })
    } catch (cause) {
      setState((current) => current ? { ...current, tasks: previous } : current)
      if (selectedAdapterIds.has(task.adapterId)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDeletingTaskId(null)
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

  const toggleSection = (sectionId: string) => {
    setCollapsedSectionIds((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
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
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Epic
          <select
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground/40"
            value={epicFilter}
            onChange={(event) => setEpicFilter(event.target.value)}
          >
            <option value="all">All epics</option>
            {epics.map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}
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
          onClick={() => void load({ force: true })}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <div className="inline-flex h-8 overflow-hidden rounded-lg border border-border bg-background shadow-sm" aria-label="Task view mode">
          <button
            type="button"
            className={["grid w-8 place-items-center", viewMode === "kanban" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"].join(" ")}
            onClick={() => setViewMode("kanban")}
            aria-label="Show kanban view"
            title="Kanban view"
          >
            <Columns3 className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={["grid w-8 place-items-center", viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"].join(" ")}
            onClick={() => setViewMode("list")}
            aria-label="Show list view"
            title="List view"
          >
            <List className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-muted/40 px-2 py-1">{adapterSummary(adapters, selectedCount)}</span>
          {movingTaskId ? <span className="rounded-full border border-border bg-muted/40 px-2 py-1">Moving…</span> : null}
          {deletingTaskId ? <span className="rounded-full border border-border bg-muted/40 px-2 py-1">Deleting…</span> : null}
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
        ) : viewMode === "list" ? (
          <div className="boring-scrollbar-discreet flex h-full flex-col gap-3 overflow-y-auto pr-1">
            {columns.map((column) => {
              const collapsed = collapsedSectionIds.has(column.id)
              return (
                <section
                  key={column.id}
                  className={["rounded-2xl border bg-muted/20", column.unmapped ? "border-dashed border-amber-400/50" : "border-border/80"].join(" ")}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 border-b border-border/70 p-3 text-left hover:bg-muted/50"
                    onClick={() => toggleSection(column.id)}
                    aria-expanded={!collapsed}
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      {column.color ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: column.color }} aria-hidden="true" /> : null}
                      <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{collapsed ? "▸" : "▾"} {column.title}</span>
                      {column.description ? <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">{column.description}</span> : null}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {column.tasks.length}
                    </span>
                  </button>
                  {!collapsed ? (
                    <div className="flex flex-col gap-2 p-2">
                      {column.tasks.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/80 p-3 text-center text-xs text-muted-foreground">
                          No tasks
                        </div>
                      ) : column.tasks.map((task) => (
                        <TaskCard
                          key={`${task.adapterId}:${task.id}`}
                          task={task}
                          draggable={false}
                          unmapped={column.unmapped}
                          compact
                          attention={attentionByTask.get(taskAttentionKey(task))}
                          deleteEnabled={Boolean(adaptersById.get(task.adapterId)?.capabilities.delete && adaptersById.get(task.adapterId)?.deleteTask)}
                          onDelete={(task) => void deleteTask(task)}
                          onDragStart={handleTaskDragStart}
                          onDragEnd={() => setActiveTaskRef(null)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        ) : (
          <div className="flex h-full gap-3 overflow-x-auto pb-2">
            {columns.map((column) => (
              <TaskKanbanColumn
                key={column.id}
                column={column}
                moveEnabled={true}
                activeTaskRef={activeTaskRef}
                onTaskDragStart={handleTaskDragStart}
                onTaskDragEnd={() => setActiveTaskRef(null)}
                onTaskDrop={(taskId, adapterId, statusId) => void moveTask(taskId, adapterId, statusId)}
                onTaskDelete={(task) => void deleteTask(task)}
              attentionByTask={attentionByTask}
                canDragTask={(task) => Boolean(adaptersById.get(task.adapterId)?.capabilities.move && adaptersById.get(task.adapterId)?.moveTask)}
                canDeleteTask={(task) => Boolean(adaptersById.get(task.adapterId)?.capabilities.delete && adaptersById.get(task.adapterId)?.deleteTask)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

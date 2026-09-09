import type { BoringTaskCard, BoringTaskColumn } from "../shared"

/** Group key used for the epic that a card has no parent for. */
export const NO_EPIC_GROUP_KEY = "__no_epic__"

/**
 * Board columns that mean "this work is finished". Kept id-based (not
 * adapter-specific) so any source whose config uses one of these ids gets the
 * active/closed split for free: beads uses `closed`, GitHub Issues uses `done`.
 */
const TERMINAL_COLUMN_IDS: ReadonlySet<string> = new Set(["closed", "done", "completed", "cancelled", "canceled", "archived"])

export function isTerminalColumnId(columnId: string): boolean {
  return TERMINAL_COLUMN_IDS.has(columnId.toLowerCase())
}

/**
 * Composite key for a card's epic. Adapter-scoped because two sources can hand
 * back the same native epic id. Shared by the epic filter and the epics view so
 * a filter selection and a group always agree on identity.
 */
export function epicGroupKey(task: BoringTaskCard): string | undefined {
  return task.epic ? `${task.adapterId}:${task.epic.id}` : undefined
}

export interface TaskEpicStatusCount {
  columnId: string
  title: string
  color?: string
  count: number
}

export interface TaskEpicGroup {
  /** Stable identity for expansion state and React keys. */
  key: string
  /** Native epic id; absent for the "No epic" group. */
  epicId?: string
  title: string
  url?: string
  adapterId?: string
  tasks: BoringTaskCard[]
  taskCount: number
  /** Cards in a non-terminal column. */
  openCount: number
  /** Cards in a terminal column. */
  closedCount: number
  /** An epic is active while at least one of its beads is not terminal. */
  active: boolean
  /** Per-column counts, in board column order, omitting empty columns. */
  statuses: TaskEpicStatusCount[]
}

interface MutableGroup extends Omit<TaskEpicGroup, "statuses" | "taskCount" | "openCount" | "closedCount" | "active"> {
  countsByColumn: Map<string, number>
}

/**
 * Groups cards by their epic. `columns` only orders and titles the status
 * breakdown; cards in columns absent from the config still count, under their
 * raw status id, so nothing silently disappears from a total.
 */
export function groupTasksByEpic(
  tasks: readonly BoringTaskCard[],
  columns: readonly BoringTaskColumn[],
): TaskEpicGroup[] {
  const columnOrder = new Map(columns.map((column, index) => [column.id, index]))
  const columnById = new Map(columns.map((column) => [column.id, column]))
  const groups = new Map<string, MutableGroup>()

  for (const task of tasks) {
    const key = epicGroupKey(task) ?? NO_EPIC_GROUP_KEY
    let group = groups.get(key)
    if (!group) {
      group = key === NO_EPIC_GROUP_KEY
        ? { key, title: "No epic", tasks: [], countsByColumn: new Map() }
        : {
          key,
          epicId: task.epic?.id,
          title: task.epic?.title ?? task.epic?.id ?? key,
          adapterId: task.adapterId,
          ...(task.epic?.url ? { url: task.epic.url } : {}),
          tasks: [],
          countsByColumn: new Map(),
        }
      groups.set(key, group)
    }
    group.tasks.push(task)
    group.countsByColumn.set(task.statusId, (group.countsByColumn.get(task.statusId) ?? 0) + 1)
  }

  const resolved = [...groups.values()].map((group): TaskEpicGroup => {
    const statuses = [...group.countsByColumn.entries()]
      .map(([columnId, count]): TaskEpicStatusCount => {
        const column = columnById.get(columnId)
        return {
          columnId,
          title: column?.title ?? columnId,
          ...(column?.color ? { color: column.color } : {}),
          count,
        }
      })
      .sort((a, b) => (columnOrder.get(a.columnId) ?? Number.MAX_SAFE_INTEGER) - (columnOrder.get(b.columnId) ?? Number.MAX_SAFE_INTEGER)
        || a.title.localeCompare(b.title))
    const closedCount = statuses.reduce((total, status) => isTerminalColumnId(status.columnId) ? total + status.count : total, 0)
    const { countsByColumn: _counts, ...rest } = group
    return {
      ...rest,
      statuses,
      taskCount: group.tasks.length,
      openCount: group.tasks.length - closedCount,
      closedCount,
      active: group.tasks.length - closedCount > 0,
    }
  })

  return resolved.sort((a, b) => {
    if (a.key === NO_EPIC_GROUP_KEY) return 1
    if (b.key === NO_EPIC_GROUP_KEY) return -1
    return a.title.localeCompare(b.title)
  })
}

export interface TaskEpicVisibility {
  visible: TaskEpicGroup[]
  /** Epics withheld by the active-only filter. Always surfaced in the UI. */
  hiddenEpicCount: number
  hiddenTaskCount: number
}

/** Splits grouped epics into what the board shows and what the toggle withholds. */
export function selectVisibleEpicGroups(groups: readonly TaskEpicGroup[], showClosed: boolean): TaskEpicVisibility {
  if (showClosed) return { visible: [...groups], hiddenEpicCount: 0, hiddenTaskCount: 0 }
  const visible = groups.filter((group) => group.active)
  const hidden = groups.filter((group) => !group.active)
  return {
    visible,
    hiddenEpicCount: hidden.length,
    hiddenTaskCount: hidden.reduce((total, group) => total + group.taskCount, 0),
  }
}

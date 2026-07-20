import type { CatalogConfig, CatalogRow } from "@hachej/boring-workspace"
import { requestAppLeftOverlay } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard } from "../shared"
import { TASKS_PLUGIN_ID } from "../shared"
import { listAllHttpTasks, listHttpTaskSources } from "./httpTaskAdapter"
import { taskMatchesSearch } from "./taskBoardModel"
import { publishTaskSearchQuery } from "./taskSearchEvents"

const TASK_CATALOG_BADGE_CODE = "TASK"

function rowId(task: BoringTaskCard): string {
  return `${encodeURIComponent(task.adapterId)}:${encodeURIComponent(task.id)}`
}

function taskRow(task: BoringTaskCard): CatalogRow {
  const context = [task.epic?.title, ...(task.tags ?? []).slice(0, 3)].filter(Boolean).join(" · ")
  return {
    id: rowId(task),
    title: `${task.number} ${task.title}`,
    subtitle: context || task.statusId,
    leading: { code: TASK_CATALOG_BADGE_CODE, tooltip: task.adapterId },
    meta: task.adapterId,
  }
}

function taskSearchScore(task: BoringTaskCard, query: string): number {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return 3
  if (task.number.toLocaleLowerCase() === normalized) return 0
  if (task.number.toLocaleLowerCase().startsWith(normalized)) return 1
  if (task.title.toLocaleLowerCase().startsWith(normalized)) return 2
  return 3
}

export function createTaskCatalog(): CatalogConfig {
  const tasksByRowId = new Map<string, BoringTaskCard>()
  return {
    id: "tasks",
    label: "Tasks",
    pluginId: TASKS_PLUGIN_ID,
    adapter: {
      async search({ query, limit, offset, signal }) {
        const sources = await listHttpTaskSources()
        const tasks = sources.length > 0 ? await listAllHttpTasks(sources.map((source) => source.id), signal) : []
        const matches = tasks
          .filter((task) => taskMatchesSearch(task, query))
          .sort((a, b) => taskSearchScore(a, query) - taskSearchScore(b, query)
            || b.number.localeCompare(a.number, undefined, { numeric: true }))
        tasksByRowId.clear()
        for (const task of matches) tasksByRowId.set(rowId(task), task)
        return {
          items: matches.slice(offset, offset + limit).map(taskRow),
          total: matches.length,
          hasMore: offset + limit < matches.length,
        }
      },
    },
    onSelect(row) {
      const task = tasksByRowId.get(row.id)
      const query = task?.number ?? row.title.split(/\s+/, 1)[0] ?? ""
      publishTaskSearchQuery(query)
      requestAppLeftOverlay(TASKS_PLUGIN_ID)
    },
  }
}

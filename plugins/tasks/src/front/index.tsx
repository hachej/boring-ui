import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"
import { TasksGlyph, TasksOverlay } from "./TasksOverlay"

export function createTasksPlugin(): BoringFrontFactoryWithId {
  return definePlugin({
    id: TASKS_PLUGIN_ID,
    label: TASKS_PLUGIN_LABEL,
    appLeftActions: [
      {
        id: "tasks",
        label: TASKS_PLUGIN_LABEL,
        icon: TasksGlyph,
        overlay: TasksOverlay,
        order: 40,
      },
    ],
  })
}

const tasksPlugin = createTasksPlugin()

export default tasksPlugin
export { TaskKanbanBoard } from "./TaskKanbanBoard"
export { TasksOverlay } from "./TasksOverlay"
export { createGitHubIssuesAdapter } from "./githubIssuesAdapter"
export { createHttpTaskAdapter, listHttpTaskSources } from "./httpTaskAdapter"
export { createMockTaskAdapter } from "./mockAdapter"
export type {
  BoringTaskAdapter,
  BoringTaskAdapterCapabilities,
  BoringTaskAdapterSummary,
  BoringTaskBoardConfig,
  BoringTaskCard,
  BoringTaskColumn,
  BoringTaskEpicRef,
  BoringTaskMoveInput,
  BoringTaskStatusId,
  BoringTaskSessionLink,
} from "../shared"

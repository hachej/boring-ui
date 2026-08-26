import type { BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { createTasksPlugin } from "./descriptor"

const tasksPlugin: BoringFrontFactoryWithId = createTasksPlugin()

export default tasksPlugin
export { createTasksPlugin } from "./descriptor"
export { TaskKanbanBoard } from "./TaskKanbanBoard"
export { TasksOverlay } from "./TasksOverlay"
export { createGitHubIssuesAdapter } from "./githubIssuesAdapter"
export { createHttpTaskAdapter, listHttpTaskSources, TaskHttpError } from "./httpTaskAdapter"
export { createMockTaskAdapter } from "./mockAdapter"
export type {
  BoringTaskAdapter,
  BoringTaskAdapterCapabilities,
  BoringTaskAdapterSummary,
  BoringTaskBoardConfig,
  BoringTaskCard,
  BoringTaskColumn,
  BoringTaskDetail,
  BoringTaskEpicRef,
  BoringTaskErrorCode,
  BoringTaskMetadataItem,
  BoringTaskMoveInput,
  BoringTaskRelation,
  BoringTaskSourceError,
  BoringTaskStatusId,
  BoringTaskSessionLink,
} from "../shared"

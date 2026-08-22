import { lazy, Suspense } from "react"
import { definePlugin, type BoringFrontAppLeftOverlayProps, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"

function TasksGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.75 6.9l.45.45 1.05-1.2M4.75 11.9l.45.45 1.05-1.2M4.75 16.9l.45.45 1.05-1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const LazyTasksOverlay = lazy(async () => {
  const module = await import("./TasksOverlay")
  return { default: module.TasksOverlay }
})

function TasksOverlayRegistration(props: BoringFrontAppLeftOverlayProps) {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">Loading Tasks…</div>}>
      <LazyTasksOverlay {...props} />
    </Suspense>
  )
}

export function createTasksPlugin(): BoringFrontFactoryWithId {
  return definePlugin({
    id: TASKS_PLUGIN_ID,
    label: TASKS_PLUGIN_LABEL,
    appLeftActions: [
      {
        id: "tasks",
        label: TASKS_PLUGIN_LABEL,
        icon: TasksGlyph,
        overlay: TasksOverlayRegistration,
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

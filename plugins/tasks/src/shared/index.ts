export const TASKS_PLUGIN_ID = "tasks"
export const TASKS_PLUGIN_LABEL = "Tasks"
export const TASKS_ROUTE_PREFIX = "/api/boring-tasks"

export interface BoringTaskSessionBinding {
  id: string
  workspaceId: string
  /** Opaque, adapter-scoped — task.id means different things per adapter. */
  adapterId: string
  taskId: string
  sessionId: string
  title?: string
  createdAt: string
}

export type BoringTaskSessionLink = BoringTaskSessionBinding

export type BoringTaskStatusId = string

export interface BoringTaskColumn {
  id: BoringTaskStatusId
  title: string
  description?: string
  color?: string
  acceptsDrop?: boolean
}

export interface BoringTaskBoardConfig {
  adapterId: string
  columns: BoringTaskColumn[]
  defaultColumnId?: BoringTaskStatusId
}

export interface BoringTaskEpicRef {
  id: string
  title: string
  url?: string
}

export interface BoringTaskPullRequestRef {
  id: string
  number: string
  title: string
  url?: string
  state?: string
}

export interface BoringTaskCard {
  id: string
  /** Display identifier only, adapter-scoped. `id` is the stable key. */
  number: string
  title: string
  description?: string
  statusId: BoringTaskStatusId
  tags?: string[]
  /** Optional higher-level grouping from the native task system: GitHub milestone, Linear project, Kata epic, etc. */
  epic?: BoringTaskEpicRef
  /** Allows card-level actions to route back to the owning adapter. */
  adapterId: string
  /** Open or otherwise associated pull requests discovered by the adapter. */
  pullRequests?: BoringTaskPullRequestRef[]
  url?: string
}

export interface BoringTaskAdapterCapabilities {
  move: boolean
  delete?: boolean
}

export interface BoringTaskAdapterSummary {
  id: string
  label: string
  description?: string
  capabilities: BoringTaskAdapterCapabilities
}

export interface BoringTaskMoveInput {
  taskId: string
  statusId: BoringTaskStatusId
}

export interface BoringTaskDeleteInput {
  taskId: string
}

export interface BoringTaskAdapter extends BoringTaskAdapterSummary {
  getBoardConfig(): Promise<BoringTaskBoardConfig> | BoringTaskBoardConfig
  listTasks(): Promise<BoringTaskCard[]> | BoringTaskCard[]
  moveTask?(input: BoringTaskMoveInput): Promise<BoringTaskCard> | BoringTaskCard
  deleteTask?(input: BoringTaskDeleteInput): Promise<void> | void
}

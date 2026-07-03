export const TASKS_PLUGIN_ID = "tasks"
export const TASKS_PLUGIN_LABEL = "Tasks"
export const TASKS_ROUTE_PREFIX = "/api/boring-tasks"

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

export interface BoringTaskCard {
  id: string
  /** Display identifier only, adapter-scoped. `id` is the stable key. */
  number: string
  title: string
  description?: string
  statusId: BoringTaskStatusId
  tags?: string[]
  /** Allows card-level actions to route back to the owning adapter. */
  adapterId: string
  url?: string
}

export interface BoringTaskAdapterCapabilities {
  move: boolean
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

export interface BoringTaskAdapter extends BoringTaskAdapterSummary {
  getBoardConfig(): Promise<BoringTaskBoardConfig> | BoringTaskBoardConfig
  listTasks(): Promise<BoringTaskCard[]> | BoringTaskCard[]
  moveTask?(input: BoringTaskMoveInput): Promise<BoringTaskCard> | BoringTaskCard
}

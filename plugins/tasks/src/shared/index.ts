export const TASKS_PLUGIN_ID = "tasks"
export const TASKS_PLUGIN_LABEL = "Tasks"
export const TASKS_ROUTE_PREFIX = "/api/boring-tasks"

export type BoringTaskStatusId = string

export const BORING_TASK_ERROR_CODES = [
  "TASK_INVALID_BODY",
  "TASK_BEADS_ID_INVALID",
  "TASK_SOURCE_NOT_FOUND",
  "TASK_NOT_FOUND",
  "TASK_BEADS_NOT_FOUND",
  "TASK_BEADS_STORE_NOT_FOUND",
  "TASK_SOURCE_DETAIL_UNSUPPORTED",
  "TASK_INVALID_ID",
  "TASK_STATUS_NOT_FOUND",
  "TASK_GITHUB_COMMAND_FAILED",
  "TASK_GITHUB_REPO_NOT_FOUND",
  "TASK_SOURCE_MOVE_UNSUPPORTED",
  "TASK_SOURCE_DELETE_UNSUPPORTED",
  "TASK_BEADS_STORE_UNHEALTHY",
  "TASK_BEADS_RUNTIME_UNAVAILABLE",
  "TASK_BEADS_VERSION_UNSUPPORTED",
  "TASK_BEADS_BINARY_NOT_FOUND",
  "TASK_BEADS_TIMEOUT",
  "TASK_BEADS_OUTPUT_TOO_LARGE",
  "TASK_BEADS_COMMAND_FAILED",
  "TASK_BEADS_INVALID_JSON",
  "TASK_BEADS_INVALID_RESPONSE",
  "TASK_BEADS_DUPLICATE_ID",
  "TASK_SOURCE_LIST_FAILED",
  "TASK_SOURCE_ERROR",
] as const

export type BoringTaskErrorCode = (typeof BORING_TASK_ERROR_CODES)[number]

export interface BoringTaskSourceError {
  sourceId: string
  code: BoringTaskErrorCode
  message: string
  retryable: boolean
  stale: boolean
}

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
  /** Compact plain-text preview. Full text belongs in BoringTaskDetail. */
  description?: string
  statusId: BoringTaskStatusId
  tags?: string[]
  priority?: string
  issueType?: string
  assignee?: string
  /** Optional higher-level grouping from the native task system: GitHub milestone, Linear project, Kata epic, etc. */
  epic?: BoringTaskEpicRef
  /** Allows card-level actions to route back to the owning adapter. */
  adapterId: string
  /** Open or otherwise associated pull requests discovered by the adapter. */
  pullRequests?: BoringTaskPullRequestRef[]
  url?: string
}

export type BoringTaskRelationDirection = "parent" | "child" | "blocked-by" | "blocks" | "related"

export interface BoringTaskRelation {
  id: string
  title?: string
  status?: string
  nativeType?: string
  direction: BoringTaskRelationDirection
}

export interface BoringTaskMetadataItem {
  id: string
  label: string
  value: string
}

export interface BoringTaskDetail {
  task: BoringTaskCard
  body?: string
  acceptanceCriteria?: string
  notes?: string
  metadata: BoringTaskMetadataItem[]
  relations: BoringTaskRelation[]
  updatedAt?: string
}

export interface BoringTaskAdapterCapabilities {
  move: boolean
  delete?: boolean
  detail?: boolean
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

export interface BoringTaskGetInput {
  taskId: string
}

export interface BoringTaskAdapter extends BoringTaskAdapterSummary {
  getBoardConfig(): Promise<BoringTaskBoardConfig> | BoringTaskBoardConfig
  listTasks(): Promise<BoringTaskCard[]> | BoringTaskCard[]
  getTask?(input: BoringTaskGetInput): Promise<BoringTaskDetail> | BoringTaskDetail
  moveTask?(input: BoringTaskMoveInput): Promise<BoringTaskCard> | BoringTaskCard
  deleteTask?(input: BoringTaskDeleteInput): Promise<void> | void
}

export { TASK_ERROR_CODES, type TaskErrorCode } from "./error-codes"

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
  "TASK_DELETE_APPROVAL_REQUIRED",
  "TASK_SESSION_CURRENT_UNAVAILABLE",
  "TASK_SESSION_FORBIDDEN",
  "TASK_SESSION_INVALID_BODY",
  "TASK_SESSION_LINK_MISSING",
  "TASK_SESSION_LINK_STORE_ERROR",
  "TASK_SESSION_LINK_STORE_INVALID",
  "TASK_SOURCE_FORBIDDEN",
  "TASK_STATUS_NOT_ACCEPTING",
  "TASK_TOOL_CONTEXT_UNAVAILABLE",
  "TASK_TOOL_ERROR",
  "TASK_TOOL_FORBIDDEN",
] as const

export type BoringTaskErrorCode = (typeof BORING_TASK_ERROR_CODES)[number]

export const BORING_TASK_ERROR_DEFINITIONS: Readonly<Record<BoringTaskErrorCode, { status: number; retryable: boolean }>> = Object.freeze({
  TASK_INVALID_BODY: { status: 400, retryable: false },
  TASK_BEADS_ID_INVALID: { status: 400, retryable: false },
  TASK_SOURCE_NOT_FOUND: { status: 404, retryable: false },
  TASK_NOT_FOUND: { status: 404, retryable: false },
  TASK_BEADS_NOT_FOUND: { status: 404, retryable: false },
  TASK_BEADS_STORE_NOT_FOUND: { status: 404, retryable: false },
  TASK_SOURCE_DETAIL_UNSUPPORTED: { status: 409, retryable: false },
  TASK_INVALID_ID: { status: 400, retryable: false },
  TASK_STATUS_NOT_FOUND: { status: 400, retryable: false },
  TASK_GITHUB_COMMAND_FAILED: { status: 502, retryable: true },
  TASK_GITHUB_REPO_NOT_FOUND: { status: 404, retryable: false },
  TASK_SOURCE_MOVE_UNSUPPORTED: { status: 409, retryable: false },
  TASK_SOURCE_DELETE_UNSUPPORTED: { status: 409, retryable: false },
  TASK_BEADS_STORE_UNHEALTHY: { status: 409, retryable: true },
  TASK_BEADS_RUNTIME_UNAVAILABLE: { status: 409, retryable: false },
  TASK_BEADS_VERSION_UNSUPPORTED: { status: 409, retryable: false },
  TASK_BEADS_BINARY_NOT_FOUND: { status: 503, retryable: false },
  TASK_BEADS_TIMEOUT: { status: 504, retryable: true },
  TASK_BEADS_OUTPUT_TOO_LARGE: { status: 502, retryable: true },
  TASK_BEADS_COMMAND_FAILED: { status: 502, retryable: true },
  TASK_BEADS_INVALID_JSON: { status: 502, retryable: true },
  TASK_BEADS_INVALID_RESPONSE: { status: 502, retryable: true },
  TASK_BEADS_DUPLICATE_ID: { status: 502, retryable: false },
  TASK_SOURCE_LIST_FAILED: { status: 502, retryable: true },
  TASK_SOURCE_ERROR: { status: 500, retryable: true },
  TASK_DELETE_APPROVAL_REQUIRED: { status: 409, retryable: false },
  TASK_SESSION_CURRENT_UNAVAILABLE: { status: 409, retryable: false },
  TASK_SESSION_FORBIDDEN: { status: 403, retryable: false },
  TASK_SESSION_INVALID_BODY: { status: 400, retryable: false },
  TASK_SESSION_LINK_MISSING: { status: 404, retryable: false },
  TASK_SESSION_LINK_STORE_ERROR: { status: 500, retryable: true },
  TASK_SESSION_LINK_STORE_INVALID: { status: 500, retryable: false },
  TASK_SOURCE_FORBIDDEN: { status: 403, retryable: false },
  TASK_STATUS_NOT_ACCEPTING: { status: 409, retryable: false },
  TASK_TOOL_CONTEXT_UNAVAILABLE: { status: 409, retryable: false },
  TASK_TOOL_ERROR: { status: 500, retryable: true },
  TASK_TOOL_FORBIDDEN: { status: 403, retryable: false },
})

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

export interface BoringTaskSessionLink {
  id: string
  adapterId: string
  taskId: string
  agentTypeId: string
  sessionId: string
  createdAt: string
}

export interface HumanIntentionTaskRef {
  adapterId: string
  taskId: string
  number: string
  title: string
  statusId: string
  url?: string
}

export interface SessionTaskMatch {
  sessionId: string
  tasks: HumanIntentionTaskRef[]
}

export interface SessionTaskResolution {
  matches: SessionTaskMatch[]
  omittedSessionIds: string[]
}

export interface SessionHandoverSummary {
  id: string
  runId: string
  terminalEntryId: string
  createdAt?: string
  artifacts: import("@hachej/boring-workspace/shared").HumanArtifact[]
}

export interface TaskSessionRef {
  agentTypeId: string
  sessionId: string
}

export interface SessionHandoverMatch extends TaskSessionRef {
  handover: SessionHandoverSummary
}

export interface SessionHandoverResolution {
  matches: SessionHandoverMatch[]
  omittedSessions: TaskSessionRef[]
}

export interface BoringTaskAdapterCapabilities {
  move: boolean
  delete?: boolean
  /** Adapter-defined effect; GitHub currently closes rather than permanently deletes. */
  deleteEffect?: "close" | "delete"
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

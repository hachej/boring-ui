import { BORING_TASK_ERROR_DEFINITIONS } from "../shared"
import type {
  BoringTaskBoardConfig,
  BoringTaskCard,
  BoringTaskDetail,
  BoringTaskErrorCode,
  BoringTaskMoveInput,
  BoringTaskSourceError,
} from "../shared"
import type { BoringTaskSourceContext, BoringTaskSourceRegistry, BoringTaskSourceRuntime, BoringTaskSourceSummary } from "./sourceRuntime"
import { TaskDetailValidationError, validateTaskDetail } from "./taskDtoValidation"

export class TaskSourceServiceError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(
    _status: number,
    readonly code: BoringTaskErrorCode,
    message: string,
    _retryable?: boolean,
  ) {
    super(message)
    this.name = "TaskSourceServiceError"
    const definition = BORING_TASK_ERROR_DEFINITIONS[code]
    this.status = definition.status
    this.retryable = definition.retryable
  }
}

export interface TaskListInput {
  sourceIds?: string[]
}

export interface TaskListOutput {
  configs: Record<string, BoringTaskBoardConfig>
  tasks: BoringTaskCard[]
  errors: Record<string, BoringTaskSourceError>
}

export interface TaskGetInput {
  sourceId: string
  taskId: string
}

export interface TaskMoveInput extends BoringTaskMoveInput {
  sourceId: string
}

export interface TaskDeleteInput {
  sourceId: string
  taskId: string
}

function selectedSources(registry: BoringTaskSourceRegistry, sourceIds?: readonly string[]): BoringTaskSourceRuntime[] {
  if (!sourceIds?.length) return registry.listSources()
  return sourceIds.map((sourceId) => {
    const source = registry.getSource(sourceId)
    if (!source) throw new TaskSourceServiceError(404, "TASK_SOURCE_NOT_FOUND", `Task source not found: ${sourceId}`)
    return source
  })
}

function sourceListError(sourceId: string, cause: unknown): BoringTaskSourceError {
  if (cause instanceof TaskSourceServiceError) {
    return {
      sourceId,
      code: cause.code,
      message: cause.message,
      retryable: cause.retryable,
      stale: false,
    }
  }
  return {
    sourceId,
    code: "TASK_SOURCE_LIST_FAILED",
    message: "Task source failed to load.",
    retryable: true,
    stale: false,
  }
}

function directSourceError(cause: unknown): TaskSourceServiceError {
  if (cause instanceof TaskSourceServiceError) return cause
  if (cause instanceof TaskDetailValidationError) {
    return new TaskSourceServiceError(502, "TASK_SOURCE_ERROR", "Task source returned invalid detail.", true)
  }
  return new TaskSourceServiceError(500, "TASK_SOURCE_ERROR", "Task source request failed.", true)
}

export function createTaskSourceService(registry: BoringTaskSourceRegistry) {
  return {
    listSources(): BoringTaskSourceSummary[] {
      return registry.listSources().map((source) => source.summary())
    },

    async listTasks(ctx: BoringTaskSourceContext, input: TaskListInput = {}): Promise<TaskListOutput> {
      const selected = selectedSources(registry, input.sourceIds)
      const entries = await Promise.all(selected.map(async (source) => {
        const summary = source.summary()
        try {
          const [config, tasks] = await Promise.all([source.getBoardConfig(ctx), source.listTasks(ctx)])
          return { ok: true as const, sourceId: summary.id, config, tasks }
        } catch (cause) {
          return { ok: false as const, sourceId: summary.id, error: sourceListError(summary.id, cause) }
        }
      }))

      return {
        configs: Object.fromEntries(entries.flatMap((entry) => entry.ok ? [[entry.sourceId, entry.config]] : [])),
        tasks: entries.flatMap((entry) => entry.ok ? entry.tasks : []),
        errors: Object.fromEntries(entries.flatMap((entry) => entry.ok ? [] : [[entry.sourceId, entry.error]])),
      }
    },

    async getTask(ctx: BoringTaskSourceContext, input: TaskGetInput): Promise<BoringTaskDetail> {
      const source = registry.getSource(input.sourceId)
      if (!source) throw new TaskSourceServiceError(404, "TASK_SOURCE_NOT_FOUND", `Task source not found: ${input.sourceId}`)
      if (!source.summary().capabilities.detail || !source.getTask) {
        throw new TaskSourceServiceError(409, "TASK_SOURCE_DETAIL_UNSUPPORTED", `Task source does not support detail: ${input.sourceId}`)
      }
      try {
        const detail = await source.getTask(ctx, { taskId: input.taskId })
        if (!detail) throw new TaskSourceServiceError(404, "TASK_NOT_FOUND", `Task not found: ${input.taskId}`)
        return validateTaskDetail(detail)
      } catch (cause) {
        throw directSourceError(cause)
      }
    },

    async moveTask(ctx: BoringTaskSourceContext, input: TaskMoveInput): Promise<BoringTaskCard> {
      const source = registry.getSource(input.sourceId)
      if (!source) throw new TaskSourceServiceError(404, "TASK_SOURCE_NOT_FOUND", `Task source not found: ${input.sourceId}`)
      if (!source.summary().capabilities.move || !source.moveTask) {
        throw new TaskSourceServiceError(409, "TASK_SOURCE_MOVE_UNSUPPORTED", `Task source does not support moves: ${input.sourceId}`)
      }
      try {
        return await source.moveTask(ctx, { taskId: input.taskId, statusId: input.statusId })
      } catch (cause) {
        throw directSourceError(cause)
      }
    },

    async deleteTask(ctx: BoringTaskSourceContext, input: TaskDeleteInput): Promise<void> {
      const source = registry.getSource(input.sourceId)
      if (!source) throw new TaskSourceServiceError(404, "TASK_SOURCE_NOT_FOUND", `Task source not found: ${input.sourceId}`)
      if (!source.summary().capabilities.delete || !source.deleteTask) {
        throw new TaskSourceServiceError(409, "TASK_SOURCE_DELETE_UNSUPPORTED", `Task source does not support issue deletion: ${input.sourceId}`)
      }
      try {
        await source.deleteTask(ctx, { taskId: input.taskId })
      } catch (cause) {
        throw directSourceError(cause)
      }
    },
  }
}

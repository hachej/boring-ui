import type { BoringTaskBoardConfig, BoringTaskCard, BoringTaskMoveInput } from "../shared"
import type { BoringTaskSourceContext, BoringTaskSourceRegistry, BoringTaskSourceSummary } from "./sourceRuntime"

export class TaskSourceServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = "TaskSourceServiceError"
  }
}

export interface TaskListInput {
  sourceIds?: string[]
}

export interface TaskListOutput {
  configs: Record<string, BoringTaskBoardConfig>
  tasks: BoringTaskCard[]
}

export interface TaskMoveInput extends BoringTaskMoveInput {
  sourceId: string
}

export function createTaskSourceService(registry: BoringTaskSourceRegistry) {
  return {
    listSources(): BoringTaskSourceSummary[] {
      return registry.listSources().map((source) => source.summary())
    },

    async listTasks(ctx: BoringTaskSourceContext, input: TaskListInput = {}): Promise<TaskListOutput> {
      const selected = input.sourceIds?.length
        ? input.sourceIds.map((sourceId) => {
          const source = registry.getSource(sourceId)
          if (!source) throw new TaskSourceServiceError(404, "TASK_SOURCE_NOT_FOUND", `Task source not found: ${sourceId}`)
          return source
        })
        : registry.listSources()

      const entries = await Promise.all(selected.map(async (source) => {
        const summary = source.summary()
        const [config, tasks] = await Promise.all([source.getBoardConfig(ctx), source.listTasks(ctx)])
        return { sourceId: summary.id, config, tasks }
      }))

      return {
        configs: Object.fromEntries(entries.map((entry) => [entry.sourceId, entry.config])),
        tasks: entries.flatMap((entry) => entry.tasks),
      }
    },

    async moveTask(ctx: BoringTaskSourceContext, input: TaskMoveInput): Promise<BoringTaskCard> {
      const source = registry.getSource(input.sourceId)
      if (!source) throw new TaskSourceServiceError(404, "TASK_SOURCE_NOT_FOUND", `Task source not found: ${input.sourceId}`)
      if (!source.summary().capabilities.move || !source.moveTask) {
        throw new TaskSourceServiceError(409, "TASK_SOURCE_MOVE_UNSUPPORTED", `Task source does not support moves: ${input.sourceId}`)
      }
      return await source.moveTask(ctx, { taskId: input.taskId, statusId: input.statusId })
    },
  }
}

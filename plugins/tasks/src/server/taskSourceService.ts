import { TASK_ERROR_CODES } from "../shared"
import type { BoringTaskBoardConfig, BoringTaskCard, BoringTaskMoveInput, BoringTaskSessionLink, HumanIntentionTaskRef, SessionTaskResolution } from "../shared"
import type { BoringTaskSourceContext, BoringTaskSourceRegistry, BoringTaskSourceSummary } from "./sourceRuntime"
import type { TaskSessionLinkStore } from "./taskSessionLinkStore"

const MAX_MANAGED_TASKS = 100
const MAX_LEGACY_LOOKUP_TASKS = 500
const MAX_REVERSE_TASKS_PER_SESSION = 25
const MAX_REVERSE_TASKS_TOTAL = 200

export class TaskSourceServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = "TaskSourceServiceError"
  }
}

export interface TaskListInput {
  /** Existing HTTP compatibility. */
  sourceIds?: string[]
  adapterId?: string
  statusId?: string
  query?: string
  limit?: number
}

export interface TaskListOutput {
  configs: Record<string, BoringTaskBoardConfig>
  tasks: BoringTaskCard[]
}

export interface TaskKeyInput {
  adapterId: string
  taskId: string
}

export interface TaskMoveInput extends BoringTaskMoveInput {
  /** Existing HTTP compatibility. */
  sourceId?: string
  adapterId?: string
}

export interface TaskDeleteInput {
  /** Existing HTTP compatibility. */
  sourceId?: string
  adapterId?: string
  taskId: string
}

export interface TaskSessionBindingContext {
  linkStore: TaskSessionLinkStore
  authorizeSession(sessionId: string): Promise<void>
}

export interface TaskManagementService {
  listSources(): BoringTaskSourceSummary[]
  getAdapterContext(ctx: BoringTaskSourceContext, adapterId: string): Promise<{ summary: BoringTaskSourceSummary; config: BoringTaskBoardConfig }>
  listTasks(ctx: BoringTaskSourceContext, input?: TaskListInput): Promise<TaskListOutput>
  getTask(ctx: BoringTaskSourceContext, input: TaskKeyInput): Promise<BoringTaskCard>
  moveTask(ctx: BoringTaskSourceContext, input: TaskMoveInput): Promise<BoringTaskCard>
  deleteTask(ctx: BoringTaskSourceContext, input: TaskDeleteInput): Promise<void>
  listSessionLinks(input: TaskKeyInput, binding: Pick<TaskSessionBindingContext, "linkStore">): Promise<BoringTaskSessionLink[]>
  bindSession(ctx: BoringTaskSourceContext, input: TaskKeyInput & { sessionId: string }, binding: TaskSessionBindingContext): Promise<BoringTaskSessionLink>
  unlinkSession(linkId: string, binding: Pick<TaskSessionBindingContext, "linkStore">): Promise<BoringTaskSessionLink>
  resolveSessionTasks(ctx: BoringTaskSourceContext, sessionIds: readonly string[], binding: TaskSessionBindingContext): Promise<SessionTaskResolution>
}

function adapterIdFromInput(input: { adapterId?: string; sourceId?: string }): string {
  const adapterId = input.adapterId?.trim() || input.sourceId?.trim()
  if (!adapterId) throw new TaskSourceServiceError(400, TASK_ERROR_CODES.INVALID_BODY, "adapterId must be a non-empty string")
  return adapterId
}

function normalizedLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MANAGED_TASKS) {
    throw new TaskSourceServiceError(400, TASK_ERROR_CODES.INVALID_BODY, `limit must be an integer from 1 to ${MAX_MANAGED_TASKS}`)
  }
  return limit
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function taskMatchesQuery(task: BoringTaskCard, query: string): boolean {
  const needle = query.toLowerCase()
  return [task.id, task.number, task.title, task.description ?? "", ...(task.tags ?? [])]
    .some((value) => value.toLowerCase().includes(needle))
}

export function createTaskSourceService(registry: BoringTaskSourceRegistry): TaskManagementService {
  const sourceFor = (adapterId: string) => {
    const source = registry.getSource(adapterId)
    if (!source) throw new TaskSourceServiceError(404, TASK_ERROR_CODES.SOURCE_NOT_FOUND, `Task source not found: ${adapterId}`)
    return source
  }

  const service: TaskManagementService = {
    listSources(): BoringTaskSourceSummary[] {
      return registry.listSources().map((source) => source.summary())
    },

    async getAdapterContext(ctx, adapterId) {
      const source = sourceFor(adapterId)
      return { summary: source.summary(), config: await source.getBoardConfig(ctx) }
    },

    async listTasks(ctx, input = {}): Promise<TaskListOutput> {
      const selectedIds = input.adapterId ? [input.adapterId] : input.sourceIds
      const selected = selectedIds?.length ? selectedIds.map(sourceFor) : registry.listSources()
      const limit = normalizedLimit(input.limit)
      const query = input.query?.trim()

      const entries = await Promise.all(selected.map(async (source) => {
        const summary = source.summary()
        const [config, listed] = await Promise.all([source.getBoardConfig(ctx), source.listTasks(ctx)])
        const tasks = listed.filter((task) => (
          (!input.statusId || task.statusId === input.statusId)
          && (!query || taskMatchesQuery(task, query))
        ))
        return { sourceId: summary.id, config, tasks }
      }))

      const tasks = entries.flatMap((entry) => entry.tasks)
      return {
        configs: Object.fromEntries(entries.map((entry) => [entry.sourceId, entry.config])),
        tasks: limit === undefined ? tasks : tasks.slice(0, limit),
      }
    },

    async getTask(ctx, input): Promise<BoringTaskCard> {
      const adapterId = adapterIdFromInput(input)
      const taskId = input.taskId.trim()
      if (!taskId) throw new TaskSourceServiceError(400, TASK_ERROR_CODES.INVALID_ID, "taskId must be a non-empty string")
      const source = sourceFor(adapterId)
      const task = source.getTask
        ? await source.getTask(ctx, taskId)
        : (await source.listTasks(ctx)).slice(0, MAX_LEGACY_LOOKUP_TASKS).find((candidate) => candidate.id === taskId)
      if (!task) throw new TaskSourceServiceError(404, TASK_ERROR_CODES.NOT_FOUND, `Task not found: ${adapterId}/${taskId}`)
      return task
    },

    async moveTask(ctx, input): Promise<BoringTaskCard> {
      const adapterId = adapterIdFromInput(input)
      const source = sourceFor(adapterId)
      if (!source.summary().capabilities.move || !source.moveTask) {
        throw new TaskSourceServiceError(409, TASK_ERROR_CODES.SOURCE_MOVE_UNSUPPORTED, `Task source does not support moves: ${adapterId}`)
      }
      const config = await source.getBoardConfig(ctx)
      const destination = config.columns.find((column) => column.id === input.statusId)
      if (!destination) {
        throw new TaskSourceServiceError(400, TASK_ERROR_CODES.STATUS_NOT_FOUND, `Task status not found: ${input.statusId}`)
      }
      if (destination.acceptsDrop === false) {
        throw new TaskSourceServiceError(409, TASK_ERROR_CODES.STATUS_NOT_ACCEPTING, `Task status does not accept moves: ${input.statusId}`)
      }
      await service.getTask(ctx, { adapterId, taskId: input.taskId })
      return await source.moveTask(ctx, { taskId: input.taskId, statusId: input.statusId })
    },

    async deleteTask(ctx, input): Promise<void> {
      const adapterId = adapterIdFromInput(input)
      const source = sourceFor(adapterId)
      if (!source.summary().capabilities.delete || !source.deleteTask) {
        throw new TaskSourceServiceError(409, TASK_ERROR_CODES.SOURCE_DELETE_UNSUPPORTED, `Task source does not support issue deletion: ${adapterId}`)
      }
      await service.getTask(ctx, { adapterId, taskId: input.taskId })
      await source.deleteTask(ctx, { taskId: input.taskId })
    },

    async listSessionLinks(input, binding): Promise<BoringTaskSessionLink[]> {
      return await binding.linkStore.list(input.adapterId, input.taskId)
    },

    async bindSession(ctx, input, binding): Promise<BoringTaskSessionLink> {
      await service.getTask(ctx, input)
      await binding.authorizeSession(input.sessionId)
      return await binding.linkStore.link(input)
    },

    async unlinkSession(linkId, binding): Promise<BoringTaskSessionLink> {
      return await binding.linkStore.unlink(linkId)
    },

    async resolveSessionTasks(ctx, sessionIds, binding): Promise<SessionTaskResolution> {
      const authorized: string[] = []
      const omitted = new Set<string>()
      for (const sessionId of sessionIds) {
        try {
          await binding.authorizeSession(sessionId)
          authorized.push(sessionId)
        } catch {
          omitted.add(sessionId)
        }
      }

      const linksBySession = await binding.linkStore.listBySessionIds(authorized)
      const matches: SessionTaskResolution["matches"] = []
      let total = 0
      for (const sessionId of authorized) {
        const tasks: HumanIntentionTaskRef[] = []
        for (const link of linksBySession.get(sessionId) ?? []) {
          if (tasks.length >= MAX_REVERSE_TASKS_PER_SESSION || total >= MAX_REVERSE_TASKS_TOTAL) break
          try {
            const task = await service.getTask(ctx, { adapterId: link.adapterId, taskId: link.taskId })
            tasks.push({
              adapterId: task.adapterId,
              taskId: task.id,
              number: task.number,
              title: task.title,
              statusId: task.statusId,
              ...(task.url ? { url: task.url } : {}),
            })
            total += 1
          } catch (cause) {
            if (cause instanceof TaskSourceServiceError && cause.status === 404) continue
            throw cause
          }
        }
        tasks.sort((left, right) => compareText(left.adapterId, right.adapterId) || compareText(left.taskId, right.taskId))
        if (tasks.length > 0) matches.push({ sessionId, tasks })
        else omitted.add(sessionId)
      }
      return { matches, omittedSessionIds: sessionIds.filter((sessionId) => omitted.has(sessionId)) }
    },

  }

  return service
}

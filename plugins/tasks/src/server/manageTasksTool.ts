import { TASK_ERROR_CODES } from "../shared"
import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace"
import { TaskSessionLinkStoreError } from "./taskSessionLinkStore"
import { TaskSourceServiceError, type TaskManagementService } from "./taskSourceService"
import { TaskToolBindingError, type TrustedTaskToolBindingResolver } from "./taskToolBinding"

const MAX_ID_BYTES = 512
const DEFAULT_LIST_LIMIT = 20
const encoder = new TextEncoder()

type ManageTasksInput =
  | { action: "list"; adapterId?: string; statusId?: string; query?: string; limit?: number }
  | { action: "get"; adapterId: string; taskId: string }
  | { action: "move"; adapterId: string; taskId: string; statusId: string }
  | { action: "bind_session"; adapterId: string; taskId: string; session: "current" | { id: string } }
  | { action: "unlink_session"; linkId: string }

class ManageTasksInputError extends Error {
  readonly code = TASK_ERROR_CODES.INVALID_BODY
}

class ManageTasksOperationError extends Error {
  constructor(readonly code: typeof TASK_ERROR_CODES.SESSION_CURRENT_UNAVAILABLE, message: string) {
    super(message)
  }
}

const idSchema = { type: "string", minLength: 1, maxLength: MAX_ID_BYTES }
const exactObject = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

export const manageTasksParameters = {
  oneOf: [
    exactObject({
      action: { const: "list" },
      adapterId: idSchema,
      statusId: idSchema,
      query: { type: "string", minLength: 1, maxLength: 512 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }, ["action"]),
    exactObject({ action: { const: "get" }, adapterId: idSchema, taskId: idSchema }, ["action", "adapterId", "taskId"]),
    exactObject({ action: { const: "move" }, adapterId: idSchema, taskId: idSchema, statusId: idSchema }, ["action", "adapterId", "taskId", "statusId"]),
    exactObject({
      action: { const: "bind_session" },
      adapterId: idSchema,
      taskId: idSchema,
      session: {
        oneOf: [
          { const: "current" },
          exactObject({ id: idSchema }, ["id"]),
        ],
      },
    }, ["action", "adapterId", "taskId", "session"]),
    exactObject({ action: { const: "unlink_session" }, linkId: idSchema }, ["action", "linkId"]),
  ],
} satisfies Record<string, unknown>

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ManageTasksInputError("input must be an object")
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: string[], required: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) {
    throw new ManageTasksInputError(`input must contain only ${allowed.join(", ")}`)
  }
}

function text(value: unknown, label: string, optional = false): string | undefined {
  if (optional && value === undefined) return undefined
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized || encoder.encode(normalized).byteLength > MAX_ID_BYTES) {
    throw new ManageTasksInputError(`${label} must be a non-empty string of at most ${MAX_ID_BYTES} UTF-8 bytes`)
  }
  return normalized
}

export function parseManageTasksInput(params: Record<string, unknown>): ManageTasksInput {
  const value = object(params)
  const action = text(value.action, "action")
  switch (action) {
    case "list": {
      exactKeys(value, ["action", "adapterId", "statusId", "query", "limit"], ["action"])
      const limit = value.limit === undefined ? DEFAULT_LIST_LIMIT : value.limit
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new ManageTasksInputError("limit must be an integer from 1 to 100")
      const adapterId = text(value.adapterId, "adapterId", true)
      const statusId = text(value.statusId, "statusId", true)
      const query = text(value.query, "query", true)
      return {
        action,
        ...(adapterId ? { adapterId } : {}),
        ...(statusId ? { statusId } : {}),
        ...(query ? { query } : {}),
        limit: limit as number,
      }
    }
    case "get":
      exactKeys(value, ["action", "adapterId", "taskId"], ["action", "adapterId", "taskId"])
      return { action, adapterId: text(value.adapterId, "adapterId")!, taskId: text(value.taskId, "taskId")! }
    case "move":
      exactKeys(value, ["action", "adapterId", "taskId", "statusId"], ["action", "adapterId", "taskId", "statusId"])
      return { action, adapterId: text(value.adapterId, "adapterId")!, taskId: text(value.taskId, "taskId")!, statusId: text(value.statusId, "statusId")! }
    case "bind_session": {
      exactKeys(value, ["action", "adapterId", "taskId", "session"], ["action", "adapterId", "taskId", "session"])
      let session: "current" | { id: string }
      if (value.session === "current") session = "current"
      else {
        const sessionValue = object(value.session)
        exactKeys(sessionValue, ["id"], ["id"])
        session = { id: text(sessionValue.id, "session.id")! }
      }
      return { action, adapterId: text(value.adapterId, "adapterId")!, taskId: text(value.taskId, "taskId")!, session }
    }
    case "unlink_session":
      exactKeys(value, ["action", "linkId"], ["action", "linkId"])
      return { action, linkId: text(value.linkId, "linkId")! }
    default:
      throw new ManageTasksInputError("action must be list, get, move, bind_session, or unlink_session")
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled manage_tasks action: ${String(value)}`)
}

function success(action: ManageTasksInput["action"], textContent: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: textContent }], details: { ok: true, action, ...details } }
}

function listText(result: Awaited<ReturnType<TaskManagementService["listTasks"]>>, sources: ReturnType<TaskManagementService["listSources"]>): string {
  const taskRefs = result.tasks.map((task) => ({
    adapterId: task.adapterId,
    taskId: task.id,
    number: task.number,
    title: task.title.slice(0, 200),
  }))
  return [
    `Found ${result.tasks.length} task(s).`,
    "Exact task references (use adapterId and taskId verbatim; do not guess):",
    JSON.stringify(taskRefs),
    `Available adapterIds: ${JSON.stringify(sources.map((source) => source.id))}`,
  ].join("\n")
}

function failure(action: unknown, error: unknown): ToolResult {
  const known = error instanceof ManageTasksInputError
    || error instanceof ManageTasksOperationError
    || error instanceof TaskSourceServiceError
    || error instanceof TaskSessionLinkStoreError
    || error instanceof TaskToolBindingError
  const code = known ? error.code : TASK_ERROR_CODES.TOOL_ERROR
  const message = known ? error.message : "Task operation failed."
  return {
    isError: true,
    content: [{ type: "text", text: `manage_tasks failed (${code}): ${message}` }],
    details: { ok: false, action: typeof action === "string" ? action : "unknown", code },
  }
}

export function createManageTasksTool(
  service: TaskManagementService,
  bindingResolver: TrustedTaskToolBindingResolver,
): AgentTool {
  return {
    name: "manage_tasks",
    description: "List, inspect, move, and explicitly bind or unlink workspace tasks and native Pi sessions.",
    promptSnippet: "Use `manage_tasks` for explicit task operations. Bind only when the user/workflow identifies the exact task. Never infer a binding from a task number, title, prompt, branch, or session title. After `list`, use the returned adapterId and taskId verbatim; never guess source IDs. Use session `current` for this native Pi session; use `{ id }` only for an exact already-known authorized native session ID.",
    parameters: manageTasksParameters,
    async execute(params, ctx: ToolExecContext): Promise<ToolResult> {
      let action: unknown = params.action
      try {
        const input = parseManageTasksInput(params)
        action = input.action
        const binding = await bindingResolver.resolve(ctx)
        const sourceContext = { workspaceId: binding.actor.workspaceId, workspace: binding.workspace }
        switch (input.action) {
          case "list": {
            const result = await service.listTasks(sourceContext, input)
            const sources = service.listSources()
            return success(input.action, listText(result, sources), { ...result, sources })
          }
          case "get": {
            const [task, adapter, links] = await Promise.all([
              service.getTask(sourceContext, input),
              service.getAdapterContext(sourceContext, input.adapterId),
              service.listSessionLinks(input, binding),
            ])
            return success(input.action, `Task ${task.number}: ${task.title}`, { task, adapter, links })
          }
          case "move": {
            const task = await service.moveTask(sourceContext, input)
            return success(input.action, `Moved task ${task.number} to ${task.statusId}.`, { task })
          }
          case "bind_session": {
            const sessionId = input.session === "current" ? ctx.sessionId?.trim() : input.session.id
            if (!sessionId) {
              return failure(input.action, new ManageTasksOperationError(TASK_ERROR_CODES.SESSION_CURRENT_UNAVAILABLE, "Current native session is unavailable."))
            }
            const link = await service.bindSession(sourceContext, { adapterId: input.adapterId, taskId: input.taskId, sessionId }, binding)
            return success(input.action, `Bound native session ${sessionId} to task ${input.taskId}.`, { link })
          }
          case "unlink_session": {
            const link = await service.unlinkSession(input.linkId, binding)
            return success(input.action, `Unlinked native session ${link.sessionId} from task ${link.taskId}.`, { link })
          }
          default:
            return assertNever(input)
        }
      } catch (error) {
        return failure(action, error)
      }
    },
  }
}

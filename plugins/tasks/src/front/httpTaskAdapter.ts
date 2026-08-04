import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type {
  BoringTaskAdapter,
  BoringTaskAdapterSummary,
  BoringTaskBoardConfig,
  BoringTaskCard,
  BoringTaskDetail,
  BoringTaskErrorCode,
  BoringTaskSourceError,
} from "../shared"

const ROUTE_PREFIX = "/api/boring-tasks"
type TaskHttpClient = Pick<WorkspacePluginClient, "getJson" | "postJson">

interface SourcesResponse { ok?: boolean; sources?: BoringTaskAdapterSummary[]; error?: string }
interface ListResponse {
  ok?: boolean
  configs?: Record<string, BoringTaskBoardConfig>
  tasks?: BoringTaskCard[]
  errors?: Record<string, BoringTaskSourceError>
  error?: string
}
interface GetResponse { ok?: boolean; detail?: BoringTaskDetail; error?: string }
interface MoveResponse { ok?: boolean; task?: BoringTaskCard; error?: string }
interface DeleteResponse { ok?: boolean; error?: string }
interface ErrorResponse { code?: unknown; error?: unknown; message?: unknown; retryable?: unknown }

export class TaskHttpError extends Error {
  constructor(
    readonly code: BoringTaskErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = "TaskHttpError"
  }
}

function errorFromPayload(payload: unknown, status?: number): TaskHttpError | null {
  if (!payload || typeof payload !== "object") return null
  const value = payload as ErrorResponse
  if (typeof value.code !== "string") return null
  const message = typeof value.message === "string"
    ? value.message
    : typeof value.error === "string"
      ? value.error
      : "Task source request failed."
  return new TaskHttpError(
    value.code as BoringTaskErrorCode,
    message,
    value.retryable === true,
    status,
  )
}

async function readError(response: Response): Promise<TaskHttpError> {
  try {
    const body = await response.json() as unknown
    const typed = errorFromPayload(body, response.status)
    if (typed) return typed
  } catch {}
  return new TaskHttpError("TASK_SOURCE_ERROR", "Task source request failed.", response.status >= 500, response.status)
}

function errorFromCause(cause: unknown): Error {
  if (cause instanceof TaskHttpError) return cause
  if (cause && typeof cause === "object") {
    const candidate = cause as { body?: unknown; status?: unknown }
    const typed = errorFromPayload(candidate.body, typeof candidate.status === "number" ? candidate.status : undefined)
    if (typed) return typed
  }
  return cause instanceof Error ? cause : new Error("Task source request failed.")
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) throw await readError(response)
  return await response.json() as T
}

async function getJson<T>(client: TaskHttpClient | undefined, path: string): Promise<T> {
  try {
    return client ? await client.getJson<T>(`${ROUTE_PREFIX}${path}`) : await fetchJson<T>(path)
  } catch (cause) {
    throw errorFromCause(cause)
  }
}

async function postJson<T>(client: TaskHttpClient | undefined, path: string, body: unknown): Promise<T> {
  try {
    return client ? await client.postJson<T>(`${ROUTE_PREFIX}${path}`, body) : await fetchJson<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    })
  } catch (cause) {
    throw errorFromCause(cause)
  }
}

export async function listHttpTaskSources(client?: TaskHttpClient): Promise<BoringTaskAdapterSummary[]> {
  const body = await getJson<SourcesResponse>(client, "/sources")
  return body.sources ?? []
}

export function createHttpTaskAdapter(source: BoringTaskAdapterSummary, client?: TaskHttpClient): BoringTaskAdapter {
  let pendingBoard: Promise<ListResponse> | null = null
  const readBoard = (): Promise<ListResponse> => {
    if (pendingBoard) return pendingBoard
    const request = postJson<ListResponse>(client, "/sources/tasks/list", { sourceIds: [source.id] })
    pendingBoard = request
    void request.then(
      () => { if (pendingBoard === request) pendingBoard = null },
      () => { if (pendingBoard === request) pendingBoard = null },
    )
    return request
  }
  const sourceFailure = (body: ListResponse): TaskHttpError | null => {
    const failure = body.errors?.[source.id]
    return failure ? new TaskHttpError(failure.code, failure.message, failure.retryable) : null
  }

  return {
    ...source,
    async getBoardConfig(): Promise<BoringTaskBoardConfig> {
      const body = await readBoard()
      const failure = sourceFailure(body)
      if (failure) throw failure
      const config = body.configs?.[source.id]
      if (!config) throw new TaskHttpError("TASK_SOURCE_ERROR", `Task source did not return board config: ${source.id}`, true)
      return config
    },
    async listTasks(): Promise<BoringTaskCard[]> {
      const body = await readBoard()
      const failure = sourceFailure(body)
      if (failure) throw failure
      return body.tasks ?? []
    },
    getTask: source.capabilities.detail ? async ({ taskId }) => {
      const body = await postJson<GetResponse>(client, "/sources/tasks/get", { sourceId: source.id, taskId })
      if (!body.detail) throw new TaskHttpError("TASK_NOT_FOUND", `Task not found: ${taskId}`, false, 404)
      return body.detail
    } : undefined,
    moveTask: source.capabilities.move ? async ({ taskId, statusId }) => {
      const body = await postJson<MoveResponse>(client, "/sources/tasks/move", { sourceId: source.id, taskId, statusId })
      if (!body.task) throw new TaskHttpError("TASK_SOURCE_ERROR", `Task source did not return moved task: ${source.id}`, true)
      return body.task
    } : undefined,
    deleteTask: source.capabilities.delete ? async ({ taskId }) => {
      await postJson<DeleteResponse>(client, "/sources/tasks/delete", { sourceId: source.id, taskId })
    } : undefined,
  }
}

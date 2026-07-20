import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type { BoringTaskAdapter, BoringTaskAdapterSummary, BoringTaskBoardConfig, BoringTaskCard } from "../shared"

const ROUTE_PREFIX = "/api/boring-tasks"
type TaskHttpClient = Pick<WorkspacePluginClient, "getJson" | "postJson">

interface SourcesResponse { ok?: boolean; sources?: BoringTaskAdapterSummary[]; error?: string }
interface ListResponse { ok?: boolean; configs?: Record<string, BoringTaskBoardConfig>; tasks?: BoringTaskCard[]; error?: string }
interface MoveResponse { ok?: boolean; task?: BoringTaskCard; error?: string }
interface DeleteResponse { ok?: boolean; error?: string }

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown; message?: unknown }
    const message = body.error ?? body.message
    if (typeof message === "string" && message.length > 0) return message
  } catch {}
  return `${response.status} ${response.statusText}`.trim()
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
  if (!response.ok) throw new Error(await readError(response))
  return await response.json() as T
}

function getJson<T>(client: TaskHttpClient | undefined, path: string): Promise<T> {
  return client ? client.getJson<T>(`${ROUTE_PREFIX}${path}`) : fetchJson<T>(path)
}

function postJson<T>(client: TaskHttpClient | undefined, path: string, body: unknown): Promise<T> {
  return client ? client.postJson<T>(`${ROUTE_PREFIX}${path}`, body) : fetchJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function listHttpTaskSources(client?: TaskHttpClient): Promise<BoringTaskAdapterSummary[]> {
  const body = await getJson<SourcesResponse>(client, "/sources")
  return body.sources ?? []
}

export async function listAllHttpTasks(sourceIds: string[], signal?: AbortSignal): Promise<BoringTaskCard[]> {
  const body = await fetchJson<ListResponse>("/sources/tasks/list", {
    method: "POST",
    body: JSON.stringify({ sourceIds }),
    signal,
  })
  return body.tasks ?? []
}

export function createHttpTaskAdapter(source: BoringTaskAdapterSummary, client?: TaskHttpClient): BoringTaskAdapter {
  return {
    ...source,
    async getBoardConfig(): Promise<BoringTaskBoardConfig> {
      const body = await postJson<ListResponse>(client, "/sources/tasks/list", { sourceIds: [source.id] })
      const config = body.configs?.[source.id]
      if (!config) throw new Error(`Task source did not return board config: ${source.id}`)
      return config
    },
    async listTasks(): Promise<BoringTaskCard[]> {
      const body = await postJson<ListResponse>(client, "/sources/tasks/list", { sourceIds: [source.id] })
      return body.tasks ?? []
    },
    moveTask: source.capabilities.move ? async ({ taskId, statusId }) => {
      const body = await postJson<MoveResponse>(client, "/sources/tasks/move", { sourceId: source.id, taskId, statusId })
      if (!body.task) throw new Error(`Task source did not return moved task: ${source.id}`)
      return body.task
    } : undefined,
    deleteTask: source.capabilities.delete ? async ({ taskId }) => {
      await postJson<DeleteResponse>(client, "/sources/tasks/delete", { sourceId: source.id, taskId })
    } : undefined,
  }
}

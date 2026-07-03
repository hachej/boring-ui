import type { BoringTaskAdapter, BoringTaskAdapterSummary, BoringTaskBoardConfig, BoringTaskCard } from "../shared"

const ROUTE_PREFIX = "/api/v1/plugins/tasks/api/boring-tasks"

interface SourcesResponse { ok?: boolean; sources?: BoringTaskAdapterSummary[]; error?: string }
interface ListResponse { ok?: boolean; configs?: Record<string, BoringTaskBoardConfig>; tasks?: BoringTaskCard[]; error?: string }
interface MoveResponse { ok?: boolean; task?: BoringTaskCard; error?: string }

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

export async function listHttpTaskSources(): Promise<BoringTaskAdapterSummary[]> {
  const body = await fetchJson<SourcesResponse>("/sources")
  return body.sources ?? []
}

export function createHttpTaskAdapter(source: BoringTaskAdapterSummary): BoringTaskAdapter {
  return {
    ...source,
    async getBoardConfig(): Promise<BoringTaskBoardConfig> {
      const body = await fetchJson<ListResponse>("/sources/tasks/list", {
        method: "POST",
        body: JSON.stringify({ sourceIds: [source.id] }),
      })
      const config = body.configs?.[source.id]
      if (!config) throw new Error(`Task source did not return board config: ${source.id}`)
      return config
    },
    async listTasks(): Promise<BoringTaskCard[]> {
      const body = await fetchJson<ListResponse>("/sources/tasks/list", {
        method: "POST",
        body: JSON.stringify({ sourceIds: [source.id] }),
      })
      return body.tasks ?? []
    },
    moveTask: source.capabilities.move ? async ({ taskId, statusId }) => {
      const body = await fetchJson<MoveResponse>("/sources/tasks/move", {
        method: "POST",
        body: JSON.stringify({ sourceId: source.id, taskId, statusId }),
      })
      if (!body.task) throw new Error(`Task source did not return moved task: ${source.id}`)
      return body.task
    } : undefined,
  }
}

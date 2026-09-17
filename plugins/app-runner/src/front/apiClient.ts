import type {
  AppRunnerAppsResponse,
  AppRunnerVersionsResponse,
} from "../shared/types"

const ROUTE_PREFIX = "/api/v1/plugins/app-runner"

export class AppRunnerApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = "AppRunnerApiError"
  }
}

async function readError(response: Response): Promise<AppRunnerApiError> {
  try {
    const body = (await response.json()) as { message?: string }
    if (body?.message) return new AppRunnerApiError(body.message, response.status)
  } catch {
    // fall through to generic message
  }
  return new AppRunnerApiError(`Request failed with status ${response.status}`, response.status)
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) throw await readError(response)
  return (await response.json()) as T
}

export function fetchApps(): Promise<AppRunnerAppsResponse> {
  return requestJson<AppRunnerAppsResponse>("/apps")
}

export function fetchAppVersions(appName: string): Promise<AppRunnerVersionsResponse> {
  return requestJson<AppRunnerVersionsResponse>(`/apps/${encodeURIComponent(appName)}/versions`)
}

export function rollbackApp(appName: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/apps/${encodeURIComponent(appName)}/rollback`, { method: "POST" })
}

export function activateAppVersion(appName: string, version: number): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/apps/${encodeURIComponent(appName)}/activate`, {
    method: "POST",
    body: JSON.stringify({ version }),
  })
}

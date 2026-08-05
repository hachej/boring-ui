import { createContext, createElement, useContext, useMemo, type ReactNode } from "react"

export interface WorkspacePluginClient {
  agentTypeId: string
  apiBaseUrl: string
  workspaceId?: string
  workspaceHeaders(): Record<string, string>
  getJson<T = unknown>(path: string, options?: { missingMessage?: string }): Promise<T>
  readJsonFile<T>(path: string, options?: { missingMessage?: string }): Promise<T>
  postJson<T = unknown>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T>
  deleteJson<T = unknown>(path: string): Promise<T>
  sendAgentPrompt(message: string, options?: { title?: string; noncePrefix?: string }): Promise<void>
}

interface WorkspacePluginClientProviderProps {
  agentTypeId: string
  apiBaseUrl: string
  workspaceId?: string
  authHeaders?: Record<string, string>
  children: ReactNode
}

const WorkspacePluginClientContext = createContext<WorkspacePluginClient | null>(null)

function currentOrigin(): string | null {
  if (typeof window === "undefined" || !window.location?.origin) return null
  return window.location.origin
}

function normalizeApiBaseUrl(base: string, hasPrivilegedContext: boolean, allowCrossOriginBase: boolean): string {
  const trimmed = base.trim().replace(/\/$/, "")
  if (!trimmed) return ""
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//") || trimmed.includes("\\")) {
      throw new Error(`workspace plugin client only accepts same-origin API base URLs, received ${JSON.stringify(base)}`)
    }
    return trimmed
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const origin = currentOrigin()
    if (!origin) {
      throw new Error(`workspace plugin client cannot verify absolute API base URL ${JSON.stringify(base)} outside a browser origin`)
    }
    const url = new URL(trimmed)
    if (url.origin !== origin && hasPrivilegedContext && !allowCrossOriginBase) {
      throw new Error(`workspace plugin client only accepts same-origin API base URLs when workspace or auth context is present, received ${JSON.stringify(base)}`)
    }
    return trimmed
  }
  throw new Error(`workspace plugin client only accepts same-origin API base URLs, received ${JSON.stringify(base)}`)
}

function assertSameOriginApiPath(path: string): string {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  ) {
    throw new Error(`workspace plugin client only accepts same-origin API paths, received ${JSON.stringify(path)}`)
  }
  return path
}

function withWorkspaceQuery(path: string, workspaceId: string | undefined): string {
  if (!workspaceId) return path
  const pathname = path.split("?", 1)[0]
  if (pathname === "/api/v1/agents" || pathname.startsWith("/api/v1/agents/")) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`
}

function deleteHeaderCaseInsensitive(headers: Record<string, string>, name: string): void {
  const wanted = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) delete headers[key]
  }
}

export class WorkspacePluginClientRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = "WorkspacePluginClientRequestError"
  }
}

async function responseError(response: Response, fallback: string, options?: { prefixFallback?: boolean }): Promise<WorkspacePluginClientRequestError> {
  const text = await response.text().catch(() => "")
  if (!text) return new WorkspacePluginClientRequestError(`${fallback} (${response.status})`, response.status)
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown }
    const message = typeof parsed.error === "object" && typeof parsed.error?.message === "string"
      ? parsed.error.message
      : typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : text
    const rendered = `${message} (${response.status})`
    return new WorkspacePluginClientRequestError(
      options?.prefixFallback ? `${fallback}: ${rendered}` : rendered,
      response.status,
      parsed,
    )
  } catch {
    const rendered = `${text.slice(0, 200)} (${response.status})`
    return new WorkspacePluginClientRequestError(
      options?.prefixFallback ? `${fallback}: ${rendered}` : rendered,
      response.status,
    )
  }
}

function createWorkspacePluginClientWithOptions(
  apiBaseUrl: string,
  agentTypeId: string,
  workspaceId: string | undefined,
  authHeaders: Record<string, string> | undefined,
  options: { allowCrossOriginBase: boolean },
): WorkspacePluginClient {
  const hasAuthHeaders = Boolean(authHeaders && Object.keys(authHeaders).length > 0)
  const base = normalizeApiBaseUrl(apiBaseUrl, Boolean(workspaceId) || hasAuthHeaders, options.allowCrossOriginBase)
  const workspaceHeaders = (): Record<string, string> => workspaceId ? { "x-boring-workspace-id": workspaceId } : {}
  const fetchJson = async <T,>(
    path: string,
    init: RequestInit,
    fallback: string,
    options?: { prefixFallbackStatuses?: readonly number[] },
  ): Promise<T> => {
    const safePath = assertSameOriginApiPath(path)
    const headers: Record<string, string> = {
      ...(authHeaders ?? {}),
      ...(init.headers as Record<string, string> | undefined),
      ...workspaceHeaders(),
    }
    if (init.body === undefined || init.body === null) deleteHeaderCaseInsensitive(headers, "content-type")
    const response = await fetch(`${base}${withWorkspaceQuery(safePath, workspaceId)}`, {
      credentials: "include",
      ...init,
      headers,
    })
    if (!response.ok) {
      throw await responseError(response, fallback, {
        prefixFallback: options?.prefixFallbackStatuses?.includes(response.status) ?? false,
      })
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }
  const getJson = async <T = unknown,>(
    path: string,
    options?: { missingMessage?: string },
  ): Promise<T> => fetchJson<T>(path, { method: "GET" }, options?.missingMessage ?? `request failed for ${path}`)
  const postJson = async <T = unknown,>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T> => fetchJson<T>(path, {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
          body: JSON.stringify(body),
        }
      : options?.headers ? { headers: options.headers } : {}),
  }, `request failed for ${path}`)
  const deleteJson = async <T = unknown,>(path: string): Promise<T> =>
    fetchJson<T>(path, { method: "DELETE" }, `request failed for ${path}`)
  const sendAgentPrompt = async (
    message: string,
    options?: { title?: string; noncePrefix?: string },
  ): Promise<void> => {
    const sessionsPath = `/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`
    const session = await postJson<{ sessionId?: unknown }>(sessionsPath, {
      title: options?.title ?? "Plugin action",
    })
    if (typeof session.sessionId !== "string") throw new Error("agent session creation did not return a session id")
    const noncePrefix = options?.noncePrefix ?? "workspace-plugin"
    const clientNonce = `${noncePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    await postJson(`${sessionsPath}/${encodeURIComponent(session.sessionId)}/prompt`, {
      requestId: clientNonce,
      content: message,
      clientNonce,
    })
  }
  const readJsonFile = async <T,>(
    path: string,
    options?: { missingMessage?: string },
  ): Promise<T> => {
    const query = new URLSearchParams({ path, t: String(Date.now()) })
    const fallback = options?.missingMessage ?? `failed to read ${path}`
    return fetchJson<T>(`/api/v1/files/raw?${query.toString()}`, { method: "GET" }, fallback, {
      prefixFallbackStatuses: [404],
    })
  }
  return {
    agentTypeId,
    apiBaseUrl: base,
    ...(workspaceId ? { workspaceId } : {}),
    workspaceHeaders,
    getJson,
    readJsonFile,
    postJson,
    deleteJson,
    sendAgentPrompt,
  }
}

export function createWorkspacePluginClient(
  apiBaseUrl: string,
  agentTypeId: string,
  workspaceId?: string,
  authHeaders?: Record<string, string>,
): WorkspacePluginClient {
  return createWorkspacePluginClientWithOptions(apiBaseUrl, agentTypeId, workspaceId, authHeaders, { allowCrossOriginBase: false })
}

export function WorkspacePluginClientProvider({
  apiBaseUrl,
  agentTypeId,
  workspaceId,
  authHeaders,
  children,
}: WorkspacePluginClientProviderProps) {
  const client = useMemo(
    () => createWorkspacePluginClientWithOptions(apiBaseUrl, agentTypeId, workspaceId, authHeaders, { allowCrossOriginBase: true }),
    [agentTypeId, apiBaseUrl, authHeaders, workspaceId],
  )
  return createElement(WorkspacePluginClientContext.Provider, { value: client }, children)
}

export function useWorkspacePluginClient(): WorkspacePluginClient {
  const client = useContext(WorkspacePluginClientContext)
  if (!client) throw new Error("useWorkspacePluginClient must be used within a WorkspaceProvider")
  return client
}

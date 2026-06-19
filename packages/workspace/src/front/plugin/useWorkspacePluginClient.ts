import { createContext, createElement, useContext, useMemo, type ReactNode } from "react"

export interface WorkspacePluginClient {
  apiBaseUrl: string
  workspaceId?: string
  workspaceHeaders(): Record<string, string>
  readJsonFile<T>(path: string, options?: { missingMessage?: string }): Promise<T>
  postJson<T = unknown>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T>
  sendAgentPrompt(message: string, options?: { title?: string; noncePrefix?: string }): Promise<void>
}

interface WorkspacePluginClientProviderProps {
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
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`
}

function deleteHeaderCaseInsensitive(headers: Record<string, string>, name: string): void {
  const wanted = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) delete headers[key]
  }
}

async function responseError(response: Response, fallback: string, options?: { prefixFallback?: boolean }): Promise<string> {
  const text = await response.text().catch(() => "")
  if (!text) return `${fallback} (${response.status})`
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = typeof parsed.error?.message === "string"
      ? parsed.error.message
      : typeof parsed.message === "string"
        ? parsed.message
        : text
    const rendered = `${message} (${response.status})`
    return options?.prefixFallback ? `${fallback}: ${rendered}` : rendered
  } catch {
    const rendered = `${text.slice(0, 200)} (${response.status})`
    return options?.prefixFallback ? `${fallback}: ${rendered}` : rendered
  }
}

function createWorkspacePluginClientWithOptions(
  apiBaseUrl: string,
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
      throw new Error(await responseError(response, fallback, {
        prefixFallback: options?.prefixFallbackStatuses?.includes(response.status) ?? false,
      }))
    }
    return await response.json() as T
  }
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
  const sendAgentPrompt = async (
    message: string,
    options?: { title?: string; noncePrefix?: string },
  ): Promise<void> => {
    const session = await postJson<{ id?: unknown }>("/api/v1/agent/pi-chat/sessions", {
      title: options?.title ?? "Plugin action",
    })
    if (typeof session.id !== "string") throw new Error("agent session creation did not return a session id")
    const noncePrefix = options?.noncePrefix ?? "workspace-plugin"
    await postJson(`/api/v1/agent/pi-chat/${encodeURIComponent(session.id)}/prompt`, {
      message,
      clientNonce: `${noncePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
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
    apiBaseUrl: base,
    ...(workspaceId ? { workspaceId } : {}),
    workspaceHeaders,
    readJsonFile,
    postJson,
    sendAgentPrompt,
  }
}

export function createWorkspacePluginClient(
  apiBaseUrl: string,
  workspaceId?: string,
  authHeaders?: Record<string, string>,
): WorkspacePluginClient {
  return createWorkspacePluginClientWithOptions(apiBaseUrl, workspaceId, authHeaders, { allowCrossOriginBase: false })
}

export function WorkspacePluginClientProvider({
  apiBaseUrl,
  workspaceId,
  authHeaders,
  children,
}: WorkspacePluginClientProviderProps) {
  const client = useMemo(
    () => createWorkspacePluginClientWithOptions(apiBaseUrl, workspaceId, authHeaders, { allowCrossOriginBase: true }),
    [apiBaseUrl, authHeaders, workspaceId],
  )
  return createElement(WorkspacePluginClientContext.Provider, { value: client }, children)
}

export function useWorkspacePluginClient(): WorkspacePluginClient {
  const client = useContext(WorkspacePluginClientContext)
  if (!client) throw new Error("useWorkspacePluginClient must be used within a WorkspaceProvider")
  return client
}

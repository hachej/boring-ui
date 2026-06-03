import { setPreloadedTreeEntries } from "../../plugins/filesystemPlugin/front/data/treePreloadCache"

export const DEFAULT_BOOT_PRELOAD_PATHS = ["/api/v1/tree?path=.", "/api/v1/agent/sessions"]

const PREPARING_ERROR_CODES = new Set([
  "WORKSPACE_NOT_READY",
  "AGENT_RUNTIME_NOT_READY",
  "RUNTIME_PROVISIONING_LOCKED",
])

export type WorkspaceRuntimeDependenciesWarmupStatus = {
  state: "preparing" | "ready" | "failed"
  message?: string
  requirement?: string
}

export type WorkspaceWarmupStatus =
  | { status: "preparing"; requirement?: "workspace-fs" | "sandbox-exec" | "ui-bridge"; message?: string; runtimeDependencies?: WorkspaceRuntimeDependenciesWarmupStatus }
  | { status: "ready"; runtimeDependencies?: WorkspaceRuntimeDependenciesWarmupStatus }
  | { status: "failed"; message: string; requirement?: "workspace-fs" | "sandbox-exec" | "ui-bridge"; runtimeDependencies?: WorkspaceRuntimeDependenciesWarmupStatus }

export function preloadUrl(apiBaseUrl: string | null | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (!apiBaseUrl) return path
  return `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`
}

export function workspaceRequestHeaders(
  workspaceId: string,
  headers?: Record<string, string>,
): Record<string, string> {
  const next = { ...(headers ?? {}) }
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "x-boring-workspace-id") delete next[key]
  }
  next["x-boring-workspace-id"] = workspaceId
  return next
}

export function treePreloadDir(path: string): string | null {
  const url = new URL(path, "http://workspace.local")
  if (url.pathname !== "/api/v1/tree") return null
  return url.searchParams.get("path") ?? "."
}

export function seedTreePreloadFromBody(
  apiBaseUrl: string | null | undefined,
  workspaceId: string,
  path: string,
  body: { entries?: unknown } | null,
): void {
  const dir = treePreloadDir(path)
  if (dir === null || !body || !Array.isArray(body.entries)) return
  setPreloadedTreeEntries(apiBaseUrl, workspaceId, dir, body.entries)
}

export interface WorkspaceReadyError {
  code?: unknown
  retryable?: unknown
  requirement?: unknown
}

export interface WarmupPreparingResult {
  requirement?: "workspace-fs" | "sandbox-exec" | "ui-bridge"
}

const VALID_REQUIREMENTS = new Set(["workspace-fs", "sandbox-exec", "ui-bridge"])

export function parseWorkspaceReadyError(payload: unknown): WorkspaceReadyError | null {
  const root = payload as { error?: unknown; details?: unknown; code?: unknown } | null
  if (!root || typeof root !== "object") return null
  const error = (root.error ?? root) as { details?: unknown; code?: unknown; retryable?: unknown; requirement?: unknown }
  const details = (error.details ?? root.details ?? error) as WorkspaceReadyError | null
  if (!details || typeof details !== "object") return null
  return {
    code: details.code ?? error.code ?? root.code,
    retryable: details.retryable ?? error.retryable,
    requirement: details.requirement ?? error.requirement,
  }
}

export function parseRetryableWarmupPreparing(payload: unknown): WarmupPreparingResult | null {
  const parsed = parseWorkspaceReadyError(payload)
  if (typeof parsed?.code !== "string" || !PREPARING_ERROR_CODES.has(parsed.code) || parsed.retryable !== true) return null
  const requirement = typeof parsed.requirement === "string" && VALID_REQUIREMENTS.has(parsed.requirement)
    ? parsed.requirement as WarmupPreparingResult["requirement"]
    : undefined
  return requirement ? { requirement } : {}
}

export function isAgentRuntimeWarmupPath(path: string): boolean {
  const url = new URL(path, "http://workspace.local")
  return url.pathname === "/api/v1/agent/sessions" || url.pathname === "/api/v1/ready-status"
}

export function isReadyStatusPath(path: string): boolean {
  return new URL(path, "http://workspace.local").pathname === "/api/v1/ready-status"
}

export function resolveBootPreloadPaths(preloadPaths: string[], provisionWorkspace: boolean): string[] {
  const paths = provisionWorkspace
    ? [...preloadPaths, "/api/v1/ready-status"]
    : preloadPaths.filter((path) => !isAgentRuntimeWarmupPath(path))
  return Array.from(new Set(paths))
}

export function errorMessageFromPayload(payload: unknown): string | null {
  if (typeof payload === "string") return payload || null
  if (!payload || typeof payload !== "object") return null
  const root = payload as { error?: unknown; message?: unknown }
  if (typeof root.message === "string" && root.message) return root.message
  const error = root.error as { message?: unknown } | undefined
  return typeof error?.message === "string" && error.message ? error.message : null
}

export interface ReadyStatusWarmupSnapshot {
  state?: string
  message?: string
  chatState?: string
  workspaceState?: string
  runtimeDependenciesState?: string
  runtimeDependenciesMessage?: string
  runtimeDependenciesRequirement?: string
}

function normalizeReadyStatusSnapshot(payload: unknown): ReadyStatusWarmupSnapshot | null {
  if (!payload || typeof payload !== "object") return null
  const root = payload as {
    state?: unknown
    message?: unknown
    capabilities?: {
      chat?: { state?: unknown }
      workspace?: { state?: unknown }
      runtimeDependencies?: { state?: unknown; message?: unknown; requirement?: unknown }
    }
  }
  return {
    state: typeof root.state === "string" ? root.state : undefined,
    message: typeof root.message === "string" ? root.message : undefined,
    chatState: typeof root.capabilities?.chat?.state === "string" ? root.capabilities.chat.state : undefined,
    workspaceState: typeof root.capabilities?.workspace?.state === "string" ? root.capabilities.workspace.state : undefined,
    runtimeDependenciesState: typeof root.capabilities?.runtimeDependencies?.state === "string" ? root.capabilities.runtimeDependencies.state : undefined,
    runtimeDependenciesMessage: typeof root.capabilities?.runtimeDependencies?.message === "string" ? root.capabilities.runtimeDependencies.message : undefined,
    runtimeDependenciesRequirement: typeof root.capabilities?.runtimeDependencies?.requirement === "string" ? root.capabilities.runtimeDependencies.requirement : undefined,
  }
}

export function parseReadyStatusSse(payload: unknown): ReadyStatusWarmupSnapshot | null {
  if (payload && typeof payload === "object") return normalizeReadyStatusSnapshot(payload)
  if (typeof payload !== "string" || !payload.trim()) return null
  const events = payload.split(/\n\n+/)
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const dataLines = events[i]
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
    if (dataLines.length === 0) continue
    try {
      return normalizeReadyStatusSnapshot(JSON.parse(dataLines.join("\n")))
    } catch {
      return null
    }
  }
  return null
}

export function parseFirstReadyStatusSseEvent(payload: string): ReadyStatusWarmupSnapshot | null {
  const index = payload.indexOf("\n\n")
  if (index < 0) return null
  return parseReadyStatusSse(payload.slice(0, index + 2))
}

export function readyStatusSupportsWorkspaceUse(status: ReadyStatusWarmupSnapshot | null): boolean {
  if (!status) return true
  const hasCapabilityStates = Boolean(status.chatState || status.workspaceState)
  if (hasCapabilityStates) return status.chatState === "ready" && status.workspaceState === "ready"
  return status.state === "ready"
}

export async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "")
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export type PaneRenderState = "loading" | "ready" | "error" | "missing"

export interface PaneRenderStatusError {
  code: string
  message: string
}

export interface PaneRenderStatusReport {
  workspaceId?: string
  pluginId: string
  panelId: string
  panelInstanceId: string
  revision?: number
  state: PaneRenderState
  error?: PaneRenderStatusError
}

export interface PaneRenderStatusSnapshot extends Required<Omit<PaneRenderStatusReport, "workspaceId" | "revision" | "error">> {
  workspaceId: string
  reportedAt: string
  revision?: number
  error?: PaneRenderStatusError
}

export interface PaneRenderStatusLookup {
  workspaceId?: string
  pluginId?: string
  panelId?: string
  panelInstanceId: string
}

export interface PaneRenderStatusStoreOptions {
  ttlMs?: number
  uiContactTtlMs?: number
  now?: () => number
}

const DEFAULT_STATUS_TTL_MS = 5 * 60_000
const DEFAULT_UI_CONTACT_TTL_MS = 30_000
const DEFAULT_WORKSPACE_ID = "default"
const MAX_ERROR_MESSAGE_LENGTH = 500

function normalizeWorkspaceId(workspaceId: string | undefined): string {
  const trimmed = workspaceId?.trim()
  return trimmed || DEFAULT_WORKSPACE_ID
}

function statusKey(input: { workspaceId: string; pluginId: string; panelId: string; panelInstanceId: string }): string {
  return `${input.workspaceId}\u0000${input.pluginId}\u0000${input.panelId}\u0000${input.panelInstanceId}`
}

function redactMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

export function createPaneRenderStatusStore(options: PaneRenderStatusStoreOptions = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_STATUS_TTL_MS
  const uiContactTtlMs = options.uiContactTtlMs ?? DEFAULT_UI_CONTACT_TTL_MS
  const now = options.now ?? (() => Date.now())
  const statuses = new Map<string, PaneRenderStatusSnapshot>()
  const lastUiContactByWorkspace = new Map<string, number>()

  function pruneExpired(current = now()): void {
    for (const [key, status] of statuses) {
      const reportedAtMs = Date.parse(status.reportedAt)
      if (!Number.isFinite(reportedAtMs) || current - reportedAtMs > ttlMs) {
        statuses.delete(key)
      }
    }
  }

  function touchUi(workspaceId?: string): void {
    lastUiContactByWorkspace.set(normalizeWorkspaceId(workspaceId), now())
  }

  function hasRecentUiContact(workspaceId?: string): boolean {
    const last = lastUiContactByWorkspace.get(normalizeWorkspaceId(workspaceId))
    return last !== undefined && now() - last <= uiContactTtlMs
  }

  return {
    touchUi,
    hasRecentUiContact,
    report(input: PaneRenderStatusReport): PaneRenderStatusSnapshot {
      pruneExpired()
      const workspaceId = normalizeWorkspaceId(input.workspaceId)
      touchUi(workspaceId)
      const snapshot: PaneRenderStatusSnapshot = {
        workspaceId,
        pluginId: input.pluginId,
        panelId: input.panelId,
        panelInstanceId: input.panelInstanceId,
        state: input.state,
        reportedAt: new Date(now()).toISOString(),
        ...(input.revision !== undefined ? { revision: input.revision } : {}),
        ...(input.error ? { error: { code: input.error.code, message: redactMessage(input.error.message) } } : {}),
      }
      statuses.set(statusKey(snapshot), snapshot)
      return snapshot
    },
    get(input: PaneRenderStatusLookup): PaneRenderStatusSnapshot | undefined {
      pruneExpired()
      const workspaceId = normalizeWorkspaceId(input.workspaceId)
      if (input.pluginId && input.panelId) {
        return statuses.get(statusKey({ workspaceId, pluginId: input.pluginId, panelId: input.panelId, panelInstanceId: input.panelInstanceId }))
      }
      for (const status of statuses.values()) {
        if (status.workspaceId !== workspaceId) continue
        if (status.panelInstanceId !== input.panelInstanceId) continue
        if (input.pluginId && status.pluginId !== input.pluginId) continue
        if (input.panelId && status.panelId !== input.panelId) continue
        return status
      }
      return undefined
    },
  }
}

export type PaneRenderStatusStore = ReturnType<typeof createPaneRenderStatusStore>

export const WORKSPACE_COMPOSER_STOP_EVENT = "boring:workspace-composer-stop" as const

export const WORKSPACE_COMPOSER_STOP_REASONS = {
  sessionSwitch: "session-switch",
  userStop: "user-stop",
} as const

export type WorkspaceComposerStopReason = typeof WORKSPACE_COMPOSER_STOP_REASONS[keyof typeof WORKSPACE_COMPOSER_STOP_REASONS]

export type WorkspaceComposerStopDetail = {
  sessionId?: string
  reason: WorkspaceComposerStopReason
}

export function emitWorkspaceComposerStop(detail: WorkspaceComposerStopDetail): void {
  if (typeof globalThis.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return
  globalThis.dispatchEvent(new CustomEvent<WorkspaceComposerStopDetail>(WORKSPACE_COMPOSER_STOP_EVENT, { detail }))
}

export function isWorkspaceComposerStopDetail(value: unknown): value is WorkspaceComposerStopDetail {
  if (!value || typeof value !== "object") return false
  const candidate = value as { reason?: unknown; sessionId?: unknown }
  return isWorkspaceComposerStopReason(candidate.reason)
    && (candidate.sessionId === undefined || typeof candidate.sessionId === "string")
}

export function isWorkspaceComposerStopReason(value: unknown): value is WorkspaceComposerStopReason {
  return value === WORKSPACE_COMPOSER_STOP_REASONS.sessionSwitch
    || value === WORKSPACE_COMPOSER_STOP_REASONS.userStop
}

export type WorkspaceComposerStopMatchOptions = {
  fallbackSessionId?: string | null
  ignoredReasons?: readonly WorkspaceComposerStopReason[]
}

export function workspaceComposerStopTargetSessionId(
  detail: unknown,
  fallbackSessionId?: string | null,
): string | undefined {
  if (isWorkspaceComposerStopDetail(detail)) return detail.sessionId ?? fallbackSessionId ?? undefined
  if (detail && typeof detail === "object") {
    const legacy = detail as { sessionId?: unknown }
    if (typeof legacy.sessionId === "string") return legacy.sessionId
  }
  return fallbackSessionId ?? undefined
}

export function workspaceComposerStopAppliesToSession(
  detail: unknown,
  sessionId: string,
  options: WorkspaceComposerStopMatchOptions = {},
): boolean {
  const ignoredReasons = options.ignoredReasons ?? [WORKSPACE_COMPOSER_STOP_REASONS.sessionSwitch]
  if (isWorkspaceComposerStopDetail(detail) && ignoredReasons.includes(detail.reason)) return false
  const targetSessionId = workspaceComposerStopTargetSessionId(detail, options.fallbackSessionId)
  return !targetSessionId || targetSessionId === sessionId
}

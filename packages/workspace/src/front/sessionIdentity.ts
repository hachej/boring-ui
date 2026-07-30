export interface WorkspaceSessionRef {
  readonly sessionId: string
  readonly agentTypeId?: string
}

export type PersistedWorkspaceSessionRef =
  | { readonly kind: "legacy"; readonly sessionId: string }
  | { readonly kind: "addressed"; readonly sessionId: string; readonly agentTypeId: string }

const SESSION_KEY_PREFIX = "boring-workspace-session-ref:v1:"
const SESSION_DRAG_VERSION = 1

export function workspaceSessionRef(sessionId: string, agentTypeId?: string): WorkspaceSessionRef {
  return agentTypeId ? { sessionId, agentTypeId } : { sessionId }
}

/**
 * Opaque UI key. Legacy ids are encoded too, so an arbitrary legacy id can
 * never alias an addressed ref merely by resembling this internal format.
 */
export function workspaceSessionKey(sessionId: string, agentTypeId: string | undefined): string {
  return `${SESSION_KEY_PREFIX}${encodeURIComponent(JSON.stringify(
    agentTypeId ? ["addressed", agentTypeId, sessionId] : ["legacy", sessionId],
  ))}`
}

/** @deprecated Use only for intentional string-only compatibility boundaries. */
export function legacyWorkspaceSessionKey(sessionId: string): string {
  return workspaceSessionKey(sessionId, undefined)
}

export function workspaceSessionKeyFor(session: { id: string; agentTypeId?: string }): string {
  return workspaceSessionKey(session.id, session.agentTypeId)
}

/**
 * Normalizes a string-only compatibility prop without decoding arbitrary raw
 * session ids. A bare id is legacy; only an exact key generated for one of the
 * supplied sessions is accepted as an internal addressed/ref key.
 */
export function workspaceSessionKeyFromBoundaryValue(
  value: string,
  sessions: readonly { id: string; agentTypeId?: string }[],
): string {
  const legacy = sessions.find((session) => !session.agentTypeId && session.id === value)
  if (legacy) return legacyWorkspaceSessionKey(legacy.id)
  return sessions.some((session) => workspaceSessionKeyFor(session) === value)
    ? value
    : legacyWorkspaceSessionKey(value)
}

export function workspaceSessionRefsEqual(
  left: WorkspaceSessionRef | null | undefined,
  right: WorkspaceSessionRef | null | undefined,
): boolean {
  return Boolean(left && right && left.sessionId === right.sessionId && left.agentTypeId === right.agentTypeId)
}

export function workspaceSessionRefFromKey(key: string): WorkspaceSessionRef {
  if (!key.startsWith(SESSION_KEY_PREFIX)) return { sessionId: key }
  try {
    const value = JSON.parse(decodeURIComponent(key.slice(SESSION_KEY_PREFIX.length))) as unknown
    if (!Array.isArray(value)) return { sessionId: key }
    if (value.length === 2 && value[0] === "legacy" && typeof value[1] === "string") {
      return { sessionId: value[1] }
    }
    if (
      value.length === 3
      && value[0] === "addressed"
      && typeof value[1] === "string"
      && value[1].length > 0
      && typeof value[2] === "string"
    ) {
      return { sessionId: value[2], agentTypeId: value[1] }
    }
  } catch {
    // Unknown strings remain legacy native session ids.
  }
  return { sessionId: key }
}

export function persistedWorkspaceSessionRef(ref: WorkspaceSessionRef): PersistedWorkspaceSessionRef {
  return ref.agentTypeId
    ? { kind: "addressed", sessionId: ref.sessionId, agentTypeId: ref.agentTypeId }
    : { kind: "legacy", sessionId: ref.sessionId }
}

export function workspaceSessionRefFromPersisted(value: unknown): WorkspaceSessionRef | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as { kind?: unknown; sessionId?: unknown; agentTypeId?: unknown }
  if (candidate.kind === "legacy" && typeof candidate.sessionId === "string" && candidate.sessionId.length > 0) {
    return { sessionId: candidate.sessionId }
  }
  if (
    candidate.kind === "addressed"
    && typeof candidate.sessionId === "string"
    && candidate.sessionId.length > 0
    && typeof candidate.agentTypeId === "string"
    && candidate.agentTypeId.length > 0
  ) {
    return { sessionId: candidate.sessionId, agentTypeId: candidate.agentTypeId }
  }
  return null
}

export function encodeWorkspaceSessionDrag(ref: WorkspaceSessionRef): string {
  return JSON.stringify({ version: SESSION_DRAG_VERSION, ...ref })
}

export function decodeWorkspaceSessionDrag(value: string): WorkspaceSessionRef | null {
  try {
    const parsed = JSON.parse(value) as { version?: unknown; sessionId?: unknown; agentTypeId?: unknown }
    if (parsed.version !== SESSION_DRAG_VERSION || typeof parsed.sessionId !== "string" || parsed.sessionId.length === 0) return null
    if (parsed.agentTypeId === undefined) return { sessionId: parsed.sessionId }
    return typeof parsed.agentTypeId === "string" && parsed.agentTypeId.length > 0
      ? { sessionId: parsed.sessionId, agentTypeId: parsed.agentTypeId }
      : null
  } catch {
    return null
  }
}

export interface WorkspaceSessionRef {
  readonly sessionId: string
  readonly agentTypeId?: string
}

const ADDRESSED_SESSION_KEY_PREFIX = "boring-agent-session:"

export function workspaceSessionKey(sessionId: string, agentTypeId?: string): string {
  return agentTypeId
    ? `${ADDRESSED_SESSION_KEY_PREFIX}${encodeURIComponent(agentTypeId)}/${encodeURIComponent(sessionId)}`
    : sessionId
}

export function workspaceSessionKeyFor(session: { id: string; agentTypeId?: string }): string {
  return workspaceSessionKey(session.id, session.agentTypeId)
}

export function workspaceSessionRefFromKey(key: string): WorkspaceSessionRef {
  if (!key.startsWith(ADDRESSED_SESSION_KEY_PREFIX)) return { sessionId: key }
  const encoded = key.slice(ADDRESSED_SESSION_KEY_PREFIX.length)
  const separator = encoded.indexOf("/")
  if (separator < 0) return { sessionId: key }
  try {
    const agentTypeId = decodeURIComponent(encoded.slice(0, separator))
    const sessionId = decodeURIComponent(encoded.slice(separator + 1))
    return agentTypeId && sessionId ? { sessionId, agentTypeId } : { sessionId: key }
  } catch {
    return { sessionId: key }
  }
}

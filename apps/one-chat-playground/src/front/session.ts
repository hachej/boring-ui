const SESSION_STORAGE_KEY = 'one-chat:session-id'

function readStoredSessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeSessionId(sessionId: string): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId)
  } catch {
    // Private mode / blocked storage: the chat still works, it just starts a
    // new conversation on the next reload.
  }
}

async function sessionExists(agentTypeId: string, sessionId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/state`,
    )
    return response.ok
  } catch {
    return false
  }
}

async function createSession(agentTypeId: string): Promise<string> {
  const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!response.ok) throw new Error(`Could not start the conversation (${response.status})`)
  const body = (await response.json()) as { sessionId?: string }
  if (!body.sessionId) throw new Error('Could not start the conversation')
  return body.sessionId
}

/**
 * One chat means one session, forever.
 *
 * The id is pinned in localStorage so a reload resumes the same conversation.
 * The stored id is probed before it is used: a session root wiped between runs
 * would otherwise leave the panel showing "session was not found" with no way
 * for a non-technical user to recover.
 */
export async function resolvePinnedSessionId(agentTypeId: string): Promise<string> {
  const stored = readStoredSessionId()
  if (stored && (await sessionExists(agentTypeId, stored))) return stored
  const created = await createSession(agentTypeId)
  storeSessionId(created)
  return created
}

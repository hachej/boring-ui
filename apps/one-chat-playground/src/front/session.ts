function storageKey(appSlug: string): string {
  return `one-chat:session-id:${appSlug}`
}

function readStoredSessionId(appSlug: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(appSlug))
  } catch {
    return null
  }
}

function storeSessionId(appSlug: string, sessionId: string): void {
  try {
    window.localStorage.setItem(storageKey(appSlug), sessionId)
  } catch {
    // The chat still works; it starts a new conversation on the next reload.
  }
}

function headers(appSlug: string): Record<string, string> {
  return { 'x-one-chat-app': appSlug }
}

async function sessionExists(agentTypeId: string, sessionId: string, appSlug: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/state`,
      { headers: headers(appSlug) },
    )
    return response.ok
  } catch {
    return false
  }
}

async function createSession(agentTypeId: string, appSlug: string): Promise<string> {
  const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`, {
    method: 'POST',
    headers: { ...headers(appSlug), 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!response.ok) throw new Error(`Could not start the conversation (${response.status})`)
  const body = (await response.json()) as { sessionId?: string }
  if (!body.sessionId) throw new Error('Could not start the conversation')
  return body.sessionId
}

/** One durable browser-pinned session for each app slug. */
export async function resolvePinnedSessionId(agentTypeId: string, appSlug: string): Promise<string> {
  const stored = readStoredSessionId(appSlug)
  if (stored && (await sessionExists(agentTypeId, stored, appSlug))) return stored
  const created = await createSession(agentTypeId, appSlug)
  storeSessionId(appSlug, created)
  return created
}

const SESSION_STORAGE_KEY = 'one-chat:session-id'

/**
 * One chat means one session, forever. Pinned in localStorage so a reload
 * resumes the same conversation rather than starting a new one.
 */
export function pinnedSessionId(): string {
  if (typeof window === 'undefined') return 'one-chat'
  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (stored) return stored
    const created = `one-chat-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`
    window.localStorage.setItem(SESSION_STORAGE_KEY, created)
    return created
  } catch {
    // Private mode / blocked storage: a stable per-load id still works, it just
    // does not survive a reload.
    return 'one-chat'
  }
}

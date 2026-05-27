import { matchPath } from 'react-router-dom'

const PENDING_CHAT_ENTRY_KEY = 'boring:pending-chat-entry'
const PENDING_CHAT_ENTRY_TTL_MS = 24 * 60 * 60 * 1000

export const DEFAULT_CHAT_FIRST_PENDING_WORKSPACE_ID = 'pending'
export const PENDING_CHAT_ENTRY_CHANGED_EVENT = 'boring:pending-chat-entry-changed'

export interface PendingChatEntryState {
  draft: string
  returnTo: string
  intendedWorkspaceId?: string
  createdAt: number
}

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function safeReturnTo(pathname: string, search: string, hash: string): string {
  const candidate = `${pathname || '/'}${search || ''}${hash || ''}`
  if (!candidate.startsWith('/') || candidate.startsWith('//') || /[\0\r\n<>"'`]/.test(candidate)) return '/'
  return candidate
}

export function readPendingChatEntry(): PendingChatEntryState | null {
  const storage = browserSessionStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_CHAT_ENTRY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingChatEntryState>
    if (typeof parsed.draft !== 'string' || typeof parsed.returnTo !== 'string' || typeof parsed.createdAt !== 'number') return null
    if (Date.now() - parsed.createdAt > PENDING_CHAT_ENTRY_TTL_MS) {
      storage.removeItem(PENDING_CHAT_ENTRY_KEY)
      return null
    }
    return {
      draft: parsed.draft,
      returnTo: parsed.returnTo,
      intendedWorkspaceId: typeof parsed.intendedWorkspaceId === 'string' ? parsed.intendedWorkspaceId : undefined,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

function notifyPendingChatEntryChanged(): void {
  globalThis.dispatchEvent?.(new Event(PENDING_CHAT_ENTRY_CHANGED_EVENT))
}

export function writePendingChatEntry(input: Omit<PendingChatEntryState, 'createdAt'>): void {
  const storage = browserSessionStorage()
  if (!storage) return
  storage.setItem(PENDING_CHAT_ENTRY_KEY, JSON.stringify({ ...input, createdAt: Date.now() }))
  notifyPendingChatEntryChanged()
}

export function clearPendingChatEntry(): void {
  browserSessionStorage()?.removeItem(PENDING_CHAT_ENTRY_KEY)
  notifyPendingChatEntryChanged()
}

export function pendingChatEntryMatchesLocation(
  pending: PendingChatEntryState | null,
  pathname: string,
  search: string,
  hash: string,
): boolean {
  return Boolean(pending && pending.returnTo === safeReturnTo(pathname, search, hash))
}

function routePatterns(route: string): string[] {
  const normalized = route.endsWith('/*') ? route.slice(0, -2) : route
  return [`${normalized}/*`, normalized]
}

export function workspaceIdFromPath(
  pathname: string,
  workspaceRoute: string,
  workspaceIdParam: string,
): string | null {
  const patterns = [
    ...routePatterns(workspaceRoute),
    '/w/:id/*',
    '/w/:id',
    '/workspace/:id/*',
    '/workspace/:id',
  ]
  for (const pattern of patterns) {
    const match = matchPath(pattern, pathname)
    const id = match?.params[workspaceIdParam]?.trim() ?? match?.params.id?.trim()
    if (id) return id
  }
  return null
}

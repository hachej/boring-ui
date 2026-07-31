const ACTIVE_SESSION_KEY_PREFIX = 'boring-agent:v2'
const ACTIVE_SESSION_KEY_SUFFIX = 'activeSessionId'
const DEFAULT_STORAGE_SCOPE = 'default'

export interface ActiveSessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ActiveSessionStorageOptions {
  storageScope?: string
  agentTypeId?: string
  storage?: ActiveSessionStorageLike
}

export function activeSessionStorageKey(storageScope?: string, agentTypeId?: string): string {
  const scope = storageScope && storageScope.length > 0 ? storageScope : DEFAULT_STORAGE_SCOPE
  const agentScope = agentTypeId && agentTypeId.length > 0
    ? `:agent:${encodeURIComponent(agentTypeId)}`
    : ''
  return `${ACTIVE_SESSION_KEY_PREFIX}:${scope}${agentScope}:${ACTIVE_SESSION_KEY_SUFFIX}`
}

export function readActiveSessionId(options: ActiveSessionStorageOptions = {}): string | undefined {
  const storage = resolveStorage(options.storage)
  if (!storage) return undefined
  try {
    return storage.getItem(activeSessionStorageKey(options.storageScope, options.agentTypeId)) ?? undefined
  } catch {
    return undefined
  }
}

export function writeActiveSessionId(sessionId: string | undefined, options: ActiveSessionStorageOptions = {}): void {
  const storage = resolveStorage(options.storage)
  if (!storage) return
  try {
    const key = activeSessionStorageKey(options.storageScope, options.agentTypeId)
    if (sessionId === undefined || sessionId.length === 0) storage.removeItem(key)
    else storage.setItem(key, sessionId)
  } catch {}
}

export function clearActiveSessionId(options: ActiveSessionStorageOptions = {}): void {
  writeActiveSessionId(undefined, options)
}

function resolveStorage(storage: ActiveSessionStorageLike | undefined): ActiveSessionStorageLike | undefined {
  if (storage) return storage
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

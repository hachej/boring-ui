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
  storage?: ActiveSessionStorageLike
}

export function activeSessionStorageKey(storageScope?: string): string {
  const scope = storageScope && storageScope.length > 0 ? storageScope : DEFAULT_STORAGE_SCOPE
  return `${ACTIVE_SESSION_KEY_PREFIX}:${scope}:${ACTIVE_SESSION_KEY_SUFFIX}`
}

export function readActiveSessionId(options: ActiveSessionStorageOptions = {}): string | undefined {
  const storage = resolveStorage(options.storage)
  if (!storage) return undefined
  try {
    return storage.getItem(activeSessionStorageKey(options.storageScope)) ?? undefined
  } catch {
    return undefined
  }
}

export function writeActiveSessionId(sessionId: string | undefined, options: ActiveSessionStorageOptions = {}): void {
  const storage = resolveStorage(options.storage)
  if (!storage) return
  try {
    const key = activeSessionStorageKey(options.storageScope)
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

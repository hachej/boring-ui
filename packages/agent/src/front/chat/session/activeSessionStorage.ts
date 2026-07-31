const ACTIVE_SESSION_KEY_PREFIX = 'boring-agent:v2'
const ACTIVE_SESSION_KEY_SUFFIX = 'activeSessionId'
const BOOT_RESUME_SESSION_KEY_SUFFIX = 'bootResumeSessionId'
const DEFAULT_STORAGE_SCOPE = 'default'

export interface ActiveSessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface BootResumeSessionSource {
  apiBaseUrl?: string
  sessionsApiPath: string
  workspaceId?: string
  storageScope?: string
}

export interface ActiveSessionStorageOptions {
  storageScope?: string
  storage?: ActiveSessionStorageLike
  bootResumeSource?: BootResumeSessionSource
}

export function activeSessionStorageKey(storageScope?: string): string {
  return scopedSessionStorageKey(storageScope, ACTIVE_SESSION_KEY_SUFFIX)
}

export function bootResumeSessionStorageKey(source?: string | BootResumeSessionSource): string {
  const scope = typeof source === 'object' && source !== null
    ? encodeURIComponent(JSON.stringify([
        source.apiBaseUrl?.replace(/\/$/, '') ?? '',
        source.sessionsApiPath,
        source.workspaceId ?? '',
        source.storageScope ?? DEFAULT_STORAGE_SCOPE,
      ]))
    : source
  return scopedSessionStorageKey(scope, BOOT_RESUME_SESSION_KEY_SUFFIX)
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

export function readBootResumeSessionId(options: ActiveSessionStorageOptions = {}): string | undefined {
  const storage = resolveBootStorage(options.storage)
  if (!storage) return undefined
  try {
    return storage.getItem(bootResumeSessionStorageKey(options.bootResumeSource ?? options.storageScope)) ?? undefined
  } catch {
    return undefined
  }
}

export function writeBootResumeSessionId(sessionId: string | undefined, options: ActiveSessionStorageOptions = {}): void {
  const storage = resolveBootStorage(options.storage)
  if (!storage) return
  try {
    const key = bootResumeSessionStorageKey(options.bootResumeSource ?? options.storageScope)
    if (sessionId === undefined || sessionId.length === 0) storage.removeItem(key)
    else storage.setItem(key, sessionId)
  } catch {}
}

function scopedSessionStorageKey(storageScope: string | undefined, suffix: string): string {
  const scope = storageScope && storageScope.length > 0 ? storageScope : DEFAULT_STORAGE_SCOPE
  return `${ACTIVE_SESSION_KEY_PREFIX}:${scope}:${suffix}`
}

function resolveStorage(storage: ActiveSessionStorageLike | undefined): ActiveSessionStorageLike | undefined {
  if (storage) return storage
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function resolveBootStorage(storage: ActiveSessionStorageLike | undefined): ActiveSessionStorageLike | undefined {
  if (storage) return storage
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

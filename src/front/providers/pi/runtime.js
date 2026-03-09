import {
  AppStorage,
  CustomProvidersStore,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
} from '@mariozechner/pi-web-ui'

let runtime = null
let runtimeScope = ''

class OperationCallbackError extends Error {
  constructor(error) {
    super('PI storage transaction callback failed')
    this.originalError = error
  }
}

class MemoryStorageBackend {
  constructor({ stores }) {
    this.config = { stores }
    this.storeData = new Map()
    for (const store of stores) {
      this.storeData.set(store.name, new Map())
    }
  }

  getStore(name) {
    if (!this.storeData.has(name)) {
      this.storeData.set(name, new Map())
    }
    return this.storeData.get(name)
  }

  resolveIndexKeyPath(storeName, indexName) {
    const store = this.config.stores.find((s) => s.name === storeName)
    const index = store?.indices?.find((idx) => idx.name === indexName)
    return index?.keyPath || indexName
  }

  readPath(value, keyPath) {
    if (!value || typeof value !== 'object') return undefined
    if (!keyPath.includes('.')) return value[keyPath]
    return keyPath.split('.').reduce((current, key) => {
      if (!current || typeof current !== 'object') return undefined
      return current[key]
    }, value)
  }

  async get(storeName, key) {
    const store = this.getStore(storeName)
    return store.has(key) ? store.get(key) : null
  }

  async set(storeName, key, value) {
    this.getStore(storeName).set(key, value)
  }

  async delete(storeName, key) {
    this.getStore(storeName).delete(key)
  }

  async keys(storeName, prefix = '') {
    const allKeys = Array.from(this.getStore(storeName).keys())
    return prefix ? allKeys.filter((key) => key.startsWith(prefix)) : allKeys
  }

  async getAllFromIndex(storeName, indexName, direction = 'asc') {
    const keyPath = this.resolveIndexKeyPath(storeName, indexName)
    const values = Array.from(this.getStore(storeName).values())

    values.sort((a, b) => {
      const av = this.readPath(a, keyPath)
      const bv = this.readPath(b, keyPath)
      if (av === bv) return 0
      if (av === undefined || av === null) return -1
      if (bv === undefined || bv === null) return 1
      return av < bv ? -1 : 1
    })

    return direction === 'desc' ? values.reverse() : values
  }

  async clear(storeName) {
    this.getStore(storeName).clear()
  }

  async has(storeName, key) {
    return this.getStore(storeName).has(key)
  }

  async transaction(_storeNames, _mode, operation) {
    const tx = {
      get: async (storeName, key) => this.get(storeName, key),
      set: async (storeName, key, value) => this.set(storeName, key, value),
      delete: async (storeName, key) => this.delete(storeName, key),
    }
    return operation(tx)
  }

  async getQuotaInfo() {
    return { usage: 0, quota: 0, percent: 0 }
  }

  async requestPersistence() {
    return false
  }
}

class FallbackStorageBackend {
  constructor(primary, fallback, storeNames = []) {
    this.active = primary
    this.fallback = fallback
    this.usingFallback = false
    this.storeNames = storeNames
    this.fallbackActivationPromise = null
  }

  async attemptMirrorPrimaryToFallback(sourceBackend) {
    for (const storeName of this.storeNames) {
      try {
        const keys = await sourceBackend.keys(storeName)
        for (const key of keys) {
          const value = await sourceBackend.get(storeName, key)
          if (value !== null) {
            await this.fallback.set(storeName, key, value)
          }
        }
      } catch (error) {
        console.warn(`[PiNativeAdapter] Failed to mirror store "${storeName}" during fallback.`, error)
      }
    }
  }

  async activateFallback(error) {
    // Fallback state machine:
    // 1) First caller flips `usingFallback` + `active` synchronously.
    // 2) It then starts one shared activation promise for best-effort mirroring/logging.
    // 3) Concurrent callers only await the shared promise or return immediately if done.
    if (this.usingFallback) {
      if (this.fallbackActivationPromise) {
        await this.fallbackActivationPromise
      }
      return
    }
    if (this.fallbackActivationPromise) {
      await this.fallbackActivationPromise
      return
    }

    const sourceBackend = this.active
    this.active = this.fallback
    this.usingFallback = true
    console.warn('[PiNativeAdapter] IndexedDB unavailable, falling back to in-memory storage.', error)

    this.fallbackActivationPromise = (async () => {
      await this.attemptMirrorPrimaryToFallback(sourceBackend)
    })()

    try {
      await this.fallbackActivationPromise
    } finally {
      this.fallbackActivationPromise = null
    }
  }

  async run(name, args) {
    try {
      return await this.active[name](...args)
    } catch (error) {
      await this.activateFallback(error)
      return this.active[name](...args)
    }
  }

  get(...args) {
    return this.run('get', args)
  }

  set(...args) {
    return this.run('set', args)
  }

  delete(...args) {
    return this.run('delete', args)
  }

  keys(...args) {
    return this.run('keys', args)
  }

  getAllFromIndex(...args) {
    return this.run('getAllFromIndex', args)
  }

  clear(...args) {
    return this.run('clear', args)
  }

  has(...args) {
    return this.run('has', args)
  }

  transaction(...args) {
    const [storeNames, mode, operation] = args
    const wrappedOperation = async (tx) => {
      try {
        return await operation(tx)
      } catch (error) {
        throw new OperationCallbackError(error)
      }
    }

    return this.active
      .transaction(storeNames, mode, wrappedOperation)
      .catch(async (error) => {
        if (error instanceof OperationCallbackError) {
          throw error.originalError
        }

        await this.activateFallback(error)
        return this.active.transaction(storeNames, mode, operation)
      })
  }

  getQuotaInfo(...args) {
    return this.run('getQuotaInfo', args)
  }

  requestPersistence(...args) {
    return this.run('requestPersistence', args)
  }
}

const sanitizeScope = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

export function getPiRuntime(userScope = '') {
  const scope = sanitizeScope(userScope)
  if (runtime && runtimeScope === scope) return runtime

  // User changed — tear down the old runtime so we get a fresh DB.
  if (runtime) {
    runtime = null
  }

  const settings = new SettingsStore()
  const providerKeys = new ProviderKeysStore()
  const sessions = new SessionsStore()
  const customProviders = new CustomProvidersStore()
  const stores = [
    settings.getConfig(),
    SessionsStore.getMetadataConfig(),
    providerKeys.getConfig(),
    customProviders.getConfig(),
    sessions.getConfig(),
  ]

  const dbName = scope
    ? `boring-ui-pi-agent-${scope}`
    : 'boring-ui-pi-agent'

  const fallbackBackend = new MemoryStorageBackend({ stores })
  let primaryBackend
  if (typeof indexedDB === 'undefined') {
    primaryBackend = fallbackBackend
  } else {
    primaryBackend = new IndexedDBStorageBackend({
      dbName,
      version: 1,
      stores,
    })
  }
  const backend = new FallbackStorageBackend(
    primaryBackend,
    fallbackBackend,
    stores.map((store) => store.name),
  )

  settings.setBackend(backend)
  providerKeys.setBackend(backend)
  sessions.setBackend(backend)
  customProviders.setBackend(backend)

  const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend)
  setAppStorage(storage)

  runtimeScope = scope
  runtime = {
    storage,
    settings,
    providerKeys,
    sessions,
    customProviders,
  }

  return runtime
}

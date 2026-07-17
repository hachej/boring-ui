import type { RemotePiSessionOptions } from './remotePiSession'

type SessionLifecycleOptions = Omit<Partial<RemotePiSessionOptions>, 'sessionId' | 'workspaceId' | 'storageScope' | 'apiBaseUrl' | 'headers' | 'fetch' | 'ephemeralSession'>

const objectIds = new WeakMap<object, number>()
let objectSequence = 0

function objectIdentity(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const object = value as object
  let id = objectIds.get(object)
  if (!id) {
    id = ++objectSequence
    objectIds.set(object, id)
  }
  return String(id)
}

/** Every callback/reference that can alter a RemotePiSession lifecycle belongs in this key. */
export function remoteSessionOptionsIdentity(options: SessionLifecycleOptions | undefined): string {
  if (!options) return '{}'
  return JSON.stringify({
    autoStart: options.autoStart,
    requestTimeoutMs: options.requestTimeoutMs,
    onEvent: objectIdentity(options.onEvent),
    storeOptions: objectIdentity(options.storeOptions),
    setTimeoutFn: objectIdentity(options.setTimeoutFn),
    clearTimeoutFn: objectIdentity(options.clearTimeoutFn),
    reconnect: options.reconnect ? {
      baseMs: options.reconnect.baseMs,
      maxMs: options.reconnect.maxMs,
      jitterRatio: options.reconnect.jitterRatio,
      random: objectIdentity(options.reconnect.random),
    } : undefined,
    debug: options.debug ? {
      largeStateWarningBytes: options.debug.largeStateWarningBytes,
      largeStateWarningMessages: options.debug.largeStateWarningMessages,
      onWarning: objectIdentity(options.debug.onWarning),
    } : undefined,
  })
}

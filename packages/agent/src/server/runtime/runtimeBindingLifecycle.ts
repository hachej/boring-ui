import type { FastifyInstance, FastifyRequest } from 'fastify'

export interface ManagedRuntimeBinding {
  retire: () => Promise<void>
  agent: { dispose: () => Promise<void> }
  disposeRuntime?: () => Promise<void>
}

export interface RuntimeBindingEntry<Binding extends ManagedRuntimeBinding> {
  workspaceId: string
  promise: Promise<Binding>
  state: 'pending' | 'ready' | 'failed' | 'retiring'
  error?: unknown
  disposePromise?: Promise<void>
  retirementPromise?: Promise<void>
  activeLeases: number
  leaseDrainPromise?: Promise<void>
  resolveLeaseDrain?: () => void
}

type RuntimeLifecyclePhase = 'accepting' | 'draining' | 'closing'

interface RequestLeaseLifetime {
  handlerSettled: boolean
  transportClosed: boolean
  deferUntilTransportClose: boolean
  released: boolean
}

interface RuntimeBindingLifecycleOptions {
  app: FastifyInstance
  capacity: number
  createDisposedError: (workspaceId: string) => Error
  evictCachedRuntime?: (ctx: { workspaceId: string }) => void | Promise<void>
  shutdownGraceMs?: number
}

interface AdmitRuntimeBindingOptions<Binding extends ManagedRuntimeBinding> {
  key: string
  workspaceId: string
  request?: FastifyRequest
  create: () => Promise<Binding>
}

export interface RuntimeBindingLifecycle<Binding extends ManagedRuntimeBinding> {
  assertAdmission: (workspaceId: string, request?: FastifyRequest) => void
  startDraining: () => void
  close: () => Promise<void>
  getEntry: (key: string) => RuntimeBindingEntry<Binding> | undefined
  isCurrentEntry: (key: string, entry: RuntimeBindingEntry<Binding>) => boolean
  touchEntry: (key: string, entry: RuntimeBindingEntry<Binding>) => void
  admit: (
    options: AdmitRuntimeBindingOptions<Binding>,
  ) => Promise<{ entry: RuntimeBindingEntry<Binding>; created: boolean }>
  retire: (key: string, entry: RuntimeBindingEntry<Binding>) => Promise<void>
  tracksRequestLifetime: (request: FastifyRequest) => boolean
  leaseRequestBinding: (request: FastifyRequest, binding: Binding) => boolean
  requestLeasesEntry: (request: FastifyRequest | undefined, entry: RuntimeBindingEntry<Binding>) => boolean
  tryLeaseOperation: (binding: Binding) => (() => void) | undefined
  tryLeaseEntryOperation: (entry: RuntimeBindingEntry<Binding>) => (() => void) | undefined
  deferRequestUntilTransportClose: (request: FastifyRequest) => void
}

export function createRuntimeBindingLifecycle<Binding extends ManagedRuntimeBinding>(
  options: RuntimeBindingLifecycleOptions,
): RuntimeBindingLifecycle<Binding> {
  const { app } = options
  let phase: RuntimeLifecyclePhase = 'accepting'
  let closePromise: Promise<void> | undefined
  const entries = new Map<string, RuntimeBindingEntry<Binding>>()
  const bindingEntries = new WeakMap<Binding, RuntimeBindingEntry<Binding>>()
  const requestBindingLeases = new WeakMap<FastifyRequest, Set<RuntimeBindingEntry<Binding>>>()
  const requestLeaseLifetimes = new WeakMap<FastifyRequest, RequestLeaseLifetime>()
  let admissionTail = Promise.resolve()
  let resolveEntryChange!: () => void
  let entryChange = new Promise<void>((resolve) => { resolveEntryChange = resolve })

  function notifyEntryChange(): void {
    resolveEntryChange()
    entryChange = new Promise<void>((resolve) => { resolveEntryChange = resolve })
  }

  async function withAdmissionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = admissionTail
    let release!: () => void
    admissionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  function getRequestLifetime(request: FastifyRequest): RequestLeaseLifetime {
    let lifetime = requestLeaseLifetimes.get(request)
    if (!lifetime) {
      lifetime = {
        handlerSettled: false,
        transportClosed: false,
        deferUntilTransportClose: false,
        released: false,
      }
      requestLeaseLifetimes.set(request, lifetime)
    }
    return lifetime
  }

  function requestCanContinueDuringDrain(request: FastifyRequest | undefined): boolean {
    if (!request) return false
    return requestLeaseLifetimes.get(request)?.handlerSettled === false
  }

  function assertAdmission(workspaceId: string, request?: FastifyRequest): void {
    if (phase === 'accepting') return
    if (phase === 'draining' && requestCanContinueDuringDrain(request)) return
    throw options.createDisposedError(workspaceId)
  }

  function releaseEntryLease(entry: RuntimeBindingEntry<Binding>): void {
    entry.activeLeases -= 1
    if (entry.activeLeases === 0) {
      entry.resolveLeaseDrain?.()
      entry.resolveLeaseDrain = undefined
      entry.leaseDrainPromise = undefined
      notifyEntryChange()
    }
  }

  function releaseRequestLeases(request: FastifyRequest): void {
    const leases = requestBindingLeases.get(request)
    if (!leases) return
    requestBindingLeases.delete(request)
    for (const entry of leases) releaseEntryLease(entry)
  }

  function maybeReleaseRequestLeases(request: FastifyRequest, lifetime: RequestLeaseLifetime): void {
    if (lifetime.released || !lifetime.handlerSettled) return
    if (lifetime.deferUntilTransportClose && !lifetime.transportClosed) return
    lifetime.released = true
    releaseRequestLeases(request)
  }

  app.addHook('onRoute', (routeOptions) => {
    const handler = routeOptions.handler
    routeOptions.handler = async function runtimeBindingLeaseHandler(request, reply) {
      const lifetime = getRequestLifetime(request)
      const onTransportClose = () => {
        request.raw.off('aborted', onTransportClose)
        reply.raw.off('close', onTransportClose)
        lifetime.transportClosed = true
        maybeReleaseRequestLeases(request, lifetime)
      }
      request.raw.once('aborted', onTransportClose)
      reply.raw.once('close', onTransportClose)
      try {
        return await handler.call(this, request, reply)
      } finally {
        lifetime.handlerSettled = true
        maybeReleaseRequestLeases(request, lifetime)
        if (!lifetime.deferUntilTransportClose) {
          request.raw.off('aborted', onTransportClose)
          reply.raw.off('close', onTransportClose)
        }
      }
    }
  })

  function leaseRequestBinding(request: FastifyRequest, binding: Binding): boolean {
    const entry = bindingEntries.get(binding)
    if (!entry) return false
    let leases = requestBindingLeases.get(request)
    if (leases?.has(entry)) return true
    if (entry.state !== 'ready') return false
    leases ??= new Set<RuntimeBindingEntry<Binding>>()
    leases.add(entry)
    requestBindingLeases.set(request, leases)
    entry.activeLeases += 1
    return true
  }

  function tryLeaseEntryOperation(entry: RuntimeBindingEntry<Binding>): (() => void) | undefined {
    if (entry.state !== 'ready') return undefined
    entry.activeLeases += 1
    let released = false
    return () => {
      if (released) return
      released = true
      releaseEntryLease(entry)
    }
  }

  function waitForLeases(entry: RuntimeBindingEntry<Binding>): Promise<void> {
    if (entry.activeLeases === 0) return Promise.resolve()
    entry.leaseDrainPromise ??= new Promise<void>((resolve) => {
      entry.resolveLeaseDrain = resolve
    })
    return entry.leaseDrainPromise
  }

  async function disposeEntry(entry: RuntimeBindingEntry<Binding>): Promise<void> {
    entry.disposePromise ??= (async () => {
      let disposalFailed = false
      let disposalError: unknown
      const captureDisposalError = (error: unknown, secondaryMessage: string) => {
        if (!disposalFailed) {
          disposalFailed = true
          disposalError = error
          return
        }
        app.log.warn({ err: error, workspaceId: entry.workspaceId }, secondaryMessage)
      }
      let binding: Binding | undefined
      try {
        binding = await entry.promise
      } catch (error) {
        captureDisposalError(error, '[agent] runtime binding cleanup failed after an earlier error')
      }
      if (binding) {
        await waitForLeases(entry)
        try {
          await binding.retire()
        } catch (error) {
          captureDisposalError(error, '[agent] failed to retire runtime binding after an earlier cleanup error')
        }
        try {
          await binding.agent.dispose()
        } catch (error) {
          captureDisposalError(error, '[agent] failed to dispose agent after an earlier cleanup error')
        }
        try {
          await binding.disposeRuntime?.()
        } catch (error) {
          captureDisposalError(error, '[agent] failed to dispose runtime pair after an earlier cleanup error')
        }
      }
      try {
        await options.evictCachedRuntime?.({ workspaceId: entry.workspaceId })
      } catch (error) {
        captureDisposalError(error, '[agent] failed to evict cached runtime after an earlier cleanup error')
      }
      if (disposalFailed) throw disposalError
    })()
    return entry.disposePromise
  }

  function beginRetirement(key: string, entry: RuntimeBindingEntry<Binding>): Promise<void> {
    if (!entry.retirementPromise) {
      entry.state = 'retiring'
      entry.retirementPromise = (async () => {
        try {
          await disposeEntry(entry)
        } finally {
          if (entries.get(key) === entry) entries.delete(key)
          notifyEntryChange()
        }
      })()
    }
    return entry.retirementPromise
  }

  function createEntry(
    key: string,
    workspaceId: string,
    create: () => Promise<Binding>,
  ): RuntimeBindingEntry<Binding> {
    let entry!: RuntimeBindingEntry<Binding>
    const promise = Promise.resolve().then(create).then(
      (binding) => {
        bindingEntries.set(binding, entry)
        if (entry.state === 'pending') entry.state = 'ready'
        notifyEntryChange()
        return binding
      },
      async (error) => {
        entry.error = error
        if (entry.state !== 'retiring') {
          entry.state = 'failed'
          if (entries.get(key) === entry) entries.delete(key)
          notifyEntryChange()
          if (!entry.disposePromise) {
            entry.disposePromise = (async () => {
              try {
                await options.evictCachedRuntime?.({ workspaceId })
              } catch (cleanupError) {
                app.log.warn(
                  { err: cleanupError, workspaceId },
                  '[agent] failed to evict runtime after binding creation failure',
                )
              }
            })()
            await entry.disposePromise
          }
        }
        throw error
      },
    )
    entry = { workspaceId, promise, state: 'pending', activeLeases: 0 }
    promise.catch(() => {})
    return entry
  }

  async function admit(
    admission: AdmitRuntimeBindingOptions<Binding>,
  ): Promise<{ entry: RuntimeBindingEntry<Binding>; created: boolean }> {
    assertAdmission(admission.workspaceId, admission.request)
    return await withAdmissionLock(async () => {
      assertAdmission(admission.workspaceId, admission.request)
      const concurrent = entries.get(admission.key)
      if (concurrent) return { entry: concurrent, created: false }
      while (entries.size >= options.capacity) {
        assertAdmission(admission.workspaceId, admission.request)
        const oldestRetireable = [...entries.entries()].find(([, entry]) =>
          entry.state === 'ready' && entry.activeLeases === 0,
        )
        if (!oldestRetireable) {
          await entryChange
          continue
        }
        await beginRetirement(oldestRetireable[0], oldestRetireable[1])
      }
      assertAdmission(admission.workspaceId, admission.request)
      const entry = createEntry(admission.key, admission.workspaceId, admission.create)
      entries.set(admission.key, entry)
      return { entry, created: true }
    })
  }

  function close(): Promise<void> {
    phase = 'closing'
    notifyEntryChange()
    closePromise ??= (async () => {
      const retirements = [...entries.entries()].map(([key, entry]) => beginRetirement(key, entry))
      entries.clear()
      const cleanup = Promise.allSettled(retirements).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            app.log.warn({ err: result.reason }, '[agent] failed to dispose runtime binding')
          }
        }
      })
      cleanup.catch(() => {})
      await Promise.race([
        cleanup,
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, options.shutdownGraceMs ?? 5_000))),
      ])
    })()
    return closePromise
  }

  return {
    assertAdmission,
    startDraining() {
      if (phase !== 'accepting') return
      phase = 'draining'
      notifyEntryChange()
    },
    close,
    getEntry: (key) => entries.get(key),
    isCurrentEntry: (key, entry) => entries.get(key) === entry,
    touchEntry(key, entry) {
      if (entry.state === 'retiring' || entries.get(key) !== entry) return
      entries.delete(key)
      entries.set(key, entry)
    },
    admit,
    retire: async (key, entry) => await beginRetirement(key, entry),
    tracksRequestLifetime: (request) => requestLeaseLifetimes.has(request),
    leaseRequestBinding,
    requestLeasesEntry: (request, entry) =>
      request ? requestBindingLeases.get(request)?.has(entry) === true : false,
    tryLeaseOperation(binding) {
      const entry = bindingEntries.get(binding)
      return entry ? tryLeaseEntryOperation(entry) : undefined
    },
    tryLeaseEntryOperation,
    deferRequestUntilTransportClose(request) {
      const lifetime = getRequestLifetime(request)
      lifetime.deferUntilTransportClose = true
      maybeReleaseRequestLeases(request, lifetime)
    },
  }
}

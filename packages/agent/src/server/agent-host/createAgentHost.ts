import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { AgentGatewayError, AgentGatewayErrorCode, ErrorCode, type AuthorizedAgentScope, type VerifiedAgentScopeClaim } from '../../shared/index'
import { buildAgentComposition, type BuiltAgentComposition } from './buildAgentComposition'
import { EmbeddedAgentGateway } from './embeddedGateway'
import { EnvironmentLeaseManager, type EnvironmentLease } from './environmentLease'
import { createAgentHostRoutes } from './httpProjection'
import { createLegacyPiChatCompatibilityService } from './legacyPiChatCompatibility'
import { InMemoryAgentRequestLedger } from './requestLedger'
import {
  AgentSessionActivityIndex,
  AgentSessionInventory,
  type AgentSessionRuntimeAuthority,
} from './sessionInventory'
import type {
  AgentHostAgentSpec,
  AgentHostHandle,
  AgentRequestKey,
  CompiledAgentHostAgentSpec,
  CreatedAgentHost,
  CreateAgentHostOptions,
  AgentHostAddressedHttpProjectionOptions,
  AgentHostHttpProjectionOptions,
  AgentHostLegacyProjectionLifecycle,
  AgentHostLegacyProjectionRuntime,
  AgentHostWorkerIntent,
  AgentHostWorkerLogger,
  ResolvedAgentRuntimeScope,
} from './types'

const SAFE_AGENT_TYPE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SAFE_HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const SAFE_WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000

type HostWorkerErrorCode =
  | typeof ErrorCode.enum.AGENT_HOST_WORKER_FAILED
  | typeof ErrorCode.enum.AGENT_HOST_WORKER_EXITED

class AgentHostWorkerError extends Error {
  readonly workerId: string

  constructor(readonly code: HostWorkerErrorCode, workerId: string) {
    super(code)
    this.name = 'AgentHostWorkerError'
    this.workerId = workerId
  }
}

class AgentHostLifecycleError extends Error {
  readonly code = ErrorCode.enum.AGENT_HOST_LIFECYCLE_CONFLICT

  constructor(message: string) {
    super(message)
    this.name = 'AgentHostLifecycleError'
  }
}

function validateHostWorkers(workers: readonly AgentHostWorkerIntent[]): void {
  const seen = new Set<string>()
  for (const worker of workers) {
    if (!worker || typeof worker !== 'object' || !SAFE_WORKER_ID.test(worker.id) || typeof worker.run !== 'function') {
      throw new AgentHostLifecycleError('agent host worker declaration is invalid')
    }
    if (seen.has(worker.id)) throw new AgentHostLifecycleError(`agent host worker registered twice: ${worker.id}`)
    seen.add(worker.id)
  }
}

function isThenable(value: unknown): value is PromiseLike<void> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'
}

interface RuntimeBinding {
  readonly key: string
  readonly scope: ResolvedAgentRuntimeScope
  readonly environmentLease: EnvironmentLease
  readonly composition: BuiltAgentComposition
}

const compatibilityRuntimes = new WeakMap<CreatedAgentHost, AgentHostRuntime>()
const compatibilityGateways = new WeakMap<CreatedAgentHost, EmbeddedAgentGateway>()

export interface AgentHostRuntime {
  readonly options: CreateAgentHostOptions
  readonly compiledAgents: readonly CompiledAgentHostAgentSpec[]
  readonly compiledById: ReadonlyMap<string, CompiledAgentHostAgentSpec>
  readonly ledger: import('./types').AgentRequestLedger
  readonly effectAdmission: import('./types').AgentEffectAdmission
  readonly activity: AgentSessionActivityIndex
  listSessionSummaries(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
  ): Promise<readonly import('../../shared/session').SessionSummary[]>
  isDraining(): boolean
  assertOpen(): void
  verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim>
  resolveSessionRuntime(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    sessionId: string,
  ): Promise<AgentSessionRuntimeAuthority | undefined>
  resolveBinding(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    resolvedRuntimeScope?: ResolvedAgentRuntimeScope,
  ): Promise<RuntimeBinding>
  startDrain(): void
  drainRuntime(): Promise<void>
  registerSubscription(close: () => void | Promise<void>): () => void
  trackEffect<T>(effect: Promise<T>, key: AgentRequestKey): Promise<T>
  retireCompatibilityComposition(composition: BuiltAgentComposition): Promise<void>
  closeRuntime(): Promise<void>
}

function cloneFleet(agents: readonly AgentHostAgentSpec[]): AgentHostAgentSpec[] {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new TypeError('createAgentHost requires a non-empty agents fleet')
  }
  return agents.map((agent) => structuredClone(agent))
}

function validateFleetIds(agents: readonly { readonly agentTypeId: string }[]): void {
  const ids = new Set<string>()
  for (const agent of agents) {
    if (!SAFE_AGENT_TYPE_ID.test(agent.agentTypeId)) {
      throw new TypeError(`unsafe agentTypeId: ${agent.agentTypeId}`)
    }
    if (ids.has(agent.agentTypeId)) {
      throw new TypeError(`duplicate agentTypeId: ${agent.agentTypeId}`)
    }
    ids.add(agent.agentTypeId)
  }
}

function freezeRecursive<T>(value: T, seen = new WeakSet<object>()): T {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  const object = value as object
  if (seen.has(object)) return value
  seen.add(object)
  for (const property of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, property)
    if (descriptor && 'value' in descriptor) freezeRecursive(descriptor.value, seen)
  }
  return Object.freeze(value)
}

async function compileFleet(
  options: CreateAgentHostOptions,
): Promise<readonly CompiledAgentHostAgentSpec[]> {
  const cloned = cloneFleet(options.agents)
  validateFleetIds(cloned)
  const compiled = [...await options.fleetCompiler.compile({ agents: cloned })]
  validateFleetIds(compiled)
  const expected = new Set(cloned.map((agent) => agent.agentTypeId))
  if (compiled.length !== cloned.length || compiled.some((agent) => !expected.has(agent.agentTypeId))) {
    throw new TypeError('fleet compiler output must preserve the input agentTypeId set one-to-one')
  }
  return freezeRecursive(compiled.map((agent) => freezeRecursive(agent)))
}

async function resolveHostId(options: CreateAgentHostOptions): Promise<string> {
  if (options.hostId !== undefined) {
    const hostId = options.hostId.trim()
    if (!SAFE_HOST_ID.test(hostId)) throw new TypeError('hostId is empty or unsafe')
    return hostId
  }
  if (!options.sessionRoot?.trim()) {
    throw new TypeError('createAgentHost requires hostId or a durable sessionRoot')
  }
  const root = options.sessionRoot
  await mkdir(root, { recursive: true })
  const identityPath = join(root, '.agent-host-id')
  try {
    const existing = (await readFile(identityPath, 'utf8')).trim()
    if (!SAFE_HOST_ID.test(existing)) throw new TypeError('stored agent host ID is invalid')
    return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const generated = randomUUID()
  try {
    await writeFile(identityPath, `${generated}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return generated
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = (await readFile(identityPath, 'utf8')).trim()
    if (!SAFE_HOST_ID.test(existing)) throw new TypeError('stored agent host ID is invalid')
    return existing
  }
}

function validateResolvedRuntimeScope(resolved: ResolvedAgentRuntimeScope): void {
  if (!resolved.identity.trim()) throw new TypeError('resolved runtime scope identity must be non-empty')
  if (!resolved.environment.placementIdentity.trim() || !resolved.environment.provisioningFingerprint.trim()) {
    throw new TypeError('resolved environment identity must be non-empty')
  }
}

function createRuntime(
  options: CreateAgentHostOptions,
  compiledAgents: readonly CompiledAgentHostAgentSpec[],
): AgentHostRuntime {
  const compiledById = new Map(compiledAgents.map((agent) => [agent.agentTypeId, agent]))
  const environments = new EnvironmentLeaseManager(options.runtimeModeAdapter)
  const inventory = new AgentSessionInventory(options, compiledById)
  const activity = new AgentSessionActivityIndex()
  const bindings = new Map<string, Promise<RuntimeBinding>>()
  const pendingBindings = new Set<Promise<RuntimeBinding>>()
  const rejectPendingBindings = new Set<(error: unknown) => void>()
  const bindingDisposals = new WeakMap<RuntimeBinding, Promise<void>>()
  const subscriptions = new Set<() => void | Promise<void>>()
  const finiteEffects = new Map<Promise<unknown>, AgentRequestKey>()
  const graceMs = Math.max(0, options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS)
  let draining = false
  let drainPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined

  const disposeBinding = (binding: RuntimeBinding): Promise<void> => {
    let disposal = bindingDisposals.get(binding)
    if (!disposal) {
      disposal = (async () => {
        try {
          await binding.composition.dispose()
        } finally {
          binding.environmentLease.release()
        }
      })()
      bindingDisposals.set(binding, disposal)
      disposal.catch(() => {})
    }
    return disposal
  }

  const runtime: AgentHostRuntime = {
    options,
    compiledAgents,
    compiledById,
    ledger: options.requestLedger ?? new InMemoryAgentRequestLedger(),
    effectAdmission: options.effectAdmission ?? {
      async admit({ key }) {
        return { type: 'accepted', admissionReceipt: `trusted-local:${key.requestId}` }
      },
    },
    activity,
    listSessionSummaries(agentTypeId, scope, claim) {
      runtime.assertOpen()
      return inventory.list(agentTypeId, scope, claim)
    },
    isDraining: () => draining,
    assertOpen() {
      if (draining) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
    },
    async verify(scope) {
      runtime.assertOpen()
      try {
        return await options.scopeVerifier.verify(scope)
      } catch {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'agent scope is not authorized')
      }
    },
    async resolveSessionRuntime(agentTypeId, scope, claim, sessionId) {
      runtime.assertOpen()
      try {
        const authority = await inventory.resolveSessionRuntime(agentTypeId, scope, claim, sessionId)
        if (!authority) return undefined
        validateResolvedRuntimeScope(authority.runtimeScope)
        return authority
      } catch {
        throw new AgentGatewayError(
          AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
          'session runtime scope metadata is unavailable',
        )
      }
    },
    async resolveBinding(agentTypeId, scope, claim, resolvedRuntimeScope) {
      runtime.assertOpen()
      const agent = compiledById.get(agentTypeId)
      if (!agent) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'agent type is not available')
      const resolved = resolvedRuntimeScope ?? await options.resolveRuntimeScope({ agentTypeId, scope })
      validateResolvedRuntimeScope(resolved)
      const key = JSON.stringify([agentTypeId, claim.workspaceScopeId, resolved.identity])
      let promise = bindings.get(key)
      if (!promise) {
        let rejectForDrain!: (error: unknown) => void
        const drainFence = new Promise<never>((_resolve, reject) => { rejectForDrain = reject })
        rejectPendingBindings.add(rejectForDrain)
        const creation = (async (): Promise<RuntimeBinding> => {
          const environmentLease = await environments.acquire(claim.workspaceScopeId, resolved.environment)
          let binding: RuntimeBinding | undefined
          try {
            const runtimeBundle = options.runtimeHost
              ? { ...environmentLease.bundle, runtimeHost: options.runtimeHost }
              : environmentLease.bundle
            const composition = await buildAgentComposition({
              agent,
              workspaceScopeId: claim.workspaceScopeId,
              runtimeScope: resolved,
              runtimeBundle,
              environmentProvisioning: environmentLease.provisioning,
              options,
              observeSessionEvent: (sessionId, event) => {
                if (!draining) {
                  activity.observe(claim.workspaceScopeId, { agentTypeId, sessionId }, event)
                }
              },
            })
            binding = { key, scope: resolved, environmentLease, composition }
            if (draining || bindings.get(key) !== promise) {
              await disposeBinding(binding)
              throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
            }
            return binding
          } catch (error) {
            if (!binding) environmentLease.release()
            throw error
          }
        })()
        creation.catch(() => {})
        promise = Promise.race([creation, drainFence])
        bindings.set(key, promise)
        pendingBindings.add(promise)
        promise.finally(() => {
          pendingBindings.delete(promise!)
          rejectPendingBindings.delete(rejectForDrain)
        }).catch(() => {})
        promise.catch(() => {
          if (bindings.get(key) === promise) bindings.delete(key)
        })
      }
      return await promise
    },
    startDrain() {
      if (draining) return
      draining = true
      environments.startDrain()
      for (const close of [...subscriptions]) void Promise.resolve(close()).catch(() => {})
      subscriptions.clear()
    },
    drainRuntime() {
      runtime.startDrain()
      drainPromise ??= (async () => {
        const work = [...finiteEffects.keys(), ...pendingBindings]
        if (work.length === 0) return
        const completed = await Promise.race([
          Promise.allSettled(work).then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs)),
        ])
        if (completed) return
        const closed = new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
        for (const reject of [...rejectPendingBindings]) reject(closed)
        for (const key of finiteEffects.values()) {
          const unknown = new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
            'effect outcome could not be safely replayed',
          )
          void runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
        }
      })()
      return drainPromise
    },
    registerSubscription(close) {
      runtime.assertOpen()
      subscriptions.add(close)
      return () => subscriptions.delete(close)
    },
    trackEffect(effect, key) {
      finiteEffects.set(effect, key)
      effect.finally(() => finiteEffects.delete(effect)).catch(() => {})
      return effect
    },
    async retireCompatibilityComposition(composition) {
      for (const [key, promise] of bindings) {
        const result = await promise.catch(() => undefined)
        if (!result || result.composition !== composition) continue
        if (bindings.get(key) === promise) bindings.delete(key)
        let firstError: unknown
        try {
          await result.composition.dispose()
        } catch (error) {
          firstError = error
        }
        try {
          await result.environmentLease.retire()
        } catch (error) {
          firstError ??= error
        }
        if (firstError !== undefined) throw firstError
        return
      }
    },
    closeRuntime() {
      closePromise ??= (async () => {
        await runtime.drainRuntime()
        let firstError: unknown
        const resolvedBindings = await Promise.allSettled([...bindings.values()])
        bindings.clear()
        const bindingCleanup = Promise.allSettled(resolvedBindings.flatMap((result) =>
          result.status === 'fulfilled' ? [disposeBinding(result.value)] : [],
        ))
        const bindingCleanupResult = await Promise.race([
          bindingCleanup.then((results) => ({ completed: true as const, results })),
          new Promise<{ completed: false }>((resolve) => setTimeout(() => resolve({ completed: false }), graceMs)),
        ])
        if (bindingCleanupResult.completed) {
          const failed = bindingCleanupResult.results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          )
          if (failed) firstError ??= failed.reason
        }
        try {
          await environments.close(graceMs)
        } catch (error) {
          firstError ??= error
        }
        try {
          await Promise.race([
            options.runtimeModeAdapter.dispose?.() ?? Promise.resolve(),
            new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
          ])
        } catch (error) {
          firstError ??= error
        }
        if (firstError !== undefined) throw firstError
      })()
      return closePromise
    },
  }
  return runtime
}

export async function createAgentHost(
  options: CreateAgentHostOptions,
): Promise<CreatedAgentHost> {
  const compiledAgents = await compileFleet(options)
  const hostId = await resolveHostId(options)
  const runtime = createRuntime(options, compiledAgents)
  const gateway = new EmbeddedAgentGateway(runtime)
  const workerIntents = options.hostWorkers ?? []
  validateHostWorkers(workerIntents)
  const workerControllers = workerIntents.map(() => new AbortController())
  const workerLifetimes: Promise<void>[] = []
  let workerLogger: AgentHostWorkerLogger | undefined
  let workerState: 'created' | 'running' | 'aborting' | 'drained' | 'closed' = 'created'
  let retainedError: unknown
  let legacyLifecycle: AgentHostLegacyProjectionLifecycle | undefined
  let hostClose: Promise<void> | undefined
  let drainPromise: Promise<void> | undefined

  const retainWorkerError = (code: HostWorkerErrorCode, workerId: string): void => {
    const error = new AgentHostWorkerError(code, workerId)
    retainedError ??= error
    workerLogger?.error({
      agentHostWorker: { code, workerId },
    }, '[agent] host worker exited unexpectedly')
  }

  const captureLifecycleError = (firstError: unknown, error: unknown, event: string): unknown => {
    if (firstError === undefined) return error
    workerLogger?.warn({
      agentHostLifecycle: { event },
    }, '[agent] Host cleanup failed after an earlier lifecycle error')
    return firstError
  }

  const registerLegacyLifecycle = (next: AgentHostLegacyProjectionLifecycle): void => {
    if (legacyLifecycle) throw new AgentHostLifecycleError('legacy route lifecycle already registered')
    legacyLifecycle = next
  }

  const host: AgentHostHandle = Object.freeze({
    hostId,
    async describe() {
      return {
        hostId,
        agents: compiledAgents.map((agent) => ({
          agentTypeId: agent.agentTypeId,
          label: 'legacyDefault' in agent ? 'Agent' : agent.definition.label,
        })),
        draining: workerState === 'aborting' || workerState === 'drained' || workerState === 'closed' || runtime.isDraining(),
      }
    },
    startWorkers({ logger }: { readonly logger: AgentHostWorkerLogger }) {
      if (workerState !== 'created') return
      workerState = 'running'
      workerLogger = logger
      for (let index = 0; index < workerIntents.length; index += 1) {
        const worker = workerIntents[index]!
        const controller = workerControllers[index]!
        let result: unknown
        try {
          result = worker.run({ signal: controller.signal, logger })
        } catch {
          retainWorkerError(ErrorCode.enum.AGENT_HOST_WORKER_FAILED, worker.id)
          continue
        }
        if (!isThenable(result)) {
          retainWorkerError(ErrorCode.enum.AGENT_HOST_WORKER_EXITED, worker.id)
          continue
        }
        const workerPromise = Promise.resolve(result)
        const settled = workerPromise.then(
          () => 'resolved' as const,
          () => 'rejected' as const,
        )
        const abortedMarker = Object.freeze({ aborted: true })
        const aborted = new Promise<typeof abortedMarker>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve(abortedMarker), { once: true })
        })
        const firstOutcome = Promise.race([workerPromise, aborted]).then(
          (value) => value === abortedMarker ? 'aborted' as const : 'resolved' as const,
          () => 'rejected' as const,
        )
        const lifetime = firstOutcome.then(async (first) => {
          if (first === 'resolved') {
            retainWorkerError(ErrorCode.enum.AGENT_HOST_WORKER_EXITED, worker.id)
            return
          }
          if (first === 'rejected') {
            retainWorkerError(ErrorCode.enum.AGENT_HOST_WORKER_FAILED, worker.id)
            return
          }
          if (await settled === 'rejected') retainWorkerError(ErrorCode.enum.AGENT_HOST_WORKER_FAILED, worker.id)
        })
        workerLifetimes.push(lifetime)
      }
    },
    beginDrain() {
      if (workerState === 'aborting' || workerState === 'drained' || workerState === 'closed') return
      workerState = 'aborting'
      for (const controller of workerControllers) controller.abort()
    },
    drain() {
      drainPromise ??= (async () => {
        host.beginDrain()
        await Promise.allSettled(workerLifetimes)
        let firstError = retainedError
        try {
          legacyLifecycle?.startDraining()
        } catch (error) {
          firstError = captureLifecycleError(firstError, error, 'legacy-admission-close-failed')
        }
        try {
          await runtime.drainRuntime()
        } catch (error) {
          firstError = captureLifecycleError(firstError, error, 'runtime-drain-failed')
        }
        workerState = 'drained'
        retainedError ??= firstError
        if (firstError !== undefined) throw firstError
      })()
      return drainPromise
    },
    close() {
      hostClose ??= (async () => {
        let firstError: unknown
        try {
          await host.drain()
        } catch (error) {
          firstError = error
        }
        try {
          await legacyLifecycle?.closeBindings()
        } catch (error) {
          firstError = captureLifecycleError(firstError, error, 'legacy-bindings-close-failed')
        }
        try {
          await runtime.closeRuntime()
        } catch (error) {
          firstError = captureLifecycleError(firstError, error, 'runtime-close-failed')
        }
        workerState = 'closed'
        retainedError ??= firstError
        if (firstError !== undefined) throw firstError
      })()
      return hostClose
    },
  })

  const legacyProjectionRuntime: AgentHostLegacyProjectionRuntime = Object.freeze({
    gateway,
    async resolveComposition(agentTypeId: string, scope: AuthorizedAgentScope) {
      const claim = await runtime.verify(scope)
      const composition = (await runtime.resolveBinding(agentTypeId, scope, claim)).composition
      return {
        agent: composition.agent,
        harness: composition.harness,
        service: composition.service,
        tools: composition.tools,
        runtimeBundle: composition.runtimeBundle,
        readyTracker: composition.readyTracker,
        retire: () => runtime.retireCompatibilityComposition(composition),
      }
    },
    createAddressedRoutes(addressedOptions: Parameters<AgentHostLegacyProjectionRuntime['createAddressedRoutes']>[0]) {
      return createAgentHostRoutes({
        host,
        gateway,
        options: { ...addressedOptions, legacyPiChatAliases: false },
        manageLifecycle: false,
        async resolveLegacyPiChatService(request) {
          const scope = await addressedOptions.authorizeRequest(request)
          const claim = await runtime.verify(scope)
          const binding = await runtime.resolveBinding(addressedOptions.defaultAgentTypeId, scope, claim)
          return createLegacyPiChatCompatibilityService({
            gateway,
            service: binding.composition.service,
            scope,
            agentTypeId: addressedOptions.defaultAgentTypeId,
          })
        },
      })
    },
    createPiChatService({ service, scope, agentTypeId }: Parameters<AgentHostLegacyProjectionRuntime['createPiChatService']>[0]) {
      return createLegacyPiChatCompatibilityService({ gateway, service, scope, agentTypeId })
    },
  })

  const created = Object.freeze({
    host,
    gateway,
    registerRoutes(projectionOptions: AgentHostHttpProjectionOptions) {
      if (!runtime.compiledById.has(projectionOptions.defaultAgentTypeId)) {
        throw new TypeError(`unknown defaultAgentTypeId: ${projectionOptions.defaultAgentTypeId}`)
      }
      if (projectionOptions.legacyRoutePolicy) {
        return async (app: FastifyInstance) => {
          app.addHook('onListen', async () => host.startWorkers({ logger: app.log }))
          app.addHook('preClose', async () => host.beginDrain())
          app.addHook('onClose', async () => await host.close())
          await projectionOptions.legacyRoutePolicy.mount({
            app,
            runtime: legacyProjectionRuntime,
            defaultAgentTypeId: projectionOptions.defaultAgentTypeId,
            registerLifecycle: registerLegacyLifecycle,
          })
          if (!legacyLifecycle) throw new AgentHostLifecycleError('legacy route policy did not register its lifecycle')
        }
      }
      const authorizeRequest = projectionOptions.authorizeRequest
      if (!authorizeRequest) {
        throw new TypeError('authorizeRequest is required for the addressed Agent Host projection')
      }
      return createAgentHostRoutes({
        host,
        gateway,
        options: { ...projectionOptions, authorizeRequest },
        async resolveLegacyPiChatService(request) {
          const scope = await authorizeRequest(request)
          const claim = await runtime.verify(scope)
          const binding = await runtime.resolveBinding(projectionOptions.defaultAgentTypeId, scope, claim)
          return createLegacyPiChatCompatibilityService({
            gateway,
            service: binding.composition.service,
            scope,
            agentTypeId: projectionOptions.defaultAgentTypeId,
          })
        },
      })
    },
  })
  compatibilityRuntimes.set(created, runtime)
  compatibilityGateways.set(created, gateway)
  return created
}

/**
 * Additive addressed projection for compatibility wrappers that already own
 * their parent Fastify lifecycle. Legacy aliases remain registered by the
 * wrapper in their historical order.
 */
export function createAgentHostCompatibilityRoutes(
  created: CreatedAgentHost,
  projectionOptions: AgentHostAddressedHttpProjectionOptions,
): import('fastify').FastifyPluginAsync {
  const runtime = compatibilityRuntimes.get(created)
  const gateway = compatibilityGateways.get(created)
  if (!runtime || !gateway) throw new TypeError('unknown Agent Host compatibility handle')
  if (!runtime.compiledById.has(projectionOptions.defaultAgentTypeId)) {
    throw new TypeError(`unknown defaultAgentTypeId: ${projectionOptions.defaultAgentTypeId}`)
  }
  const authorizeRequest = projectionOptions.authorizeRequest
  if (!authorizeRequest) {
    throw new TypeError('authorizeRequest is required for compatibility routes')
  }
  return createAgentHostRoutes({
    host: created.host,
    gateway,
    options: { ...projectionOptions, authorizeRequest, legacyPiChatAliases: false },
    manageLifecycle: false,
    async resolveLegacyPiChatService(request) {
      const scope = await authorizeRequest(request)
      const claim = await runtime.verify(scope)
      const binding = await runtime.resolveBinding(projectionOptions.defaultAgentTypeId, scope, claim)
      return createLegacyPiChatCompatibilityService({
        gateway,
        service: binding.composition.service,
        scope,
        agentTypeId: projectionOptions.defaultAgentTypeId,
      })
    },
  })
}

/**
 * Internal compatibility projection for the two legacy public wrappers. It
 * deliberately resolves through the same Host runtime/binding funnel used by
 * the Gateway; it cannot construct a composition independently.
 */
export async function resolveAgentHostCompatibilityComposition(
  created: CreatedAgentHost,
  agentTypeId: string,
  scope: AuthorizedAgentScope,
): Promise<BuiltAgentComposition> {
  const runtime = compatibilityRuntimes.get(created)
  if (!runtime) throw new TypeError('unknown Agent Host compatibility handle')
  const claim = await runtime.verify(scope)
  return (await runtime.resolveBinding(agentTypeId, scope, claim)).composition
}

export function createAgentHostLegacyPiChatCompatibilityService(
  created: CreatedAgentHost,
  service: import('../../core/piChatSessionService').AgentCoreSessionService,
  scope: AuthorizedAgentScope,
  agentTypeId: string,
): import('../../core/piChatSessionService').PiChatSessionService {
  const gateway = compatibilityGateways.get(created)
  if (!gateway) throw new TypeError('unknown Agent Host compatibility handle')
  return createLegacyPiChatCompatibilityService({ gateway, service, scope, agentTypeId })
}

export async function retireAgentHostCompatibilityComposition(
  created: CreatedAgentHost,
  composition: BuiltAgentComposition,
): Promise<void> {
  const runtime = compatibilityRuntimes.get(created)
  if (!runtime) throw new TypeError('unknown Agent Host compatibility handle')
  await runtime.retireCompatibilityComposition(composition)
}

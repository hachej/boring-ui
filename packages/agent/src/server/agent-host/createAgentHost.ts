import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AgentGatewayError, AgentGatewayErrorCode, type AuthorizedAgentScope, type VerifiedAgentScopeClaim } from '../../shared/index'
import { buildAgentComposition, type BuiltAgentComposition } from './buildAgentComposition'
import { EmbeddedAgentGateway } from './embeddedGateway'
import { EnvironmentLeaseManager, type EnvironmentLease } from './environmentLease'
import { getOptionalRuntimeBundleStorageRoot } from '../runtime/mode'
import { mergeRuntimeFilesystemBindings } from '../runtime/filesystemBindings'
import { createAgentHostRoutes } from './httpProjection'
import { InMemoryAgentRequestLedger } from './requestLedger'
import { resolveRequestLedgerPath } from './requestLedgerPath'
import { SqliteAgentRequestLedger } from './sqliteRequestLedger'
import {
  createAgentHostRuntimeCapabilityProjection,
} from './runtimeCapabilityProjection'
import {
  bindingDisposedError,
  guardMethods,
  runWithWorkspaceAgentLease,
} from './workspaceAgentLease'
import {
  AgentSessionActivityIndex,
  AgentSessionInventory,
} from './sessionInventory'
import type {
  AgentHostAgentSpec,
  AgentHostHandle,
  AgentRequestKey,
  CompiledAgentHostAgentSpec,
  CreatedAgentHost,
  CreateAgentHostOptions,
  AgentHostDirectProjectionOptions,
  AgentHostEnvironmentLease,
  AgentHostEnvironmentScope,
  AuthorizedEnvironmentIntent,
  LeaseBoundWorkspaceAgent,
  ResolvedAgentRuntimeScope,
} from './types'

const SAFE_AGENT_TYPE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SAFE_HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000

export interface RuntimeBinding {
  readonly key: string
  readonly agentTypeId: string
  readonly workspaceScopeId: string
  readonly generation: number
  readonly scope: ResolvedAgentRuntimeScope
  readonly environmentLease: EnvironmentLease
  readonly composition: BuiltAgentComposition
}

export interface AgentHostRuntime {
  readonly options: CreateAgentHostOptions
  readonly compiledAgents: readonly CompiledAgentHostAgentSpec[]
  readonly compiledById: ReadonlyMap<string, CompiledAgentHostAgentSpec>
  readonly ledger: import('./types').AgentRequestLedger
  readonly effectAdmission: import('./types').AgentEffectAdmission
  readonly activity: AgentSessionActivityIndex
  readonly shutdownGraceMs: number
  listSessionSummaries(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
  ): Promise<readonly import('../../shared/session').SessionSummary[]>
  isDraining(): boolean
  assertOpen(): void
  verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim>
  resolveEnvironmentScope(
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    intent: AuthorizedEnvironmentIntent,
  ): Promise<AgentHostEnvironmentScope>
  acquireEnvironment(
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    intent: AuthorizedEnvironmentIntent,
  ): Promise<EnvironmentLease>
  acquireResolvedEnvironment(
    workspaceScopeId: string,
    environment: AgentHostEnvironmentScope,
  ): Promise<EnvironmentLease>
  resolveSessionRuntime(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    sessionId: string,
  ): Promise<ResolvedAgentRuntimeScope | undefined>
  resolveAgentRuntimeScope(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    operation: 'new-binding' | 'existing-session' | 'reload',
    requestId: string,
    sessionId?: string,
  ): Promise<ResolvedAgentRuntimeScope>
  resolveBinding(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    resolvedRuntimeScope?: ResolvedAgentRuntimeScope,
  ): Promise<RuntimeBinding>
  findPublishedCurrentBinding(
    agentTypeId: string,
    workspaceScopeId: string,
    physicalBindingIdentity: string,
    bindingIdentity?: string,
    provisioningFingerprint?: string,
  ): RuntimeBinding | undefined
  startDrain(): void
  drainRuntime(): Promise<void>
  registerSubscription(close: () => void | Promise<void>): () => void
  startPreparedEffect<T>(key: AgentRequestKey, effect: () => Promise<T>): Promise<T>
  runBindingOperation<T>(bindingKey: string, operation: () => Promise<T>): Promise<T>
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

function validateDirectResolvedRuntimeScope(
  resolved: Omit<ResolvedAgentRuntimeScope, 'environment'>,
): void {
  if (!resolved.identity.trim()) throw new TypeError('resolved runtime scope identity must be non-empty')
  if (!resolved.resourceInputDigest?.trim()) {
    throw new TypeError('direct resolved runtime scope resourceInputDigest must be non-empty')
  }
  if (!resolved.physicalBindingIdentity?.trim()) {
    throw new TypeError('direct resolved runtime scope physicalBindingIdentity must be non-empty')
  }
}

function validateEnvironmentScope(resolved: AgentHostEnvironmentScope): void {
  if (!resolved.placementIdentity.trim() || !resolved.provisioningFingerprint.trim()) {
    throw new TypeError('resolved environment identity must be non-empty')
  }
  if (!resolved.workspaceRoot.trim()) throw new TypeError('resolved environment workspaceRoot must be non-empty')
}

/**
 * Durable ledger file this host will open, or `undefined` when it was given
 * neither an explicit path nor a session root.
 *
 * `createAgentHost` is the innermost host: its `requestLedgerPath` is a
 * programmatic option taken verbatim (outer hosts normalize their user-facing
 * option before passing it down), and it has no in-workspace fallback — a host
 * with nothing host-owned to write to fails closed. The session-root tail is
 * owned by {@link resolveRequestLedgerPath}, the single canonical chain.
 */
function resolveHostLedgerPath(options: CreateAgentHostOptions): string | undefined {
  return options.requestLedgerPath ?? resolveRequestLedgerPath({ sessionRoot: options.sessionRoot })
}

function createRuntime(
  options: CreateAgentHostOptions,
  compiledAgents: readonly CompiledAgentHostAgentSpec[],
): AgentHostRuntime {
  const compiledById = new Map(compiledAgents.map((agent) => [agent.agentTypeId, agent]))
  const environments = new EnvironmentLeaseManager(options.runtimeModeAdapter)
  const resolveAgentRuntimeScope = async (
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    operation: 'new-binding' | 'existing-session' | 'reload',
    requestId: string,
    sessionId?: string,
  ): Promise<ResolvedAgentRuntimeScope> => {
    if (options.resolveAuthorizedEnvironmentScope && options.resolveAuthorizedAgentRuntimeScope) {
      const environment = await options.resolveAuthorizedEnvironmentScope({
        authorizedScope: scope,
        verifiedClaim: claim,
        intent: { kind: 'agent-binding', requestId },
      })
      validateEnvironmentScope(environment)
      const resolved = await options.resolveAuthorizedAgentRuntimeScope({
        authorizedScope: scope,
        verifiedClaim: claim,
        agentTypeId,
        intent: {
          kind: 'agent-binding',
          operation,
          requestId,
          ...(sessionId ? { sessionId } : {}),
        },
        environment,
      })
      validateDirectResolvedRuntimeScope(resolved)
      return Object.freeze({ ...resolved, environment })
    }
    throw new TypeError('createAgentHost requires direct Environment and Agent runtime scope resolvers')
  }
  const inventory = new AgentSessionInventory(
    options.sessionRoot,
    compiledById,
    (agentTypeId, scope, claim) => resolveAgentRuntimeScope(
      agentTypeId,
      scope,
      claim,
      'existing-session',
      `inventory:${agentTypeId}`,
    ),
  )
  const activity = new AgentSessionActivityIndex()
  const bindings = new Map<string, Promise<RuntimeBinding>>()
  const publishedCurrentBindings = new Map<string, RuntimeBinding>()
  const currentBindingReservations = new Map<string, string>()
  const nextBindingGeneration = new Map<string, number>()
  const pendingBindings = new Set<Promise<RuntimeBinding>>()
  const rejectPendingBindings = new Set<(error: unknown) => void>()
  const bindingDisposals = new WeakMap<RuntimeBinding, Promise<void>>()
  const subscriptions = new Set<() => void | Promise<void>>()
  const subscriptionClosures = new Set<Promise<void>>()
  const finiteEffects = new Map<Promise<unknown>, AgentRequestKey>()
  const bindingOperationTails = new Map<string, Promise<void>>()
  const graceMs = Math.max(0, options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS)
  let draining = false
  let drainPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined
  const durableLedgerPath = resolveHostLedgerPath(options)
  const ledger: import('./types').AgentRequestLedger = options.requestLedger
    ?? (options.inMemoryRequestLedgerMode || !durableLedgerPath
      ? new InMemoryAgentRequestLedger()
      : new SqliteAgentRequestLedger(durableLedgerPath))

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
    ledger,
    effectAdmission: options.effectAdmission ?? {
      async admit({ key }) {
        return { type: 'accepted', admissionReceipt: `trusted-local:${key.requestId}` }
      },
    },
    activity,
    shutdownGraceMs: graceMs,
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
    async resolveEnvironmentScope(scope, claim, intent) {
      runtime.assertOpen()
      if (!options.resolveAuthorizedEnvironmentScope) {
        throw new TypeError('direct Environment projection requires resolveAuthorizedEnvironmentScope')
      }
      const environment = await options.resolveAuthorizedEnvironmentScope({
        authorizedScope: scope,
        verifiedClaim: claim,
        intent,
      })
      validateEnvironmentScope(environment)
      return environment
    },
    async acquireEnvironment(scope, claim, intent) {
      const environment = await runtime.resolveEnvironmentScope(scope, claim, intent)
      return await environments.acquire(claim.workspaceScopeId, environment)
    },
    async acquireResolvedEnvironment(workspaceScopeId, environment) {
      validateEnvironmentScope(environment)
      return await environments.acquire(workspaceScopeId, environment)
    },
    async resolveSessionRuntime(agentTypeId, scope, claim, sessionId) {
      runtime.assertOpen()
      const resolved = await inventory.resolveSessionRuntime(agentTypeId, scope, claim, sessionId)
      if (resolved) validateResolvedRuntimeScope(resolved)
      return resolved
    },
    resolveAgentRuntimeScope,
    async resolveBinding(agentTypeId, scope, claim, resolvedRuntimeScope) {
      runtime.assertOpen()
      const agent = compiledById.get(agentTypeId)
      if (!agent) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'agent type is not available')
      const resolved = resolvedRuntimeScope ?? await runtime.resolveAgentRuntimeScope(
        agentTypeId,
        scope,
        claim,
        'new-binding',
        `binding:${agentTypeId}`,
      )
      validateResolvedRuntimeScope(resolved)
      const key = JSON.stringify([
        agentTypeId,
        claim.workspaceScopeId,
        resolved.identity,
        resolved.environment.provisioningFingerprint,
        resolved.physicalBindingIdentity ?? resolved.identity,
      ])
      const physicalBindingIdentity = resolved.physicalBindingIdentity ?? resolved.identity
      const currentKey = JSON.stringify([agentTypeId, claim.workspaceScopeId, physicalBindingIdentity])
      const useCanonicalCurrent = options.resolveAuthorizedAgentRuntimeScope !== undefined
      if (useCanonicalCurrent) {
        const current = publishedCurrentBindings.get(currentKey)
        if (current) return current
        const reservedKey = currentBindingReservations.get(currentKey)
        if (reservedKey && reservedKey !== key) {
          const reserved = bindings.get(reservedKey)
          if (reserved) return await reserved
        } else if (!reservedKey) {
          currentBindingReservations.set(currentKey, key)
        }
      }
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
            const generation = (nextBindingGeneration.get(currentKey) ?? 0) + 1
            nextBindingGeneration.set(currentKey, generation)
            binding = {
              key,
              agentTypeId,
              workspaceScopeId: claim.workspaceScopeId,
              generation,
              scope: resolved,
              environmentLease,
              composition,
            }
            if (draining || bindings.get(key) !== promise) {
              await disposeBinding(binding)
              throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
            }
            // A Host generation has exactly one canonical current binding per
            // workspace + Agent.
            if (
              useCanonicalCurrent
              && currentBindingReservations.get(currentKey) === key
              && !publishedCurrentBindings.has(currentKey)
            ) {
              publishedCurrentBindings.set(currentKey, binding)
              currentBindingReservations.delete(currentKey)
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
          if (currentBindingReservations.get(currentKey) === key) currentBindingReservations.delete(currentKey)
        })
      }
      const binding = await promise
      if (
        useCanonicalCurrent
        && currentBindingReservations.get(currentKey) === key
        && !publishedCurrentBindings.has(currentKey)
      ) {
        publishedCurrentBindings.set(currentKey, binding)
        currentBindingReservations.delete(currentKey)
      }
      return binding
    },
    findPublishedCurrentBinding(
      agentTypeId,
      workspaceScopeId,
      physicalBindingIdentity,
      bindingIdentity,
      provisioningFingerprint,
    ) {
      const exact = publishedCurrentBindings.get(JSON.stringify([
        agentTypeId,
        workspaceScopeId,
        physicalBindingIdentity,
      ]))
      if (exact) return exact
      const matches = [...publishedCurrentBindings.values()].filter((binding) =>
        binding.agentTypeId === agentTypeId
        && binding.workspaceScopeId === workspaceScopeId
        && (!bindingIdentity || binding.scope.identity === bindingIdentity)
        && (!provisioningFingerprint
          || binding.scope.environment.provisioningFingerprint === provisioningFingerprint))
      return matches.length === 1 ? matches[0] : undefined
    },
    startDrain() {
      if (draining) return
      draining = true
      environments.startDrain()
      for (const close of [...subscriptions]) {
        const closing = Promise.resolve().then(close).then(() => undefined)
        subscriptionClosures.add(closing)
        closing.finally(() => subscriptionClosures.delete(closing)).catch(() => {})
        closing.catch(() => {})
      }
      subscriptions.clear()
    },
    drainRuntime() {
      runtime.startDrain()
      drainPromise ??= (async () => {
        const work = [...finiteEffects.keys(), ...pendingBindings, ...subscriptionClosures]
        if (work.length === 0) return
        const completed = await Promise.race([
          Promise.allSettled(work).then((results) => ({ completed: true as const, results })),
          new Promise<{ completed: false }>((resolve) => {
            setTimeout(() => resolve({ completed: false }), graceMs)
          }),
        ])
        if (completed.completed) {
          const failed = completed.results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          )
          if (failed) throw failed.reason
          return
        }
        const closed = new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
        for (const reject of [...rejectPendingBindings]) reject(closed)
        const terminalizations: Promise<void>[] = []
        for (const key of finiteEffects.values()) {
          terminalizations.push((async () => {
            const record = await runtime.ledger.read(key)
            if (record?.state === 'pending-admission' || record?.state === 'admission-accepted') {
              await runtime.ledger.reject(key, { kind: 'gateway', error: closed.toJSON() })
              return
            }
            if (record?.state === 'in-flight') {
              const unknown = new AgentGatewayError(
                AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
                'effect outcome could not be safely replayed',
              )
              await runtime.ledger.markOutcomeUnknown(key, unknown.toJSON())
            }
          })().catch(() => {}))
        }
        await Promise.allSettled(terminalizations)
      })()
      return drainPromise
    },
    registerSubscription(close) {
      runtime.assertOpen()
      subscriptions.add(close)
      return () => subscriptions.delete(close)
    },
    startPreparedEffect(key, start) {
      runtime.assertOpen()
      let resolveEffect!: (value: Awaited<ReturnType<typeof start>>) => void
      let rejectEffect!: (error: unknown) => void
      const effect = new Promise<Awaited<ReturnType<typeof start>>>((resolve, reject) => {
        resolveEffect = resolve
        rejectEffect = reject
      })
      finiteEffects.set(effect, key)
      effect.finally(() => finiteEffects.delete(effect)).catch(() => {})
      try {
        Promise.resolve(start()).then(resolveEffect, rejectEffect)
      } catch (error) {
        rejectEffect(error)
      }
      return effect
    },
    async runBindingOperation(bindingKey, operation) {
      const previous = bindingOperationTails.get(bindingKey) ?? Promise.resolve()
      let release!: () => void
      const current = new Promise<void>((resolve) => { release = resolve })
      const tail = previous.then(() => current)
      bindingOperationTails.set(bindingKey, tail)
      await previous
      runtime.assertOpen()
      try {
        return await operation()
      } finally {
        release()
        if (bindingOperationTails.get(bindingKey) === tail) bindingOperationTails.delete(bindingKey)
      }
    },
    closeRuntime() {
      closePromise ??= (async () => {
        let firstError: unknown
        try {
          await runtime.drainRuntime()
        } catch (error) {
          firstError = error
        }
        const resolvedBindings = await Promise.allSettled([...bindings.values()])
        bindings.clear()
        publishedCurrentBindings.clear()
        nextBindingGeneration.clear()
        currentBindingReservations.clear()
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
        try {
          await ledger.close?.()
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


function readyEnvironmentCapabilities(): import('../runtime/readyStatus').AgentCapabilityReadiness {
  return Object.freeze({
    chat: Object.freeze({ state: 'not-started' as const }),
    workspace: Object.freeze({ state: 'ready' as const }),
    runtimeDependencies: Object.freeze({ state: 'ready' as const }),
  })
}

export async function createAgentHost(
  options: CreateAgentHostOptions,
): Promise<CreatedAgentHost> {
  const hasEnvironmentResolver = options.resolveAuthorizedEnvironmentScope !== undefined
  const hasAgentResolver = options.resolveAuthorizedAgentRuntimeScope !== undefined
  if (hasEnvironmentResolver !== hasAgentResolver) {
    throw new TypeError('direct Environment and Agent runtime scope resolvers must be provided together')
  }
  if (!hasEnvironmentResolver) {
    throw new TypeError('createAgentHost requires direct Environment and Agent runtime scope resolvers')
  }
  const compiledAgents = await compileFleet(options)
  const hostId = await resolveHostId(options)
  const durableLedgerPath = resolveHostLedgerPath(options)
  if (!options.requestLedger && !options.inMemoryRequestLedgerMode && !durableLedgerPath) {
    throw new TypeError(
      'createAgentHost requires requestLedgerPath or sessionRoot for its durable transactional ledger',
    )
  }
  if (durableLedgerPath) await mkdir(dirname(durableLedgerPath), { recursive: true })
  const runtime = createRuntime(options, compiledAgents)
  if (
    runtime.ledger.durability !== 'durable-transactional'
    && options.inMemoryRequestLedgerMode === undefined
  ) {
    throw new TypeError(
      'createAgentHost requires a transactional durable AgentRequestLedger; '
      + 'in-memory mode must be explicitly limited to test/development',
    )
  }
  const gateway = new EmbeddedAgentGateway(runtime)
  const assertStrongLedger = () => {
    if (
      runtime.ledger.durability !== 'durable-transactional'
      && options.inMemoryRequestLedgerMode === undefined
    ) {
      throw new TypeError(
        'Agent Host production routes require a transactional durable AgentRequestLedger; '
        + 'in-memory mode must be explicitly limited to test/development',
      )
    }
  }
  let hostClose: Promise<void> | undefined
  let drainPromise: Promise<void> | undefined
  const host: AgentHostHandle = Object.freeze({
    hostId,
    async describe() {
      return {
        hostId,
        agents: compiledAgents.map((agent) => ({
          agentTypeId: agent.agentTypeId,
          label: 'legacyDefault' in agent ? 'Agent' : agent.definition.label,
          ...('legacyDefault' in agent || agent.definition.digest === undefined
            ? {}
            : { definitionDigest: agent.definition.digest }),
        })),
        draining: runtime.isDraining(),
      }
    },
    drain() {
      drainPromise ??= runtime.drainRuntime()
      return drainPromise
    },
    close() {
      runtime.startDrain()
      hostClose ??= runtime.closeRuntime()
      return hostClose
    },
  })

  const runtimeCapabilityProjection = (
    projectionOptions: AgentHostDirectProjectionOptions,
  ) => createAgentHostRuntimeCapabilityProjection({
    runtime,
    gateway,
    options: projectionOptions,
  })

  const acquireAppEnvironment = async (input: {
    readonly authorizedScope: AuthorizedAgentScope
    readonly intent: AuthorizedEnvironmentIntent
  }): Promise<AgentHostEnvironmentLease> => {
    const claim = await runtime.verify(input.authorizedScope)
    const environment = await runtime.resolveEnvironmentScope(
      input.authorizedScope,
      claim,
      input.intent,
    )
    const providerLease = await runtime.acquireResolvedEnvironment(
      claim.workspaceScopeId,
      environment,
    )
    const abort = new AbortController()
    let active = true
    let unregister = () => {}
    const release = () => {
      if (!active) return
      active = false
      abort.abort()
      unregister()
      providerLease.release()
    }
    try {
      unregister = runtime.registerSubscription(release)
      const requestedFilesystemBindings = environment.resolveFilesystemBindings
        ? await environment.resolveFilesystemBindings({
            verifiedClaim: claim,
            requestId: input.intent.requestId,
          })
        : undefined
      const filesystemBindings = mergeRuntimeFilesystemBindings(
        providerLease.bundle.filesystemBindings,
        requestedFilesystemBindings,
      )
      if (!active) throw bindingDisposedError()
      const assertActive = () => {
        if (!active) throw bindingDisposedError()
      }
      const workspace = guardMethods(providerLease.bundle.workspace, assertActive)
      const storageRoot = getOptionalRuntimeBundleStorageRoot(providerLease.bundle)
      const gitWorkspaceSource = storageRoot
        ? (options.runtimeHost ?? providerLease.bundle.runtimeHost)?.createNodeWorkspace(storageRoot)
          ?? providerLease.bundle.workspace
        : providerLease.bundle.workspace
      const guardedFilesystemBindings = filesystemBindings?.map((binding) => Object.freeze({
        ...binding,
        operations: guardMethods(binding.operations, assertActive),
      }))
      return Object.freeze({
        workspace,
        gitWorkspace: guardMethods(gitWorkspaceSource, assertActive),
        fileSearch: guardMethods(providerLease.bundle.fileSearch, assertActive),
        ...(guardedFilesystemBindings
          ? { filesystemBindings: Object.freeze(guardedFilesystemBindings) }
          : {}),
        readiness: readyEnvironmentCapabilities(),
        signal: abort.signal,
        release,
      })
    } catch (error) {
      release()
      throw error
    }
  }

  const runWithWorkspaceAgent = (
    input: import('./types').AgentHostDispatcherRunInput,
    run: (binding: LeaseBoundWorkspaceAgent) => Promise<void>,
  ) => runWithWorkspaceAgentLease({ runtime, gateway, request: input, run })

  const resolveProjectionPiChatService = async (
    authorizeAgentRequest: (request: import('fastify').FastifyRequest) => Promise<AuthorizedAgentScope>,
    request: import('fastify').FastifyRequest,
    agentTypeId: string,
    sessionId: string,
  ) => {
    const scope = await authorizeAgentRequest(request)
    const binding = (await gateway.resolveHostSessionBinding(scope, { agentTypeId, sessionId })).binding
    return {
      scope,
      service: binding.composition.service,
    }
  }

  const created = Object.freeze({
    host,
    gateway,
    acquireEnvironment: acquireAppEnvironment,
    runWithWorkspaceAgent,
    registerDirectRoutes(projectionOptions: AgentHostDirectProjectionOptions) {
      assertStrongLedger()
      return createAgentHostRoutes({
        host,
        gateway,
        options: projectionOptions,
        runtimeCapabilities: runtimeCapabilityProjection(projectionOptions),
        activity: runtime.activity,
        async resolveActivityWorkspaceScope(request) {
          const scope = await projectionOptions.authorizeAgentRequest(request)
          return (await runtime.verify(scope)).workspaceScopeId
        },
        resolveAddressedPiChatService(request, agentTypeId, sessionId) {
          return resolveProjectionPiChatService(projectionOptions.authorizeAgentRequest, request, agentTypeId, sessionId)
        },
      })
    },
  })
  return created
}

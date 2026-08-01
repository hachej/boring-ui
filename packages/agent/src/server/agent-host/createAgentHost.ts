import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { AgentGatewayError, AgentGatewayErrorCode, type AuthorizedAgentScope, type VerifiedAgentScopeClaim } from '../../shared/index'
import { buildAgentComposition, type BuiltAgentComposition } from './buildAgentComposition'
import { EmbeddedAgentGateway } from './embeddedGateway'
import { EnvironmentLeaseManager, type EnvironmentLease } from './environmentLease'
import { getOptionalRuntimeBundleStorageRoot } from '../runtime/mode'
import { claimAgentHostProjection, createAgentHostRoutes } from './httpProjection'
import { createLegacyPiChatCompatibilityService } from './legacyPiChatCompatibility'
import { InMemoryAgentRequestLedger } from './requestLedger'
import { SqliteAgentRequestLedger } from './sqliteRequestLedger'
import {
  createAgentHostRuntimeCapabilityProjection,
  type AgentHostRuntimeCapabilityProjection,
} from './runtimeCapabilityProjection'
import {
  bindingDisposedError,
  guardMethods,
  runWithWorkspaceAgentLease,
} from './workspaceAgentLease'
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
  AgentHostDirectProjectionOptions,
  AgentHostEnvironmentLease,
  AgentHostEnvironmentScope,
  AuthorizedEnvironmentIntent,
  AgentHostLegacyProjectionRuntime,
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

const compatibilityRuntimes = new WeakMap<CreatedAgentHost, AgentHostRuntime>()
const compatibilityGateways = new WeakMap<CreatedAgentHost, EmbeddedAgentGateway>()
const compatibilityRuntimeCapabilityFactories = new WeakMap<
  CreatedAgentHost,
  (options: AgentHostAddressedHttpProjectionOptions) => AgentHostRuntimeCapabilityProjection
>()

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
  ): Promise<AgentSessionRuntimeAuthority | undefined>
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
    purpose?: 'current' | 'pinned',
  ): Promise<RuntimeBinding>
  findPublishedBinding(
    agentTypeId: string,
    workspaceScopeId: string,
    runtimeScopeIdentity?: string,
    physicalBindingIdentity?: string,
    provisioningFingerprint?: string,
  ): RuntimeBinding | undefined
  findPublishedCurrentBinding(
    agentTypeId: string,
    workspaceScopeId: string,
  ): RuntimeBinding | undefined
  startDrain(): void
  drainRuntime(): Promise<void>
  registerSubscription(close: () => void | Promise<void>): () => void
  startPreparedEffect<T>(key: AgentRequestKey, effect: () => Promise<T>): Promise<T>
  runBindingOperation<T>(bindingKey: string, operation: () => Promise<T>): Promise<T>
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
    if (!options.resolveRuntimeScope) {
      throw new TypeError('createAgentHost requires the direct scope resolvers or resolveRuntimeScope compatibility resolver')
    }
    return await options.resolveRuntimeScope({ agentTypeId, scope })
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
  const publishedBindings = new Map<string, RuntimeBinding>()
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
  const ledger: import('./types').AgentRequestLedger = options.requestLedger
    ?? (options.requestLedgerCompatibilityMode
      ? new InMemoryAgentRequestLedger()
      : options.requestLedgerPath || options.sessionRoot
        ? new SqliteAgentRequestLedger(options.requestLedgerPath ?? join(options.sessionRoot!, '.agent-request-ledger.sqlite'))
        : new InMemoryAgentRequestLedger())

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
    resolveAgentRuntimeScope,
    async resolveBinding(agentTypeId, scope, claim, resolvedRuntimeScope, purpose = 'current') {
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
      const currentKey = JSON.stringify([agentTypeId, claim.workspaceScopeId])
      const useCanonicalCurrent = purpose === 'current'
        && options.resolveAuthorizedAgentRuntimeScope !== undefined
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
            publishedBindings.set(key, binding)
            // A Host generation has exactly one canonical current binding per
            // workspace + Agent. Other identity-keyed bindings may remain
            // published solely for persisted session pins; resolving one never
            // makes it current implicitly.
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
      // A pinned lookup may have published this exact binding before a current
      // lookup reserved it. The explicit current reservation still owns the
      // canonical publication; pinned creation alone never does.
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
    findPublishedBinding(
      agentTypeId,
      workspaceScopeId,
      runtimeScopeIdentity,
      physicalBindingIdentity,
      provisioningFingerprint,
    ) {
      const matches = [...publishedBindings.values()].filter((binding) =>
        binding.agentTypeId === agentTypeId
        && binding.workspaceScopeId === workspaceScopeId
        && (!runtimeScopeIdentity || binding.scope.identity === runtimeScopeIdentity)
        && (!physicalBindingIdentity
          || (binding.scope.physicalBindingIdentity ?? binding.scope.identity) === physicalBindingIdentity)
        && (!provisioningFingerprint
          || binding.scope.environment.provisioningFingerprint === provisioningFingerprint))
      return matches.length === 1 ? matches[0] : undefined
    },
    findPublishedCurrentBinding(agentTypeId, workspaceScopeId) {
      return publishedCurrentBindings.get(JSON.stringify([agentTypeId, workspaceScopeId]))
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
          const unknown = new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
            'effect outcome could not be safely replayed',
          )
          terminalizations.push(runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {}))
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
    async retireCompatibilityComposition(composition) {
      for (const [key, promise] of bindings) {
        const result = await promise.catch(() => undefined)
        if (!result || result.composition !== composition) continue
        if (bindings.get(key) === promise) bindings.delete(key)
        publishedBindings.delete(key)
        for (const [currentKey, current] of publishedCurrentBindings) {
          if (current === result) publishedCurrentBindings.delete(currentKey)
        }
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
        let firstError: unknown
        try {
          await runtime.drainRuntime()
        } catch (error) {
          firstError = error
        }
        const resolvedBindings = await Promise.allSettled([...bindings.values()])
        bindings.clear()
        publishedBindings.clear()
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
  if (!options.resolveRuntimeScope && !hasEnvironmentResolver) {
    throw new TypeError('createAgentHost requires direct scope resolvers or resolveRuntimeScope')
  }
  const compiledAgents = await compileFleet(options)
  const hostId = await resolveHostId(options)
  const durableLedgerPath = options.requestLedgerPath
    ?? (options.sessionRoot ? join(options.sessionRoot, '.agent-request-ledger.sqlite') : undefined)
  if (!options.requestLedger && !options.requestLedgerCompatibilityMode && !durableLedgerPath) {
    throw new TypeError(
      'createAgentHost requires requestLedgerPath or sessionRoot for its durable transactional ledger',
    )
  }
  if (durableLedgerPath) await mkdir(dirname(durableLedgerPath), { recursive: true })
  const runtime = createRuntime(options, compiledAgents)
  if (
    runtime.ledger.durability !== 'durable-transactional'
    && options.requestLedgerCompatibilityMode === undefined
  ) {
    throw new TypeError(
      'createAgentHost requires a transactional durable AgentRequestLedger; '
      + 'in-memory compatibility must be explicitly limited to test/development',
    )
  }
  const gateway = new EmbeddedAgentGateway(runtime)
  const assertStrongLedger = () => {
    if (
      runtime.ledger.durability !== 'durable-transactional'
      && options.requestLedgerCompatibilityMode === undefined
    ) {
      throw new TypeError(
        'Agent Host production routes require a transactional durable AgentRequestLedger; '
        + 'in-memory compatibility must be explicitly limited to test/development',
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
    projectionOptions: AgentHostAddressedHttpProjectionOptions,
  ): AgentHostRuntimeCapabilityProjection => createAgentHostRuntimeCapabilityProjection({
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
      const filesystemBindings = environment.resolveFilesystemBindings
        ? await environment.resolveFilesystemBindings({
            verifiedClaim: claim,
            requestId: input.intent.requestId,
          })
        : providerLease.bundle.filesystemBindings
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
    authorizeRequest: (request: import('fastify').FastifyRequest) => Promise<AuthorizedAgentScope>,
    request: import('fastify').FastifyRequest,
    agentTypeId: string,
    sessionId?: string,
  ) => {
    const scope = await authorizeRequest(request)
    const binding = sessionId
      ? (await gateway.resolveHostSessionBinding(scope, { agentTypeId, sessionId })).binding
      : await runtime.resolveBinding(agentTypeId, scope, await runtime.verify(scope))
    return {
      scope,
      service: createLegacyPiChatCompatibilityService({
      gateway,
      service: binding.composition.service,
      scope,
      agentTypeId,
      }),
    }
  }

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
        projectionClaimed: true,
        runtimeCapabilities: runtimeCapabilityProjection(addressedOptions),
        async resolveLegacyPiChatService(request, addressedAgentTypeId) {
          const agentTypeId = addressedAgentTypeId ?? addressedOptions.defaultAgentTypeId
          return (await resolveProjectionPiChatService(
            addressedOptions.authorizeRequest,
            request,
            agentTypeId,
          )).service
        },
        resolveAddressedPiChatService(request, agentTypeId, sessionId) {
          return resolveProjectionPiChatService(addressedOptions.authorizeRequest, request, agentTypeId, sessionId)
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
    acquireEnvironment: acquireAppEnvironment,
    runWithWorkspaceAgent,
    registerDirectRoutes(projectionOptions: AgentHostDirectProjectionOptions) {
      assertStrongLedger()
      const addressedOptions: AgentHostAddressedHttpProjectionOptions = {
        authorizeRequest: projectionOptions.authorizeAgentRequest,
        defaultAgentTypeId: compiledAgents[0]!.agentTypeId,
        defaultSessionId: projectionOptions.defaultSessionId,
        filterModels: projectionOptions.filterModels,
        sessionChangesTracker: projectionOptions.sessionChangesTracker,
      }
      return createAgentHostRoutes({
        host,
        gateway,
        options: addressedOptions,
        runtimeCapabilities: runtimeCapabilityProjection(addressedOptions),
        async resolveLegacyPiChatService(request, addressedAgentTypeId) {
          if (!addressedAgentTypeId) {
            throw new TypeError('agentTypeId is required by the direct Host projection')
          }
          const agentTypeId = addressedAgentTypeId
          return (await resolveProjectionPiChatService(
            projectionOptions.authorizeAgentRequest,
            request,
            agentTypeId,
          )).service
        },
        resolveAddressedPiChatService(request, agentTypeId, sessionId) {
          return resolveProjectionPiChatService(projectionOptions.authorizeAgentRequest, request, agentTypeId, sessionId)
        },
      })
    },
    registerRoutes(projectionOptions: AgentHostHttpProjectionOptions) {
      assertStrongLedger()
      if (!runtime.compiledById.has(projectionOptions.defaultAgentTypeId)) {
        throw new TypeError(`unknown defaultAgentTypeId: ${projectionOptions.defaultAgentTypeId}`)
      }
      if (projectionOptions.legacyRoutePolicy) {
        return async (app: FastifyInstance) => {
          claimAgentHostProjection(app, host)
          let lifecycle: import('./types').AgentHostLegacyProjectionLifecycle | undefined
          app.addHook('preClose', async () => {
            lifecycle?.startDraining()
            await host.drain()
          })
          app.addHook('onClose', async () => {
            let firstError: unknown
            try {
              await lifecycle?.closeBindings()
            } catch (error) {
              firstError = error
            }
            try {
              await host.close()
            } catch (error) {
              if (firstError === undefined) firstError = error
              else app.log.warn({ err: error }, '[agent] failed to close Agent Host after an earlier cleanup error')
            }
            if (firstError !== undefined) throw firstError
          })
          await projectionOptions.legacyRoutePolicy.mount({
            app,
            runtime: legacyProjectionRuntime,
            defaultAgentTypeId: projectionOptions.defaultAgentTypeId,
            registerLifecycle(next) {
              if (lifecycle) throw new TypeError('legacy route lifecycle already registered')
              lifecycle = next
            },
          })
          if (!lifecycle) throw new TypeError('legacy route policy did not register its lifecycle')
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
        runtimeCapabilities: runtimeCapabilityProjection({ ...projectionOptions, authorizeRequest }),
        async resolveLegacyPiChatService(request, addressedAgentTypeId) {
          const agentTypeId = addressedAgentTypeId ?? projectionOptions.defaultAgentTypeId
          return (await resolveProjectionPiChatService(
            authorizeRequest,
            request,
            agentTypeId,
          )).service
        },
        resolveAddressedPiChatService(request, agentTypeId, sessionId) {
          return resolveProjectionPiChatService(authorizeRequest, request, agentTypeId, sessionId)
        },
      })
    },
  })
  compatibilityRuntimes.set(created, runtime)
  compatibilityGateways.set(created, gateway)
  compatibilityRuntimeCapabilityFactories.set(created, runtimeCapabilityProjection)
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
  const capabilities = compatibilityRuntimeCapabilityFactories.get(created)
  if (!runtime || !gateway || !capabilities) throw new TypeError('unknown Agent Host compatibility handle')
  if (
    runtime.ledger.durability !== 'durable-transactional'
    && runtime.options.requestLedgerCompatibilityMode === undefined
  ) {
    throw new TypeError('Agent Host compatibility routes require a transactional durable AgentRequestLedger')
  }
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
    runtimeCapabilities: capabilities(projectionOptions),
    async resolveLegacyPiChatService(request, addressedAgentTypeId) {
      const scope = await authorizeRequest(request)
      const agentTypeId = addressedAgentTypeId ?? projectionOptions.defaultAgentTypeId
      const binding = await runtime.resolveBinding(agentTypeId, scope, await runtime.verify(scope))
      return createLegacyPiChatCompatibilityService({
        gateway,
        service: binding.composition.service,
        scope,
        agentTypeId,
      })
    },
    async resolveAddressedPiChatService(request, agentTypeId, sessionId) {
      const scope = await authorizeRequest(request)
      const binding = (await gateway.resolveHostSessionBinding(scope, { agentTypeId, sessionId })).binding
      return {
        scope,
        service: createLegacyPiChatCompatibilityService({
          gateway,
          service: binding.composition.service,
          scope,
          agentTypeId,
        }),
      }
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

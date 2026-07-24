import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentGatewayError, AgentGatewayErrorCode, type AuthorizedAgentScope, type VerifiedAgentScopeClaim } from '../../shared/index'
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
  CompiledAgentHostAgentSpec,
  CreatedAgentHost,
  CreateAgentHostOptions,
  AgentHostHttpProjectionOptions,
  ResolvedAgentRuntimeScope,
} from './types'

const SAFE_AGENT_TYPE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SAFE_HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000

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
  registerSubscription(close: () => void | Promise<void>): () => void
  trackEffect<T>(effect: Promise<T>): Promise<T>
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
  const subscriptions = new Set<() => void | Promise<void>>()
  const finiteEffects = new Set<Promise<unknown>>()
  let draining = false
  let closePromise: Promise<void> | undefined

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
        promise = (async () => {
          const environmentLease = await environments.acquire(claim.workspaceScopeId, resolved.environment)
          try {
            const runtimeBundle = options.runtimeHost
              ? { ...environmentLease.bundle, runtimeHost: options.runtimeHost }
              : environmentLease.bundle
            const composition = await buildAgentComposition({
              agent,
              workspaceScopeId: claim.workspaceScopeId,
              runtimeScope: resolved,
              runtimeBundle,
              options,
              observeSessionEvent: (sessionId, event) => activity.observe(
                claim.workspaceScopeId,
                { agentTypeId, sessionId },
                event,
              ),
            })
            return { key, scope: resolved, environmentLease, composition }
          } catch (error) {
            environmentLease.release()
            throw error
          }
        })()
        bindings.set(key, promise)
        promise.catch(() => {
          if (bindings.get(key) === promise) bindings.delete(key)
        })
      }
      return await promise
    },
    startDrain() {
      if (draining) return
      draining = true
      for (const close of [...subscriptions]) void Promise.resolve(close()).catch(() => {})
      subscriptions.clear()
    },
    registerSubscription(close) {
      runtime.assertOpen()
      subscriptions.add(close)
      return () => subscriptions.delete(close)
    },
    trackEffect(effect) {
      finiteEffects.add(effect)
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
      runtime.startDrain()
      closePromise ??= (async () => {
        const graceMs = Math.max(0, options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS)
        if (finiteEffects.size > 0) {
          await Promise.race([
            Promise.allSettled([...finiteEffects]),
            new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
          ])
        }
        let firstError: unknown
        const resolvedBindings = await Promise.allSettled([...bindings.values()])
        for (const result of resolvedBindings) {
          if (result.status === 'rejected') {
            firstError ??= result.reason
            continue
          }
          try {
            await result.value.composition.dispose()
          } catch (error) {
            firstError ??= error
          }
          result.value.environmentLease.release()
        }
        bindings.clear()
        try {
          await environments.close()
        } catch (error) {
          firstError ??= error
        }
        try {
          await options.runtimeModeAdapter.dispose?.()
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
  const [compiledAgents, hostId] = await Promise.all([
    compileFleet(options),
    resolveHostId(options),
  ])
  const runtime = createRuntime(options, compiledAgents)
  const gateway = new EmbeddedAgentGateway(runtime)
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
      drainPromise ??= (async () => runtime.startDrain())()
      return drainPromise
    },
    close() {
      runtime.startDrain()
      hostClose ??= runtime.closeRuntime()
      return hostClose
    },
  })

  const created = Object.freeze({
    host,
    gateway,
    registerRoutes(projectionOptions: AgentHostHttpProjectionOptions) {
      if (!runtime.compiledById.has(projectionOptions.defaultAgentTypeId)) {
        throw new TypeError(`unknown defaultAgentTypeId: ${projectionOptions.defaultAgentTypeId}`)
      }
      return createAgentHostRoutes({ host, gateway, options: projectionOptions })
    },
  })
  compatibilityRuntimes.set(created, runtime)
  compatibilityGateways.set(created, gateway)
  return created
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

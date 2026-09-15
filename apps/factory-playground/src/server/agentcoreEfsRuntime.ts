import { lstat, realpath } from 'node:fs/promises'
import { parse, relative, resolve, sep } from 'node:path'
import { posix } from 'node:path'
import { createProviderRuntimeModeAdapter, sandboxRuntimeHostOperations } from '@hachej/boring-agent/server'
import type { ModeContext, RuntimeModeAdapter } from '@hachej/boring-agent/server'
import type { FencedSandboxHandleStore, SandboxCleanupOutcome, SandboxHandleFence, SandboxHandleKey } from '@hachej/boring-core/server'
import { createDirectSandboxProvider } from '@hachej/boring-sandbox/providers/direct'
import { createNodeWorkspace, disposeNodeWorkspace } from '@hachej/boring-sandbox/providers/node-workspace'
import { PROVIDER_CONTRACT_VERSION } from '@hachej/boring-sandbox/shared'
import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import type { ExecOptions, Sandbox } from '@hachej/boring-agent/shared'

export const ECS_LOCAL_EFS_MODE = 'factory:ecs-local-efs'
export const AGENTCORE_REMOTE_EFS_MODE = 'factory:agentcore-remote-efs'
const AGENTCORE_PROVIDER = 'aws-agentcore'

export interface AgentCoreDeleteResult {
  readonly outcome: 'succeeded' | 'failed' | 'ambiguous'
  readonly detail?: string
}

/** Minimal host-owned protocol. The application supplies an authenticated AWS client implementation. */
export interface AgentCoreRuntimeClient {
  createSession(input: { idempotencyKey: string; runtimeCwd: string; signal: AbortSignal }): Promise<{ handle: Uint8Array; runtimeCwd: string }>
  resumeSession(input: { handle: Uint8Array; signal: AbortSignal }): Promise<{ runtimeCwd: string }>
  exec(input: { handle: Uint8Array; command: string; cwd: string; options?: ExecOptions }): ReturnType<Sandbox['exec']>
  /** A thrown transport error is conservatively treated as an ambiguous delete outcome. */
  deleteSession(input: { handle: Uint8Array; signal: AbortSignal }): Promise<void | AgentCoreDeleteResult>
}

export interface SharedEfsRuntimeOptions {
  hostScope: string
  tenantId: string
  accessPointRoot: string
  runtimeRoot: string
  handleStore: FencedSandboxHandleStore
  agentCore: AgentCoreRuntimeClient
  leaseOwner: string
  leaseForMs?: number
}

type SharedEfsMappingOptions = Pick<SharedEfsRuntimeOptions, 'tenantId' | 'accessPointRoot' | 'runtimeRoot'>

function safeSegment(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') {
    throw new Error(`${name} is not a safe EFS path segment`)
  }
  return value
}

function canonicalPosixAbsolute(value: string, name: string): string {
  if (!posix.isAbsolute(value) || posix.resolve(value) !== value) {
    throw new Error(`${name} must be a canonical POSIX absolute path`)
  }
  return value
}

function isContained(root: string, candidate: string, pathRelative: (from: string, to: string) => string): boolean {
  const rel = pathRelative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !posix.isAbsolute(rel))
}

function mapping(options: SharedEfsMappingOptions, context: ModeContext) {
  const workspaceId = safeSegment(context.workspaceId ?? '', 'workspaceId')
  const tenantId = safeSegment(options.tenantId, 'tenantId')
  const accessPointRoot = resolve(options.accessPointRoot)
  if (options.accessPointRoot !== accessPointRoot) {
    throw new Error('accessPointRoot must be a canonical host absolute path')
  }
  const hostRoot = resolve(accessPointRoot, tenantId, workspaceId)
  if (!isContained(accessPointRoot, hostRoot, relative) || hostRoot === accessPointRoot) {
    throw new Error('workspace escaped EFS access point')
  }
  if (context.workspaceRoot !== resolve(context.workspaceRoot)) {
    throw new Error('workspaceRoot must be a canonical host absolute path')
  }
  if (context.workspaceRoot !== hostRoot) {
    throw new Error(`EFS workspace mapping mismatch: expected ${hostRoot}`)
  }

  const configuredRuntimeRoot = canonicalPosixAbsolute(options.runtimeRoot, 'runtimeRoot')
  const runtimeRoot = posix.resolve(configuredRuntimeRoot, tenantId, workspaceId)
  if (!isContained(configuredRuntimeRoot, runtimeRoot, posix.relative) || runtimeRoot === configuredRuntimeRoot) {
    throw new Error('workspace escaped AgentCore runtime root')
  }
  return { workspaceId, tenantId, accessPointRoot, hostRoot, runtimeRoot }
}

async function inspectCanonicalDirectory(path: string, name: string): Promise<string> {
  const root = parse(path).root
  const components = path.slice(root.length).split(sep).filter(Boolean)
  let current = root
  for (const component of components) {
    current = resolve(current, component)
    const metadata = await lstat(current)
    if (metadata.isSymbolicLink()) throw new Error(`${name} contains a symlink: ${current}`)
    if (!metadata.isDirectory()) throw new Error(`${name} component is not a directory: ${current}`)
    const canonical = await realpath(current)
    if (canonical !== current) throw new Error(`${name} is not canonical: ${current}`)
  }
  return await realpath(path)
}

async function preflightEfs(options: SharedEfsMappingOptions, context: ModeContext): Promise<void> {
  const mapped = mapping(options, context)
  const canonicalAccessPointRoot = await inspectCanonicalDirectory(mapped.accessPointRoot, 'EFS access-point root')
  const canonicalTenantRoot = await inspectCanonicalDirectory(resolve(mapped.accessPointRoot, mapped.tenantId), 'EFS tenant namespace')
  const canonicalWorkspaceRoot = await inspectCanonicalDirectory(mapped.hostRoot, 'EFS workspace namespace')
  if (!isContained(canonicalAccessPointRoot, canonicalTenantRoot, relative)
      || !isContained(canonicalAccessPointRoot, canonicalWorkspaceRoot, relative)
      || canonicalWorkspaceRoot !== mapped.hostRoot) {
    throw new Error('canonical EFS workspace escaped canonical access-point root')
  }
  // This is a fail-closed pre-acquisition check, not a filesystem lock. Namespace
  // components can still change afterward; production authority is EFS access-point
  // identity/isolation plus IAM, not this inherently TOCTOU-prone host inspection.
}

function assertRemoteCwd(root: string, value: string, name: string): string {
  const cwd = canonicalPosixAbsolute(value, name)
  const rel = posix.relative(root, cwd)
  if (rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel)) {
    throw new Error(`${name} escaped authorized EFS namespace`)
  }
  return cwd
}

function fenceOf(lease: { key: SandboxHandleKey; generation: number; leaseToken: string }): SandboxHandleFence {
  return { key: lease.key, generation: lease.generation, leaseToken: lease.leaseToken }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortError(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback)
}

export function createEcsLocalEfsProvider(
  options: Omit<SharedEfsRuntimeOptions, 'handleStore' | 'agentCore' | 'leaseOwner'>,
): SandboxProviderV1 {
  const direct = createDirectSandboxProvider()
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: ECS_LOCAL_EFS_MODE as SandboxProviderV1['providerId'],
    capabilities: direct.capabilities,
    resolveRuntimeRoot(context) { return mapping(options, context).hostRoot },
    async create(context) {
      const { hostRoot } = mapping(options, context)
      // Preserve the canonical provider's mkdir, Sandbox.init, pair disposal, and
      // error cleanup. This wrapper owns only the shared-EFS path projection.
      return await direct.create({ ...context, workspaceRoot: hostRoot })
    },
    async close() { await direct.close?.() },
  }
}

export function createEcsLocalEfsRuntimeMode(
  options: Omit<SharedEfsRuntimeOptions, 'handleStore' | 'agentCore' | 'leaseOwner'>,
): RuntimeModeAdapter {
  return createProviderRuntimeModeAdapter({
    id: ECS_LOCAL_EFS_MODE,
    provider: createEcsLocalEfsProvider(options),
    preflight: (context) => preflightEfs(options, context),
    runtimeHost: sandboxRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host' },
    filesystem: { kind: 'host' },
    storageRoot: (context) => mapping(options, context).hostRoot,
  })
}

/** Creates the atomic Workspace/Sandbox pair; no builtin mode registry or auto detection is modified. */
export function createAgentCoreRemoteEfsProvider(options: SharedEfsRuntimeOptions): SandboxProviderV1 {
  const leaseForMs = options.leaseForMs ?? 60_000
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: AGENTCORE_PROVIDER as SandboxProviderV1['providerId'],
    capabilities: {
      fs: 'readwrite', exec: true, watch: false, search: true,
      sourceOfTruth: 'storage-primary', provisioningSupport: true,
      providerContractVersion: PROVIDER_CONTRACT_VERSION, runtimeImage: 'unknown',
      networkIsolation: 'provider', hardening: 'provider', filesystemPersistence: 'durable',
    },
    resolveRuntimeRoot(context) { return mapping(options, context).runtimeRoot },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      const { workspaceId, hostRoot, runtimeRoot } = mapping(options, context)
      const key = { hostScope: options.hostScope, workspaceId, provider: AGENTCORE_PROVIDER, mode: AGENTCORE_REMOTE_EFS_MODE }
      const lease = await options.handleStore.claim({ key, leaseOwner: options.leaseOwner, leaseForMs })
      if (!lease) throw new Error('AgentCore session is owned by another runtime')
      if (lease.status === 'create-ambiguous') {
        throw new Error(`AgentCore create outcome is ambiguous (${lease.idempotencyKey}); operator reconciliation required`)
      }

      const fence = fenceOf(lease)
      const lifecycle = new AbortController()
      let state: 'active' | 'disposing' | 'disposed' = 'active'
      let fenceLost = false
      let confirmedLeaseDeadlineMs = Date.parse(lease.leaseExpiresAt)
      if (!Number.isFinite(confirmedLeaseDeadlineMs)) throw new Error('AgentCore lease has an invalid deadline')
      let renewTimer: NodeJS.Timeout | undefined
      let deadlineTimer: NodeJS.Timeout | undefined
      let renewTail = Promise.resolve()
      let disposalPromise: Promise<void> | undefined
      const inFlight = new Set<Promise<unknown>>()
      const minimumLeaseValidityMs = Math.max(1, Math.floor(leaseForMs / 3))

      const stopPeriodicRenewal = () => {
        if (renewTimer) clearTimeout(renewTimer)
        renewTimer = undefined
      }
      const stopTimers = () => {
        stopPeriodicRenewal()
        if (deadlineTimer) clearTimeout(deadlineTimer)
        deadlineTimer = undefined
      }
      const loseFence = (cause?: unknown) => {
        if (fenceLost) return
        fenceLost = true
        stopTimers()
        lifecycle.abort(new Error('AgentCore session ownership fence was lost', { cause }))
      }
      const armDeadline = () => {
        if (deadlineTimer) clearTimeout(deadlineTimer)
        const remaining = confirmedLeaseDeadlineMs - Date.now()
        if (remaining <= 0) {
          loseFence(new Error('AgentCore session lease deadline was reached'))
          return
        }
        deadlineTimer = setTimeout(() => {
          deadlineTimer = undefined
          loseFence(new Error('AgentCore session lease deadline was reached'))
        }, remaining)
        deadlineTimer.unref()
      }
      armDeadline()
      const raceLifecycleAbort = async <T>(operation: Promise<T>): Promise<T> => {
        let rejectAbort!: (error: Error) => void
        const onAbort = () => rejectAbort(abortError(lifecycle.signal, 'AgentCore session ownership fence was lost'))
        try {
          const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
          lifecycle.signal.addEventListener('abort', onAbort, { once: true })
          return await Promise.race([operation, aborted])
        } finally {
          lifecycle.signal.removeEventListener('abort', onAbort)
        }
      }
      const renewFence = (): Promise<void> => {
        const renewal = renewTail.then(async () => {
          if (state !== 'active' || lifecycle.signal.aborted || Date.now() >= confirmedLeaseDeadlineMs) {
            loseFence(new Error('AgentCore session lease deadline was reached'))
            throw abortError(lifecycle.signal, 'AgentCore runtime is not active')
          }
          let renewedDeadline: string | null
          try {
            renewedDeadline = await raceLifecycleAbort(options.handleStore.renew(fence, leaseForMs))
          } catch (error) {
            loseFence(error)
            throw abortError(lifecycle.signal, 'AgentCore session ownership fence was lost')
          }
          if (lifecycle.signal.aborted || !renewedDeadline) {
            loseFence()
            throw abortError(lifecycle.signal, 'AgentCore session ownership fence was lost')
          }
          const nextDeadline = Date.parse(renewedDeadline)
          if (!Number.isFinite(nextDeadline) || nextDeadline - Date.now() < minimumLeaseValidityMs) {
            loseFence(new Error('AgentCore renewed lease has insufficient remaining validity'))
            throw abortError(lifecycle.signal, 'AgentCore session ownership fence was lost')
          }
          confirmedLeaseDeadlineMs = nextDeadline
          armDeadline()
        })
        renewTail = renewal.catch(() => undefined)
        return renewal
      }
      const authorizeRemoteSideEffect = async (): Promise<void> => {
        await renewFence()
        if (lifecycle.signal.aborted || Date.now() >= confirmedLeaseDeadlineMs
            || confirmedLeaseDeadlineMs - Date.now() < minimumLeaseValidityMs) {
          loseFence(new Error('AgentCore session lease deadline was reached'))
          throw abortError(lifecycle.signal, 'AgentCore session ownership fence was lost')
        }
      }
      const scheduleRenewal = () => {
        if (state !== 'active' || lifecycle.signal.aborted) return
        renewTimer = setTimeout(() => {
          renewTimer = undefined
          void renewFence().then(scheduleRenewal, () => undefined)
        }, minimumLeaseValidityMs)
        renewTimer.unref()
      }
      scheduleRenewal()

      let handle = lease.handle
      let createdUnpublished = lease.handleState === 'pending-validation'
      let cleanupStarted = false
      let published = lease.handleState === 'published'

      const cleanupUnpublished = async (reason: string): Promise<AgentCoreDeleteResult> => {
        if (!handle || !createdUnpublished) throw new Error('AgentCore unpublished cleanup has no durable pending handle')
        cleanupStarted = true
        let cleanup: AgentCoreDeleteResult
        try {
          await authorizeRemoteSideEffect()
          // Cleanup is bounded by this confirmed lease. Do not keep extending
          // ownership around a provider delete that may never settle.
          stopPeriodicRenewal()
          cleanup = await raceLifecycleAbort(
            options.agentCore.deleteSession({ handle, signal: lifecycle.signal }),
          ) ?? { outcome: 'succeeded' }
        } catch (error) {
          cleanup = { outcome: 'ambiguous', detail: errorDetail(error) }
        }
        const durable: SandboxCleanupOutcome = {
          outcome: cleanup.outcome,
          detail: [reason, cleanup.detail].filter(Boolean).join(': '),
          recordedAt: new Date().toISOString(),
        }
        const deleted = lifecycle.signal.aborted
          ? false
          : await options.handleStore.delete(fence, durable).catch(() => false)
        if (cleanup.outcome !== 'succeeded') {
          await options.handleStore.release(fence).catch(() => false)
          throw new Error(`AgentCore unpublished session cleanup ${cleanup.outcome}: ${durable.detail}`)
        }
        if (!deleted) throw new Error('AgentCore session was deleted but cleanup outcome lost its ownership fence')
        return cleanup
      }

      try {
        if (handle && lease.handleState === null) {
          throw new Error('AgentCore durable handle has no publication state; operator reconciliation required')
        }
        if (createdUnpublished) {
          const retryingCleanupDebt = Boolean(lease.cleanup && lease.cleanup.outcome !== 'succeeded')
          await cleanupUnpublished(retryingCleanupDebt
            ? 'retry prior unpublished-session cleanup debt'
            : 'reconcile predecessor pending-validation session')
          throw new Error(retryingCleanupDebt
            ? 'AgentCore cleanup debt was resolved; retry acquisition'
            : 'AgentCore pending session was resolved; retry acquisition')
        }
        if (lease.cleanup && lease.cleanup.outcome !== 'succeeded') {
          throw new Error('AgentCore published session unexpectedly has cleanup debt; operator reconciliation required')
        }

        if (handle) {
          await authorizeRemoteSideEffect()
          const resumed = await options.agentCore.resumeSession({ handle, signal: lifecycle.signal })
          const reported = assertRemoteCwd(runtimeRoot, resumed.runtimeCwd, 'AgentCore resumed runtime cwd')
          if (reported !== runtimeRoot) throw new Error('AgentCore resumed runtime cwd does not match authorized EFS namespace')
          await renewFence()
        } else {
          const attempt = await options.handleStore.beginCreate(fence)
          if (!attempt || attempt.status !== 'started') throw new Error('AgentCore create could not acquire a durable idempotency key')
          await authorizeRemoteSideEffect()
          const created = await options.agentCore.createSession({
            idempotencyKey: attempt.idempotencyKey,
            runtimeCwd: runtimeRoot,
            signal: lifecycle.signal,
          })
          handle = created.handle

          // The provider handle remains durably pending until metadata validation
          // and a current fenced publication transition both succeed.
          if (!await options.handleStore.update(fence, handle, 1)) {
            loseFence()
            throw abortError(lifecycle.signal, 'AgentCore session handle lost its ownership fence')
          }
          createdUnpublished = true
          const reported = assertRemoteCwd(runtimeRoot, created.runtimeCwd, 'AgentCore created runtime cwd')
          if (reported !== runtimeRoot) throw new Error('AgentCore created runtime cwd does not match authorized EFS namespace')
          await renewFence()
          if (!await options.handleStore.publish(fence)) {
            loseFence()
            throw abortError(lifecycle.signal, 'AgentCore session publication lost its ownership fence')
          }
          createdUnpublished = false
          published = true
        }

        if (lifecycle.signal.aborted || state !== 'active' || fenceLost || !published) {
          throw abortError(lifecycle.signal, 'AgentCore runtime is not active')
        }
        const runtimeContext = { runtimeCwd: runtimeRoot }
        const workspace = createNodeWorkspace(hostRoot, { runtimeContext })
        const sandbox: Sandbox = {
          id: `${workspaceId}:${lease.generation}`,
          provider: AGENTCORE_PROVIDER,
          placement: 'remote',
          capabilities: ['exec', 'persistent-fs'],
          runtimeContext,
          exec(command: string, execOptions?: ExecOptions) {
            if (state !== 'active' || lifecycle.signal.aborted || fenceLost) {
              return Promise.reject(abortError(lifecycle.signal, 'AgentCore runtime is not active'))
            }
            let cwd: string
            try {
              cwd = assertRemoteCwd(runtimeRoot, execOptions?.cwd ?? runtimeRoot, 'AgentCore exec cwd')
            } catch (error) {
              return Promise.reject(error)
            }
            if (execOptions?.signal?.aborted) {
              return Promise.reject(abortError(execOptions.signal, 'AgentCore exec was aborted'))
            }
            const signal = execOptions?.signal
              ? AbortSignal.any([execOptions.signal, lifecycle.signal])
              : lifecycle.signal
            if (signal.aborted) return Promise.reject(abortError(signal, 'AgentCore exec was aborted'))

            const execution = Promise.resolve().then(async () => {
              await authorizeRemoteSideEffect()
              if (signal.aborted) throw abortError(signal, 'AgentCore exec was aborted')
              return await options.agentCore.exec({
                handle: handle!,
                command,
                cwd,
                options: { ...execOptions, signal },
              })
            })
            inFlight.add(execution)
            void execution.finally(() => inFlight.delete(execution)).catch(() => undefined)
            return execution
          },
        }

        const dispose = (): Promise<void> => {
          if (state === 'disposed') return Promise.resolve()
          if (disposalPromise) return disposalPromise
          state = 'disposing'
          stopTimers()
          lifecycle.abort(new Error('AgentCore runtime is disposing'))
          disposalPromise = (async () => {
            await Promise.allSettled([...inFlight])
            await renewTail
            disposeNodeWorkspace(workspace)
            const released = await options.handleStore.release(fence)
            if (!released) throw new Error('AgentCore runtime disposal lost its ownership fence')
            state = 'disposed'
          })().finally(() => {
            if (state !== 'disposed') disposalPromise = undefined
          })
          return disposalPromise
        }
        published = true
        return { workspace, sandbox, dispose }
      } catch (error) {
        if (createdUnpublished && !published && handle && !cleanupStarted) {
          try {
            await cleanupUnpublished(`pair publication failed: ${errorDetail(error)}`)
          } catch (cleanupError) {
            stopTimers()
            lifecycle.abort(error)
            await renewTail
            throw new Error(errorDetail(cleanupError), { cause: error })
          }
        }
        stopTimers()
        lifecycle.abort(error)
        await renewTail
        if (!cleanupStarted) await options.handleStore.release(fence).catch(() => false)
        throw error
      }
    },
  }
}

/** Creates the remote runtime-mode adapter; no builtin mode registry or auto detection is modified. */
export function createAgentCoreRemoteEfsRuntimeMode(options: SharedEfsRuntimeOptions): RuntimeModeAdapter {
  return createProviderRuntimeModeAdapter({
    id: AGENTCORE_REMOTE_EFS_MODE,
    provider: createAgentCoreRemoteEfsProvider(options),
    preflight: (context) => preflightEfs(options, context),
    runtimeHost: sandboxRuntimeHostOperations,
    workspaceFsCapability: 'strong',
    bash: { kind: 'remote' },
    filesystem: { kind: 'remote-workspace' },
    storageRoot: (context) => mapping(options, context).hostRoot,
  })
}

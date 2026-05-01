import { createHash } from 'node:crypto'
import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '../../../shared/sandbox-handle-store'
import { ErrorCode } from '../../../shared/error-codes'

type VercelSandboxStatus =
  | 'aborted'
  | 'failed'
  | 'pending'
  | 'running'
  | 'snapshotting'
  | 'stopped'
  | 'stopping'

export interface ResolveSandboxCreateParams {
  name?: string
  persistent?: boolean
  snapshotExpiration?: number
  source?:
    | { type: 'snapshot'; snapshotId: string }
    | { type: 'tarball'; url: string }
}

export type VercelSandboxHandle = VercelSandbox & {
  sandboxId?: string
  name?: string
  currentSnapshotId?: string
  sourceSnapshotId?: string
}

export interface VercelSandboxClient {
  create(params?: ResolveSandboxCreateParams): Promise<VercelSandboxHandle>
  get(params: { sandboxId?: string; name?: string; resume?: boolean }): Promise<VercelSandboxHandle>
}

interface SandboxLifecycleLogger {
  info?(message: string, metadata: Record<string, unknown>): void
  warn?(message: string, metadata: Record<string, unknown>): void
}

export type ExpiredSandboxPolicy = 'recreate' | 'error'

export class SandboxHandleUnavailableError extends Error {
  readonly code = ErrorCode.enum.SANDBOX_EXPIRED
  readonly statusCode = 410
  readonly workspaceId: string
  readonly sandboxId: string | null
  readonly reason: string

  constructor(init: {
    workspaceId: string
    sandboxId?: string
    reason: string
    cause?: unknown
  }) {
    super(`sandbox is unavailable for workspace ${init.workspaceId}: ${init.reason}`)
    this.name = 'SandboxHandleUnavailableError'
    this.workspaceId = init.workspaceId
    this.sandboxId = init.sandboxId ?? null
    this.reason = init.reason
    if (init.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = init.cause
    }
  }
}

// Process-local cache keyed by workspace id. In multi-process deployments each
// worker maintains its own cache and converges via SandboxHandleStore.
const sandboxesByWorkspaceId = new Map<string, VercelSandboxHandle>()
const inFlightResolutionsByWorkspaceId = new Map<string, Promise<VercelSandboxHandle>>()
const EXPIRED_STATUSES: ReadonlySet<VercelSandboxStatus> = new Set([
  'aborted',
  'failed',
])
const ESTIMATED_ABANDONED_SESSION_COST_USD = 0.10

function nowIso(): string {
  return new Date().toISOString()
}

function getSandboxStatus(sandbox: VercelSandbox): VercelSandboxStatus | null {
  const status = (sandbox as { status?: unknown }).status
  if (typeof status !== 'string') {
    return null
  }

  switch (status) {
    case 'aborted':
    case 'failed':
    case 'pending':
    case 'running':
    case 'snapshotting':
    case 'stopped':
    case 'stopping':
      return status
    default:
      return null
  }
}

function isSandboxExpired(sandbox: VercelSandbox): boolean {
  const status = getSandboxStatus(sandbox)
  return status !== null && EXPIRED_STATUSES.has(status)
}

function extractHttpStatus(error: unknown): number | null {
  const directStatus = (error as { status?: unknown } | null)?.status
  if (typeof directStatus === 'number') {
    return directStatus
  }

  const response = (error as { response?: { status?: unknown } } | null)?.response
  return typeof response?.status === 'number' ? response.status : null
}

function shouldRecreateFromSnapshot(error: unknown): boolean {
  const status = extractHttpStatus(error)
  const apiCode = (error as { json?: { error?: { code?: unknown } } } | null)?.json?.error?.code
  return status === 404 || status === 410 || apiCode === 'snapshot_not_found'
}

function throwUnavailable(
  workspaceId: string,
  persisted: SandboxHandleRecord,
  reason: string,
  cause?: unknown,
): never {
  throw new SandboxHandleUnavailableError({
    workspaceId,
    sandboxId: persisted.sandboxId,
    reason,
    cause,
  })
}

function getSandboxIdentifier(sandbox: VercelSandboxHandle): string {
  return sandbox.name ?? sandbox.sandboxId ?? 'unknown-sandbox'
}

function getSandboxSnapshotId(sandbox: VercelSandboxHandle): string | undefined {
  return sandbox.currentSnapshotId ?? sandbox.sourceSnapshotId
}

function sandboxNameForWorkspace(workspaceId: string): string {
  // Persistent sandbox names are global within the Vercel project. Use a hash
  // instead of truncating the workspace id so long ids cannot collide by prefix.
  const hash = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32)
  return `boring-${hash}`
}

function reusablePersistentName(previous: SandboxHandleRecord | null, workspaceId: string): string {
  // Pre-beta records stored ephemeral IDs like "sbx_...". Do not carry those
  // forward as persistent names; migrate them to the stable workspace name.
  const id = previous?.sandboxId
  if (id && !id.startsWith('sbx_')) return id
  return sandboxNameForWorkspace(workspaceId)
}

function isPersistentSandbox(sandbox: VercelSandboxHandle): boolean {
  return (sandbox as VercelSandboxHandle & { persistent?: boolean }).persistent === true
}

function selectSnapshotForRecreate(
  workspaceId: string,
  persisted: SandboxHandleRecord,
  reason: string,
  logger?: SandboxLifecycleLogger,
  sandbox?: VercelSandboxHandle,
): string | undefined {
  const snapshotId = persisted.snapshotId ?? (sandbox ? getSandboxSnapshotId(sandbox) : undefined)
  if (!snapshotId) {
    logger?.warn?.('[sandbox] recreating empty sandbox; no snapshot available', {
      workspaceId,
      sandboxId: persisted.sandboxId,
      reason,
    })
  }
  return snapshotId
}

function buildRecord(
  workspaceId: string,
  sandbox: VercelSandboxHandle,
  previous: SandboxHandleRecord | null,
): SandboxHandleRecord {
  const timestamp = nowIso()

  return {
    workspaceId,
    sandboxId: getSandboxIdentifier(sandbox),
    snapshotId: getSandboxSnapshotId(sandbox) ?? previous?.snapshotId,
    // Keep createdAt stable for the logical workspace handle lineage.
    createdAt: previous?.createdAt ?? timestamp,
    lastUsedAt: timestamp,
  }
}

async function persistAndCache(
  workspaceId: string,
  sandbox: VercelSandboxHandle,
  previous: SandboxHandleRecord | null,
  store: SandboxHandleStore,
): Promise<VercelSandboxHandle> {
  await store.put(buildRecord(workspaceId, sandbox, previous))
  sandboxesByWorkspaceId.set(workspaceId, sandbox)
  return sandbox
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }
  return parsed
}

function shouldRecycleFromIdle(
  persisted: SandboxHandleRecord | null,
  nowMs: number,
  maxIdleMs: number,
): { stale: boolean; idleMs: number | null } {
  const lastUsedAtMs = parseIsoTimestamp(persisted?.lastUsedAt)
  if (lastUsedAtMs === null) {
    return { stale: false, idleMs: null }
  }
  const idleMs = Math.max(0, nowMs - lastUsedAtMs)
  return {
    stale: idleMs > maxIdleMs,
    idleMs,
  }
}

async function stopSandboxForOrphanGuard(
  sandbox: VercelSandboxHandle,
): Promise<{ stopped: boolean; error: unknown | null }> {
  const stop = (sandbox as unknown as { stop?: () => Promise<unknown> }).stop
  if (typeof stop !== 'function') {
    return { stopped: false, error: new Error('sandbox.stop is unavailable') }
  }

  try {
    await stop.call(sandbox)
    return { stopped: true, error: null }
  } catch (error) {
    return { stopped: false, error }
  }
}

function logSandboxCreate(
  logger: SandboxLifecycleLogger | undefined,
  metadata: Record<string, unknown>,
): void {
  logger?.info?.('[sandbox] created', {
    estimatedAbandonedSessionCostUsd: ESTIMATED_ABANDONED_SESSION_COST_USD,
    ...metadata,
  })
}

function logSandboxStop(
  logger: SandboxLifecycleLogger | undefined,
  metadata: Record<string, unknown>,
): void {
  logger?.info?.('[sandbox] stopped', {
    estimatedAbandonedSessionCostUsd: ESTIMATED_ABANDONED_SESSION_COST_USD,
    ...metadata,
  })
}

async function createFresh(
  workspaceId: string,
  snapshotId: string | undefined,
  tarballUrl: string | undefined,
  previous: SandboxHandleRecord | null,
  store: SandboxHandleStore,
  vercel: VercelSandboxClient,
  logger?: SandboxLifecycleLogger,
): Promise<VercelSandboxHandle> {
  let sandbox: VercelSandboxHandle
  let sourceType: 'empty' | 'snapshot' | 'tarball' = 'empty'
  const base = {
    name: reusablePersistentName(previous, workspaceId),
    persistent: true,
    snapshotExpiration: 0,
  }
  if (snapshotId) {
    sourceType = 'snapshot'
    sandbox = await vercel.create({
      ...base,
      source: { type: 'snapshot', snapshotId },
    })
  } else if (tarballUrl) {
    sourceType = 'tarball'
    sandbox = await vercel.create({
      ...base,
      source: { type: 'tarball', url: tarballUrl },
    })
  } else {
    sandbox = await vercel.create(base)
  }

  logSandboxCreate(logger, {
    workspaceId,
    sandboxId: getSandboxIdentifier(sandbox),
    sourceType,
    sourceSnapshotId: snapshotId ?? null,
  })

  return await persistAndCache(workspaceId, sandbox, previous, store)
}

export interface ResolveSandboxHandleOptions {
  tarballUrl?: string
  maxIdleMs?: number
  now?: () => number
  logger?: SandboxLifecycleLogger
  expiredSandboxPolicy?: ExpiredSandboxPolicy
}

export async function resolveSandboxHandle(
  workspaceId: string,
  store: SandboxHandleStore,
  vercel: VercelSandboxClient,
  opts?: ResolveSandboxHandleOptions,
): Promise<VercelSandboxHandle> {
  const workspaceKey = workspaceId.trim()
  if (workspaceKey.length === 0) {
    throw new Error('workspaceId must not be empty')
  }
  const expiredSandboxPolicy = opts?.expiredSandboxPolicy ?? 'recreate'

  const inProcess = sandboxesByWorkspaceId.get(workspaceKey)
  if (inProcess && !isSandboxExpired(inProcess)) {
    return inProcess
  }
  if (inProcess) {
    sandboxesByWorkspaceId.delete(workspaceKey)
  }

  const inFlightResolution = inFlightResolutionsByWorkspaceId.get(workspaceKey)
  if (inFlightResolution) {
    return await inFlightResolution
  }

  const resolution = (async (): Promise<VercelSandboxHandle> => {
    const maxIdleMs = opts?.maxIdleMs
    const orphanGuardEnabled = Number.isFinite(maxIdleMs) && (maxIdleMs as number) > 0
    const nowMs = orphanGuardEnabled
      ? (opts?.now ?? Date.now)()
      : 0
    const persisted = await store.get(workspaceKey)

    if (persisted?.sandboxId) {
      try {
        const sandbox = await vercel.get({ name: persisted.sandboxId, sandboxId: persisted.sandboxId, resume: true })
        if (!isSandboxExpired(sandbox)) {
          if (!isPersistentSandbox(sandbox)) {
            const reason = 'sandbox is not persistent'
            const snapshotId = selectSnapshotForRecreate(
              workspaceKey,
              persisted,
              reason,
              opts?.logger,
              sandbox,
            )
            opts?.logger?.warn?.('[sandbox] migrating non-persistent sandbox to persistent sandbox', {
              workspaceId: workspaceKey,
              sandboxId: getSandboxIdentifier(sandbox),
              persistent: false,
              snapshotId: snapshotId ?? null,
            })
            return await createFresh(
              workspaceKey,
              snapshotId,
              opts?.tarballUrl,
              persisted,
              store,
              vercel,
              opts?.logger,
            )
          }

          const idle = orphanGuardEnabled
            ? shouldRecycleFromIdle(persisted, nowMs, maxIdleMs as number)
            : { stale: false, idleMs: null }
          if (idle.stale) {
            opts?.logger?.warn?.('[sandbox] orphan-guard stale sandbox detected', {
              workspaceId: workspaceKey,
              sandboxId: getSandboxIdentifier(sandbox),
              idleMs: idle.idleMs,
              maxIdleMs,
              lastUsedAt: persisted.lastUsedAt,
            })
            const snapshotId = persisted.snapshotId
            if (!snapshotId) {
              opts?.logger?.warn?.('[sandbox] orphan-guard skipped; no snapshot available', {
                workspaceId: workspaceKey,
                sandboxId: getSandboxIdentifier(sandbox),
                idleMs: idle.idleMs,
                maxIdleMs,
              })
              return await persistAndCache(workspaceKey, sandbox, persisted, store)
            }
            const stopResult = await stopSandboxForOrphanGuard(sandbox)
            if (stopResult.stopped) {
              logSandboxStop(opts?.logger, {
                workspaceId: workspaceKey,
                sandboxId: getSandboxIdentifier(sandbox),
                reason: 'orphan-guard-idle',
                idleMs: idle.idleMs,
                maxIdleMs,
              })
              return await createFresh(
                workspaceKey,
                snapshotId,
                opts?.tarballUrl,
                persisted,
                store,
                vercel,
                opts?.logger,
              )
            }

            opts?.logger?.warn?.('[sandbox] orphan-guard stop failed; reusing sandbox', {
              workspaceId: workspaceKey,
              sandboxId: getSandboxIdentifier(sandbox),
              idleMs: idle.idleMs,
              maxIdleMs,
              error: stopResult.error instanceof Error
                ? stopResult.error.message
                : String(stopResult.error),
            })
          }
          return await persistAndCache(workspaceKey, sandbox, persisted, store)
        }
        const reason = `sandbox status is ${getSandboxStatus(sandbox) ?? 'expired'}`
        if (expiredSandboxPolicy === 'error') {
          throwUnavailable(
            workspaceKey,
            persisted,
            reason,
          )
        }
        const snapshotId = selectSnapshotForRecreate(
          workspaceKey,
          persisted,
          reason,
          opts?.logger,
          sandbox,
        )
        return await createFresh(
          workspaceKey,
          snapshotId,
          opts?.tarballUrl,
          persisted,
          store,
          vercel,
          opts?.logger,
        )
      } catch (error) {
        if (!shouldRecreateFromSnapshot(error)) {
          throw error
        }
        const reason = `sandbox lookup returned HTTP ${extractHttpStatus(error) ?? 'unknown'}`
        if (expiredSandboxPolicy === 'error') {
          throwUnavailable(
            workspaceKey,
            persisted,
            reason,
            error,
          )
        }
        const snapshotId = selectSnapshotForRecreate(
          workspaceKey,
          persisted,
          reason,
          opts?.logger,
        )
        return await createFresh(
          workspaceKey,
          snapshotId,
          opts?.tarballUrl,
          persisted,
          store,
          vercel,
          opts?.logger,
        )
      }
    }

    return await createFresh(
      workspaceKey,
      persisted?.snapshotId,
      opts?.tarballUrl,
      persisted,
      store,
      vercel,
      opts?.logger,
    )
  })()

  inFlightResolutionsByWorkspaceId.set(workspaceKey, resolution)

  try {
    return await resolution
  } finally {
    const current = inFlightResolutionsByWorkspaceId.get(workspaceKey)
    if (current === resolution) {
      inFlightResolutionsByWorkspaceId.delete(workspaceKey)
    }
  }
}

export function resetSandboxHandleCacheForTests(): void {
  sandboxesByWorkspaceId.clear()
  inFlightResolutionsByWorkspaceId.clear()
}

export function evictSandboxHandleCacheForWorkspace(workspaceId: string): void {
  const workspaceKey = workspaceId.trim()
  if (workspaceKey.length === 0) return
  sandboxesByWorkspaceId.delete(workspaceKey)
  inFlightResolutionsByWorkspaceId.delete(workspaceKey)
}

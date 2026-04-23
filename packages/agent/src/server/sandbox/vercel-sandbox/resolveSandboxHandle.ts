import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '../../../shared/sandbox-handle-store'

type VercelSandboxStatus =
  | 'aborted'
  | 'failed'
  | 'pending'
  | 'running'
  | 'snapshotting'
  | 'stopped'
  | 'stopping'

export interface ResolveSandboxCreateParams {
  source?: {
    type: 'snapshot'
    snapshotId: string
  }
}

export interface VercelSandboxClient {
  create(params?: ResolveSandboxCreateParams): Promise<VercelSandbox>
  get(params: { sandboxId: string }): Promise<VercelSandbox>
}

// Process-local cache keyed by workspace id. In multi-process deployments each
// worker maintains its own cache and converges via SandboxHandleStore.
const sandboxesByWorkspaceId = new Map<string, VercelSandbox>()
const EXPIRED_STATUSES: ReadonlySet<VercelSandboxStatus> = new Set([
  'aborted',
  'failed',
  'stopped',
])

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
  const response = (error as { response?: { status?: unknown } } | null)?.response
  return typeof response?.status === 'number' ? response.status : null
}

function shouldRecreateFromSnapshot(error: unknown): boolean {
  const status = extractHttpStatus(error)
  return status === 404 || status === 410
}

function buildRecord(
  workspaceId: string,
  sandbox: VercelSandbox,
  previous: SandboxHandleRecord | null,
): SandboxHandleRecord {
  const timestamp = nowIso()

  return {
    workspaceId,
    sandboxId: sandbox.sandboxId,
    snapshotId: sandbox.sourceSnapshotId ?? previous?.snapshotId,
    createdAt: previous?.createdAt ?? timestamp,
    lastUsedAt: timestamp,
  }
}

async function persistAndCache(
  workspaceId: string,
  sandbox: VercelSandbox,
  previous: SandboxHandleRecord | null,
  store: SandboxHandleStore,
): Promise<VercelSandbox> {
  sandboxesByWorkspaceId.set(workspaceId, sandbox)
  await store.put(buildRecord(workspaceId, sandbox, previous))
  return sandbox
}

async function createFromSnapshot(
  workspaceId: string,
  snapshotId: string | undefined,
  previous: SandboxHandleRecord | null,
  store: SandboxHandleStore,
  vercel: VercelSandboxClient,
): Promise<VercelSandbox> {
  const sandbox = snapshotId
    ? await vercel.create({
      source: {
        type: 'snapshot',
        snapshotId,
      },
    })
    : await vercel.create()

  return await persistAndCache(workspaceId, sandbox, previous, store)
}

export async function resolveSandboxHandle(
  workspaceId: string,
  store: SandboxHandleStore,
  vercel: VercelSandboxClient,
): Promise<VercelSandbox> {
  if (workspaceId.trim().length === 0) {
    throw new Error('workspaceId must not be empty')
  }

  const inProcess = sandboxesByWorkspaceId.get(workspaceId)
  if (inProcess && !isSandboxExpired(inProcess)) {
    return inProcess
  }
  if (inProcess) {
    sandboxesByWorkspaceId.delete(workspaceId)
  }

  const persisted = await store.get(workspaceId)

  if (persisted?.sandboxId) {
    try {
      const sandbox = await vercel.get({ sandboxId: persisted.sandboxId })
      if (!isSandboxExpired(sandbox)) {
        return await persistAndCache(workspaceId, sandbox, persisted, store)
      }
    } catch (error) {
      if (!shouldRecreateFromSnapshot(error)) {
        throw error
      }
    }
  }

  return await createFromSnapshot(
    workspaceId,
    persisted?.snapshotId,
    persisted,
    store,
    vercel,
  )
}

export function resetSandboxHandleCacheForTests(): void {
  sandboxesByWorkspaceId.clear()
}

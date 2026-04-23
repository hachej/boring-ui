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
  source?:
    | { type: 'snapshot'; snapshotId: string }
    | { type: 'tarball'; url: string }
}

export interface VercelSandboxClient {
  create(params?: ResolveSandboxCreateParams): Promise<VercelSandbox>
  get(params: { sandboxId: string }): Promise<VercelSandbox>
}

// Process-local cache keyed by workspace id. In multi-process deployments each
// worker maintains its own cache and converges via SandboxHandleStore.
const sandboxesByWorkspaceId = new Map<string, VercelSandbox>()
const inFlightResolutionsByWorkspaceId = new Map<string, Promise<VercelSandbox>>()
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
  const directStatus = (error as { status?: unknown } | null)?.status
  if (typeof directStatus === 'number') {
    return directStatus
  }

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
    // Keep createdAt stable for the logical workspace handle lineage.
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
  await store.put(buildRecord(workspaceId, sandbox, previous))
  sandboxesByWorkspaceId.set(workspaceId, sandbox)
  return sandbox
}

async function createFresh(
  workspaceId: string,
  snapshotId: string | undefined,
  tarballUrl: string | undefined,
  previous: SandboxHandleRecord | null,
  store: SandboxHandleStore,
  vercel: VercelSandboxClient,
): Promise<VercelSandbox> {
  let sandbox: VercelSandbox
  if (snapshotId) {
    sandbox = await vercel.create({
      source: { type: 'snapshot', snapshotId },
    })
  } else if (tarballUrl) {
    sandbox = await vercel.create({
      source: { type: 'tarball', url: tarballUrl },
    })
  } else {
    sandbox = await vercel.create()
  }

  return await persistAndCache(workspaceId, sandbox, previous, store)
}

export interface ResolveSandboxHandleOptions {
  tarballUrl?: string
}

export async function resolveSandboxHandle(
  workspaceId: string,
  store: SandboxHandleStore,
  vercel: VercelSandboxClient,
  opts?: ResolveSandboxHandleOptions,
): Promise<VercelSandbox> {
  const workspaceKey = workspaceId.trim()
  if (workspaceKey.length === 0) {
    throw new Error('workspaceId must not be empty')
  }

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

  const resolution = (async (): Promise<VercelSandbox> => {
    const persisted = await store.get(workspaceKey)

    if (persisted?.sandboxId) {
      try {
        const sandbox = await vercel.get({ sandboxId: persisted.sandboxId })
        if (!isSandboxExpired(sandbox)) {
          return await persistAndCache(workspaceKey, sandbox, persisted, store)
        }
      } catch (error) {
        if (!shouldRecreateFromSnapshot(error)) {
          throw error
        }
      }
    }

    return await createFresh(
      workspaceKey,
      persisted?.snapshotId,
      opts?.tarballUrl,
      persisted,
      store,
      vercel,
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

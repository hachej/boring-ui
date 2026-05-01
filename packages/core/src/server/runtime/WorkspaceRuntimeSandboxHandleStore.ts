import type {
  WorkspaceRuntime,
  WorkspaceRuntimeResource,
  WorkspaceRuntimeResourceInput,
  WorkspaceRuntimeResourceSelector,
} from '../../shared/types.js'

export interface WorkspaceSandboxHandleRecord {
  workspaceId: string
  sandboxId: string
  snapshotId?: string
  provider?: string
  handleKind?: string
  stableKey?: string
  persistenceMode?: string
  providerMeta?: Record<string, unknown>
  createdAt: string
  lastUsedAt: string
}

export interface WorkspaceRuntimeStoreLike {
  getWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>
  putWorkspaceRuntime(
    workspaceId: string,
    state: Partial<WorkspaceRuntime>,
  ): Promise<WorkspaceRuntime>
  getWorkspaceRuntimeResource?(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<WorkspaceRuntimeResource | null>
  putWorkspaceRuntimeResource?(
    workspaceId: string,
    resource: WorkspaceRuntimeResourceInput,
  ): Promise<WorkspaceRuntimeResource>
  deleteWorkspaceRuntimeResource?(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<void>
  listWorkspaceRuntimeResources?(
    workspaceId?: string,
  ): Promise<WorkspaceRuntimeResource[]>
  listWorkspaceRuntimes?(): Promise<WorkspaceRuntime[]>
}

const SANDBOX_RESOURCE: WorkspaceRuntimeResourceSelector = {
  kind: 'sandbox',
  purpose: 'main',
  provider: 'vercel',
}

export class WorkspaceRuntimeSandboxHandleStore {
  constructor(private readonly store: WorkspaceRuntimeStoreLike) {}

  async get(workspaceId: string): Promise<WorkspaceSandboxHandleRecord | null> {
    const resource = await this.store.getWorkspaceRuntimeResource?.(workspaceId, SANDBOX_RESOURCE)
    const handle = resourceToHandle(resource)
    if (handle) return handle

    const runtime = await this.store.getWorkspaceRuntime(workspaceId)
    return runtimeToHandle(runtime)
  }

  async put(record: WorkspaceSandboxHandleRecord): Promise<void> {
    const seenAt = new Date().toISOString()
    const selector = {
      ...SANDBOX_RESOURCE,
      provider: record.provider ?? SANDBOX_RESOURCE.provider,
    }
    const previousResource = await this.store.getWorkspaceRuntimeResource?.(
      record.workspaceId,
      selector,
    )
    let resourceWritten = false

    if (this.store.putWorkspaceRuntimeResource) {
      await this.store.putWorkspaceRuntimeResource(
        record.workspaceId,
        handleToResourceInput(record, seenAt),
      )
      resourceWritten = true
    }

    try {
      await this.store.putWorkspaceRuntime(record.workspaceId, {
        sandboxProvider: record.provider ?? 'vercel',
        sandboxId: record.sandboxId,
        sandboxSnapshotId: record.snapshotId ?? null,
        sandboxCreatedAt: record.createdAt,
        sandboxLastUsedAt: record.lastUsedAt,
        sandboxLastSeenAt: seenAt,
        state: 'ready',
        lastError: null,
        lastErrorOp: null,
      })
    } catch (error) {
      if (resourceWritten) {
        await this.restoreRuntimeResource(record.workspaceId, selector, previousResource)
      }
      throw error
    }
  }

  private async restoreRuntimeResource(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
    previousResource: WorkspaceRuntimeResource | null | undefined,
  ): Promise<void> {
    try {
      if (previousResource && this.store.putWorkspaceRuntimeResource) {
        await this.store.putWorkspaceRuntimeResource(
          workspaceId,
          resourceToInput(previousResource),
        )
        return
      }
      await this.store.deleteWorkspaceRuntimeResource?.(workspaceId, selector)
    } catch {
      // Preserve the original write error. The next resolver can still fall
      // back to legacy runtime columns if resource rollback did not complete.
    }
  }

  async delete(workspaceId: string): Promise<void> {
    await this.store.deleteWorkspaceRuntimeResource?.(workspaceId, SANDBOX_RESOURCE)

    const existing = await this.store.getWorkspaceRuntime(workspaceId)
    if (!existing) return
    await this.store.putWorkspaceRuntime(workspaceId, {
      sandboxId: null,
      sandboxStatus: null,
      sandboxSnapshotId: null,
      sandboxCreatedAt: null,
      sandboxLastUsedAt: null,
      sandboxLastSeenAt: null,
      sandboxExpiresAt: null,
    })
  }

  async list(): Promise<WorkspaceSandboxHandleRecord[]> {
    if (this.store.listWorkspaceRuntimeResources) {
      const resources = await this.store.listWorkspaceRuntimeResources()
      const handles = resources
        .filter(
          (resource) =>
            resource.kind === SANDBOX_RESOURCE.kind &&
            resource.purpose === SANDBOX_RESOURCE.purpose &&
            resource.provider === SANDBOX_RESOURCE.provider &&
            resource.state !== 'deleted',
        )
        .map((resource) => resourceToHandle(resource))
        .filter((record): record is WorkspaceSandboxHandleRecord => record !== null)
      if (handles.length > 0) return handles
    }

    if (!this.store.listWorkspaceRuntimes) return []
    const runtimes = await this.store.listWorkspaceRuntimes()
    return runtimes
      .map((runtime) => runtimeToHandle(runtime))
      .filter((record): record is WorkspaceSandboxHandleRecord => record !== null)
  }
}

function handleToResourceInput(
  record: WorkspaceSandboxHandleRecord,
  seenAt: string,
): WorkspaceRuntimeResourceInput {
  return {
    ...SANDBOX_RESOURCE,
    provider: record.provider ?? SANDBOX_RESOURCE.provider,
    handleKind: record.handleKind ?? 'session',
    stableKey: record.stableKey ?? null,
    providerResourceId: record.sandboxId,
    state: 'ready',
    persistenceMode: record.persistenceMode ?? (record.snapshotId ? 'snapshot' : 'ephemeral'),
    providerMeta: {
      ...(record.providerMeta ?? {}),
      ...(record.snapshotId ? { snapshotId: record.snapshotId } : {}),
    },
    lastSeenAt: seenAt,
    lastUsedAt: record.lastUsedAt,
  }
}

function resourceToInput(resource: WorkspaceRuntimeResource): WorkspaceRuntimeResourceInput {
  return {
    id: resource.id,
    kind: resource.kind,
    purpose: resource.purpose,
    provider: resource.provider,
    handleKind: resource.handleKind,
    stableKey: resource.stableKey,
    providerResourceId: resource.providerResourceId,
    parentResourceId: resource.parentResourceId,
    state: resource.state,
    persistenceMode: resource.persistenceMode,
    config: resource.config,
    providerMeta: resource.providerMeta,
    lastError: resource.lastError,
    lastErrorCode: resource.lastErrorCode,
    lastSeenAt: resource.lastSeenAt,
    lastUsedAt: resource.lastUsedAt,
    expiresAt: resource.expiresAt,
    generation: resource.generation,
  }
}

function resourceToHandle(
  resource: WorkspaceRuntimeResource | null | undefined,
): WorkspaceSandboxHandleRecord | null {
  if (!resource?.providerResourceId || resource.state === 'deleted') return null
  const snapshotId = typeof resource.providerMeta.snapshotId === 'string'
    ? resource.providerMeta.snapshotId
    : undefined

  return {
    workspaceId: resource.workspaceId,
    sandboxId: resource.providerResourceId,
    snapshotId,
    provider: resource.provider,
    handleKind: resource.handleKind,
    stableKey: resource.stableKey ?? undefined,
    persistenceMode: resource.persistenceMode,
    providerMeta: resource.providerMeta,
    createdAt: resource.createdAt,
    lastUsedAt: resource.lastUsedAt ?? resource.updatedAt,
  }
}

function runtimeToHandle(
  runtime: WorkspaceRuntime | null,
): WorkspaceSandboxHandleRecord | null {
  if (!runtime?.sandboxId) return null

  return {
    workspaceId: runtime.workspaceId,
    sandboxId: runtime.sandboxId,
    snapshotId: runtime.sandboxSnapshotId ?? undefined,
    createdAt: runtime.sandboxCreatedAt ?? runtime.updatedAt,
    lastUsedAt: runtime.sandboxLastUsedAt ?? runtime.updatedAt,
  }
}

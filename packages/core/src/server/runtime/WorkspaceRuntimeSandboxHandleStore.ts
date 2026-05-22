import type {
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
  getWorkspaceRuntimeResource(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<WorkspaceRuntimeResource | null>
  putWorkspaceRuntimeResource(
    workspaceId: string,
    resource: WorkspaceRuntimeResourceInput,
  ): Promise<WorkspaceRuntimeResource>
  deleteWorkspaceRuntimeResource(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<void>
  listWorkspaceRuntimeResources(
    workspaceId?: string,
  ): Promise<WorkspaceRuntimeResource[]>
}

const SANDBOX_RESOURCE: WorkspaceRuntimeResourceSelector = {
  kind: 'sandbox',
  purpose: 'main',
  provider: 'vercel',
}

export class WorkspaceRuntimeSandboxHandleStore {
  constructor(private readonly store: WorkspaceRuntimeStoreLike) {}

  async get(workspaceId: string): Promise<WorkspaceSandboxHandleRecord | null> {
    const resource = await this.store.getWorkspaceRuntimeResource(workspaceId, SANDBOX_RESOURCE)
    return resourceToHandle(resource)
  }

  async put(record: WorkspaceSandboxHandleRecord): Promise<void> {
    const seenAt = new Date().toISOString()
    await this.store.putWorkspaceRuntimeResource(
      record.workspaceId,
      handleToResourceInput(record, seenAt),
    )
  }

  async delete(workspaceId: string): Promise<void> {
    await this.store.deleteWorkspaceRuntimeResource(workspaceId, SANDBOX_RESOURCE)
  }

  async list(): Promise<WorkspaceSandboxHandleRecord[]> {
    const resources = await this.store.listWorkspaceRuntimeResources()
    return resources
      .filter(
        (resource) =>
          resource.kind === SANDBOX_RESOURCE.kind &&
          resource.purpose === SANDBOX_RESOURCE.purpose &&
          resource.provider === SANDBOX_RESOURCE.provider &&
          resource.state !== 'deleted',
      )
      .map((resource) => resourceToHandle(resource))
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

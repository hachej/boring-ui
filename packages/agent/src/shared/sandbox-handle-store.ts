export interface SandboxHandleRecord {
  workspaceId: string
  sandboxId: string
  snapshotId?: string
  createdAt: string
  lastUsedAt: string
}

export interface SandboxHandleStore {
  get(workspaceId: string): Promise<SandboxHandleRecord | null>
  put(record: SandboxHandleRecord): Promise<void>
  delete(workspaceId: string): Promise<void>
  list(): Promise<SandboxHandleRecord[]>
}

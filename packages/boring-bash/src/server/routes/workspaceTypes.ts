export interface WorkspaceChangeEvent {
  op: 'write' | 'unlink' | 'rename' | 'mkdir'
  path: string
  oldPath?: string
  mtimeMs?: number
}

export type WorkspaceWatcherReadiness =
  | { ok: true }
  | { ok: false; reason: string; message?: string }

export interface WorkspaceWatchControlEvent {
  type: 'resync-required'
  reason: string
}

export interface WorkspaceWatcher {
  subscribe(
    listener: (event: WorkspaceChangeEvent) => void,
    options?: { onControlEvent?: (event: WorkspaceWatchControlEvent) => void },
  ): () => void
  whenReady?(): Promise<WorkspaceWatcherReadiness>
  close(): void
}

export interface Workspace {
  readonly root: string
  readFile(relPath: string): Promise<string>
  writeFile(relPath: string, data: string): Promise<void>
  unlink(relPath: string): Promise<void>
  readdir(relPath: string): Promise<Entry[]>
  stat(relPath: string): Promise<Stat>
  mkdir(relPath: string, opts?: { recursive?: boolean }): Promise<void>
  rename(fromRelPath: string, toRelPath: string): Promise<void>

  /**
   * Optional change-event channel. Implementations that can observe
   * out-of-band file changes (e.g. local fs via chokidar, or an
   * in-process EventEmitter for sandbox-driven tool writes) return a
   * watcher; implementations that can't observe changes (and don't
   * want to fake it via polling) omit this method or leave it
   * undefined.
   *
   * Frontends should always assume the method may be missing and
   * degrade to "rely on tool-reported events + window-focus refetch."
   * Calling `watch()` more than once on a single workspace must yield
   * watchers that share the same underlying observation source —
   * spawning N OS-level watchers per HTTP connection is not allowed.
   */
  watch?(): WorkspaceWatcher

  /**
   * Capability hint for hosts that want to render a UI affordance
   * ("connected"/"polling"/"manual refresh"). Optional — absence
   * means "treat as 'none' and consult `watch?` for the truth." When
   * present this is purely advisory; the actual events flow through
   * `watch()`.
   */
  readonly fsCapability?: FsCapability
}

export type FsCapability = 'none' | 'best-effort' | 'strong'

export interface Entry {
  name: string
  kind: 'file' | 'dir'
}

export interface Stat {
  size: number
  mtimeMs: number
  kind: 'file' | 'dir'
}

/**
 * Single fs-event payload. `op` is the canonical mutation kind, the
 * paths are workspace-relative, and `mtimeMs` is filled when the
 * implementation can stat the result cheaply (lets the client run an
 * idempotent staleness check without a follow-up stat request).
 */
export interface WorkspaceChangeEvent {
  op: 'write' | 'unlink' | 'rename' | 'mkdir'
  path: string
  /** Set on rename only — the path before the move. */
  oldPath?: string
  mtimeMs?: number
}

export interface WorkspaceWatcher {
  /**
   * Add a listener for change events. Returns an unsubscribe fn —
   * the underlying observation source stays open until the workspace
   * itself is disposed, so unsubscribing one listener is cheap and
   * does NOT tear down the watcher.
   */
  subscribe(listener: (event: WorkspaceChangeEvent) => void): () => void

  /**
   * Tear down the underlying observation source (chokidar instance,
   * sandbox emitter binding, …). Idempotent. Subscribers added after
   * close are no-ops. Hosts call this on workspace disposal.
   */
  close(): void
}

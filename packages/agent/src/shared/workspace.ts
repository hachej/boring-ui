import type { WorkspaceRuntimeContext } from './runtime'

export interface Workspace {
  /** Agent-visible workspace root; must match runtimeContext.runtimeCwd. */
  readonly root: string
  readonly runtimeContext: WorkspaceRuntimeContext
  readFile(relPath: string): Promise<string>
  /** Optional binary read operation for media/document previews. */
  readBinaryFile?(relPath: string): Promise<Uint8Array>
  writeFile(relPath: string, data: string): Promise<void>
  /**
   * Optional binary write operation for user-uploaded assets. Shared callers use
   * Uint8Array so browser-safe workspace contracts do not depend on Node-only types.
   */
  writeBinaryFile?(relPath: string, data: Uint8Array): Promise<void>
  /**
   * Optional optimized read+metadata operation. Remote workspaces should
   * implement this as one round trip when possible.
   */
  readFileWithStat?(relPath: string): Promise<{ content: string; stat: Stat }>
  /**
   * Optional optimized write+metadata operation. Remote workspaces should
   * implement this as one round trip when possible.
   */
  writeFileWithStat?(relPath: string, data: string): Promise<Stat>
  /** Optional optimized binary write+metadata operation. */
  writeBinaryFileWithStat?(relPath: string, data: Uint8Array): Promise<Stat>
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
   * Optional control-event channel for out-of-band changes.
   *
   * The primary `watch()` subscription is for fine-grained file
   * events. This is a secondary channel for coarse-grained external
   * events that should trigger a client-side resync — e.g. a bash
   * tool that mutates many files, or a git pull that swaps many refs.
   *
   * Implementations that can't observe changes (and don't
   * want to fake it via polling) omit this method or leave it
   * undefined.
   */
  notifyExternalChange?(event: WorkspaceWatchControlEvent): void

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

/**
 * Result of a watcher's readiness probe. `ok: false` means the
 * implementation decided it cannot observe this workspace (e.g. the
 * tree is too large to watch without harming the host process) —
 * hosts should tell clients to fall back rather than wait for events
 * that will never come.
 */
export type WorkspaceWatcherReadiness =
  | { ok: true }
  | { ok: false; reason: string; message?: string }

export interface WorkspaceWatchControlEvent {
  type: 'resync-required'
  reason: string
}

export interface WorkspaceWatchSubscribeOptions {
  /**
   * Called when the watcher detects a gap where changes may have been
   * missed. Consumers should drop caches/refetch instead of trusting
   * incremental events alone.
   */
  onControlEvent?: (event: WorkspaceWatchControlEvent) => void
}

export interface WorkspaceWatcher {
  /**
   * Add a listener for change events. Returns an unsubscribe fn —
   * the underlying observation source stays open until the workspace
   * itself is disposed, so unsubscribing one listener is cheap and
   * does NOT tear down the watcher.
   */
  subscribe(
    listener: (event: WorkspaceChangeEvent) => void,
    options?: WorkspaceWatchSubscribeOptions,
  ): () => void

  /**
   * Optional readiness probe. Implementations with a startup guard
   * (workspace-size check, native module availability, …) resolve it
   * once the underlying source is observing — or with `ok: false`
   * when observation was refused. Absent → assume always ready.
   */
  whenReady?(): Promise<WorkspaceWatcherReadiness>

  /**
   * Tear down the underlying observation source (chokidar instance,
   * sandbox emitter binding, …). Idempotent. Subscribers added after
   * close are no-ops. Hosts call this on workspace disposal.
   */
  close(): void
}

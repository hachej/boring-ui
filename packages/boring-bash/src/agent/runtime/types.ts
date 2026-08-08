import type {
  FileSearch,
  Sandbox,
  Workspace,
} from '@hachej/boring-agent/shared'
import type { WorkspacePythonEnvOptions } from './workspacePythonEnv'

/**
 * Environment mount shape accepted by the injected bwrap args builder
 * (gh-1123). Structural mirror of boring-sandbox's
 * `SandboxEnvironmentMountV1`; kept local because the canonical builder
 * implementation lives in `@hachej/boring-sandbox/providers/bwrap` and is
 * injected through `RuntimeHostOperations` — boring-bash never imports the
 * provider package.
 */
export interface RuntimeEnvironmentMount {
  readonly sourceRoot: string
  readonly logicalPath: string
  readonly access: 'ro' | 'rw'
}

/**
 * Options contract for the injected bwrap args builder. The canonical
 * implementation (and its validation rules) is
 * `@hachej/boring-sandbox/providers/bwrap#buildBwrapArgs`; the byte-identical
 * local copy was removed in gh-1123 slice 1.
 */
export interface BwrapArgsOptions {
  extraArgs?: string[]
  postWorkspaceArgs?: string[]
  network?: 'shared' | 'isolated'
  newSession?: boolean
  dropAllCapabilities?: boolean
  /** Sandbox-visible home/primary root; defaults to `/workspace`. */
  sandboxHome?: string
  /** Already-resolved environment mounts (gh-1123). */
  mounts?: readonly RuntimeEnvironmentMount[]
}

export type RuntimeBashStrategy =
  | { kind: 'host'; preserveHostHome?: boolean }
  | { kind: 'local-sandbox'; sandboxRoot: string }
  | { kind: 'remote'; defaultPath?: string }

export interface RuntimeRemoteWorkspacePathOptions {
  rootAliases?: string[]
  toRemotePath?: (value: string) => string
  toRuntimePath?: (value: string) => string
  sanitizeErrorText?: (value: string) => string
}

export type RuntimeFilesystemStrategy =
  | { kind: 'host' }
  | { kind: 'remote-workspace'; pathOptions?: RuntimeRemoteWorkspacePathOptions }

export interface RuntimeFilesystemBindingOperations {
  read(descriptor: { filesystem: string; path: string }): Promise<{ content: string; mtimeMs?: number; metadata?: unknown }>
  list(descriptor: { filesystem: string; path: string }): Promise<{ entries: string[]; metadata?: unknown }>
  find(descriptor: { filesystem: string; path: string }, pattern: string, options?: { limit?: number; offset?: number }): Promise<{ paths: string[]; metadata?: unknown }>
  grep(descriptor: { filesystem: string; path: string }, pattern: string, options?: { limit?: number; offset?: number }): Promise<{ matches: Array<{ path: string; line: number; text: string }>; metadata?: unknown }>
  stat(descriptor: { filesystem: string; path: string }): Promise<{ isDirectory: boolean; metadata?: unknown }>
  write?(descriptor: { filesystem: string; path: string; content: string; expectedMtimeMs?: number }): Promise<{ mtimeMs?: number; metadata?: unknown }>
  delete?(descriptor: { filesystem: string; path: string }): Promise<{ metadata?: unknown }>
  move?(descriptor: { filesystem: string; from: string; to: string }): Promise<{ metadata?: unknown }>
  mkdir?(descriptor: { filesystem: string; path: string; recursive?: boolean }): Promise<{ metadata?: unknown }>
  rejectMutation(operation: string, descriptor: { filesystem: string; path: string }): never
}

/**
 * How a binding may be realized as an environment mount (gh-1123):
 * - `direct`: a static real host directory; requires
 *   `materialization.sourceRoot` (zero-cost bind).
 * - `view`: a live Operations→FUSE bridge over the binding's vtable
 *   (later slice); requires only the operations vtable.
 * Absent means the binding is file-tools-only (today's default).
 */
export type RuntimeFilesystemMountKind = 'direct' | 'view'

export interface RuntimeFilesystemBinding {
  readonly filesystem: string
  readonly access: 'readonly' | 'readwrite'
  readonly operations: RuntimeFilesystemBindingOperations
  /** gh-1123: declared mountability; never inferred from probing. */
  readonly mountKind?: RuntimeFilesystemMountKind
  /**
   * Server-private materialization for `mountKind: 'direct'` bindings: the
   * real host directory a mount binds. Never wired to the browser catalog.
   * A binding never mounts wider than its file-ops access; readonly
   * bindings mount `ro`.
   */
  readonly materialization?: { readonly sourceRoot: string }
}

export interface RuntimeHostOperations {
  buildBwrapArgs(workspaceRoot: string, options?: BwrapArgsOptions): string[]
  withWorkspacePythonEnv(input: WorkspacePythonEnvOptions): Record<string, string | undefined>
}

export interface RuntimeBundle {
  storageRoot?: string
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
  /** Host-owned provider utilities injected by the consuming application. */
  runtimeHost?: RuntimeHostOperations
  getRuntimeEnv?: () => Promise<Record<string, string>>
  bash?: RuntimeBashStrategy
  filesystem?: RuntimeFilesystemStrategy
  filesystemBindings?: RuntimeFilesystemBinding[]
}

export function getRuntimeBundleStorageRoot(bundle: RuntimeBundle): string {
  if (bundle.storageRoot) return bundle.storageRoot

  throw new Error(
    'RuntimeBundle.storageRoot is required for host-filesystem tools. ' +
    'The pre-integration boring-bash copy cannot read Agent\'s private node-workspace host-root binding. ' +
    `Got workspace.root=${bundle.workspace.root}, sandbox.provider=${bundle.sandbox.provider}`,
  )
}

import type {
  FileSearch,
  Sandbox,
  Workspace,
} from '@hachej/boring-agent/shared'
import type { BwrapArgsOptions } from './buildBwrapArgs'
import type { WorkspacePythonEnvOptions } from './workspacePythonEnv'

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

export type RuntimeFilesystemCapability =
  | 'read'
  | 'write'
  | 'create-child'
  | 'delete'
  | 'move-from'

export interface RuntimeFilesystemAccessDecision {
  readonly filesystem: string
  readonly normalizedPath: string
  readonly access: 'readonly' | 'readwrite'
  readonly capabilities: Readonly<Record<RuntimeFilesystemCapability, boolean>>
}

export const READONLY_FILESYSTEM_MUTATION_CODE = 'readonly' as const
export const RUNTIME_FILESYSTEM_CAPABILITIES = Object.freeze([
  'read',
  'write',
  'create-child',
  'delete',
  'move-from',
] as const satisfies readonly RuntimeFilesystemCapability[])

export class ReadonlyFilesystemMutationError extends Error {
  readonly code = READONLY_FILESYSTEM_MUTATION_CODE
  readonly statusCode = 403 as const
  readonly filesystem: string
  readonly operation: RuntimeFilesystemCapability

  constructor(filesystem: string, operation: RuntimeFilesystemCapability) {
    super(`${filesystem} binding is readonly`)
    this.name = 'ReadonlyFilesystemMutationError'
    this.filesystem = filesystem
    this.operation = operation
  }
}

export function isReadonlyFilesystemMutationError(
  value: unknown,
): value is ReadonlyFilesystemMutationError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.code === READONLY_FILESYSTEM_MUTATION_CODE
    && candidate.statusCode === 403
    && typeof candidate.filesystem === 'string'
    && RUNTIME_FILESYSTEM_CAPABILITIES.includes(candidate.operation as RuntimeFilesystemCapability)
}

export interface RuntimeFilesystemBindingOperations {
  read(descriptor: { filesystem: string; path: string }): Promise<{ content: string; mtimeMs?: number; metadata?: unknown }>
  list(descriptor: { filesystem: string; path: string }): Promise<{ entries: string[]; metadata?: unknown }>
  find(descriptor: { filesystem: string; path: string }, pattern: string, options?: { limit?: number; offset?: number }): Promise<{ paths: string[]; metadata?: unknown }>
  grep(descriptor: { filesystem: string; path: string }, pattern: string, options?: { limit?: number; offset?: number }): Promise<{ matches: Array<{ path: string; line: number; text: string }>; metadata?: unknown }>
  stat(descriptor: { filesystem: string; path: string }): Promise<{ isDirectory: boolean; metadata?: unknown }>
  write?(descriptor: { filesystem: string; path: string; content: string; expectedMtimeMs?: number }): Promise<{ mtimeMs?: number; metadata?: unknown }>
  writeBinary?(descriptor: { filesystem: string; path: string; content: Uint8Array }): Promise<{ mtimeMs?: number; metadata?: unknown }>
  delete?(descriptor: { filesystem: string; path: string }): Promise<{ metadata?: unknown }>
  move?(descriptor: { filesystem: string; from: string; to: string }): Promise<{ metadata?: unknown }>
  mkdir?(descriptor: { filesystem: string; path: string; recursive?: boolean }): Promise<{ metadata?: unknown }>
  resolveAccess?(descriptor: { filesystem: string; path: string }): Promise<RuntimeFilesystemAccessDecision>
  rejectMutation(operation: string, descriptor: { filesystem: string; path: string }): never
}

export interface RuntimeFilesystemBinding {
  readonly filesystem: string
  readonly access: 'readonly' | 'readwrite'
  readonly operations: RuntimeFilesystemBindingOperations
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

import type { FileSearch } from '../../shared/file-search'
import type { WorkspaceRuntimeContext } from '../../shared/runtime'
import type { Sandbox } from '../../shared/sandbox'
import type { TelemetrySink } from '../../shared/telemetry'
import type { Workspace } from '../../shared/workspace'
import { getNodeWorkspaceHostRoot } from '../workspace/createNodeWorkspace'
import type { BoringAgentRuntimePaths } from '../workspace/runtimeLayout'
import type { WorkspaceProvisioningAdapter } from '../workspace/provisioning'
import type { CapabilityReadinessDetail, ReadyStatusTracker } from './readyStatus'

export type BuiltinRuntimeModeId = 'direct' | 'local' | 'vercel-sandbox'
export type RuntimeModeId = BuiltinRuntimeModeId | (string & {})

export interface RuntimeModeReadinessHooks {
  initialSandboxReady?: boolean
  initialWorkspaceReadiness?: CapabilityReadinessDetail
  onTrackerCreated?: (tracker: ReadyStatusTracker) => void
}

export type RuntimeCachedBindingHealthCheckResult =
  | { state: 'ok' }
  | { state: 'recreate'; message?: string; error?: unknown }

export interface RuntimeCachedBindingHealthCheck {
  intervalMs?: number
  check(ctx: { runtimeBundle: RuntimeBundle; workspaceId: string }): Promise<RuntimeCachedBindingHealthCheckResult>
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

export interface RuntimeModeAdapter {
  readonly id: RuntimeModeId
  /**
   * Declares whether the workspace files are strongly available on the host
   * path before create() runs. Composition layers use this to decide whether
   * host-side fs checks/prompts are safe without hard-coding sandbox IDs.
   */
  readonly workspaceFsCapability?: Workspace['fsCapability']
  readonly readiness?: RuntimeModeReadinessHooks
  readonly cachedBindingHealthCheck?: RuntimeCachedBindingHealthCheck
  create(ctx: ModeContext): Promise<RuntimeBundle>
  createProvisioningAdapter?(runtimeLayout: BoringAgentRuntimePaths, ctx?: ModeContext): WorkspaceProvisioningAdapter
  getRuntimeLayoutRoot?(ctx: ModeContext): string
  evictCachedRuntime?(ctx: { workspaceId: string }): void
  dispose?(): Promise<void>
}

export interface ModeContext {
  workspaceRoot: string
  sessionId: string
  workspaceId?: string
  templatePath?: string
  requestId?: string
  telemetry?: TelemetrySink
}

export interface RuntimeFilesystemBindingOperations {
  read(descriptor: { filesystem: string; path: string }): Promise<{ content: string; metadata?: unknown }>
  list(descriptor: { filesystem: string; path: string }): Promise<{ entries: string[]; metadata?: unknown }>
  find(descriptor: { filesystem: string; path: string }, pattern: string, options?: { limit?: number; offset?: number }): Promise<{ paths: string[]; metadata?: unknown }>
  grep(descriptor: { filesystem: string; path: string }, pattern: string, options?: { limit?: number; offset?: number }): Promise<{ matches: Array<{ path: string; line: number; text: string }>; metadata?: unknown }>
  stat(descriptor: { filesystem: string; path: string }): Promise<{ isDirectory: boolean; metadata?: unknown }>
  rejectMutation(operation: string, descriptor: { filesystem: string; path: string }): never
}

export interface RuntimeFilesystemBinding {
  readonly filesystem: string
  readonly access: 'readonly'
  readonly operations: RuntimeFilesystemBindingOperations
}


export interface RuntimeBundle {
  runtimeContext?: WorkspaceRuntimeContext
  /**
   * Server-private host/storage root for host-side filesystem work. Do not use
   * this as the agent-visible cwd; Workspace.root remains the public runtime
   * namespace shown to tools/model.
   */
  storageRoot?: string
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
  /** Optional per-execution runtime env provider for local/direct operations that do not call Sandbox.exec. */
  getRuntimeEnv?: () => Promise<Record<string, string>>
  /** Runtime-owned bash execution strategy, consumed by the agent bash tool builder. */
  bash?: RuntimeBashStrategy
  /** Runtime-owned filesystem strategy, consumed by the agent filesystem tool builder. */
  filesystem?: RuntimeFilesystemStrategy
  /** Optional filesystem bindings prepared for this runtime/session. */
  filesystemBindings?: RuntimeFilesystemBinding[]
}

export function getOptionalRuntimeBundleStorageRoot(bundle: RuntimeBundle): string | undefined {
  return bundle.storageRoot ?? getNodeWorkspaceHostRoot(bundle.workspace) ?? undefined
}

export function getRuntimeBundleStorageRoot(bundle: RuntimeBundle): string {
  const hostRoot = getOptionalRuntimeBundleStorageRoot(bundle)
  if (hostRoot) return hostRoot

  throw new Error(
    'RuntimeBundle.storageRoot is required for host-filesystem tools. ' +
    'Mode adapters must set storageRoot to the host workspace path. ' +
    `Got workspace.root=${bundle.workspace.root}, sandbox.provider=${bundle.sandbox.provider}`,
  )
}

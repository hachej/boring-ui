import type { SandboxHandleStore } from '@hachej/boring-agent/shared'

import type { ProviderCapabilities } from './capability'
import type {
  SandboxProviderCreateContextV1,
  SandboxProviderV1,
} from './providerV1'

export type SandboxRuntimeBashStrategyV1 =
  | Readonly<{ kind: 'host'; preserveHostHome?: boolean }>
  | Readonly<{ kind: 'local-sandbox'; sandboxRoot: string }>
  | Readonly<{ kind: 'remote'; defaultPath?: string }>

export interface SandboxRuntimeRemotePathOptionsV1 {
  readonly rootAliases?: string[]
  readonly toRemotePath?: (value: string) => string
  readonly toRuntimePath?: (value: string) => string
  readonly sanitizeErrorText?: (value: string) => string
}

export type SandboxRuntimeFilesystemStrategyV1 =
  | Readonly<{ kind: 'host' }>
  | Readonly<{
      kind: 'remote-workspace'
      pathOptions?: SandboxRuntimeRemotePathOptionsV1
    }>

export interface SandboxRuntimeReadinessV1 {
  readonly initialSandboxReady?: boolean
  readonly initialWorkspaceReadiness?: Readonly<{
    state: 'not-started' | 'preparing' | 'ready' | 'failed'
    message?: string
  }>
  readonly markSandboxReadyOnTrackerCreated?: boolean
}

export interface SandboxRuntimeAdapterProfileV1 {
  readonly workspaceFsCapability: 'strong' | 'best-effort'
  readonly bash: SandboxRuntimeBashStrategyV1
  readonly filesystem: SandboxRuntimeFilesystemStrategyV1
  readonly storageRoot: 'workspace-root' | 'none'
  readonly prepareWorkspaceTemplateOnHost?: boolean
  readonly provisioning?: 'host-direct' | 'host-local' | 'pair'
  readonly healthCheckIntervalMs?: number
  readonly readiness?: SandboxRuntimeReadinessV1
  readonly requiredPlatform?: Readonly<{
    platform: NodeJS.Platform
    message: string
  }>
}

export interface SandboxRuntimeHostPolicyV1 {
  readonly productionSafe: boolean
  readonly inferSiblingSessionRoot: boolean
  readonly allowPiExtensions: boolean
  readonly loadWorkspacePiResources: boolean
  readonly includePluginAuthoringProvisioning: boolean
  readonly resolveCompanyContextFromHostWorkspace: boolean
  readonly httpWorkspaceScope: 'default' | 'session'
  readonly sandboxHandle?: Readonly<{
    provider: string
    defaultPersistenceMode: string
  }>
}

export interface SandboxRuntimePairFactoryOptionsV1 {
  readonly sandboxHandleStore?: SandboxHandleStore
}

/**
 * Provider-owned description of one selectable runtime mode.
 *
 * The only construction seam is createPairFactory(), which returns a
 * SandboxProviderV1. That provider can only create WorkspaceSandboxPairV1, so
 * Workspace and Sandbox cannot be selected or replaced independently.
 */
export interface SandboxRuntimeModeDescriptorV1 {
  readonly id: string
  readonly providerId: string
  readonly pair: Readonly<{
    workspaceProviderId: string
    sandboxProviderId: string
    isolationProviderId?: string
  }>
  readonly capabilities: ProviderCapabilities
  readonly errorCodeNamespace: string
  readonly adapter: SandboxRuntimeAdapterProfileV1
  readonly host: SandboxRuntimeHostPolicyV1
  resolveRuntimeRoot(context: SandboxProviderCreateContextV1): string
  createPairFactory(
    options: SandboxRuntimePairFactoryOptionsV1,
  ): SandboxProviderV1 | Promise<SandboxProviderV1>
}

/** Read-only provider lookup exposed to hosts. Registration stays package-internal. */
export interface SandboxRuntimeModeRegistryV1 {
  has(id: string): boolean
  resolve(id: string): SandboxRuntimeModeDescriptorV1
  find(id: string): SandboxRuntimeModeDescriptorV1 | undefined
  list(): readonly SandboxRuntimeModeDescriptorV1[]
}

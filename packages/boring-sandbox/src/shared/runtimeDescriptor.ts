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
  readonly providerOptions?: unknown
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

export class SandboxRuntimeModeRegistryV1 {
  readonly #descriptors = new Map<string, SandboxRuntimeModeDescriptorV1>()

  constructor(descriptors: readonly SandboxRuntimeModeDescriptorV1[] = []) {
    for (const descriptor of descriptors) this.register(descriptor)
  }

  register(descriptor: SandboxRuntimeModeDescriptorV1): this {
    const id = descriptor.id.trim()
    if (!id) throw new Error('Sandbox runtime descriptor id is required')
    if (this.#descriptors.has(id)) {
      throw new Error(`Sandbox runtime descriptor "${id}" is already registered`)
    }
    if (descriptor.providerId !== descriptor.pair.sandboxProviderId) {
      throw new Error(
        `Sandbox runtime descriptor "${id}" must pair its declared provider with its Sandbox factory`,
      )
    }
    this.#descriptors.set(id, descriptor)
    return this
  }

  has(id: string): boolean {
    return this.#descriptors.has(id)
  }

  resolve(id: string): SandboxRuntimeModeDescriptorV1 {
    const descriptor = this.#descriptors.get(id)
    if (!descriptor) throw new Error(`Runtime mode "${id}" has no registered sandbox provider.`)
    return descriptor
  }

  list(): readonly SandboxRuntimeModeDescriptorV1[] {
    return Object.freeze([...this.#descriptors.values()])
  }
}

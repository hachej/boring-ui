export interface AgentRuntimeCapabilities {
  nativeFollowUp: boolean
  aiSdkOwnsHistory: boolean
}

export interface ResolvedEnvironment {
  /**
   * Model/manifest-visible id, e.g. user, company_context, scratch.
   * This is a methodless projection of runtime authority.
   */
  readonly id: string
  readonly filesystem?: {
    readonly access: 'read' | 'readwrite'
    readonly acceptsInputAssets?: boolean
    readonly defaultInputAssetSink?: boolean
  }
  readonly tools: readonly string[]
  /** Diagnostic only; consumers must not use this as a feature gate. */
  readonly provider?: string
  readonly label?: string
}

export interface ResolvedAgentCapabilities {
  readonly v: 1
  /** Diagnostic only; consumers must derive behavior from environments/tools. */
  readonly runtimeMode?: string
  /** Source of truth for filesystem/bash/environment authority. */
  readonly environments: readonly ResolvedEnvironment[]
  readonly tools: readonly string[]
  readonly skills: readonly string[]
  readonly mcpServers: readonly string[]
}

export const DEFAULT_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  nativeFollowUp: false,
  aiSdkOwnsHistory: true,
}

export const PI_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  nativeFollowUp: true,
  aiSdkOwnsHistory: false,
}

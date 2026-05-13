export interface AgentRuntimeCapabilities {
  nativeFollowUp: boolean
  aiSdkOwnsHistory: boolean
}

export const DEFAULT_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  nativeFollowUp: false,
  aiSdkOwnsHistory: true,
}

export const PI_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  nativeFollowUp: true,
  aiSdkOwnsHistory: false,
}

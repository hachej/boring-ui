export type AgentRuntimeProtocol = 'ai-sdk' | 'pi-native'

export interface AgentRuntimeCapabilities {
  protocol: AgentRuntimeProtocol
}

export const DEFAULT_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  protocol: 'ai-sdk',
}

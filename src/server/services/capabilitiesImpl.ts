/**
 * Capabilities service implementation — abstract vocabulary, no legacy names.
 *
 * Each WorkspaceBackend declares its capabilities:
 *   BwrapBackend:     workspace.files, workspace.exec, workspace.git, workspace.python
 *   LightningBackend: workspace.files, workspace.git
 *   JustBashBackend:  workspace.files, workspace.exec
 *
 * Agent capabilities (always available when agent is enabled):
 *   agent.chat, agent.tools
 */
import type { ServerConfig, WorkspaceBackend } from '../config.js'

// --- Abstract capability vocabulary ---

export const WORKSPACE_CAPABILITIES = [
  'workspace.files',
  'workspace.exec',
  'workspace.git',
  'workspace.python',
] as const

export const AGENT_CAPABILITIES = [
  'agent.chat',
  'agent.tools',
] as const

export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number]
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number]

// --- Backend → capabilities mapping ---

const BACKEND_CAPABILITIES: Record<WorkspaceBackend, WorkspaceCapability[]> = {
  bwrap: ['workspace.files', 'workspace.exec', 'workspace.git', 'workspace.python'],
  lightningfs: ['workspace.files', 'workspace.git'],
  justbash: ['workspace.files', 'workspace.exec'],
}

// --- Response builder ---

export interface CapabilitiesResponse {
  version: string
  capabilities: Record<string, boolean>
  auth: {
    provider: string
    neonAuthUrl?: string
    callbackUrl?: string
    emailProvider?: string
    verificationEmailEnabled?: boolean
  }
  workspace: {
    backend: string
  }
  agent: {
    runtime: string
    placement: string
  }
}

export function buildCapabilitiesResponse(
  config: ServerConfig,
  backend?: WorkspaceBackend,
): CapabilitiesResponse {
  const effectiveBackend = backend ?? config.workspaceBackend

  // Build capabilities map — only abstract names
  const capabilities: Record<string, boolean> = {}

  // Add workspace capabilities for this backend
  const backendCaps = BACKEND_CAPABILITIES[effectiveBackend] ?? []
  for (const cap of backendCaps) {
    capabilities[cap] = true
  }

  // Add agent capabilities (always available)
  for (const cap of AGENT_CAPABILITIES) {
    capabilities[cap] = true
  }

  return {
    version: '1.0.0',
    capabilities,
    auth: {
      provider: config.controlPlaneProvider,
      neonAuthUrl: config.neonAuthBaseUrl,
      emailProvider: config.authEmailProvider,
      verificationEmailEnabled: config.authEmailProvider !== 'none',
    },
    workspace: {
      backend: effectiveBackend,
    },
    agent: {
      runtime: config.agentRuntime,
      placement: config.agentPlacement,
    },
  }
}

/**
 * Python-compatible capabilities response builder.
 *
 * Phase 1: Returns the SAME response shape as the Python server's
 * GET /api/capabilities, using legacy feature names (files, git, pty,
 * chat_claude_code, etc.). This ensures smoke test parity.
 *
 * Phase 4 (bd-1wkce.1) will migrate to abstract vocabulary (workspace.files, etc.).
 */
import type { ServerConfig } from '../config.js'

// --- Router metadata (mirrors Python's RouterRegistry entries) ---

export interface RouterMeta {
  name: string
  prefix: string
  description: string
  tags: string[]
  enabled: boolean
}

const DEFAULT_ROUTERS: Omit<RouterMeta, 'enabled'>[] = [
  {
    name: 'files',
    prefix: '/api/v1/files',
    description: 'File system operations (read, write, rename, delete)',
    tags: ['files'],
  },
  {
    name: 'git',
    prefix: '/api/v1/git',
    description: 'Git operations (status, diff, show)',
    tags: ['git'],
  },
  {
    name: 'exec',
    prefix: '/api/v1',
    description: 'Command execution',
    tags: ['exec'],
  },
  {
    name: 'ui_state',
    prefix: '/api/v1/ui',
    description: 'Workspace UI state snapshots (open panes, active pane)',
    tags: ['ui'],
  },
  {
    name: 'control_plane',
    prefix: '/api/v1/control-plane',
    description: 'Workspace/user/membership/invite/settings metadata foundation',
    tags: ['control-plane'],
  },
  {
    name: 'pty',
    prefix: '/ws',
    description: 'PTY WebSocket for shell terminals',
    tags: ['websocket', 'terminal'],
  },
  {
    name: 'chat_claude_code',
    prefix: '/ws/agent/normal',
    description: 'Claude stream WebSocket for AI chat',
    tags: ['websocket', 'ai'],
  },
  {
    name: 'stream',
    prefix: '/ws/agent/normal',
    description: 'Claude stream WebSocket for AI chat (alias for chat_claude_code)',
    tags: ['websocket', 'ai'],
  },
  {
    name: 'approval',
    prefix: '/api',
    description: 'Approval workflow endpoints',
    tags: ['approval'],
  },
]

// --- Enabled features builder (matches Python app.py:129-143) ---

export function buildEnabledFeatures(config: ServerConfig): Record<string, boolean> {
  // In the TS server, core routers are always enabled
  const chatEnabled = true // chat_claude_code always available
  const piEnabled = config.agentsMode === 'backend'
  const githubEnabled = !!config.githubAppId

  return {
    files: true,
    git: true,
    exec: true,
    messaging: false, // Not yet ported
    ui_state: true,
    control_plane: true,
    pty: true,
    chat_claude_code: chatEnabled,
    stream: chatEnabled, // Backward compat alias
    approval: false, // Not yet ported
    pi: piEnabled,
    github: githubEnabled,
  }
}

// --- Python-compat capabilities response ---

export interface PythonCompatCapabilitiesResponse {
  version: string
  features: Record<string, boolean>
  agents: string[]
  agent_mode: string
  agent_default?: string
  routers: RouterMeta[]
  auth?: {
    provider: string
    neonAuthUrl?: string
    callbackUrl?: string
    appName?: string
    appDescription?: string
    emailProvider?: string
    verificationEmailEnabled?: boolean
  }
  workspace_runtime?: {
    placement: string
    agent_mode: string
  }
}

export function buildPythonCompatCapabilities(
  config: ServerConfig,
): PythonCompatCapabilitiesResponse {
  const features = buildEnabledFeatures(config)

  // Build agents list from features (matches Python's _build_available_agents)
  const agents: string[] = []
  if (features.chat_claude_code || features.stream) {
    agents.push('claude_code')
  }
  if (features.pi) {
    agents.push('pi')
  }

  // Build routers array with enabled status
  const routers: RouterMeta[] = DEFAULT_ROUTERS.map((r) => ({
    ...r,
    enabled: features[r.name] ?? false,
  }))

  const result: PythonCompatCapabilitiesResponse = {
    version: '0.1.0',
    features,
    agents: agents.sort(),
    agent_mode: config.agentsMode,
    routers,
  }

  // Auth section (when neon provider is configured)
  if (config.controlPlaneProvider === 'neon' && config.neonAuthBaseUrl) {
    result.auth = {
      provider: 'neon',
      neonAuthUrl: config.neonAuthBaseUrl.replace(/\/+$/, ''),
      callbackUrl: '/auth/callback',
      appName: config.authAppName || '',
      emailProvider: config.authEmailProvider,
      verificationEmailEnabled: config.authEmailProvider !== 'none',
    }
  }

  // Workspace runtime (backend agent mode)
  if (config.agentsMode === 'backend') {
    result.workspace_runtime = {
      placement: 'workspace_machine',
      agent_mode: 'backend',
    }
  }

  return result
}

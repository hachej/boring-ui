/**
 * Runtime config payload builder for /__bui/config endpoint.
 *
 * Mirrors Python's runtime_config.py build_runtime_config_payload().
 * Provides the frontend bootstrap contract: app identity, branding,
 * data backend, agent mode, and auth config.
 */
import type { ServerConfig } from '../config.js'

/** Map workspace backend config values to frontend data.backend values. */
function mapDataBackend(workspaceBackend: string): string {
  // bwrap backend uses HTTP transport from frontend perspective
  if (workspaceBackend === 'bwrap') return 'http'
  // lightningfs and justbash run in browser
  return workspaceBackend
}

function normalizeAgentMode(agentsMode: string): string {
  return agentsMode === 'backend' ? 'backend' : 'frontend'
}

export interface RuntimeConfigPayload {
  app: {
    id: string
    name: string
    logo: string
  }
  frontend: {
    branding: {
      name: string
      logo: string
    }
    features: Record<string, unknown>
    data: {
      backend: string
    }
    agents: {
      mode: string
    }
    panels: Record<string, unknown>
    mode: {
      profile: string
    }
  }
  agents: {
    mode: string
    default: string | null
    available: string[]
    definitions: unknown[]
  }
  auth: {
    provider: string
    neonAuthUrl: string
    callbackUrl: string
    appName: string
  } | null
}

export function buildRuntimeConfigPayload(
  config: ServerConfig,
): RuntimeConfigPayload {
  const agentMode = normalizeAgentMode(config.agentsMode)
  const dataBackend = mapDataBackend(config.workspaceBackend)

  // Determine profile from env or agent mode
  const explicitProfile =
    process.env.VITE_UI_PROFILE ||
    process.env.UI_PROFILE ||
    ''
  const profile = explicitProfile.trim().toLowerCase() || agentMode

  // Build available agents list
  const available: string[] = []
  if (agentMode === 'backend') {
    available.push('pi')
  }

  // Build auth section
  let auth: RuntimeConfigPayload['auth'] = null
  if (config.controlPlaneProvider === 'neon' && config.neonAuthBaseUrl) {
    auth = {
      provider: 'neon',
      neonAuthUrl: config.neonAuthBaseUrl.replace(/\/+$/, ''),
      callbackUrl: '/auth/callback',
      appName: config.authAppName || '',
    }
  }

  return {
    app: {
      id: config.controlPlaneAppId || 'boring-ui',
      name: config.authAppName || 'Boring UI',
      logo: 'B',
    },
    frontend: {
      branding: {
        name: config.authAppName || 'Boring UI',
        logo: 'B',
      },
      features: {},
      data: {
        backend: dataBackend,
      },
      agents: {
        mode: agentMode,
      },
      panels: {},
      mode: {
        profile,
      },
    },
    agents: {
      mode: agentMode,
      default: null,
      available: available.sort(),
      definitions: [],
    },
    auth,
  }
}

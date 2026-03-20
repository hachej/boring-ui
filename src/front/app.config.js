const parseBoolEnv = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const UI_PROFILES = {
  frontend: 'frontend',
  backend: 'backend',
}

const PROFILE_DEFAULTS = {
  [UI_PROFILES.frontend]: { agentMode: 'frontend', dataBackend: 'lightningfs' },
  [UI_PROFILES.backend]: { agentMode: 'backend', dataBackend: 'http' },
}

const normalizeAgentMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'frontend' || normalized === 'backend') {
    return normalized
  }
  return 'frontend'
}

const normalizeUiProfile = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return PROFILE_DEFAULTS[normalized] ? normalized : ''
}

const normalizeDataBackend = (value) =>
  String(value || '').trim().toLowerCase()

const explicitProfile = normalizeUiProfile(import.meta.env.VITE_UI_PROFILE || '')
const uiProfile = explicitProfile || UI_PROFILES.frontend
const profileDefaults = PROFILE_DEFAULTS[uiProfile] || {}
const agentMode = normalizeAgentMode(import.meta.env.VITE_AGENT_MODE || profileDefaults.agentMode || 'frontend')
const modeDefaultDataBackend = profileDefaults.dataBackend || (agentMode === 'backend' ? 'http' : 'lightningfs')
const dataBackend = normalizeDataBackend(import.meta.env.VITE_DATA_BACKEND || modeDefaultDataBackend)

export default {
  mode: {
    profile: uiProfile || 'custom',
  },
  editors: {
    markdownPane: 'editor',
  },
  agents: {
    mode: agentMode,
  },
  features: {
    codeSessions: true,
    controlPlaneOnboarding: parseBoolEnv(import.meta.env.VITE_CONTROL_PLANE_ONBOARDING),
  },
  data: {
    backend: dataBackend,
    lightningfs: {
      name: (import.meta.env.VITE_LIGHTNINGFS_NAME || 'boring-fs').trim(),
    },
  },
}

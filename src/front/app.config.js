const parseBoolEnv = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const normalizeDeployMode = (value) =>
  String(value || '').trim().toLowerCase() === 'edge' ? 'edge' : 'core'

const UI_PROFILES = {
  piLightningFs: 'pi-lightningfs',
  piCheerpx: 'pi-cheerpx',
  piHttpFs: 'pi-httpfs',
  companionHttpFs: 'companion-httpfs',
}

const PROFILE_DEFAULTS = {
  [UI_PROFILES.piLightningFs]: { agentRailMode: 'pi', dataBackend: 'lightningfs' },
  [UI_PROFILES.piCheerpx]: { agentRailMode: 'pi', dataBackend: 'cheerpx' },
  [UI_PROFILES.piHttpFs]: { agentRailMode: 'pi', dataBackend: 'http' },
  [UI_PROFILES.companionHttpFs]: { agentRailMode: 'companion', dataBackend: 'http' },
}

const normalizeAgentRailMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'native' || normalized === 'companion' || normalized === 'pi' || normalized === 'all') {
    return normalized
  }
  return 'all'
}

const normalizeUiProfile = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return PROFILE_DEFAULTS[normalized] ? normalized : ''
}

const normalizeDataBackend = (value) =>
  String(value || '').trim().toLowerCase()

const deployMode = normalizeDeployMode(import.meta.env.VITE_DEPLOY_MODE || '')
const explicitProfile = normalizeUiProfile(import.meta.env.VITE_UI_PROFILE || '')
const inferredDefaultProfile = deployMode === 'edge' ? UI_PROFILES.companionHttpFs : UI_PROFILES.piLightningFs
const uiProfile = explicitProfile || inferredDefaultProfile
const profileDefaults = PROFILE_DEFAULTS[uiProfile] || {}
const agentRailMode = normalizeAgentRailMode(import.meta.env.VITE_AGENT_RAIL_MODE || profileDefaults.agentRailMode || 'all')
const modeDefaultDataBackend = profileDefaults.dataBackend || (agentRailMode === 'pi' ? 'lightningfs' : 'http')
const dataBackend = normalizeDataBackend(import.meta.env.VITE_DATA_BACKEND || modeDefaultDataBackend)

export default {
  mode: {
    deployMode,
    profile: uiProfile || 'custom',
  },
  editors: {
    markdownPane: 'potion',
  },
  features: {
    codeSessions: true,
    agentRailMode,
    controlPlaneOnboarding: parseBoolEnv(import.meta.env.VITE_CONTROL_PLANE_ONBOARDING),
  },
  data: {
    backend: dataBackend,
    lightningfs: {
      name: (import.meta.env.VITE_LIGHTNINGFS_NAME || 'boring-fs').trim(),
    },
    cheerpx: {
      workspaceRoot: (import.meta.env.VITE_CHEERPX_WORKSPACE_ROOT || '/workspace').trim(),
      primaryDiskUrl: (
        import.meta.env.VITE_CHEERPX_PRIMARY_DISK_URL
        || 'wss://disks.webvm.io/alpine_20251007.ext2'
      ).trim(),
      overlayName: (import.meta.env.VITE_CHEERPX_OVERLAY_NAME || 'boring-ui-cheerpx-overlay').trim(),
      cheerpxEsmUrl: (
        import.meta.env.VITE_CHEERPX_ESM_URL
        || 'https://cdn.jsdelivr.net/npm/@leaningtech/cheerpx/+esm'
      ).trim(),
    },
  },
}

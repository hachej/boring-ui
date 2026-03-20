import { rewriteLoopbackForRemoteClient } from '../../utils/loopbackRewrite'
import { getWorkspaceIdFromPathname } from '../../utils/controlPlane'

const normalizeBase = (value) => String(value || '').trim().replace(/\/+$/, '')

const getWorkspaceScopedPiUrl = () => {
  if (typeof window === 'undefined') return ''
  const workspaceId = getWorkspaceIdFromPathname(window.location.pathname)
  return workspaceId ? `${window.location.origin}/w/${workspaceId}` : ''
}

export function resolvePiServiceUrl(rawUrl) {
  const normalized = normalizeBase(rawUrl)
  if (!normalized) return ''

  let absolute = normalized
  if (absolute.startsWith('/') && typeof window !== 'undefined') {
    absolute = `${window.location.origin}${absolute}`
  }

  return rewriteLoopbackForRemoteClient(absolute)
}

export function isPiBackendMode(capabilities) {
  const serviceMode = String(capabilities?.services?.pi?.mode || '').toLowerCase()
  if (serviceMode === 'backend') return true
  return Boolean(resolvePiServiceUrl(import.meta.env.VITE_PI_SERVICE_URL || ''))
}

export function getPiServiceUrl(capabilities) {
  const fromCapabilities = resolvePiServiceUrl(capabilities?.services?.pi?.url || '')
  if (fromCapabilities) return fromCapabilities
  if (isPiBackendMode(capabilities)) {
    const fromWorkspacePath = getWorkspaceScopedPiUrl()
    if (fromWorkspacePath) return fromWorkspacePath
  }
  return resolvePiServiceUrl(import.meta.env.VITE_PI_SERVICE_URL || '')
}

import { isLoopbackHost, rewriteLoopbackForRemoteClient } from './loopbackRewrite'

const normalizeBase = (value) => (value ? value.replace(/\/$/, '') : '')

const toSearchParams = (query) => {
  if (!query) return ''
  if (query instanceof URLSearchParams) {
    const value = query.toString()
    return value ? `?${value}` : ''
  }

  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined && entry !== null) params.append(key, String(entry))
      })
      return
    }
    params.set(key, String(value))
  })

  const value = params.toString()
  return value ? `?${value}` : ''
}

const isDevPort = (port) => {
  const devPorts = new Set(['3000', '3001', '4173', '4174', '5173', '5174', '5175', '5176', '5180', '5190'])
  return devPorts.has(port)
}

const getWorkspaceBasePath = (pathname = '') => {
  const match = String(pathname || '').match(/^\/w\/[^/]+/)
  return match ? match[0] : ''
}

const resolveApiBase = () => {
  const envUrl = import.meta.env.VITE_API_URL || ''
  if (envUrl) return normalizeBase(rewriteLoopbackForRemoteClient(normalizeBase(envUrl)))

  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port, origin, pathname } = window.location
    if (origin) {
      const workspaceBase = getWorkspaceBasePath(pathname)
      return workspaceBase ? `${origin}${workspaceBase}` : origin
    }
  }

  return 'http://localhost:8000'
}

export const getApiBase = () => resolveApiBase()

export const buildApiUrl = (path, query) => `${getApiBase()}${path}${toSearchParams(query)}`

export const getWsBase = () => {
  const apiBase = getApiBase()
  const url = new URL(apiBase)
  const protocol = url.protocol === 'https:' ? 'wss' : 'ws'
  const basePath = url.pathname && url.pathname !== '/'
    ? url.pathname.replace(/\/+$/, '')
    : ''
  return `${protocol}://${url.host}${basePath}`
}

export const buildWsUrl = (path, query) => `${getWsBase()}${path}${toSearchParams(query)}`

export const __apiBaseTestUtils = {
  isDevPort,
  isLoopbackHost,
  rewriteLoopbackForRemoteClient,
  toSearchParams,
  getWorkspaceBasePath,
}

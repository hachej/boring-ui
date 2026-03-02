import { isLoopbackHost, rewriteLoopbackForRemoteClient } from '../../utils/loopbackRewrite'

let _baseUrl = ''
let _authToken = ''

export function setCompanionConfig(baseUrl, authToken) {
  let normalized = String(baseUrl || '').trim()
  if (normalized.startsWith('/') && typeof window !== 'undefined') {
    normalized = `${window.location.origin}${normalized}`
  }
  normalized = normalized.replace(/\/+$/, '')
  if (normalized && typeof window !== 'undefined') {
    try {
      const parsed = new URL(normalized, window.location.origin)
      // Remote browsers cannot reach loopback ports exposed inside a sandbox.
      // Normalize loopback companion URLs to same-origin and let routing pick
      // up the workspace-scoped /api/v1/agent/companion path.
      if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(window.location.hostname)) {
        normalized = window.location.origin
      } else {
        normalized = rewriteLoopbackForRemoteClient(parsed.toString())
      }
    } catch {
      normalized = rewriteLoopbackForRemoteClient(normalized)
    }
  } else {
    normalized = rewriteLoopbackForRemoteClient(normalized)
  }
  _baseUrl = normalized
  _authToken = String(authToken || '').trim()
}

export function getCompanionBaseUrl() {
  return _baseUrl
}

export function getCompanionAuthToken() {
  return _authToken
}

export function getAuthHeaders() {
  if (!_authToken) return {}
  return { Authorization: `Bearer ${_authToken}` }
}

export const __companionConfigTestUtils = {
  isLoopbackHost,
  rewriteLoopbackForRemoteClient,
}

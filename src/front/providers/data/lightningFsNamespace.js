const FALLBACK_BASE_NAME = 'boring-fs'
const NAMESPACE_VERSION = 'v2'
const DEFAULT_ORIGIN_SCOPE = 'local'
const DEFAULT_WORKSPACE_SCOPE = 'workspace-default'
const DEFAULT_ANON_SCOPE = 'anon'
const DEFAULT_SESSION_SCOPE = 'session'

const normalizeToken = (value, fallback = '') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

const normalizeBaseName = (value) => {
  const base = normalizeToken(value, FALLBACK_BASE_NAME)
  return base.slice(0, 32) || FALLBACK_BASE_NAME
}

const hashFnv1a = (value) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = (
      hash
      + (hash << 1)
      + (hash << 4)
      + (hash << 7)
      + (hash << 8)
      + (hash << 24)
    ) >>> 0
  }
  return hash.toString(36)
}

export const resolveLightningFsUserScope = ({
  userId,
  userEmail,
  authStatus,
  sessionScope,
} = {}) => {
  const session = normalizeToken(sessionScope, DEFAULT_SESSION_SCOPE)
  const id = normalizeToken(userId)
  if (id) return `u-${id}`

  const email = normalizeToken(userEmail)
  if (email) return `e-${email}`

  const status = String(authStatus || '').trim().toLowerCase()
  if (status === 'authenticated') {
    return `auth-${session}`
  }
  if (status === 'unauthenticated') {
    return `${DEFAULT_ANON_SCOPE}-${session}`
  }
  return `pending-${session}`
}

export const resolveLightningFsWorkspaceScope = (workspaceId) =>
  normalizeToken(workspaceId, DEFAULT_WORKSPACE_SCOPE)

export const buildLightningFsNamespace = ({
  baseName,
  origin,
  userScope,
  workspaceScope,
} = {}) => {
  const base = normalizeBaseName(baseName)
  const normalizedOrigin = normalizeToken(origin, DEFAULT_ORIGIN_SCOPE)
  const normalizedUserScope = normalizeToken(userScope, DEFAULT_ANON_SCOPE)
  const normalizedWorkspaceScope = normalizeToken(workspaceScope, DEFAULT_WORKSPACE_SCOPE)
  const digest = hashFnv1a([
    NAMESPACE_VERSION,
    normalizedOrigin,
    normalizedUserScope,
    normalizedWorkspaceScope,
  ].join('|'))
  return `${base}-${NAMESPACE_VERSION}-${digest}`
}

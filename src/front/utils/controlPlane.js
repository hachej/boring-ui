const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const getFirstString = (...values) => {
  const entry = values.find((value) => typeof value === 'string' && value.trim().length > 0)
  return entry ? entry.trim() : ''
}

const toWorkspaceRecord = (value) => {
  if (!isRecord(value)) return null
  const id = getFirstString(value.id, value.workspace_id, value.workspaceId)
  if (!id) return null

  return {
    id,
    name: getFirstString(value.name, value.workspace_name, value.workspaceName),
  }
}

const listCandidates = (payload) => {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.workspaces)) return payload.workspaces
  if (Array.isArray(payload.items)) return payload.items
  if (isRecord(payload.data)) return listCandidates(payload.data)
  return []
}

export const normalizeWorkspaceList = (payload) => {
  const seen = new Set()
  const records = []

  listCandidates(payload).forEach((entry) => {
    const workspace = toWorkspaceRecord(entry)
    if (!workspace || seen.has(workspace.id)) return
    seen.add(workspace.id)
    records.push(workspace)
  })

  return records
}

export const extractWorkspaceId = (payload) => {
  const direct = toWorkspaceRecord(payload)
  if (direct?.id) return direct.id

  if (isRecord(payload)) {
    const nested = toWorkspaceRecord(payload.workspace) || toWorkspaceRecord(payload.data)
    if (nested?.id) return nested.id
  }

  return normalizeWorkspaceList(payload)[0]?.id || ''
}

export const extractUserEmail = (payload) => {
  if (!isRecord(payload)) return ''
  return getFirstString(
    payload.email,
    payload.user_email,
    payload.userEmail,
    payload.user?.email,
    payload.me?.email,
    payload.data?.email,
  )
}

export const extractUserId = (payload) => {
  if (!isRecord(payload)) return ''
  return getFirstString(
    payload.user_id,
    payload.userId,
    payload.id,
    payload.user?.user_id,
    payload.user?.userId,
    payload.user?.id,
    payload.me?.user_id,
    payload.me?.userId,
    payload.me?.id,
    payload.data?.user_id,
    payload.data?.userId,
    payload.data?.id,
  )
}

export const getWorkspaceIdFromPathname = (pathname = '') => {
  const match = String(pathname).match(/^\/w\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export const getWorkspacePathSuffix = (pathname = '') => {
  const match = String(pathname).match(/^\/w\/[^/]+\/?(.*)$/)
  return match ? match[1] || '' : ''
}

export const getRuntimeStatus = (payload) => {
  if (!isRecord(payload)) return ''
  const value = getFirstString(
    payload.status,
    payload.state,
    payload.runtime_status,
    payload.runtime?.status,
    payload.runtime?.state,
    payload.data?.status,
    payload.data?.state,
  )
  return value.toLowerCase()
}

export const shouldRetryRuntime = (payload) => {
  if (!isRecord(payload)) return false

  if (payload.retryable === true || payload.runtime?.retryable === true) {
    return true
  }

  const status = getRuntimeStatus(payload)
  return status === 'failed' || status === 'error'
}

export const isRuntimeReady = (payload) => {
  const status = getRuntimeStatus(payload)
  return status === 'ready' || status === 'running' || status === 'active'
}

export const extractWorkspaceSettingsPayload = (payload) => {
  if (isRecord(payload?.settings)) return payload.settings
  if (isRecord(payload?.workspace_settings)) return payload.workspace_settings
  if (isRecord(payload?.data?.settings)) return payload.data.settings
  if (isRecord(payload?.data?.workspace_settings)) return payload.data.workspace_settings
  return {}
}

export const runWithPreflightFallback = async ({
  run,
  fallbackRoute,
  warningMessage,
}) => {
  try {
    return await run()
  } catch (error) {
    console.warn(warningMessage, error)
    return fallbackRoute
  }
}

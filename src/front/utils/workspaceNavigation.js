import { routes } from './routes'
import {
  extractWorkspaceSettingsPayload,
  getWorkspacePathSuffix,
  shouldRetryRuntime,
} from './controlPlane'

export const syncWorkspaceRuntimeAndSettings = async ({
  workspaceId,
  writeSettings = false,
  apiFetchJson,
  apiFetch,
}) => {
  const runtimeRoute = routes.controlPlane.workspaces.runtime.get(workspaceId)
  const { response: runtimeResponse, data: runtimeData } = await apiFetchJson(runtimeRoute.path, {
    query: runtimeRoute.query,
  })
  let runtimePayload = runtimeResponse.ok ? runtimeData : null

  if (runtimeResponse.ok && shouldRetryRuntime(runtimeData)) {
    const retryRoute = routes.controlPlane.workspaces.runtime.retry(workspaceId)
    await apiFetch(retryRoute.path, { query: retryRoute.query, method: 'POST' })
    const retriedRuntime = await apiFetchJson(runtimeRoute.path, { query: runtimeRoute.query })
    if (retriedRuntime.response.ok) {
      runtimePayload = retriedRuntime.data
    }
  }

  const settingsReadRoute = routes.controlPlane.workspaces.settings.get(workspaceId)
  const { response: settingsResponse, data: settingsData } = await apiFetchJson(
    settingsReadRoute.path,
    { query: settingsReadRoute.query },
  )
  if (writeSettings && settingsResponse.ok) {
    const settingsWriteRoute = routes.controlPlane.workspaces.settings.update(workspaceId)
    await apiFetch(settingsWriteRoute.path, {
      query: settingsWriteRoute.query,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(extractWorkspaceSettingsPayload(settingsData)),
    })
  }

  return { runtimePayload }
}

export const resolveWorkspaceNavigationRoute = ({
  workspaceId,
  runtimePayload: _runtimePayload,
  currentWorkspacePathSuffix = '',
  onboardingEnabled: _onboardingEnabled = true,
}) => {
  return routes.controlPlane.workspaces.scope(workspaceId, currentWorkspacePathSuffix)
}

// Derive suffix from the live URL pathname to avoid boot-race/stale-state issues
// when the App's path context effect hasn't run yet.
export const resolveWorkspaceNavigationRouteFromPathname = ({
  workspaceId,
  runtimePayload,
  pathname = '',
  onboardingEnabled,
}) => {
  return resolveWorkspaceNavigationRoute({
    workspaceId,
    runtimePayload,
    currentWorkspacePathSuffix: getWorkspacePathSuffix(pathname),
    onboardingEnabled,
  })
}

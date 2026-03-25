import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, apiFetchJson } from '../utils/transport'
import { getStorageKey } from '../layout'
import { routeHref, routes } from '../utils/routes'
import {
  extractWorkspaceId,
  getWorkspaceIdFromPathname,
  getWorkspacePathSuffix,
  runWithPreflightFallback,
} from '../utils/controlPlane'
import {
  resolveWorkspaceNavigationRouteFromPathname,
  syncWorkspaceRuntimeAndSettings,
} from '../utils/workspaceNavigation'
import {
  buildSwitchPrompt,
  getWorkspaceSwitchCandidates,
  resolveWorkspaceSwitchTarget,
} from '../utils/workspaceSwitch'

const readLocationState = () => ({
  pathname: window.location.pathname,
  search: window.location.search,
})

export default function useWorkspaceRouter({
  workspaceOptions = [],
  workspaceListStatus = 'idle',
  fetchWorkspaceList,
  userMenuAuthStatus = 'unknown',
  storagePrefix = '',
  projectRoot = '',
  controlPlaneOnboardingEnabled = false,
  backendWorkspaceRuntimeEnabled = false,
  controlPlaneEnabled = false,
  assign = (href) => window.location.assign(href),
  replaceRoute = (path) => window.history.replaceState(null, '', path),
  promptForWorkspace = (message, defaultValue) => window.prompt(message, defaultValue),
} = {}) {
  const [locationState, setLocationState] = useState(readLocationState)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() =>
    getWorkspaceIdFromPathname(window.location.pathname),
  )
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false)
  const autoCreateAttempted = useRef(false)

  const syncWorkspacePathContext = useCallback(() => {
    const nextLocation = readLocationState()
    setLocationState((prev) => (
      prev.pathname === nextLocation.pathname && prev.search === nextLocation.search
        ? prev
        : nextLocation
    ))
    const nextWorkspaceId = getWorkspaceIdFromPathname(nextLocation.pathname)
    setCurrentWorkspaceId((prev) => (prev === nextWorkspaceId ? prev : nextWorkspaceId))
  }, [])

  useEffect(() => {
    syncWorkspacePathContext()
    window.addEventListener('popstate', syncWorkspacePathContext)
    return () => {
      window.removeEventListener('popstate', syncWorkspacePathContext)
    }
  }, [syncWorkspacePathContext])

  const pagePathname = locationState.pathname
  const pageSearchParams = useMemo(
    () => new URLSearchParams(locationState.search),
    [locationState.search],
  )
  const workspaceSubpath = useMemo(
    () => getWorkspacePathSuffix(pagePathname),
    [pagePathname],
  )
  const isUserSettingsPage = pagePathname === '/auth/settings'
  const isAuthLoginPage = pagePathname === '/auth/login'
    || pagePathname === '/auth/signup'
    || pagePathname === '/auth/reset-password'
  const isAuthCallbackPage = pagePathname === '/auth/callback'
  const isWorkspaceSettingsPage = Boolean(currentWorkspaceId) && workspaceSubpath === 'settings'
  const userSettingsWorkspaceId = String(pageSearchParams.get('workspace_id') || '').trim()
  const isWorkspaceSetupPage = Boolean(currentWorkspaceId) && workspaceSubpath === 'setup'

  const activeWorkspaceName = useMemo(() => {
    const match = workspaceOptions.find((workspace) => workspace.id === currentWorkspaceId)
    if (match?.name) return match.name
    if (!currentWorkspaceId && projectRoot) {
      return projectRoot.split('/').filter(Boolean).pop() || ''
    }
    return ''
  }, [workspaceOptions, currentWorkspaceId, projectRoot])

  const userMenuCanSwitchWorkspace = useMemo(() => {
    if (!currentWorkspaceId) return false
    return workspaceOptions.some(
      (workspace) => workspace?.id && workspace.id !== currentWorkspaceId,
    )
  }, [workspaceOptions, currentWorkspaceId])

  const handleCreateWorkspace = useCallback(() => {
    setShowCreateWorkspaceModal(true)
  }, [])

  const handleCreateWorkspaceSubmit = useCallback(async (name) => {
    const createRoute = routes.controlPlane.workspaces.create()
    const { response, data } = await apiFetchJson(createRoute.path, {
      query: createRoute.query,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) {
      throw new Error(data?.message || 'Failed to create workspace')
    }

    const createdWorkspaceId = extractWorkspaceId(data)
    if (!createdWorkspaceId) {
      throw new Error('No workspace ID returned')
    }

    await fetchWorkspaceList()
    setShowCreateWorkspaceModal(false)

    if (!controlPlaneOnboardingEnabled && !backendWorkspaceRuntimeEnabled) {
      const route = routes.controlPlane.workspaces.scope(
        createdWorkspaceId,
        getWorkspacePathSuffix(window.location.pathname),
      )
      assign(routeHref(route))
      return
    }

    assign(routeHref(routes.controlPlane.workspaces.setup(createdWorkspaceId)))
  }, [
    assign,
    backendWorkspaceRuntimeEnabled,
    controlPlaneOnboardingEnabled,
    fetchWorkspaceList,
  ])

  const handleSwitchWorkspace = useCallback(async () => {
    const workspaces = await fetchWorkspaceList()
    const candidateWorkspaces = getWorkspaceSwitchCandidates(workspaces, currentWorkspaceId)
    if (candidateWorkspaces.length === 0) return

    const prompt = buildSwitchPrompt(candidateWorkspaces)
    if (!prompt) return
    const promptValue = promptForWorkspace(prompt.message, prompt.defaultValue)

    const selectedWorkspace = resolveWorkspaceSwitchTarget(
      candidateWorkspaces,
      currentWorkspaceId,
      promptValue,
    )
    if (!selectedWorkspace) return
    const targetWorkspaceId = selectedWorkspace.id

    if (!controlPlaneOnboardingEnabled) {
      const route = routes.controlPlane.workspaces.scope(
        targetWorkspaceId,
        getWorkspacePathSuffix(window.location.pathname),
      )
      assign(routeHref(route))
      return
    }

    const route = await runWithPreflightFallback({
      run: async () => {
        const { runtimePayload } = await syncWorkspaceRuntimeAndSettings({
          workspaceId: targetWorkspaceId,
          writeSettings: false,
          apiFetchJson,
          apiFetch,
        })
        return resolveWorkspaceNavigationRouteFromPathname({
          workspaceId: targetWorkspaceId,
          runtimePayload,
          pathname: window.location.pathname,
        })
      },
      fallbackRoute: routes.controlPlane.workspaces.scope(
        targetWorkspaceId,
        getWorkspacePathSuffix(window.location.pathname),
      ),
      warningMessage: '[UserMenu] Switch workspace preflight failed:',
    })
    assign(routeHref(route))
  }, [
    assign,
    controlPlaneOnboardingEnabled,
    currentWorkspaceId,
    fetchWorkspaceList,
    promptForWorkspace,
  ])

  const handleOpenUserSettings = useCallback(() => {
    if (userMenuAuthStatus === 'unauthenticated') {
      const route = routes.controlPlane.auth.login(
        `${window.location.pathname}${window.location.search || ''}`,
      )
      assign(routeHref(route))
      return
    }

    const key = getStorageKey(storagePrefix, projectRoot, 'user-settings-intent')
    const detail = {
      source: 'sidebar-user-menu',
      workspace_id: currentWorkspaceId || null,
      timestamp: Date.now(),
    }
    try {
      localStorage.setItem(key, JSON.stringify(detail))
    } catch {
      // ignore storage errors for local-only settings intent
    }
    window.dispatchEvent(new CustomEvent('boring-ui:user-settings-open', { detail }))
    assign(routeHref(routes.controlPlane.auth.settings(currentWorkspaceId || undefined)))
  }, [assign, currentWorkspaceId, projectRoot, storagePrefix, userMenuAuthStatus])

  const handleOpenWorkspaceSettings = useCallback(() => {
    if (!currentWorkspaceId) return
    assign(routes.controlPlane.workspaces.scope(currentWorkspaceId, 'settings').path)
  }, [assign, currentWorkspaceId])

  useEffect(() => {
    const needsWorkspaceRedirect = (
      controlPlaneEnabled
      && userMenuAuthStatus === 'authenticated'
      && !currentWorkspaceId
      && pagePathname === '/'
    )
    if (!needsWorkspaceRedirect) return
    if (workspaceListStatus !== 'success' && workspaceListStatus !== 'error') return
    if (workspaceListStatus === 'error') return

    if (workspaceOptions.length > 0) {
      const firstWs = workspaceOptions[0]
      const route = routes.controlPlane.workspaces.scope(firstWs.id)
      replaceRoute(route.path)
      syncWorkspacePathContext()
      return
    }

    if (autoCreateAttempted.current) return
    autoCreateAttempted.current = true
    handleCreateWorkspaceSubmit('My Workspace').catch(() => {
      setShowCreateWorkspaceModal(true)
    })
  }, [
    controlPlaneEnabled,
    currentWorkspaceId,
    handleCreateWorkspaceSubmit,
    pagePathname,
    replaceRoute,
    syncWorkspacePathContext,
    userMenuAuthStatus,
    workspaceListStatus,
    workspaceOptions,
  ])

  return {
    currentWorkspaceId,
    pagePathname,
    isUserSettingsPage,
    isAuthLoginPage,
    isAuthCallbackPage,
    isWorkspaceSettingsPage,
    userSettingsWorkspaceId,
    isWorkspaceSetupPage,
    activeWorkspaceName,
    userMenuCanSwitchWorkspace,
    showCreateWorkspaceModal,
    setShowCreateWorkspaceModal,
    handleSwitchWorkspace,
    handleCreateWorkspace,
    handleCreateWorkspaceSubmit,
    handleOpenUserSettings,
    handleOpenWorkspaceSettings,
  }
}

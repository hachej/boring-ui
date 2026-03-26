import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { DockviewReact } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'

import { ThemeProvider, useCapabilities, useKeyboardShortcuts, UNKNOWN_CAPABILITIES } from './hooks'
import { TooltipProvider } from './components/ui/tooltip'
import useApprovalPolling from './hooks/useApprovalPolling'
import useDataProviderScope from './hooks/useDataProviderScope'
import useFrontendStatePersist from './hooks/useFrontendStatePersist'
import useDockLayout from './hooks/useDockLayout'
import usePanelActions from './hooks/usePanelActions'
import useWorkspaceAuth from './hooks/useWorkspaceAuth'
import useWorkspaceRouter from './hooks/useWorkspaceRouter'
import { useWorkspacePlugins } from './hooks/useWorkspacePlugins'
import { loadWorkspacePanes } from './workspace/loader'
import { useConfig } from './config'
import { apiFetchJson } from './utils/transport'
import { routeHref, routes } from './utils/routes'
import {
  LAYOUT_VERSION,
  validateLayoutStructure,
  loadSavedTabs,
  saveTabs,
  loadLayout,
  saveLayout,
  saveCollapsedState,
  savePanelSizes,
  pruneEmptyGroups,
  getStorageKey,
  getFileName,
} from './layout'
import { debounce } from './utils/debounce'
import {
  isCenterContentPanel,
  listDockPanels,
  listDockGroups,
  getPanelComponent,
  countAllAgentPanels,
} from './utils/dockHelpers'
import {
  arePlainObjectsEqual,
  getPanelSizeConfigValue,
  readPersistedCollapsedState,
  readPersistedPanelSizes,
} from './utils/panelConfig'
import ThemeToggle from './components/ThemeToggle'
import Tooltip from './components/Tooltip'
import WorkspaceLoading from './components/WorkspaceLoading'
import {
  CapabilitiesContext,
  CapabilitiesStatusContext,
  createCapabilityGatedPane,
} from './components/CapabilityGate'
import { UserIdentityProvider } from './components/UserIdentityContext'
import paneRegistry, {
  registerPane,
  getGatedComponents,
  getKnownComponents,
  getUnavailableEssentialPanes,
} from './registry/panes'
import { QueryClientProvider } from '@tanstack/react-query'
import DataContext from './providers/data/DataContext'
import { PI_OPEN_FILE_BRIDGE } from './providers/pi/uiBridge'
import UserSettingsPage from './pages/UserSettingsPage'
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage'
import WorkspaceSetupPage from './pages/WorkspaceSetupPage'
import AuthPage, { AuthCallbackPage } from './pages/AuthPage'
import CreateWorkspaceModal from './pages/CreateWorkspaceModal'
import { UnifiedDockTab, tabComponents } from './components/DockTab'
import {
  normalizeMarkdownEditorPanels,
  normalizeMarkdownPane,
} from './utils/editorFiles'

const MAIN_CONTENT_ID = 'workspace-main-content'
// Get capability-gated components from pane registry
// Components with requiresFeatures/requiresRouters will show error states when unavailable
const getLiveKnownComponents = () => getKnownComponents()

export default function App() {
  // Get config (defaults are used until async load completes)
  const config = useConfig()
  const codeSessionsEnabled = config.features?.codeSessions !== false
  const urlAgentMode = new URLSearchParams(window.location.search).get('agent_mode')
  const configAgentMode = String(config.agents?.mode || 'frontend').toLowerCase()
  const validAgentModes = ['frontend', 'backend']
  const fallbackAgentMode = validAgentModes.includes(configAgentMode) ? configAgentMode : 'frontend'
  const agentMode = validAgentModes.includes(urlAgentMode)
    ? urlAgentMode
    : fallbackAgentMode
  const nativeAgentEnabled = codeSessionsEnabled
  const localDataBackend = String(config.data?.backend || '').toLowerCase()
  const hasLocalDataBackend = localDataBackend === 'lightningfs'
  const baseStoragePrefix = config.storage?.prefix || 'kurt-web'
  const layoutVersion = config.storage?.layoutVersion || 1
  const markdownPane = normalizeMarkdownPane(config.editors?.markdownPane)

  // Panel sizing configuration from config
  const panelDefaults = config.panels?.defaults || { filetree: 280, terminal: 400, agent: 400, shell: 250 }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback object is stable across renders when config is unchanged
  const panelMin = config.panels?.min || { filetree: 180, terminal: 250, agent: 250, shell: 100, center: 200 }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback object is stable across renders when config is unchanged
  const panelCollapsed = config.panels?.collapsed || { filetree: 48, terminal: 48, agent: 48, shell: 36 }
  const rightRailDefaults = {
    agent:
      Number.isFinite(panelDefaults.agent) ? panelDefaults.agent : panelDefaults.terminal,
    agentMin:
      Number.isFinite(panelMin.agent) ? panelMin.agent : panelMin.terminal,
    agentCollapsed:
      Number.isFinite(panelCollapsed.agent) ? panelCollapsed.agent : panelCollapsed.terminal,
  }
  const leftSidebarPanelIds = useMemo(() => {
    const configured = config.panels?.leftSidebarPanels
    if (!Array.isArray(configured) || configured.length === 0) {
      return ['filetree']
    }
    const unique = []
    configured.forEach((id) => {
      if (typeof id !== 'string' || id.length === 0 || unique.includes(id)) return
      unique.push(id)
    })
    return unique.length > 0 ? unique : ['filetree']
  }, [config.panels?.leftSidebarPanels])
  const leftSidebarCollapsedWidth = useMemo(() => {
    const widths = leftSidebarPanelIds
      .map((panelId) => getPanelSizeConfigValue(panelCollapsed, panelId, 'filetree'))
      .filter((value) => Number.isFinite(value))
    if (widths.length === 0) return panelCollapsed.filetree ?? 48
    return Math.max(...widths)
  }, [leftSidebarPanelIds, panelCollapsed])
  const leftSidebarMinWidth = useMemo(() => {
    const widths = leftSidebarPanelIds
      .map((panelId) => getPanelSizeConfigValue(panelMin, panelId, 'filetree'))
      .filter((value) => Number.isFinite(value))
    if (widths.length === 0) return panelMin.filetree ?? 180
    return Math.max(...widths)
  }, [leftSidebarPanelIds, panelMin])

  // Fetch backend capabilities for feature gating.
  // config.capabilities provides static overrides for browser-only mode
  // (no server). When present, server-fetched capabilities are merged on top.
  const staticCapabilities = config.capabilities || null
  const { capabilities: serverCapabilities, loading: capabilitiesLoading, refetch: refetchCapabilities } = useCapabilities({
    rootScoped: true,
  })
  const capabilities = useMemo(() => {
    if (!staticCapabilities) {
      const featureCount = Object.keys(serverCapabilities?.features || {}).length
      // In core/local mode, capability fetch can be unavailable. Infer minimal
      // local capabilities so PI rail and local data backends still render.
      if (serverCapabilities?.version === 'unknown' && featureCount === 0) {
        return {
          version: 'inferred-local',
          features: {
            files: hasLocalDataBackend,
            git: hasLocalDataBackend,
            pi: true,
            chat_claude_code: nativeAgentEnabled,
          },
          routers: [],
        }
      }
      return serverCapabilities
    }
    if (!serverCapabilities || serverCapabilities.version === 'unknown') {
      return {
        version: staticCapabilities.version || 'static',
        features: { ...staticCapabilities.features },
        routers: staticCapabilities.routers || [],
        ...(staticCapabilities.macro_catalog ? { macro_catalog: staticCapabilities.macro_catalog } : {}),
      }
    }
    return {
      ...serverCapabilities,
      features: { ...staticCapabilities.features, ...serverCapabilities.features },
    }
  }, [
    staticCapabilities,
    serverCapabilities,
    hasLocalDataBackend,
    nativeAgentEnabled,
  ])
  const controlPlaneOnboardingEnabled =
    config.features?.controlPlaneOnboarding === true ||
    capabilities?.features?.control_plane === true
  const backendWorkspaceRuntimeEnabled =
    String(capabilities?.workspace_runtime?.agent_mode || '').toLowerCase() === 'backend'
  const capabilitiesRef = useRef(capabilities)
  const capabilitiesLoadingRef = useRef(capabilitiesLoading)
  capabilitiesRef.current = capabilities
  capabilitiesLoadingRef.current = capabilitiesLoading

  // Workspace plugin components loaded dynamically
  const [workspaceComponents, setWorkspaceComponents] = useState({})
  const [workspacePanesReady, setWorkspacePanesReady] = useState(false)

  const components = useMemo(() => {
    const gated = getGatedComponents(createCapabilityGatedPane)
    return { ...gated, ...workspaceComponents }
  }, [workspaceComponents])

  const capabilitiesFeatureCount = Object.keys(capabilities?.features || {}).length
  const approvalFeatureEnabled = capabilities?.features?.approval === true
  const uiStateFeatureEnabled = capabilities?.features?.ui_state === true
  const capabilitiesPending = staticCapabilities
    ? false
    : (capabilitiesLoading
      || !capabilities
      || (
        capabilities?.version === 'unknown'
        && capabilitiesFeatureCount === 0
      ))

  // Check for unavailable essential panes
  const unavailableEssentials = !capabilitiesPending && capabilities
    ? getUnavailableEssentialPanes(capabilities)
    : []

  const [dockApi, setDockApi] = useState(null)
  const dockApiRef = useRef(null)
  dockApiRef.current = dockApi
  const [tabs, setTabs] = useState({}) // path -> { content, isDirty }
  const [projectRoot, setProjectRoot] = useState(null) // null = not loaded yet, '' = loaded but empty
  const projectRootRef = useRef(null) // Stable ref for callbacks
  // Approval polling (extracted to hook)
  const {
    approvals,
    approvalsLoaded,
    handleDecision: handleApprovalDecision,
    normalizeApprovalPath,
    getReviewTitle,
  } = useApprovalPolling({
    enabled: approvalFeatureEnabled,
    projectRoot,
  })
  const [activeFile, setActiveFile] = useState(null)
  const [activeDiffFile, setActiveDiffFile] = useState(null)
  // Auth identity + workspace list (extracted to hook)
  const {
    userId: menuUserId,
    email: menuUserEmail,
    authStatus: userMenuAuthStatus,
    identityError: userMenuIdentityError,
    workspaceError: userMenuWorkspaceError,
    workspaces: workspaceOptions,
    workspaceListStatus,
    storagePrefix,
    fetchWorkspaces: fetchWorkspaceList,
    retryData: handleUserMenuRetry,
    logout: handleLogout,
  } = useWorkspaceAuth({ baseStoragePrefix })
  const {
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
  } = useWorkspaceRouter({
    workspaceOptions,
    workspaceListStatus,
    fetchWorkspaceList,
    userMenuAuthStatus,
    storagePrefix,
    projectRoot,
    controlPlaneOnboardingEnabled,
    backendWorkspaceRuntimeEnabled,
    controlPlaneEnabled: capabilities?.features?.control_plane === true,
  })
  const [collapsed, setCollapsed] = useState(() => (
    readPersistedCollapsedState(storagePrefix, baseStoragePrefix)
  ))
  const [layoutChromeHydratedPrefix, setLayoutChromeHydratedPrefix] = useState(storagePrefix)
  const sidebarToggleHostId = useMemo(() => {
    const hasFiletree = leftSidebarPanelIds.includes('filetree')
    if (collapsed.filetree && hasFiletree) return 'filetree'
    return leftSidebarPanelIds[0] || 'filetree'
  }, [collapsed.filetree, leftSidebarPanelIds])
  const panelSizesRef = useRef(
    readPersistedPanelSizes(
      storagePrefix,
      baseStoragePrefix,
      panelDefaults,
      rightRailDefaults.agent,
    ),
  )
  const collapsedEffectRan = useRef(false)
  // dismissedApprovalsRef moved into useApprovalPolling hook
  const centerGroupRef = useRef(null)
  const isInitialized = useRef(false)
  const layoutRestored = useRef(false)
  const ensureCorePanelsRef = useRef(null)
  const suppressPendingLayoutRestoreRef = useRef(false)
  const hasRestoredFromUrl = useRef(false)
  // Frontend state refs (managed by hook — clientId generation + reset on prefix change)
  const {
    publish: persistFrontendState,
    clientIdRef: frontendStateClientIdRef,
    unavailableRef: frontendStateUnavailableRef,
  } = useFrontendStatePersist({
    enabled: uiStateFeatureEnabled,
    storagePrefix,
  })
  const frontendCommandUnavailableRef = useRef(false)
  const storagePrefixRef = useRef(storagePrefix) // Stable ref for callbacks
  storagePrefixRef.current = storagePrefix
  const layoutVersionRef = useRef(layoutVersion) // Stable ref for callbacks
  layoutVersionRef.current = layoutVersion
  projectRootRef.current = projectRoot

  // clientIdRef is now initialized by useFrontendStatePersist hook

  // --- DataProvider infrastructure ---
  // If setDataProvider() was called before mount (poc1/poc2), use that;
  // otherwise resolve from config.data.backend (with HTTP fallback).
  const {
    configuredDataBackend,
    dataProviderScopeKey,
    queryClient,
    dataProvider,
  } = useDataProviderScope({
    config,
    storagePrefix,
    currentWorkspaceId,
    menuUserId,
    menuUserEmail,
    userMenuAuthStatus,
  })
  const userIdentityAuthResolved = userMenuAuthStatus !== 'unknown'
  const layoutPersistenceReady = (
    userIdentityAuthResolved
    && layoutChromeHydratedPrefix === storagePrefix
  )
  const userIdentity = useMemo(
    () => ({ userId: menuUserId, authResolved: userIdentityAuthResolved }),
    [menuUserId, userIdentityAuthResolved],
  )

  useEffect(() => {
    // clientIdRef and unavailableRef reset is handled by useFrontendStatePersist hook
    frontendCommandUnavailableRef.current = false
  }, [storagePrefix])

  useEffect(() => {
    const nextCollapsed = readPersistedCollapsedState(storagePrefix)
    const nextPanelSizes = readPersistedPanelSizes(storagePrefix)
    panelSizesRef.current = nextPanelSizes
    setCollapsed((prev) => (
      arePlainObjectsEqual(prev, nextCollapsed)
        ? prev
        : nextCollapsed
    ))
    setLayoutChromeHydratedPrefix(storagePrefix)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- outer-scope functions are stable; intentionally run only on storagePrefix change
  }, [storagePrefix, readPersistedCollapsedState, readPersistedPanelSizes])

  const publishFrontendState = useCallback((api, options = {}) => {
    return persistFrontendState(api || dockApi, {
      ...options,
      projectRoot: options.projectRoot ?? projectRootRef.current ?? '',
    })
  }, [dockApi, persistFrontendState])

  useEffect(() => {
    if (!dockApi || projectRoot === null || !uiStateFeatureEnabled) return
    void publishFrontendState(dockApi, { force: true })
  }, [dockApi, projectRoot, publishFrontendState, uiStateFeatureEnabled])

  // Refs for panel config (used in callbacks)
  const panelCollapsedRef = useRef({ ...panelCollapsed, agent: rightRailDefaults.agentCollapsed })
  panelCollapsedRef.current = { ...panelCollapsed, agent: rightRailDefaults.agentCollapsed }
  const panelMinRef = useRef({ ...panelMin, agent: rightRailDefaults.agentMin })
  panelMinRef.current = { ...panelMin, agent: rightRailDefaults.agentMin }
  const userMenuStatusMessage = userMenuIdentityError || userMenuWorkspaceError
  const userMenuStatusTone = userMenuStatusMessage ? 'error' : ''
  const userMenuDisabledActions = useMemo(() => {
    if (userMenuAuthStatus === 'unauthenticated') {
      return ['switch', 'create', 'logout']
    }
    if (userMenuWorkspaceError) {
      return ['switch']
    }
    return []
  }, [userMenuAuthStatus, userMenuWorkspaceError])

  const applyInitialSizes = (
    api,
    panelSizesRefArg,
    panelMinRefArg,
    panelCollapsedRefArg,
    collapsedState,
    registry,
  ) => {
    requestAnimationFrame(() => {
      const paneConfigs = typeof registry?.list === 'function' ? registry.list() : []
      const seenGroups = new Set()

      paneConfigs.forEach((paneConfig) => {
        const panelId = paneConfig?.id
        if (!panelId) return

        const defaultSize = panelSizesRefArg?.current?.[panelId]
        if (!Number.isFinite(defaultSize)) return

        const panel = api.getPanel(panelId)
        const group = panel?.group
        if (!group || seenGroups.has(group.id)) return
        seenGroups.add(group.id)

        const groupApi = api.getGroup(group.id)?.api
        if (!groupApi) return

        const collapsedSize = panelCollapsedRefArg?.current?.[panelId]
        const minSize = panelMinRefArg?.current?.[panelId]
        const isCollapsed = !!collapsedState?.[panelId]
        const sizeAxis = paneConfig?.placement === 'bottom' ? 'height' : 'width'

        if (isCollapsed && Number.isFinite(collapsedSize)) {
          if (sizeAxis === 'height') {
            groupApi.setConstraints({
              minimumHeight: collapsedSize,
              maximumHeight: collapsedSize,
            })
            groupApi.setSize({ height: collapsedSize })
          } else {
            groupApi.setConstraints({
              minimumWidth: collapsedSize,
              maximumWidth: collapsedSize,
            })
            groupApi.setSize({ width: collapsedSize })
          }
          return
        }

        const size = Number.isFinite(minSize)
          ? Math.max(defaultSize, minSize)
          : defaultSize
        if (sizeAxis === 'height') {
          if (Number.isFinite(minSize)) {
            groupApi.setConstraints({
              minimumHeight: minSize,
              maximumHeight: Number.MAX_SAFE_INTEGER,
            })
          }
          groupApi.setSize({ height: size })
          return
        }

        if (Number.isFinite(minSize)) {
          groupApi.setConstraints({
            minimumWidth: minSize,
            maximumWidth: Number.MAX_SAFE_INTEGER,
          })
        }
        groupApi.setSize({ width: size })
      })
    })
  }

  // DockView layout helpers (extracted to hook)
  const {
    getLeftSidebarGroups,
    getLeftSidebarAnchorPanelId,
    getLeftSidebarAnchorPosition,
    isLeftSidebarGroup,
    findCenterAnchorPanel,
    getLiveCenterGroup,
    toggleFiletree,
    toggleAgent,
    activeSidebarPanelId,
    filetreeActivityIntent,
    catalogActivityIntent,
    sectionCollapsed,
    getSidebarCollapsedHeight,
    getSidebarExpandedMinHeight,
    toggleSectionCollapse,
    activateSidebarPanel,
  } = useDockLayout({
    dockApi,
    leftSidebarPanelIds,
    collapsed,
    setCollapsed,
    panelSizesRef,
    storagePrefixRef,
    centerGroupRef,
    leftSidebarCollapsedWidth,
    panelCollapsedRef,
    sidebarToggleHostId,
    saveCollapsedState,
    savePanelSizes,
  })

  useEffect(() => {
    if (!dockApi) return
    // When sidebar is fully collapsed, the layout effect handles height.
    if (collapsed.filetree) return
    const isOnlyPanel = leftSidebarPanelIds.length <= 1
    const allSectionsCollapsed = !isOnlyPanel && leftSidebarPanelIds.every((id) => sectionCollapsed[id])
    leftSidebarPanelIds.forEach((panelId) => {
      const group = dockApi.getPanel(panelId)?.group
      if (!group) return
      const collapsedHeight = getSidebarCollapsedHeight(panelId)
      const expandedMinHeight = getSidebarExpandedMinHeight(panelId)
      if (sectionCollapsed[panelId]) {
        // Keep filetree flexible when it's the only panel OR when all sections
        // are collapsed (so margin-top:auto on the footer pushes it to bottom).
        const hasFooter = panelId === 'filetree'
        const keepFlexible = isOnlyPanel || (allSectionsCollapsed && hasFooter)
        group.api.setConstraints({
          minimumHeight: collapsedHeight,
          maximumHeight: keepFlexible ? Number.MAX_SAFE_INTEGER : collapsedHeight,
        })
        if (!keepFlexible) {
          group.api.setSize({ height: collapsedHeight })
        }
      } else {
        group.api.setConstraints({
          minimumHeight: expandedMinHeight,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
      }
    })
  }, [
    dockApi,
    leftSidebarPanelIds,
    sectionCollapsed,
    collapsed.filetree,
    getSidebarCollapsedHeight,
    getSidebarExpandedMinHeight,
  ])

  // Close active tab handler for keyboard shortcut
  const closeTab = useCallback(() => {
    if (!dockApi) return
    const activePanel = dockApi.activePanel
    // Only close editor tabs, not pinned workspace chrome.
    if (activePanel && activePanel.id.startsWith('editor-')) {
      activePanel.api.close()
    }
  }, [dockApi])

  // Toggle theme handler (dispatches event for ThemeProvider to handle)
  const toggleTheme = useCallback(() => {
    // Dispatch custom event that ThemeProvider listens to
    window.dispatchEvent(new CustomEvent('theme-toggle-request'))
  }, [])

  // Keyboard shortcuts
  const searchFiles = useCallback(() => {
    activateSidebarPanel('filetree', { mode: 'search' })
  }, [activateSidebarPanel])

  const searchCatalog = useCallback(() => {
    activateSidebarPanel('data-catalog', { mode: 'search' })
  }, [activateSidebarPanel])

  useKeyboardShortcuts({
    toggleFiletree,
    closeTab,
    toggleTheme,
    searchFiles,
    searchCatalog,
  })

  // Apply collapsed state to dockview groups
  useEffect(() => {
    if (!dockApi) return

    // On first run, only apply constraints and collapsed sizes, not expanded sizes
    // (layout restore already set the correct expanded sizes)
    const isFirstRun = !collapsedEffectRan.current
    if (isFirstRun) {
      collapsedEffectRan.current = true
    }

    const leftGroups = getLeftSidebarGroups(dockApi)
    const terminalGroups = (() => {
      const byId = new Map()
      listDockPanels(dockApi)
        .filter((panel) => getPanelComponent(panel) === 'terminal')
        .forEach((panel) => {
          if (panel?.group?.id) byId.set(panel.group.id, panel.group)
        })
      return Array.from(byId.values())
    })()
    const agentGroups = (() => {
      const byId = new Map()
      listDockPanels(dockApi)
        .filter((panel) => getPanelComponent(panel) === 'agent')
        .forEach((panel) => {
          if (panel?.group?.id) byId.set(panel.group.id, panel.group)
        })
      return Array.from(byId.values())
    })()

    if (leftGroups.length > 0) {
      const collapsedWidth = leftSidebarCollapsedWidth
      const minWidth = leftSidebarMinWidth
      if (collapsed.filetree) {
        // When sidebar is fully collapsed, give filetree all vertical space
        // and hide non-filetree panels (they render empty when collapsed).
        leftSidebarPanelIds.forEach((panelId) => {
          const group = dockApi.getPanel(panelId)?.group
          if (!group) return
          const constraints = {
            minimumWidth: collapsedWidth,
            maximumWidth: collapsedWidth,
          }
          if (leftSidebarPanelIds.length > 1 && panelId !== 'filetree') {
            constraints.minimumHeight = 0
            constraints.maximumHeight = 0
          }
          group.api.setConstraints(constraints)
          group.api.setSize({ width: collapsedWidth })
          if (leftSidebarPanelIds.length > 1 && panelId !== 'filetree') {
            group.api.setSize({ height: 0 })
          }
        })
      } else {
        // Restore width AND height constraints when expanding.
        // Height constraints must be restored because collapse sets non-filetree panels to height 0.
        const allSectionsCollapsed = leftSidebarPanelIds.length > 1
          && leftSidebarPanelIds.every((id) => sectionCollapsed[id])
        leftSidebarPanelIds.forEach((panelId) => {
          const group = dockApi.getPanel(panelId)?.group
          if (!group) return
          const constraints = {
            minimumWidth: minWidth,
            maximumWidth: Number.MAX_SAFE_INTEGER,
          }
          if (leftSidebarPanelIds.length > 1) {
            if (sectionCollapsed[panelId]) {
              const collapsedHeight = getSidebarCollapsedHeight(panelId)
              const hasFooter = panelId === 'filetree'
              const keepFlexible = allSectionsCollapsed && hasFooter
              constraints.minimumHeight = collapsedHeight
              constraints.maximumHeight = keepFlexible ? Number.MAX_SAFE_INTEGER : collapsedHeight
            } else {
              constraints.minimumHeight = getSidebarExpandedMinHeight(panelId)
              constraints.maximumHeight = Number.MAX_SAFE_INTEGER
            }
          }
          group.api.setConstraints(constraints)
        })
        // Only set size on subsequent runs (user toggled), not on initial load.
        if (!isFirstRun) {
          const expandedWidth = Math.max(panelSizesRef.current.filetree ?? minWidth, minWidth)
          leftGroups.forEach((group) => {
            group.api.setSize({ width: expandedWidth })
          })
        }
      }
    }

    terminalGroups.forEach((terminalGroup) => {
      if (collapsed.terminal) {
        terminalGroup.api.setConstraints({
          minimumWidth: panelCollapsedRef.current.terminal,
          maximumWidth: panelCollapsedRef.current.terminal,
        })
        terminalGroup.api.setSize({ width: panelCollapsedRef.current.terminal })
      } else {
        // Use Number.MAX_SAFE_INTEGER to clear max constraint and allow resizing
        terminalGroup.api.setConstraints({
          minimumWidth: panelMinRef.current.terminal,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (!isFirstRun) {
          terminalGroup.api.setSize({ width: panelSizesRef.current.terminal })
        }
      }
    })

    agentGroups.forEach((agentGroup) => {
      if (collapsed.agent) {
        agentGroup.api.setConstraints({
          minimumWidth: panelCollapsedRef.current.agent,
          maximumWidth: panelCollapsedRef.current.agent,
        })
        agentGroup.api.setSize({ width: panelCollapsedRef.current.agent })
      } else {
        agentGroup.api.setConstraints({
          minimumWidth: panelMinRef.current.agent,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (!isFirstRun) {
          agentGroup.api.setSize({ width: panelSizesRef.current.agent })
        }
      }
    })

    const shellPanel = dockApi.getPanel('shell')
    const shellGroup = shellPanel?.group

    // Apply constraints to shell group
    if (shellGroup) {
      if (collapsed.shell) {
        shellGroup.api.setConstraints({
          minimumHeight: panelCollapsedRef.current.shell,
          maximumHeight: panelCollapsedRef.current.shell,
        })
        shellGroup.api.setSize({ height: panelCollapsedRef.current.shell })
      } else {
        // Clear height constraints to allow resizing (use Number.MAX_SAFE_INTEGER as open-ended max)
        shellGroup.api.setConstraints({
          minimumHeight: panelMinRef.current.shell,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
        // Only set size on subsequent runs (user toggled), not on initial load
        if (!isFirstRun) {
          // Ensure saved size respects minimum constraint
          const savedHeight = panelSizesRef.current.shell
          const minHeight = panelMinRef.current.shell
          shellGroup.api.setSize({ height: Math.max(savedHeight, minHeight) })
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally limited deps to avoid re-running layout logic on every config change
  }, [dockApi, collapsed, getLeftSidebarGroups, leftSidebarCollapsedWidth, leftSidebarMinWidth])

  // Git status polling removed - not currently used in UI

  // Approval polling, decision handling, and path normalization
  // are now in useApprovalPolling hook (see hooks/useApprovalPolling.js).
  // The hook returns: approvals, approvalsLoaded, handleApprovalDecision,
  // normalizeApprovalPath, getReviewTitle.

  // Wrap handleApprovalDecision to inject dockApi
  const handleDecision = useCallback(
    (requestId, decision, reason) =>
      handleApprovalDecision(requestId, decision, reason, dockApi),
    [handleApprovalDecision, dockApi],
  )

  // isLeftSidebarGroup, findCenterAnchorPanel, getLiveCenterGroup
  // are now provided by useDockLayout hook above.

  const {
    openFileAtPosition,
    openFile,
    openPanel,
    openFileToSide,
    openDiff,
  } = usePanelActions({
    dockApi,
    centerGroupRef,
    panelMinRef,
    markdownPane,
    queryClient,
    dataProvider,
    tabs,
    activeFile,
    setTabs,
    setActiveDiffFile,
    uiStateFeatureEnabled,
    frontendStateUnavailableRef,
    frontendCommandUnavailableRef,
    frontendStateClientIdRef,
    storagePrefixRef,
    publishFrontendState,
    frontendCommandPollIntervalMs: 750,
    getLeftSidebarAnchorPosition,
    getLiveCenterGroup,
    findCenterAnchorPanel,
    isLeftSidebarGroup,
  })

  useEffect(() => {
    if (!dockApi || !approvalsLoaded) return
    const pendingIds = new Set(approvals.map((req) => req.id))
    const panels = Array.isArray(dockApi.panels)
      ? dockApi.panels
      : typeof dockApi.getPanels === 'function'
        ? dockApi.getPanels()
        : []

    panels.forEach((panel) => {
      if (!panel?.id?.startsWith('review-')) return
      const requestId = panel.id.replace('review-', '')
      if (!pendingIds.has(requestId)) {
        panel.api.close()
      }
    })

    approvals.forEach((approval) => {
      const panelId = `review-${approval.id}`
      const approvalPath = normalizeApprovalPath(approval)
      const existingPanel = dockApi.getPanel(panelId)
      const params = {
        request: approval,
        filePath: approvalPath,
        onDecision: handleDecision,
        onOpenFile: openFile,
      }

      if (existingPanel) {
        existingPanel.api.updateParameters(params)
        existingPanel.api.setTitle(getReviewTitle(approval))
        return
      }

      // Get panel references for positioning
      const emptyPanel = dockApi.getPanel('empty-center')

      // Find existing editor/review panels to add as sibling tab
      const allPanels = Array.isArray(dockApi.panels) ? dockApi.panels : []
      const existingEditorPanel = allPanels.find(p => p.id.startsWith('editor-') || p.id.startsWith('review-'))

      // Priority: existing editor group > centerGroupRef > empty panel > fallback
      const centerGroup = getLiveCenterGroup(dockApi)
      let position
      if (existingEditorPanel?.group) {
        // Add as tab next to existing editors/reviews
        position = { referenceGroup: existingEditorPanel.group }
      } else if (centerGroup) {
        position = { referenceGroup: centerGroup }
      } else if (emptyPanel?.group) {
        position = { referenceGroup: emptyPanel.group }
      } else {
        position = getLeftSidebarAnchorPosition(dockApi)
      }

      const panel = dockApi.addPanel({
        id: panelId,
        component: 'review',
        title: getReviewTitle(approval),
        position,
        params,
      })

      // Close empty panel AFTER adding review to its group
      if (emptyPanel) {
        emptyPanel.api.close()
      }

      if (panel?.group) {
        panel.group.header.hidden = false
        centerGroupRef.current = panel.group
        // Apply minimum height constraint to center group (use Number.MAX_SAFE_INTEGER to allow resize)
        panel.group.api.setConstraints({
          minimumHeight: panelMinRef.current.center,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
      }
    })
  }, [
    approvals,
    approvalsLoaded,
    dockApi,
    getReviewTitle,
    getLiveCenterGroup,
    handleDecision,
    normalizeApprovalPath,
    openFile,
    getLeftSidebarAnchorPosition,
  ])

  const createUniquePanelId = useCallback((api, prefix) => {
    let counter = 1
    let candidate = `${prefix}-${Date.now().toString(36)}`
    while (api.getPanel(candidate)) {
      candidate = `${prefix}-${Date.now().toString(36)}-${counter}`
      counter += 1
    }
    return candidate
  }, [])

  const handleSplitChatPanelRef = useRef(null)

  const addChatPanel = useCallback(
    ({
      mode = 'tab',
      sourcePanelId = '',
      piSessionBootstrap = 'latest',
      suppressPendingLayoutRestore = false,
    } = {}) => {
      const api = dockApiRef.current
      if (!api) return false
      if (suppressPendingLayoutRestore) {
        suppressPendingLayoutRestoreRef.current = true
      }

      const sourcePanel = sourcePanelId ? api.getPanel(sourcePanelId) : null
      const component = 'agent'

      const panelIdPrefix = 'agent-chat'
      const panelId = createUniquePanelId(api, panelIdPrefix)
      const piInitialSessionId = agentMode !== 'backend'
        && piSessionBootstrap === 'new'
        ? `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        : ''
      const title = 'Agent'
      const matchingPanels = listDockPanels(api).filter(
        (panel) => getPanelComponent(panel) === component,
      )
      const defaultReferencePanel = matchingPanels[0]
      let emptyCenterPanel = api.getPanel('empty-center')
      let centerGroup = getLiveCenterGroup(api) || emptyCenterPanel?.group

      // Ensure chat panels anchor in the center area, not side rails.
      if (!centerGroup) {
        const emptyCenterPosition = getLeftSidebarAnchorPosition(api)
        if (!emptyCenterPanel && emptyCenterPosition) {
          emptyCenterPanel = api.addPanel({
            id: 'empty-center',
            component: 'empty',
            title: '',
            position: emptyCenterPosition,
          })
        }
        if (emptyCenterPanel?.group) {
          emptyCenterPanel.group.header.hidden = true
          centerGroupRef.current = emptyCenterPanel.group
          centerGroup = emptyCenterPanel.group
          emptyCenterPanel.group.api.setConstraints({
            minimumHeight: panelMinRef.current.center,
            maximumHeight: Number.MAX_SAFE_INTEGER,
          })
        }
      }

      let position
      if (mode === 'split' && sourcePanel) {
        position = { direction: 'right', referencePanel: sourcePanel.id }
      } else if (mode === 'tab' && !sourcePanel && centerGroup) {
        position = { referenceGroup: centerGroup }
      } else if (mode === 'split' && defaultReferencePanel) {
        position = { direction: 'right', referencePanel: defaultReferencePanel.id }
      } else if (sourcePanel?.group) {
        position = { referenceGroup: sourcePanel.group }
      } else if (defaultReferencePanel?.group) {
        position = { referenceGroup: defaultReferencePanel.group }
      } else if (mode === 'split') {
        const emptyCenter = api.getPanel('empty-center')
        if (emptyCenter) {
          position = { direction: 'right', referencePanel: emptyCenter.id }
        } else if (centerGroup?.activePanel?.id) {
          position = { direction: 'right', referencePanel: centerGroup.activePanel.id }
        } else if (centerGroup?.panels?.[0]?.id) {
          position = { direction: 'right', referencePanel: centerGroup.panels[0].id }
        } else if (centerGroup) {
          position = { referenceGroup: centerGroup }
        }
      } else if (centerGroup) {
        position = { referenceGroup: centerGroup }
      } else {
        position = getLeftSidebarAnchorPosition(api)
      }

      const panel = api.addPanel({
        id: panelId,
        component,
        title,
        position,
        params: {
          panelId,
          collapsed: false,
          onToggleCollapse: undefined,
          mode: agentMode,
          piSessionBootstrap,
          piInitialSessionId,
        },
      })
      if (!panel) return false

      // Set onSplitPanel immediately so the "Split chat panel" button
      // appears without waiting for the params sync effect to re-run.
      if (handleSplitChatPanelRef.current) {
        panel.api.updateParameters({
          ...panel.params,
          onSplitPanel: handleSplitChatPanelRef.current,
        })
      }

      if (panel?.group) {
        panel.group.locked = false
        panel.group.header.hidden = false
        panel.group.api.setConstraints({
          minimumWidth: panelMinRef.current.agent,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (!collapsed.agent) {
          panel.group.api.setSize({ width: panelSizesRef.current.agent })
        }

        // Remove empty placeholder once a real chat panel is added to that group.
        if (
          emptyCenterPanel
          && emptyCenterPanel.id !== panel.id
          && emptyCenterPanel.group?.id === panel.group.id
        ) {
          emptyCenterPanel.api.close()
        }
      }

      panel.api.setActive()
      return true
    },
    [
      agentMode,
      createUniquePanelId,
      getLeftSidebarAnchorPosition,
      getLiveCenterGroup,
      collapsed.agent,
    ],
  )

  const handleSplitChatPanel = useCallback((panelId, options = {}) => {
    if (!panelId) return
    addChatPanel({
      mode: 'split',
      sourcePanelId: panelId,
      piSessionBootstrap: options.piSessionBootstrap || 'latest',
      suppressPendingLayoutRestore: true,
    })
  }, [addChatPanel])
  handleSplitChatPanelRef.current = handleSplitChatPanel

  const handleOpenChatTab = useCallback(() => {
    if (!dockApi) {
      addChatPanel({ mode: 'split', piSessionBootstrap: 'new', suppressPendingLayoutRestore: true })
      return
    }

    const agentPanels = listDockPanels(dockApi).filter((panel) => {
      const component = getPanelComponent(panel)
      return component === 'agent'
    })

    const activePanel = dockApi.activePanel
    const activeIsAgent = activePanel
      && getPanelComponent(activePanel) === 'agent'
    const preferredSource = activeIsAgent
      ? activePanel
      : (agentPanels.find((panel) => panel.id === 'agent') || agentPanels[0])

    if (preferredSource?.id) {
      handleSplitChatPanel(preferredSource.id, { piSessionBootstrap: 'new' })
      return
    }

    addChatPanel({ mode: 'split', piSessionBootstrap: 'new', suppressPendingLayoutRestore: true })
  }, [addChatPanel, dockApi, handleSplitChatPanel])

  // Right header actions component for quick chat actions in center groups.
  const RightHeaderActions = useCallback(
    (props) => {
      const panels = props.group?.panels || []
      const hasCenterTabs = panels.some((p) => {
        const id = typeof p?.id === 'string' ? p.id : ''
        return id.startsWith('editor-') || id.startsWith('review-') || id === 'empty-center'
      })

      if (!hasCenterTabs) return null

      return (
        <div className="tab-header-actions">
          {hasCenterTabs && (
            <Tooltip label="Open new chat pane">
              <button
                type="button"
                className="tab-collapse-btn"
                onClick={handleOpenChatTab}
                aria-label="Open new chat pane"
              >
                <Bot size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      )
    },
    [handleOpenChatTab],
  )

  const onReady = (event) => {
    const api = event.api
    setDockApi(api)
    // Keep dock drag-and-drop explicitly enabled.
    if (typeof api?.updateOptions === 'function') {
      api.updateOptions({ disableDnd: false })
    }
    if (typeof api?.onUnhandledDragOverEvent === 'function') {
      api.onUnhandledDragOverEvent((dragEvent) => {
        const dataTransfer = dragEvent?.nativeEvent?.dataTransfer
        const isInternalPanelDrag = typeof dragEvent?.getData === 'function' && !!dragEvent.getData()
        const droppedSeriesFromCustomType = String(dataTransfer?.getData('text/series-id') || '').trim()
        const isExternalSeriesDragFallback = typeof window !== 'undefined'
          && typeof window.__BM_DND_SERIES_ID === 'string'
          && window.__BM_DND_SERIES_ID.trim().length > 0
        const isSeriesDrag = droppedSeriesFromCustomType.length > 0 || isExternalSeriesDragFallback
        const targetPanel = dragEvent?.group?.activePanel
        const isChartOverlayTarget = getPanelComponent(targetPanel) === 'chart-canvas'
        const isExternalDrag = !!dataTransfer || isExternalSeriesDragFallback

        if (isInternalPanelDrag) {
          dragEvent.accept()
          return
        }

        // Suppress split overlay UI when dragging catalog series onto an existing chart panel.
        // The actual drop is handled by the DOM capture bridge below.
        if (isSeriesDrag && isChartOverlayTarget) {
          return
        }

        if (isExternalDrag) {
          dragEvent.accept()
        }
      })
    }

    const applyPanelConstraints = (api, registry, panelMinRef) => {
      const paneConfigs = typeof registry?.list === 'function' ? registry.list() : []

      paneConfigs.forEach((paneConfig) => {
        const panel = api.getPanel(paneConfig.id)
        const group = panel?.group
        if (!group) return

        const effectiveLocked = paneConfig.locked
        if (typeof effectiveLocked === 'boolean') {
          group.locked = effectiveLocked
        }

        if (paneConfig.hideHeader === true) {
          group.header.hidden = true
        } else if (paneConfig.hideHeader === false) {
          // Explicit reset prevents stale hidden state from saved layouts.
          group.header.hidden = false
        }

        const configMin = panelMinRef?.current?.[paneConfig.id]
        const hasConfigMin = Number.isFinite(configMin)
        const fallbackMinWidth = paneConfig.constraints?.minWidth
        const fallbackMinHeight = paneConfig.constraints?.minHeight
        const minimumWidth = Number.isFinite(fallbackMinWidth)
          ? (hasConfigMin ? configMin : fallbackMinWidth)
          : undefined
        const minimumHeight = Number.isFinite(fallbackMinHeight)
          ? (hasConfigMin ? configMin : fallbackMinHeight)
          : undefined
        const constraints = {}

        if (Number.isFinite(minimumWidth)) {
          constraints.minimumWidth = minimumWidth
          constraints.maximumWidth = Number.MAX_SAFE_INTEGER
        }
        if (Number.isFinite(minimumHeight)) {
          constraints.minimumHeight = minimumHeight
          constraints.maximumHeight = Number.MAX_SAFE_INTEGER
        }
        if (Object.keys(constraints).length > 0) {
          group.api.setConstraints(constraints)
        }
      })
    }

    const getDefaultParams = (panelId) => {
      switch (panelId) {
        case 'filetree':
          return {
            onOpenFile: openFile,
            onOpenFileToSide: openFileToSide,
            onOpenDiff: openDiff,
            projectRoot,
            activeFile,
            activeDiffFile,
            collapsed: collapsed.filetree,
            onToggleCollapse: toggleFiletree,
            showSidebarToggle: sidebarToggleHostId === 'filetree',
            appName: config.branding?.name || '',
            onOpenChatTab: handleOpenChatTab,
            sectionCollapsed: sectionCollapsed.filetree,
            onToggleSection: () => toggleSectionCollapse('filetree'),
            activeSidebarPanelId,
            onActivateSidebarPanel: activateSidebarPanel,
            filetreeActivityIntent,
            userEmail: menuUserEmail,
            userMenuStatusMessage,
            userMenuStatusTone,
            onUserMenuRetry: handleUserMenuRetry,
            userMenuDisabledActions,
            showSwitchWorkspace: userMenuCanSwitchWorkspace,
            workspaceName: activeWorkspaceName,
            workspaceId: currentWorkspaceId,
            onSwitchWorkspace: handleSwitchWorkspace,
            workspaceOptions,
            onCreateWorkspace: handleCreateWorkspace,
            onOpenUserSettings: handleOpenUserSettings,
            onOpenWorkspaceSettings: handleOpenWorkspaceSettings,
            onLogout: handleLogout,
          }
        case 'agent':
          return {
            panelId: 'agent',
            collapsed: false,
            onToggleCollapse: undefined,
            onSplitPanel: handleSplitChatPanel,
            mode: agentMode,
            piSessionBootstrap: 'latest',
          }
        default:
          if (leftSidebarPanelIds.includes(panelId)) {
            return {
              collapsed: collapsed.filetree,
              onToggleCollapse: toggleFiletree,
              showSidebarToggle: sidebarToggleHostId === panelId,
              appName: config.branding?.name || '',
              onOpenChatTab: handleOpenChatTab,
              sectionCollapsed: sectionCollapsed[panelId],
              onToggleSection: () => toggleSectionCollapse(panelId),
              activeSidebarPanelId,
              onActivateSidebarPanel: activateSidebarPanel,
              catalogActivityIntent,
            }
          }
          return {}
      }
    }

    const ensureCorePanels = () => {
      // Layout goal: [filetree | editor/chat center column]
      //
      // Strategy: Create in order that establishes correct hierarchy
      // 1. filetree (left)
      // 2. empty-center (right of filetree) - center column for editor/chat tabs

      // Create left sidebar panels. Strategy:
      // 1. Create the first left panel (anchors the column)
      // 2. Create empty-center to the right (establishes the column boundary)
      // 3. Add remaining left panels below the first (vertical split within left column)
      //
      // This order matters: DockView splits relative to the reference cell,
      // so we must establish the left/center column boundary before adding
      // vertical splits within the left column.
      const leftPanelQueue = []
      let firstLeftPanel = null
      for (const panelId of leftSidebarPanelIds) {
        let panel = api.getPanel(panelId)
        if (!panel) {
          const paneConfig = paneRegistry.get(panelId)
          if (!paneConfig) continue
          if (!firstLeftPanel) {
            panel = api.addPanel({
              id: panelId,
              component: panelId,
              title: paneConfig.title,
              params: getDefaultParams(panelId),
            })
          } else {
            leftPanelQueue.push({ panelId, paneConfig })
            continue
          }
        }
        if (panel?.group) {
          panel.group.locked = true
          panel.group.header.hidden = true
        }
        if (!firstLeftPanel) firstLeftPanel = panel
      }

      // Backwards compat: ensure filetree exists even if not in leftSidebarPanelIds
      let filetreePanel = api.getPanel('filetree')
      if (!filetreePanel && !leftSidebarPanelIds.includes('filetree')) {
        filetreePanel = api.addPanel({
          id: 'filetree',
          component: 'filetree',
          title: 'Files',
          params: getDefaultParams('filetree'),
        })
        if (!firstLeftPanel) firstLeftPanel = filetreePanel
      } else {
        filetreePanel = api.getPanel('filetree')
      }

      // Add empty panel right of the first left panel - creates center column
      const leftAnchorId = firstLeftPanel?.id || 'filetree'
      let emptyPanel = api.getPanel('empty-center')
      if (!emptyPanel) {
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: { direction: 'right', referencePanel: leftAnchorId },
        })
      }
      // Always set centerGroupRef from empty panel if it exists
      if (emptyPanel?.group) {
        emptyPanel.group.header.hidden = true
        centerGroupRef.current = emptyPanel.group
        // Set minimum height for the center group (use Number.MAX_SAFE_INTEGER to allow resize)
        emptyPanel.group.api.setConstraints({
          minimumHeight: panelMinRef.current.center,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
      }

      // Now that the left/center column boundary exists, add remaining
      // left sidebar panels below the first one (vertical splits).
      let lastLeftPanel = firstLeftPanel
      for (const { panelId, paneConfig } of leftPanelQueue) {
        if (api.getPanel(panelId)) continue
        const refGroup = lastLeftPanel?.group
        if (!refGroup) continue
        const panel = api.addPanel({
          id: panelId,
          component: panelId,
          title: paneConfig.title,
          params: getDefaultParams(panelId),
          position: { direction: 'below', referenceGroup: refGroup },
        })
        if (panel?.group) {
          panel.group.locked = true
          panel.group.header.hidden = true
        }
        if (panel) lastLeftPanel = panel
      }

      // Set centerGroupRef from editor panels if any exist
      const panels = Array.isArray(api.panels)
        ? api.panels
        : typeof api.getPanels === 'function'
          ? api.getPanels()
          : []
      const editorPanels = panels.filter((panel) =>
        panel.id.startsWith('editor-') && !isLeftSidebarGroup(panel.group),
      )
      if (editorPanels.length > 0) {
        centerGroupRef.current = editorPanels[0].group
      }
      // centerGroupRef was already set above when creating empty-center if no editors

      applyPanelConstraints(
        api,
        paneRegistry,
        panelMinRef,
      )
      applyInitialSizes(
        api,
        panelSizesRef,
        panelMinRef,
        panelCollapsedRef,
        collapsed,
        paneRegistry,
      )
    }

    const buildLayoutFromConfig = (
      api,
      config,
      registry,
      capabilitiesSnapshot,
      capabilitiesLoadingSnapshot,
    ) => {
      const layoutPanels = config?.defaultLayout?.panels
      if (!Array.isArray(layoutPanels)) {
        console.error('[Layout] defaultLayout.panels must be an array, falling back to stock layout')
        ensureCorePanels()
        return
      }

      const createdPanels = new Map()
      const orderedCreated = []

      layoutPanels.forEach((entry) => {
        const id = entry?.id
        if (!id || typeof id !== 'string') {
          console.warn('[Layout] Invalid panel entry (missing id), skipping', entry)
          return
        }

        const paneConfig = registry?.get?.(id)
        if (!paneConfig) {
          console.warn(`[Layout] Panel "${id}" not registered in PaneRegistry, skipping`)
          return
        }

        const existingPanel = api.getPanel(id)
        if (existingPanel) {
          createdPanels.set(id, existingPanel)
          orderedCreated.push({ id, panel: existingPanel, paneConfig })
          return
        }

        // During initial boot, capabilities may not be loaded yet.
        // Don't skip panel creation in that window or the layout can be
        // persisted without core panes (e.g. filetree).
        const canEnforceRequirements = !capabilitiesLoadingSnapshot
          && !!capabilitiesSnapshot
          && typeof registry?.checkRequirements === 'function'
        const requirementsMet = canEnforceRequirements
          ? registry.checkRequirements(id, capabilitiesSnapshot)
          : true
        if (!requirementsMet) {
          console.warn(`[Layout] Panel "${id}" skipped - required capabilities not available`)
          return
        }

        let position
        const ref = entry?.ref
        if (ref) {
          const referencedPanel = createdPanels.get(ref)
          if (!referencedPanel) {
            console.warn(`[Layout] Panel "${id}" references unknown ref "${ref}", skipping`)
            return
          }

          const direction = entry?.position
          if (direction === 'left' || direction === 'right') {
            position = { direction, referencePanel: ref }
          } else if (direction === 'above' || direction === 'below') {
            const referenceGroup = api.getPanel(ref)?.group
            if (!referenceGroup) {
              console.warn(`[Layout] Panel "${id}" references panel "${ref}" without a group, skipping`)
              return
            }
            position = { direction, referenceGroup }
          } else if (direction === 'tab') {
            position = { referencePanel: ref }
          } else {
            console.warn(`[Layout] Panel "${id}" has invalid position "${direction}", skipping`)
            return
          }
        }

        const panel = api.addPanel({
          id,
          component: id,
          title: paneConfig.title,
          tabComponent: paneConfig.tabComponent,
          position,
          params: getDefaultParams(id),
        })
        if (!panel) return

        createdPanels.set(id, panel)
        orderedCreated.push({ id, panel, paneConfig })
      })

      if (orderedCreated.length === 0) {
        ensureCorePanels()
        return
      }

      const firstCenterPanel = orderedCreated.find(
        ({ paneConfig, panel }) => paneConfig?.placement === 'center' && panel?.group,
      )?.panel
      if (firstCenterPanel?.group) {
        centerGroupRef.current = firstCenterPanel.group
      }

      if (!api.getPanel('empty-center')) {
        const rightRailPanel = api.getPanel('agent')
        const emptyPosition = firstCenterPanel?.group
          ? { referenceGroup: firstCenterPanel.group }
          : rightRailPanel
            ? { direction: 'left', referencePanel: rightRailPanel.id }
            : getLeftSidebarAnchorPosition(api)

        const emptyCenterPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: emptyPosition,
        })
        if (emptyCenterPanel?.group) {
          emptyCenterPanel.group.header.hidden = true
          centerGroupRef.current = emptyCenterPanel.group
          emptyCenterPanel.group.api.setConstraints({
            minimumHeight: panelMinRef.current.center,
            maximumHeight: Number.MAX_SAFE_INTEGER,
          })
        }
      }

      applyPanelConstraints(
        api,
        registry,
        panelMinRef,
      )
      applyInitialSizes(
        api,
        panelSizesRef,
        panelMinRef,
        panelCollapsedRef,
        collapsed,
        paneRegistry,
      )
    }

    let hasSavedLayout = false
    let invalidLayoutFound = false
    const shouldUseConfigLayout = Array.isArray(config?.defaultLayout?.panels)
      ? config.defaultLayout.panels.length > 0
      : config?.defaultLayout && Object.prototype.hasOwnProperty.call(config.defaultLayout, 'panels')
    const panelBuilder = shouldUseConfigLayout
      ? () => buildLayoutFromConfig(
          api,
          config,
          paneRegistry,
          capabilitiesRef.current,
          capabilitiesLoadingRef.current,
        )
      : ensureCorePanels
    ensureCorePanelsRef.current = panelBuilder

    if (layoutPersistenceReady) {
      // Check if there's a saved layout - if so, DON'T create panels here
      // Let the layout restoration effect handle it to avoid creating->destroying->recreating.
      try {
        const layoutKeyPrefix = `${storagePrefix}-`
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith(layoutKeyPrefix) && key.endsWith('-layout')) {
            const raw = localStorage.getItem(key)
            if (raw) {
              const parsed = JSON.parse(raw)
              const hasValidVersion = parsed?.version >= LAYOUT_VERSION
              const hasPanels = !!parsed?.panels
              const capabilitiesSnapshot = capabilitiesRef.current || UNKNOWN_CAPABILITIES
              const hasValidStructure = validateLayoutStructure(parsed, capabilitiesSnapshot)

              if (hasValidVersion && hasPanels && hasValidStructure) {
                hasSavedLayout = true
                break
              }

              if (!hasValidStructure || !hasValidVersion || !hasPanels) {
                console.warn('[Layout] Invalid layout detected in onReady, clearing and reloading:', key)
                localStorage.removeItem(key)
                const keyPrefix = key.replace('-layout', '')
                localStorage.removeItem(`${keyPrefix}-tabs`)
                localStorage.removeItem(`${storagePrefix}-terminal-sessions`)
                localStorage.removeItem(`${storagePrefix}-terminal-active`)
                localStorage.removeItem(`${storagePrefix}-terminal-chat-interface`)
                invalidLayoutFound = true
              }
            }
          }
        }
      } catch {
        // Ignore errors checking localStorage.
      }
    }

    if (layoutPersistenceReady && (!hasSavedLayout || invalidLayoutFound)) {
      panelBuilder()
    }

    // Handle panel close to clean up tabs state
    api.onDidRemovePanel((e) => {
      if (e.id.startsWith('editor-')) {
        const path = e.id.replace('editor-', '')
        setTabs((prev) => {
          const next = { ...prev }
          delete next[path]
          return next
        })
      }
    })


    // When all editors are closed, show the empty panel again
    api.onDidRemovePanel(() => {
      // Check if empty panel already exists
      const existingEmpty = api.getPanel('empty-center')
      if (existingEmpty) return

      // Check if there are any center-content panels left anywhere
      const allPanels = Array.isArray(api.panels) ? api.panels : []
      const hasCenterPanels = allPanels.some((panel) => isCenterContentPanel(panel, paneRegistry))

      // If there are still center panels open, don't add empty panel
      if (hasCenterPanels) return

      // Need to add empty panel - find the right position
      // Try to use centerGroupRef if it still exists and has panels
      const centerGroup = getLiveCenterGroup(api)
      const groupStillExists = !!centerGroup

      let emptyPanel
      if (groupStillExists) {
        // Reuse the surviving center group (even if it's temporarily empty)
        // so closing the last editor does not create a new split/layout drift.
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: { referenceGroup: centerGroup },
        })
      } else {
        const agentPanel = api.getPanel('agent')
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: agentPanel
            ? { direction: 'left', referencePanel: agentPanel.id }
            : getLeftSidebarAnchorPosition(api),
        })
      }

      // Update centerGroupRef and apply constraints
      if (emptyPanel?.group) {
        centerGroupRef.current = emptyPanel.group
        emptyPanel.group.header.hidden = true
        emptyPanel.group.api.setConstraints({
          minimumHeight: panelMinRef.current.center,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
      }
    })

    const saveLayoutNow = () => {
      if (typeof api.toJSON !== 'function') return
      // Use refs for stable access in event handlers
      saveLayout(storagePrefixRef.current, projectRootRef.current, api.toJSON(), layoutVersionRef.current)
    }

    // Enforce minimum constraints on panels (workaround for dockview not enforcing during drag)
    const enforceMinimumConstraints = () => {
      const shellPanel = api.getPanel('shell')
      const shellGroup = shellPanel?.group
      if (shellGroup) {
        const height = shellGroup.api.height
        const minHeight = panelMinRef.current.shell
        const collapsedHeight = panelCollapsedRef.current.shell
        // If height is below minimum but not collapsed, enforce minimum
        if (height < minHeight && height > collapsedHeight) {
          shellGroup.api.setSize({ height: minHeight })
        }
      }
    }

    // Save panel sizes when layout changes (user resizes via drag)
    const savePanelSizesNow = () => {
      const filetreePanel = api.getPanel('filetree')
      const terminalPanel = api.getPanel('terminal')
      const agentPanel = api.getPanel('agent')
      const shellPanel = api.getPanel('shell')

      const leftGroups = getLeftSidebarGroups(api)
      const filetreeGroup = filetreePanel?.group
      const terminalGroup = terminalPanel?.group
      const agentGroup = agentPanel?.group
      const shellGroup = shellPanel?.group

      const newSizes = { ...panelSizesRef.current }
      let changed = false

      // Only save if not collapsed (width/height > collapsed size)
      const leftCollapsedWidth = leftSidebarCollapsedWidth
      const leftWidth = leftGroups[0]?.api?.width ?? filetreeGroup?.api?.width
      if (Number.isFinite(leftWidth) && leftWidth > leftCollapsedWidth) {
        if (newSizes.filetree !== leftWidth) {
          newSizes.filetree = leftWidth
          changed = true
        }
      }
      if (terminalGroup && terminalGroup.api.width > panelCollapsedRef.current.terminal) {
        if (newSizes.terminal !== terminalGroup.api.width) {
          newSizes.terminal = terminalGroup.api.width
          changed = true
        }
      }
      if (agentGroup && agentGroup.api.width > panelCollapsedRef.current.agent) {
        if (newSizes.agent !== agentGroup.api.width) {
          newSizes.agent = agentGroup.api.width
          changed = true
        }
      }
      if (shellGroup && shellGroup.api.height > panelCollapsedRef.current.shell) {
        // Enforce minimum height before saving
        const height = Math.max(shellGroup.api.height, panelMinRef.current.shell)
        if (newSizes.shell !== height) {
          newSizes.shell = height
          changed = true
        }
      }

      if (changed) {
        panelSizesRef.current = newSizes
        savePanelSizes(newSizes, storagePrefixRef.current)
      }
    }

    // Debounce layout saves to avoid excessive writes during drag operations
    const debouncedSaveLayout = debounce(saveLayoutNow, 300)
    const debouncedSavePanelSizes = debounce(savePanelSizesNow, 300)
    const debouncedPublishFrontendState = debounce(() => {
      void publishFrontendState(api)
    }, 250)

    if (typeof api.onDidLayoutChange === 'function') {
      api.onDidLayoutChange(() => {
        // Enforce minimum constraints after resize (workaround for dockview)
        enforceMinimumConstraints()
        debouncedSaveLayout()
        debouncedSavePanelSizes()
        debouncedPublishFrontendState()
      })
    }
    if (typeof api.onDidAddPanel === 'function') {
      api.onDidAddPanel(() => {
        debouncedPublishFrontendState()
      })
    }
    api.onDidRemovePanel(() => {
      debouncedPublishFrontendState()
    })
    requestAnimationFrame(() => {
      void publishFrontendState(api, { force: true })
    })

    // Flush pending saves before page unload to avoid data loss
    window.addEventListener('beforeunload', () => {
      debouncedSaveLayout.flush()
      debouncedSavePanelSizes.flush()
      debouncedPublishFrontendState.flush()
      void publishFrontendState(api, { force: true, transport: 'beacon' })
    })

    // Mark as initialized immediately - tabs will be restored via useEffect
    isInitialized.current = true
  }

  // Fetch project root for copy path feature and project-specific storage
  useEffect(() => {
    let retryCount = 0
    let fallbackApplied = false
    const maxRetries = 6 // ~3 seconds total before initial fallback
    const fetchProjectRoot = () => {
      const route = routes.project.root()
      apiFetchJson(route.path, {
        query: route.query,
        rootScoped: true,
      })
        .then(({ data }) => {
          const root = data.root || ''
          // Don't update projectRoot after fallback to avoid overwriting project-scoped state
          // (layout/tabs were restored from fallback key; updating root would save to wrong location)
          if (fallbackApplied) {
            console.info('[App] Backend available but fallback already applied, refresh to reload project state')
            return
          }
          projectRootRef.current = root
          setProjectRoot(root)
        })
        .catch(() => {
          retryCount++
          if (retryCount < maxRetries) {
            // Retry on failure - server might not be ready yet
            setTimeout(fetchProjectRoot, 500)
          } else if (!fallbackApplied) {
            // After max retries, fall back to empty string to unblock layout restoration
            // We don't continue retrying - user should refresh once backend is available
            console.warn('[App] Failed to fetch project root after retries, using fallback (refresh when backend is available)')
            projectRootRef.current = ''
            setProjectRoot('')
            fallbackApplied = true
          }
        })
    }
    fetchProjectRoot()
  }, [])

  // Set browser tab title using config titleFormat
  useEffect(() => {
    const folderName = projectRoot ? projectRoot.split('/').filter(Boolean).pop() : null
    const titleFormat = config.branding?.titleFormat
    if (typeof titleFormat === 'function') {
      document.title = titleFormat({ folder: folderName, workspace: folderName })
    } else {
      // Fallback if titleFormat is not a function
      document.title = folderName
        ? `${folderName} - ${config.branding?.name || 'Boring UI'}`
        : config.branding?.name || 'Boring UI'
    }
  }, [projectRoot, config.branding])

  // Restore layout once projectRoot is loaded and dockApi is available
  const layoutRestorationRan = useRef(false)
  useEffect(() => {
    layoutRestorationRan.current = false
    layoutRestored.current = false
    collapsedEffectRan.current = false
    suppressPendingLayoutRestoreRef.current = false
  }, [storagePrefix, projectRoot])

  useEffect(() => {
    // Wait for dockApi, projectRoot, and layout persistence hydration so we
    // restore from the final per-user storage key only once.
    if (
      !dockApi
      || projectRoot === null
      || !layoutPersistenceReady
      || capabilitiesLoading
      || !workspacePanesReady
      || layoutRestorationRan.current
    ) return
    if (suppressPendingLayoutRestoreRef.current) {
      layoutRestorationRan.current = true
      layoutRestored.current = true
      return
    }
    layoutRestorationRan.current = true
    const collapsedState = {
      filetree: collapsed.filetree,
      terminal: collapsed.terminal,
      agent: collapsed.agent,
      shell: collapsed.shell,
    }

    const savedLayout = loadLayout(storagePrefix, projectRoot, getLiveKnownComponents(), layoutVersion)
    if (!savedLayout) {
      if (ensureCorePanelsRef.current) {
        ensureCorePanelsRef.current()
        layoutRestored.current = true
        applyInitialSizes(
          dockApi,
          panelSizesRef,
          panelMinRef,
          panelCollapsedRef,
          collapsedState,
          paneRegistry,
        )
        collapsedEffectRan.current = true
      }
      return
    }
    if (savedLayout && typeof dockApi.fromJSON === 'function') {
      const normalizedLayout = normalizeMarkdownEditorPanels(savedLayout, markdownPane)
      // Since onReady skips panel creation when a saved layout exists,
      // we can directly call fromJSON without clearing first
      // This avoids the create->destroy->recreate race condition
      try {
        dockApi.fromJSON(normalizedLayout)
        layoutRestored.current = true

        // Safety net: if fromJSON failed to restore essential panels
        // (e.g. stale grid structure), re-run panel builder to add them.
        if (ensureCorePanelsRef.current) {
          ensureCorePanelsRef.current()
        }

        // After restoring, apply locked panels and cleanup
        const filetreePanel = dockApi.getPanel('filetree')
        const linkedSidebarPanels = leftSidebarPanelIds
          .filter((panelId) => panelId !== 'filetree')
          .map((panelId) => dockApi.getPanel(panelId))
          .filter(Boolean)
        const terminalPanel = dockApi.getPanel('terminal')
        const shellPanel = dockApi.getPanel('shell')

        const filetreeGroup = filetreePanel?.group
        if (filetreeGroup) {
          filetreeGroup.locked = true
          filetreeGroup.header.hidden = true
        }

        // Update filetree params with callbacks (callbacks can't be serialized in layout JSON)
        if (filetreePanel) {
          filetreePanel.api.updateParameters({
            onOpenFile: openFile,
            onOpenFileToSide: openFileToSide,
            onOpenDiff: openDiff,
            projectRoot,
            activeFile,
            activeDiffFile,
            collapsed: collapsed.filetree,
            onToggleCollapse: toggleFiletree,
            showSidebarToggle: sidebarToggleHostId === 'filetree',
            appName: config.branding?.name || '',
            onOpenChatTab: handleOpenChatTab,
            sectionCollapsed: sectionCollapsed.filetree,
            onToggleSection: () => toggleSectionCollapse('filetree'),
            activeSidebarPanelId,
            onActivateSidebarPanel: activateSidebarPanel,
            filetreeActivityIntent,
            userEmail: menuUserEmail,
            userMenuStatusMessage,
            userMenuStatusTone,
            onUserMenuRetry: handleUserMenuRetry,
            userMenuDisabledActions,
            showSwitchWorkspace: userMenuCanSwitchWorkspace,
            workspaceName: activeWorkspaceName,
            workspaceId: currentWorkspaceId,
            onSwitchWorkspace: handleSwitchWorkspace,
            workspaceOptions,
            onCreateWorkspace: handleCreateWorkspace,
            onOpenUserSettings: handleOpenUserSettings,
            onOpenWorkspaceSettings: handleOpenWorkspaceSettings,
            onLogout: handleLogout,
            githubEnabled: capabilities?.features?.github === true,
            dataBackend: configuredDataBackend,
          })
        }

        linkedSidebarPanels.forEach((panel) => {
          if (panel?.group) {
            panel.group.locked = true
            panel.group.header.hidden = true
          }
          const panelId = panel?.id
          panel?.api?.updateParameters({
            ...(panel?.params || {}),
            collapsed: collapsed.filetree,
            onToggleCollapse: toggleFiletree,
            showSidebarToggle: sidebarToggleHostId === panelId,
            appName: config.branding?.name || '',
            onOpenChatTab: handleOpenChatTab,
            sectionCollapsed: panelId ? sectionCollapsed[panelId] : false,
            onToggleSection: panelId ? () => toggleSectionCollapse(panelId) : undefined,
            activeSidebarPanelId,
            onActivateSidebarPanel: activateSidebarPanel,
            catalogActivityIntent,
          })
        })

        const terminalGroup = terminalPanel?.group
        if (terminalGroup) {
          terminalGroup.locked = false
          terminalGroup.header.hidden = true
        }

        const shellGroup = shellPanel?.group
        if (shellGroup) {
          // Lock group to prevent closing tabs; panel-local header provides controls.
          shellGroup.locked = true
          shellGroup.header.hidden = true
          shellGroup.api.setConstraints({
            minimumHeight: panelMinRef.current.shell,
            maximumHeight: Number.MAX_SAFE_INTEGER,
          })
          // Enforce minimum height if saved layout has invalid dimensions
          // (between collapsed 36px and minimum 100px)
          const currentHeight = shellGroup.api.height
          const minHeight = panelMinRef.current.shell
          const collapsedHeight = panelCollapsedRef.current.shell
          if (currentHeight < minHeight && currentHeight > collapsedHeight) {
            shellGroup.api.setSize({ height: minHeight })
          }
        }

        // Handle agent panel restored from saved layout.
        const agentPanel = dockApi.getPanel('agent')
        if (agentPanel) {
          if (!capabilitiesLoading && capabilities?.features?.pi !== true) {
            agentPanel.api.close()
          } else {
            const agentGroup = agentPanel.group
            if (agentGroup) {
              agentGroup.locked = false
              agentGroup.header.hidden = false
              if (collapsed.agent) {
                agentGroup.api.setConstraints({
                  minimumWidth: panelCollapsedRef.current.agent,
                  maximumWidth: panelCollapsedRef.current.agent,
                })
                agentGroup.api.setSize({ width: panelCollapsedRef.current.agent })
              } else {
                agentGroup.api.setConstraints({
                  minimumWidth: panelMinRef.current.agent,
                  maximumWidth: Number.MAX_SAFE_INTEGER,
                })
                agentGroup.api.setSize({ width: panelSizesRef.current.agent })
              }
            }
          }
        }

        // If layout has editor panels, set constraints and close empty-center
        const panels = Array.isArray(dockApi.panels)
          ? dockApi.panels
          : typeof dockApi.getPanels === 'function'
            ? dockApi.getPanels()
            : []
        const editorPanels = panels.filter((p) => p.id.startsWith('editor-'))
        const hasReviews = panels.some((p) => p.id.startsWith('review-'))
        if (editorPanels.length > 0 || hasReviews) {
          // Apply minimum height constraint to editor group (prevents shell from taking all space)
          // This must happen regardless of whether empty-center exists, since saved layouts
          // with open editors won't have the empty-center panel
          const editorPanel = panels.find((p) => p.id.startsWith('editor-') || p.id.startsWith('review-'))
          if (editorPanel?.group) {
            centerGroupRef.current = editorPanel.group
            editorPanel.group.api.setConstraints({
              minimumHeight: panelMinRef.current.center,
              maximumHeight: Number.MAX_SAFE_INTEGER,
            })
          }
          // Close empty-center if it exists
          const emptyPanel = dockApi.getPanel('empty-center')
          if (emptyPanel) {
            emptyPanel.api.close()
          }
        }

        // Update editor panels with callbacks (callbacks can't be serialized in layout JSON)
        editorPanels.forEach((panel) => {
          panel.api.updateParameters({
            onContentChange: (p, newContent) => {
              setTabs((prev) => ({
                ...prev,
                [p]: { ...prev[p], content: newContent },
              }))
            },
            onDirtyChange: (p, dirty) => {
              setTabs((prev) => ({
                ...prev,
                [p]: { ...prev[p], isDirty: dirty },
              }))
              const editorPanel = dockApi.getPanel(`editor-${p}`)
              if (editorPanel) {
                editorPanel.api.setTitle(getFileName(p) + (dirty ? ' *' : ''))
              }
            },
          })
        })

        // Update centerGroupRef if there's an empty-center panel
        const emptyPanel = dockApi.getPanel('empty-center')
        if (emptyPanel?.group) {
          centerGroupRef.current = emptyPanel.group
          // Set minimum height for the center group (use Number.MAX_SAFE_INTEGER to allow resize)
          emptyPanel.group.api.setConstraints({
            minimumHeight: panelMinRef.current.center,
            maximumHeight: Number.MAX_SAFE_INTEGER,
          })
        }

        // Prune empty groups
        const pruned = pruneEmptyGroups(dockApi, getLiveKnownComponents())
        if (pruned && typeof dockApi.toJSON === 'function') {
          saveLayout(storagePrefix, projectRoot, dockApi.toJSON(), layoutVersion)
        }

        // Apply saved panel sizes, respecting collapsed state
        // collapsed state is loaded from localStorage at init, so we can check it here
        requestAnimationFrame(() => {
          const leftGroups = getLeftSidebarGroups(dockApi)
          const tGroup = dockApi.getPanel('terminal')?.group
          const aGroup = dockApi.getPanel('agent')?.group
          const sGroup = dockApi.getPanel('shell')?.group

          // For collapsed panels, set collapsed size; for expanded, use saved size
          if (leftGroups.length > 0) {
            const collapsedWidth = leftSidebarCollapsedWidth
            const minWidth = leftSidebarMinWidth
            const expandedWidth = Math.max(panelSizesRef.current.filetree ?? minWidth, minWidth)

            leftGroups.forEach((group) => {
              const groupApi = dockApi.getGroup(group.id)?.api
              if (!groupApi) return
              if (collapsed.filetree) {
                groupApi.setConstraints({ minimumWidth: collapsedWidth, maximumWidth: collapsedWidth })
                groupApi.setSize({ width: collapsedWidth })
              } else {
                groupApi.setConstraints({ minimumWidth: minWidth, maximumWidth: Number.MAX_SAFE_INTEGER })
                groupApi.setSize({ width: expandedWidth })
              }
            })
          }
          if (tGroup) {
            const tApi = dockApi.getGroup(tGroup.id)?.api
            if (tApi) {
              if (collapsed.terminal) {
                tApi.setConstraints({ minimumWidth: panelCollapsedRef.current.terminal, maximumWidth: panelCollapsedRef.current.terminal })
                tApi.setSize({ width: panelCollapsedRef.current.terminal })
              } else {
                tApi.setConstraints({ minimumWidth: panelMinRef.current.terminal, maximumWidth: Number.MAX_SAFE_INTEGER })
                tApi.setSize({ width: panelSizesRef.current.terminal })
              }
            }
          }
          if (aGroup) {
            const aApi = dockApi.getGroup(aGroup.id)?.api
            if (aApi) {
              if (collapsed.agent) {
                aApi.setConstraints({ minimumWidth: panelCollapsedRef.current.agent, maximumWidth: panelCollapsedRef.current.agent })
                aApi.setSize({ width: panelCollapsedRef.current.agent })
              } else {
                aApi.setConstraints({ minimumWidth: panelMinRef.current.agent, maximumWidth: Number.MAX_SAFE_INTEGER })
                aApi.setSize({ width: panelSizesRef.current.agent })
              }
            }
          }
          if (sGroup) {
            const sApi = dockApi.getGroup(sGroup.id)?.api
            if (sApi) {
              if (collapsed.shell) {
                sApi.setConstraints({ minimumHeight: panelCollapsedRef.current.shell, maximumHeight: panelCollapsedRef.current.shell })
                sApi.setSize({ height: panelCollapsedRef.current.shell })
              } else {
                sApi.setConstraints({ minimumHeight: panelMinRef.current.shell, maximumHeight: Number.MAX_SAFE_INTEGER })
                // Ensure shell height respects minimum constraint
                const shellHeight = Math.max(panelSizesRef.current.shell, panelMinRef.current.shell)
                sApi.setSize({ height: shellHeight })
              }
            }
          }

          // Reset the collapsed effect flag so it doesn't override on first toggle
          collapsedEffectRan.current = true
        })
      } catch {
        layoutRestored.current = false
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- layout restoration effect intentionally omits derived/stable values to avoid re-triggering
  }, [
    dockApi,
    projectRoot,
    storagePrefix,
    layoutVersion,
    layoutPersistenceReady,
    markdownPane,
    userIdentityAuthResolved,
    capabilities,
    capabilitiesLoading,
    workspacePanesReady,
    collapsed.filetree,
    collapsed.terminal,
    collapsed.shell,
    collapsed.agent,
    openFile,
    openFileToSide,
    openDiff,
    activeFile,
    activeDiffFile,
    toggleFiletree,
    menuUserEmail,
    userMenuStatusMessage,
    userMenuStatusTone,
    handleUserMenuRetry,
    userMenuDisabledActions,
    activeWorkspaceName,
    currentWorkspaceId,
    handleSwitchWorkspace,
    handleCreateWorkspace,
    handleOpenUserSettings,
    handleOpenWorkspaceSettings,
    handleLogout,
    sectionCollapsed,
    toggleSectionCollapse,
    nativeAgentEnabled,
    getLeftSidebarGroups,
    leftSidebarCollapsedWidth,
    leftSidebarMinWidth,
    leftSidebarPanelIds,
    sidebarToggleHostId,
    activeSidebarPanelId,
    activateSidebarPanel,
    filetreeActivityIntent,
    catalogActivityIntent,
  ])

  // Track active panel to highlight in file tree and sync URL
  useEffect(() => {
    if (!dockApi) return
    const disposable = dockApi.onDidActivePanelChange((panel) => {
      if (panel?.id && leftSidebarPanelIds.includes(panel.id)) {
        setActiveSidebarPanelId(panel.id)
      }
      if (panel && panel.id && panel.id.startsWith('editor-')) {
        const path = panel.id.replace('editor-', '')
        setActiveFile(path)
        // Also set activeDiffFile if this file is in git changes
        setActiveDiffFile(path)
        // Sync URL for easy sharing/reload
        const url = new URL(window.location.href)
        url.searchParams.set('doc', path)
        window.history.replaceState({}, '', url)
      } else {
        setActiveFile(null)
        setActiveDiffFile(null)
        const url = new URL(window.location.href)
        const pendingUrlDoc = url.searchParams.has('doc') && !hasRestoredFromUrl.current
        // Preserve an initial ?doc=... long enough for the restore effect to consume it.
        if (!pendingUrlDoc) {
          url.searchParams.delete('doc')
          window.history.replaceState({}, '', url)
        }
      }
      void publishFrontendState(dockApi)
    })
    return () => disposable.dispose()
  }, [dockApi, publishFrontendState, leftSidebarPanelIds])

  // Update filetree panel params when openFile changes
  useEffect(() => {
    if (!dockApi) return
    const filetreePanel = dockApi.getPanel('filetree')
    const linkedSidebarPanels = leftSidebarPanelIds
      .filter((panelId) => panelId !== 'filetree')
      .map((panelId) => dockApi.getPanel(panelId))
      .filter(Boolean)
    if (filetreePanel) {
      filetreePanel.api.updateParameters({
        onOpenFile: openFile,
        onOpenFileToSide: openFileToSide,
        onOpenDiff: openDiff,
        projectRoot,
        activeFile,
        activeDiffFile,
        collapsed: collapsed.filetree,
        onToggleCollapse: toggleFiletree,
        showSidebarToggle: sidebarToggleHostId === 'filetree',
        appName: config.branding?.name || '',
        onOpenChatTab: handleOpenChatTab,
        sectionCollapsed: sectionCollapsed.filetree,
        onToggleSection: () => toggleSectionCollapse('filetree'),
        activeSidebarPanelId,
        onActivateSidebarPanel: activateSidebarPanel,
        filetreeActivityIntent,
        userEmail: menuUserEmail,
        userMenuStatusMessage,
        userMenuStatusTone,
        onUserMenuRetry: handleUserMenuRetry,
        userMenuDisabledActions,
        showSwitchWorkspace: userMenuCanSwitchWorkspace,
        workspaceName: activeWorkspaceName,
        workspaceId: currentWorkspaceId,
        onSwitchWorkspace: handleSwitchWorkspace,
        workspaceOptions,
        onCreateWorkspace: handleCreateWorkspace,
        onOpenUserSettings: handleOpenUserSettings,
        onOpenWorkspaceSettings: handleOpenWorkspaceSettings,
        onLogout: handleLogout,
        githubEnabled: capabilities?.features?.github === true,
        dataBackend: configuredDataBackend,
      })
    }
    linkedSidebarPanels.forEach((panel) => {
      const panelId = panel?.id
      panel.api.updateParameters({
        ...(panel?.params || {}),
        collapsed: collapsed.filetree,
        onToggleCollapse: toggleFiletree,
        showSidebarToggle: sidebarToggleHostId === panelId,
        appName: config.branding?.name || '',
        onOpenChatTab: handleOpenChatTab,
        sectionCollapsed: panelId ? sectionCollapsed[panelId] : false,
        onToggleSection: panelId ? () => toggleSectionCollapse(panelId) : undefined,
        activeSidebarPanelId,
        onActivateSidebarPanel: activateSidebarPanel,
        catalogActivityIntent,
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- panel update effect intentionally omits derived/stable values to avoid excessive re-renders
  }, [
    dockApi,
    openFile,
    openFileToSide,
    openDiff,
    projectRoot,
    activeFile,
    activeDiffFile,
    collapsed.filetree,
    toggleFiletree,
    sectionCollapsed,
    toggleSectionCollapse,
    menuUserEmail,
    userMenuStatusMessage,
    userMenuStatusTone,
    handleUserMenuRetry,
    userMenuDisabledActions,
    userMenuCanSwitchWorkspace,
    activeWorkspaceName,
    currentWorkspaceId,
    handleSwitchWorkspace,
    handleCreateWorkspace,
    handleOpenUserSettings,
    handleOpenWorkspaceSettings,
    handleLogout,
    handleOpenChatTab,
    leftSidebarPanelIds,
    sidebarToggleHostId,
    activeSidebarPanelId,
    activateSidebarPanel,
    filetreeActivityIntent,
    catalogActivityIntent,
    capabilities,
  ])

  // Update agent panel params
  useEffect(() => {
    if (!dockApi) return
    const agentPanels = listDockPanels(dockApi).filter(
      (panel) => getPanelComponent(panel) === 'agent',
    )
    agentPanels.forEach((panel) => {
      panel.api.updateParameters({
        ...(panel?.params || {}),
        panelId: panel.id,
        collapsed: false,
        onToggleCollapse: undefined,
        onSplitPanel: handleSplitChatPanel,
        mode: agentMode,
      })
    })
  }, [dockApi, collapsed.agent, toggleAgent, handleSplitChatPanel, agentMode])

  // Load workspace plugin panels when capabilities include them
  const workspacePanesKey = JSON.stringify(capabilities?.workspace_panes || [])
  useEffect(() => {
    let cancelled = false
    const panes = capabilities?.workspace_panes
    if (capabilitiesLoading) {
      setWorkspacePanesReady(false)
      return () => {
        cancelled = true
      }
    }

    if (!panes || panes.length === 0) {
      setWorkspacePanesReady(true)
      return () => {
        cancelled = true
      }
    }

    loadWorkspacePanes(panes).then((loaded) => {
      if (cancelled) return
      for (const [id, component] of Object.entries(loaded)) {
        const name = id.replace('ws-', '')
        registerPane({ id, component, title: name, placement: 'center' })
      }
      setWorkspaceComponents(loaded)
      setWorkspacePanesReady(true)
    }).catch(() => {
      if (cancelled) return
      setWorkspacePanesReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [capabilitiesLoading, workspacePanesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket for live workspace plugin hot-reload
  const workspacePluginsEnabled =
    (capabilities?.workspace_panes?.length || 0) > 0
    || (capabilities?.workspace_routes?.length || 0) > 0
  useWorkspacePlugins({
    onPluginChanged: refetchCapabilities,
    enabled: workspacePluginsEnabled,
  })

  // Re-run core panel/layout builder once capabilities are resolved.
  // This repairs first-load races where onReady executed before
  // capabilities arrived and persisted an incomplete layout.
  useEffect(() => {
    if (!dockApi || capabilitiesLoading || projectRoot === null || !layoutPersistenceReady) return
    if (layoutRestored.current) return
    if (ensureCorePanelsRef.current) {
      ensureCorePanelsRef.current()
    }
  }, [
    dockApi,
    capabilitiesLoading,
    capabilities,
    nativeAgentEnabled,
    projectRoot,
    layoutPersistenceReady,
  ])

  const startupChatOpened = useRef(false)

  // Remove legacy fixed right-rail chat panels from older layouts.
  // New chat panels are dynamic tab panels created via addChatPanel.
  useEffect(() => {
    if (!dockApi || capabilitiesLoading || !layoutPersistenceReady) return

    let removedLegacyPanel = false
    ;['terminal', 'agent'].forEach((panelId) => {
      const panel = dockApi.getPanel(panelId)
      if (panel) {
        panel.api.close()
        removedLegacyPanel = true
      }
    })

    if (!nativeAgentEnabled) {
      try {
        localStorage.removeItem(`${storagePrefix}-terminal-sessions`)
        localStorage.removeItem(`${storagePrefix}-terminal-active`)
        localStorage.removeItem(`${storagePrefix}-terminal-chat-interface`)
      } catch {
        // ignore storage cleanup errors
      }
    }

    if (removedLegacyPanel && typeof dockApi.toJSON === 'function') {
      saveLayout(storagePrefix, projectRootRef.current, dockApi.toJSON(), layoutVersionRef.current)
    }

    if (countAllAgentPanels(dockApi) === 0) {
      const opened = addChatPanel({ mode: 'split' })
      if (opened) {
        startupChatOpened.current = true
      }
    }
  }, [dockApi, capabilitiesLoading, nativeAgentEnabled, storagePrefix, addChatPanel, layoutPersistenceReady])

  // Always open one chat panel on startup when none exists.
  useEffect(() => {
    if (!dockApi || capabilitiesLoading || projectRoot === null || !layoutPersistenceReady) return
    if (!isInitialized.current || startupChatOpened.current) return

    // Run startup auto-open only once, so user-closing the last chat
    // does not trigger re-creation until a full reload.
    startupChatOpened.current = true
    if (countAllAgentPanels(dockApi) === 0) {
      addChatPanel({ mode: 'split' })
    }
  }, [dockApi, capabilitiesLoading, projectRoot, addChatPanel, layoutPersistenceReady])

  // Restore saved tabs when dockApi and projectRoot become available
  const hasRestoredTabs = useRef(false)
  useEffect(() => {
    // Wait for projectRoot to be loaded (null = not loaded yet)
    if (!dockApi || projectRoot === null || hasRestoredTabs.current) return
    hasRestoredTabs.current = true

    if (layoutRestored.current) {
      return
    }

    const savedPaths = loadSavedTabs(storagePrefix, projectRoot)
    if (savedPaths.length > 0) {
      // Small delay to ensure layout is ready
      setTimeout(() => {
        savedPaths.forEach((path) => {
          openFile(path)
        })
      }, 50)
    }
  }, [dockApi, projectRoot, openFile, storagePrefix])

  // Save open tabs to localStorage whenever tabs change (but not on initial empty state)
  useEffect(() => {
    // Wait for projectRoot to be loaded
    if (!isInitialized.current || projectRoot === null) return
    const paths = Object.keys(tabs)
    saveTabs(storagePrefix, projectRoot, paths)
  }, [tabs, projectRoot, storagePrefix])

  // Restore document from URL query param on load
  useEffect(() => {
    if (!dockApi || hasRestoredFromUrl.current) return

    const docPath = new URLSearchParams(window.location.search).get('doc')
    if (!docPath) return

    const existingPanel = dockApi.getPanel(`editor-${docPath}`)
    if (existingPanel) {
      hasRestoredFromUrl.current = true
      return
    }

    // Layout restoration can still replace center groups after the shell is mounted.
    // Retry until the requested doc panel actually exists, then mark the URL as consumed.
    let cancelled = false
    let attemptCount = 0
    let timerId = null
    const maxAttempts = 20

    const ensureDocPanel = () => {
      if (cancelled || hasRestoredFromUrl.current) return

      if (dockApi.getPanel(`editor-${docPath}`)) {
        hasRestoredFromUrl.current = true
        return
      }

      const openViaBridge = window[PI_OPEN_FILE_BRIDGE]
      if (typeof openViaBridge === 'function') {
        openViaBridge(docPath)
      } else {
        openFile(docPath)
      }
      attemptCount += 1

      requestAnimationFrame(() => {
        if (cancelled || hasRestoredFromUrl.current) return
        if (dockApi.getPanel(`editor-${docPath}`)) {
          hasRestoredFromUrl.current = true
          return
        }
        if (attemptCount >= maxAttempts) return
        timerId = window.setTimeout(ensureDocPanel, 250)
      })
    }

    timerId = window.setTimeout(ensureDocPanel, 150)

    return () => {
      cancelled = true
      if (timerId !== null) {
        window.clearTimeout(timerId)
      }
    }
  }, [dockApi, openFile, getLiveCenterGroup, tabs])

  const readDroppedSeriesId = useCallback((dataTransfer) => {
    const transferTypes = dataTransfer?.types && typeof dataTransfer.types[Symbol.iterator] === 'function'
      ? Array.from(dataTransfer.types)
      : []
    const hasCustomSeriesType = transferTypes.includes('text/series-id')
    const droppedSeriesFromCustomType = String(dataTransfer?.getData('text/series-id') || '').trim()
    const droppedPlainText = String(dataTransfer?.getData('text/plain') || '').trim()
    const droppedSeriesFromWindow = typeof window !== 'undefined'
      ? String(window.__BM_DND_SERIES_ID || '').trim()
      : ''
    return droppedSeriesFromCustomType
      || droppedSeriesFromWindow
      || (
        hasCustomSeriesType
        && droppedPlainText
        && !droppedPlainText.includes('/')
        && !droppedPlainText.includes('\\')
        ? droppedPlainText
        : ''
      )
  }, [])

  const routeSeriesDropToPanel = useCallback((targetPanel, droppedSeriesId) => {
    if (!targetPanel || !droppedSeriesId) return
    const nextDropNonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const targetPanelId = String(targetPanel?.id || targetPanel?.api?.id || '')

    // Primary delivery path for chart overlays: explicit browser event routed by panel id.
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('bm-chart-overlay-drop', {
        detail: {
          panelId: targetPanelId,
          seriesId: droppedSeriesId,
          nonce: nextDropNonce,
        },
      }))
    }
    if (typeof targetPanel.api?.setActive === 'function') {
      targetPanel.api.setActive()
    }
  }, [])

  const openSeriesAtPosition = useCallback((seriesId, position, mode = 'chart') => {
    if (!dockApi || !seriesId) return

    const normalizedMode = mode === 'table' ? 'table' : 'chart'
    const panelId = `chart-${seriesId}`
    const existing = dockApi.getPanel(panelId)
    if (existing) {
      existing.api.updateParameters({ seriesId, mode: normalizedMode })
      if (existing.group) existing.group.locked = false
      existing.api.setActive()
      return
    }

    const emptyPanel = dockApi.getPanel('empty-center')
    const panel = dockApi.addPanel({
      id: panelId,
      component: 'chart-canvas',
      title: seriesId,
      params: { seriesId, mode: normalizedMode },
      position,
    })

    if (panel?.group) {
      panel.group.locked = false
      panel.group.header.hidden = false
      centerGroupRef.current = panel.group
      panel.group.api?.setConstraints({
        minimumHeight: panelMinRef.current.center,
        maximumHeight: Number.MAX_SAFE_INTEGER,
      })
    }
    panel?.api?.setActive()

    if (emptyPanel) {
      requestAnimationFrame(() => {
        const staleEmpty = dockApi.getPanel('empty-center')
        if (staleEmpty) {
          staleEmpty.api.close()
        }
      })
    }
  }, [dockApi])

  const resolveDropPosition = useCallback((dropEvent) => {
    const dropGroup = dropEvent?.group
    const dropPanel = dropEvent?.panel || dropGroup?.activePanel
    const rawPosition = dropEvent?.position
    const activePanelId = String(dropPanel?.id || '')

    if (rawPosition && typeof rawPosition === 'object' && !Array.isArray(rawPosition)) {
      return rawPosition
    }

    const mappedDirection = (() => {
      switch (String(rawPosition || '')) {
        case 'top':
          return 'above'
        case 'bottom':
          return 'below'
        case 'left':
          return 'left'
        case 'right':
          return 'right'
        case 'center':
          return 'within'
        default:
          return ''
      }
    })()

    if (mappedDirection && activePanelId) {
      return { direction: mappedDirection, referencePanel: activePanelId }
    }

    if (dropGroup && !isLeftSidebarGroup(dropGroup)) {
      return { referenceGroup: dropGroup }
    }

    const centerGroup = getLiveCenterGroup(dockApi)
    if (centerGroup) {
      return { referenceGroup: centerGroup }
    }

    return getLeftSidebarAnchorPosition(dockApi)
  }, [dockApi, getLeftSidebarAnchorPosition, getLiveCenterGroup, isLeftSidebarGroup])

  const onDidDrop = (event) => {
    const dataTransfer = event?.nativeEvent?.dataTransfer
    if (!dataTransfer) return

    const fileDataStr = dataTransfer.getData('application/x-kurt-file')
    if (fileDataStr) {
      try {
        const fileData = JSON.parse(fileDataStr)
        const path = fileData.path

        openFileAtPosition(path, resolveDropPosition(event))
      } catch {
        // Ignore parse errors
      }
      return
    }

    const droppedSeriesId = readDroppedSeriesId(dataTransfer)
    if (!droppedSeriesId) return

    const targetPanel = event?.panel || event?.group?.activePanel
    if (targetPanel && getPanelComponent(targetPanel) === 'chart-canvas') {
      routeSeriesDropToPanel(targetPanel, droppedSeriesId)
      return
    }

    if (targetPanel?.id) {
      openSeriesAtPosition(droppedSeriesId, {
        direction: targetPanel.id === 'agent' ? 'left' : 'right',
        referencePanel: targetPanel.id,
      })
      return
    }

    openSeriesAtPosition(droppedSeriesId, resolveDropPosition(event))
  }

  // Fallback drop bridge for browsers/paths where Dockview external drops are suppressed.
  // Used for series overlay drops onto existing chart panels without split-target overlays.
  useEffect(() => {
    if (!dockApi || typeof document === 'undefined') return

    const dockRoot = document.querySelector('[data-testid="dockview"]')
    if (!dockRoot) return

    const resolvePanelFromTabElement = (tabElement) => {
      const tabTitle = String(
        tabElement?.querySelector?.('.dv-default-tab-content')?.textContent
          || tabElement?.textContent
          || '',
      ).trim()
      if (!tabTitle) return null

      const panels = listDockPanels(dockApi)
      const titleMatches = panels.filter((panel) => String(panel?.title || '').trim() === tabTitle)
      if (titleMatches.length === 0) return null
      if (titleMatches.length === 1) return titleMatches[0]
      return titleMatches.find((panel) => getPanelComponent(panel) === 'chart-canvas') || titleMatches[0]
    }

    const resolvePanelFromNativeTarget = (targetNode) => {
      const tabElement = targetNode?.closest?.('.dv-tab')
      if (tabElement) {
        return resolvePanelFromTabElement(tabElement)
      }

      const groupElement = targetNode?.closest?.('.dv-groupview')
      if (!groupElement) return null

      const groups = listDockGroups(dockApi)
      const group = groups.find((candidate) => candidate?.element === groupElement)
      return group?.activePanel || null
    }

    const onDragOverCapture = (nativeEvent) => {
      const droppedSeriesId = readDroppedSeriesId(nativeEvent.dataTransfer)
      if (!droppedSeriesId) return

      const targetNode = nativeEvent?.target
      if (!targetNode || typeof targetNode?.closest !== 'function') return
      const targetPanel = resolvePanelFromNativeTarget(targetNode)
      if (!targetPanel || getPanelComponent(targetPanel) !== 'chart-canvas') return

      nativeEvent.preventDefault()
      if (nativeEvent.dataTransfer) {
        nativeEvent.dataTransfer.dropEffect = 'copy'
      }
    }

    const onDropCapture = (nativeEvent) => {
      const droppedSeriesId = readDroppedSeriesId(nativeEvent.dataTransfer)
      if (!droppedSeriesId) return

      const targetNode = nativeEvent?.target
      if (!targetNode || typeof targetNode?.closest !== 'function') return
      const targetPanel = resolvePanelFromNativeTarget(targetNode)
      if (!targetPanel || getPanelComponent(targetPanel) !== 'chart-canvas') return

      nativeEvent.preventDefault()
      nativeEvent.stopPropagation()
      routeSeriesDropToPanel(targetPanel, droppedSeriesId)
    }

    dockRoot.addEventListener('dragover', onDragOverCapture, true)
    dockRoot.addEventListener('drop', onDropCapture, true)

    return () => {
      dockRoot.removeEventListener('dragover', onDragOverCapture, true)
      dockRoot.removeEventListener('drop', onDropCapture, true)
    }
  }, [dockApi, readDroppedSeriesId, routeSeriesDropToPanel])

  // Full-page auth views
  if (isAuthLoginPage) {
    return (
      <ThemeProvider>
        <AuthPage authConfig={{
          provider: capabilities?.auth?.provider || 'local',
          neonAuthUrl: capabilities?.auth?.neonAuthUrl || '',
          callbackUrl: capabilities?.auth?.callbackUrl || '',
          emailProvider: capabilities?.auth?.emailProvider || '',
          verificationEmailEnabled: capabilities?.auth?.verificationEmailEnabled !== false,
          redirectUri: new URLSearchParams(window.location.search).get('redirect_uri') || '/',
          initialMode: pagePathname === '/auth/signup'
            ? 'sign_up'
            : pagePathname === '/auth/reset-password'
              ? 'reset_password'
              : 'sign_in',
          appName: capabilities?.auth?.appName || '',
          appDescription: capabilities?.auth?.appDescription || '',
        }} />
      </ThemeProvider>
    )
  }

  if (isAuthCallbackPage) {
    return (
      <ThemeProvider>
        <AuthCallbackPage />
      </ThemeProvider>
    )
  }

  // Auth guard: redirect unauthenticated users to login when control plane is enabled
  // Only enforce when hosted auth is configured; local/dev control-plane mode
  // can run without a frontend login screen.
  const authProviderConfigured = capabilities?.auth?.provider === 'neon' && !!capabilities?.auth?.neonAuthUrl
  if (
    capabilities?.features?.control_plane &&
    authProviderConfigured &&
    userMenuAuthStatus === 'unauthenticated' &&
    !isAuthLoginPage &&
    !isAuthCallbackPage
  ) {
    // Guard against infinite redirect loops: bail after 3 attempts
    const url = new URL(window.location.href)
    const attempts = parseInt(url.searchParams.get('auth_attempts') || '0', 10)
    if (attempts >= 3) {
      return (
        <ThemeProvider>
          <div className="app-error-boundary">
            <div className="app-error-boundary-content">
              <h1 className="app-error-boundary-title">Authentication Error</h1>
              <p className="app-error-boundary-message">
                Unable to sign in after multiple attempts. The auth service may be unavailable.
              </p>
              <button
                type="button"
                className="app-error-boundary-reload"
                onClick={() => { window.location.href = '/auth/login' }}
              >
                Try Again
              </button>
            </div>
          </div>
        </ThemeProvider>
      )
    }
    const redirectUri = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.replace(`/auth/login?redirect_uri=${redirectUri}&auth_attempts=${attempts + 1}`)
    return null
  }

  // Full-page settings views (render instead of DockView)
  if (isUserSettingsPage) {
    return (
      <ThemeProvider>
        <UserSettingsPage workspaceId={userSettingsWorkspaceId || currentWorkspaceId} />
      </ThemeProvider>
    )
  }

  if (isWorkspaceSettingsPage) {
    return (
      <ThemeProvider>
        <WorkspaceSettingsPage workspaceId={currentWorkspaceId} capabilities={capabilities} />
      </ThemeProvider>
    )
  }

  if (isWorkspaceSetupPage) {
    return (
      <ThemeProvider>
        <WorkspaceSetupPage
          workspaceId={currentWorkspaceId}
          workspaceName={activeWorkspaceName}
          capabilities={capabilities}
          capabilitiesPending={capabilitiesPending}
          onComplete={() => {
            const scope = routes.controlPlane.workspaces.scope(currentWorkspaceId)
            window.location.assign(routeHref(scope))
          }}
        />
      </ThemeProvider>
    )
  }

  // Build className with collapsed state flags for CSS targeting
  const dockviewClassName = [
    'dockview-theme-abyss',
    collapsed.filetree && 'filetree-is-collapsed',
    collapsed.terminal && 'terminal-is-collapsed',
    collapsed.agent && 'agent-is-collapsed',
    collapsed.shell && 'shell-is-collapsed',
  ].filter(Boolean).join(' ')

  return (
    <QueryClientProvider key={dataProviderScopeKey} client={queryClient}>
      <DataContext.Provider key={dataProviderScopeKey} value={dataProvider}>
        <ThemeProvider>
          <TooltipProvider delayDuration={300} skipDelayDuration={100}>
          <div className="app-container">
            <a className="skip-to-content-link" href={`#${MAIN_CONTENT_ID}`}>
              Skip to main content
            </a>
            {config.features?.showHeader !== false && (
              <header className="app-header">
                <div className="app-header-brand">
                  <div className="app-header-logo" aria-hidden="true">
                    {config.branding?.logo || 'B'}
                  </div>
                  <div className="app-header-title">
                    {config.branding?.name || projectRoot?.split('/').pop() || 'Workspace'}
                  </div>
                </div>
                <div className="app-header-controls">
                  <ThemeToggle />
                </div>
              </header>
            )}
            <main id={MAIN_CONTENT_ID} className="app-main-content" tabIndex={-1}>
              {unavailableEssentials.length > 0 && (
                <div className="capability-warning">
                  <strong>Warning:</strong> Some features are unavailable.
                  Missing capabilities for: {unavailableEssentials.map(p => p.title || p.id).join(', ')}.
                </div>
              )}
              <UserIdentityProvider value={userIdentity}>
                <CapabilitiesStatusContext.Provider value={{ pending: capabilitiesPending }}>
                  <CapabilitiesContext.Provider value={capabilities}>
                    {(capabilitiesPending || !userIdentityAuthResolved) ? (
                      <WorkspaceLoading />
                    ) : (
                      <div data-testid="dockview" className="dockview-host">
                        <DockviewReact
                          className={dockviewClassName}
                          components={components}
                          tabComponents={tabComponents}
                          defaultTabComponent={UnifiedDockTab}
                          rightHeaderActionsComponent={RightHeaderActions}
                          onReady={onReady}
                          onDidDrop={onDidDrop}
                        />
                      </div>
                    )}
                  </CapabilitiesContext.Provider>
                </CapabilitiesStatusContext.Provider>
              </UserIdentityProvider>
            </main>
            {showCreateWorkspaceModal && (
              <CreateWorkspaceModal
                onClose={() => setShowCreateWorkspaceModal(false)}
                onCreate={handleCreateWorkspaceSubmit}
              />
            )}
          </div>
          </TooltipProvider>
        </ThemeProvider>
      </DataContext.Provider>
    </QueryClientProvider>
  )
}

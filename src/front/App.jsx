import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { DockviewReact, DockviewDefaultTab } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

import { ThemeProvider, useCapabilities, useKeyboardShortcuts } from './hooks'
import { useWorkspacePlugins } from './hooks/useWorkspacePlugins'
import { loadWorkspacePanes } from './workspace/loader'
import { useConfig } from './config'
import { apiFetch, apiFetchJson, getHttpErrorDetail } from './utils/transport'
import { buildApiUrl } from './utils/apiBase'
import { routes } from './utils/routes'
import {
  extractUserEmail,
  extractWorkspaceId,
  getWorkspaceIdFromPathname,
  getWorkspacePathSuffix,
  normalizeWorkspaceList,
  runWithPreflightFallback,
} from './utils/controlPlane'
import {
  resolveWorkspaceNavigationRouteFromPathname,
  syncWorkspaceRuntimeAndSettings,
} from './utils/workspaceNavigation'
import {
  LAYOUT_VERSION,
  validateLayoutStructure,
  loadSavedTabs,
  saveTabs,
  loadLayout,
  saveLayout,
  loadCollapsedState,
  saveCollapsedState,
  loadPanelSizes,
  savePanelSizes,
  pruneEmptyGroups,
  getStorageKey,
  getFileName,
} from './layout'
import ThemeToggle from './components/ThemeToggle'
import ClaudeStreamChat from './components/chat/ClaudeStreamChat'
import {
  CapabilitiesContext,
  CapabilitiesStatusContext,
  createCapabilityGatedPane,
} from './components/CapabilityGate'
import paneRegistry, {
  getPane,
  registerPane,
  getGatedComponents,
  getKnownComponents,
  getUnavailableEssentialPanes,
} from './registry/panes'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  getQueryClient,
  getDataProvider,
  getDataProviderFactory,
  createHttpProvider,
  createLightningDataProvider,
  createCheerpXDataProvider,
  queryKeys,
} from './providers/data'
import DataContext from './providers/data/DataContext'
import { PI_LIST_TABS_BRIDGE, PI_OPEN_FILE_BRIDGE, PI_OPEN_PANEL_BRIDGE } from './providers/pi/uiBridge'
import UserSettingsPage from './pages/UserSettingsPage'
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage'
import CreateWorkspaceModal from './pages/CreateWorkspaceModal'

const URL_PARAMS = new URLSearchParams(window.location.search)
// POC mode - add ?poc=chat, ?poc=diff, or ?poc=tiptap-diff to URL to test
const POC_MODE = URL_PARAMS.get('poc')
const DATA_BACKEND_OVERRIDE = String(URL_PARAMS.get('data_backend') || '').trim().toLowerCase()
const DATA_FS_OVERRIDE = String(URL_PARAMS.get('data_fs') || '').trim()

// Debounce helper - delays function execution until after wait ms of inactivity
const debounce = (fn, wait) => {
  let timeoutId = null
  const debounced = (...args) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      timeoutId = null
      fn(...args)
    }, wait)
  }
  // Allow immediate flush (for beforeunload)
  debounced.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
      fn()
    }
  }
  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }
  return debounced
}

const panelIdToConfigKey = (panelId) =>
  String(panelId || '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())

const getPanelSizeConfigValue = (sizeConfig, panelId, fallbackKey) => {
  if (!sizeConfig || !panelId) return undefined
  const direct = sizeConfig[panelId]
  if (Number.isFinite(direct)) return direct
  const camelKey = panelIdToConfigKey(panelId)
  const camel = sizeConfig[camelKey]
  if (Number.isFinite(camel)) return camel
  const fallback = sizeConfig[fallbackKey]
  return Number.isFinite(fallback) ? fallback : undefined
}

const createFrontendStateClientId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const getFrontendStateClientId = (storagePrefix) => {
  const key = `${storagePrefix}-frontend-state-client-id`
  try {
    const existing = window.sessionStorage?.getItem(key)
    if (existing) return existing
    const created = createFrontendStateClientId()
    window.sessionStorage?.setItem(key, created)
    return created
  } catch {
    return createFrontendStateClientId()
  }
}

const MAX_SNAPSHOT_DEPTH = 4
const MAX_SNAPSHOT_ARRAY_ITEMS = 32
const MAX_SNAPSHOT_OBJECT_KEYS = 64
const MAX_SNAPSHOT_STRING_LENGTH = 2048

const sanitizeSnapshotValue = (value, depth = 0, seen = new WeakSet()) => {
  if (value == null) return value
  const kind = typeof value
  if (kind === 'string') {
    if (value.length <= MAX_SNAPSHOT_STRING_LENGTH) {
      return value
    }
    return `${value.slice(0, MAX_SNAPSHOT_STRING_LENGTH)}...`
  }
  if (kind === 'number' || kind === 'boolean') {
    return value
  }
  if (kind === 'bigint') {
    return value.toString()
  }
  if (kind === 'function' || kind === 'symbol' || kind === 'undefined') {
    return undefined
  }
  if (depth >= MAX_SNAPSHOT_DEPTH) return undefined

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_SNAPSHOT_ARRAY_ITEMS)
      .map((item) => sanitizeSnapshotValue(item, depth + 1, seen))
      .filter((item) => item !== undefined)
  }

  if (kind === 'object') {
    if (seen.has(value)) return undefined
    seen.add(value)
    const out = {}
    Object.entries(value)
      .slice(0, MAX_SNAPSHOT_OBJECT_KEYS)
      .forEach(([key, entry]) => {
        const sanitized = sanitizeSnapshotValue(entry, depth + 1, seen)
        if (sanitized !== undefined) out[key] = sanitized
      })
    return out
  }

  return undefined
}

const collectFrontendStateSnapshot = (api, clientId, projectRoot) => {
  const activePanelId = api?.activePanel?.id ?? null
  const panels = Array.isArray(api?.panels)
    ? api.panels
    : typeof api?.getPanels === 'function'
      ? api.getPanels()
      : []

  const openPanels = panels
    .filter((panel) => typeof panel?.id === 'string' && panel.id.length > 0)
    .map((panel) => {
      const params = sanitizeSnapshotValue(
        panel?.params ?? panel?.api?.params ?? panel?.api?.parameters ?? {},
      ) || {}
      const entry = {
        id: panel.id,
        component: panel?.api?.component ?? panel?.component ?? null,
        title: panel?.api?.title ?? panel?.title ?? null,
        active: panel.id === activePanelId,
        params,
      }
      if (panel?.group?.id) entry.group_id = panel.group.id
      return entry
    })

  return {
    client_id: clientId,
    project_root: projectRoot || null,
    active_panel_id: activePanelId,
    open_panels: openPanels,
    captured_at_ms: Date.now(),
    meta: {
      pane_count: openPanels.length,
    },
  }
}

const isCenterContentPanel = (panel, registry) => {
  if (!panel?.id || panel.id === 'empty-center') return false
  if (panel.id.startsWith('editor-') || panel.id.startsWith('review-')) return true

  const componentId = panel?.api?.component ?? panel?.component
  if (typeof componentId !== 'string' || componentId.length === 0) return false
  const paneConfig = registry?.get?.(componentId)
  return paneConfig?.placement === 'center'
}

const listDockPanels = (api) => {
  if (!api) return []
  if (Array.isArray(api.panels)) return api.panels
  if (typeof api.getPanels === 'function') return api.getPanels()
  return []
}

const listDockGroups = (api) => {
  if (!api) return []
  if (Array.isArray(api.groups)) return api.groups
  if (typeof api.getGroups === 'function') return api.getGroups()
  return []
}

const getPanelComponent = (panel) => panel?.api?.component ?? panel?.component ?? ''

const countAgentPanels = (api, family) => {
  const panels = listDockPanels(api)
  if (family === 'terminal') {
    return panels.filter((panel) => getPanelComponent(panel) === 'terminal').length
  }
  if (family === 'companion') {
    return panels.filter(
      (panel) =>
        getPanelComponent(panel) === 'companion'
        && (panel?.params?.provider || 'companion') === 'companion',
    ).length
  }
  if (family === 'pi') {
    return panels.filter(
      (panel) =>
        getPanelComponent(panel) === 'companion'
        && ((panel?.params?.provider === 'pi') || panel.id === 'pi-agent'),
    ).length
  }
  return 0
}

const panelIdToAgentFamily = (panelId) => {
  if (panelId === 'terminal' || panelId.startsWith('terminal-chat-')) return 'terminal'
  if (panelId === 'companion' || panelId.startsWith('companion-chat-')) return 'companion'
  if (panelId === 'pi-agent' || panelId.startsWith('pi-agent-chat-')) return 'pi'
  return null
}

const countAllAgentPanels = (api) =>
  countAgentPanels(api, 'terminal')
  + countAgentPanels(api, 'companion')
  + countAgentPanels(api, 'pi')

// Get capability-gated components from pane registry
// Components with requiresFeatures/requiresRouters will show error states when unavailable
const KNOWN_COMPONENTS = getKnownComponents()

// Custom tab component that hides close button (for shell tabs)
const TabWithoutClose = (props) => <DockviewDefaultTab {...props} hideClose />

const tabComponents = {
  noClose: TabWithoutClose,
}

export default function App() {
  // Get config (defaults are used until async load completes)
  const config = useConfig()
  const codeSessionsEnabled = config.features?.codeSessions !== false
  const urlAgentMode = new URLSearchParams(window.location.search).get('agent_mode')
  const configAgentMode = config.features?.agentRailMode || 'all'
  const validAgentModes = ['all', 'native', 'companion', 'pi']
  const fallbackAgentMode = validAgentModes.includes(configAgentMode) ? configAgentMode : 'all'
  const agentRailMode = validAgentModes.includes(urlAgentMode)
    ? urlAgentMode
    : fallbackAgentMode
  const nativeAgentEnabled = codeSessionsEnabled && (agentRailMode === 'all' || agentRailMode === 'native')
  const companionAgentEnabled = agentRailMode === 'all' || agentRailMode === 'companion'
  const piAgentEnabled = agentRailMode === 'all' || agentRailMode === 'pi'
  const controlPlaneOnboardingEnabled = config.features?.controlPlaneOnboarding === true
  const storagePrefix = config.storage?.prefix || 'kurt-web'
  const layoutVersion = config.storage?.layoutVersion || 1

  // Panel sizing configuration from config
  const panelDefaults = config.panels?.defaults || { filetree: 280, terminal: 400, companion: 400, shell: 250 }
  const panelMin = config.panels?.min || { filetree: 180, terminal: 250, companion: 250, shell: 100, center: 200 }
  const panelCollapsed = config.panels?.collapsed || { filetree: 48, terminal: 48, companion: 48, shell: 36 }
  const rightRailDefaults = {
    companion:
      Number.isFinite(panelDefaults.companion) ? panelDefaults.companion : panelDefaults.terminal,
    companionMin:
      Number.isFinite(panelMin.companion) ? panelMin.companion : panelMin.terminal,
    companionCollapsed:
      Number.isFinite(panelCollapsed.companion) ? panelCollapsed.companion : panelCollapsed.terminal,
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
  const { capabilities: serverCapabilities, loading: capabilitiesLoading, refetch: refetchCapabilities } = useCapabilities()
  const capabilities = useMemo(() => {
    if (!staticCapabilities) return serverCapabilities
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
  }, [staticCapabilities, serverCapabilities])
  const capabilitiesRef = useRef(capabilities)
  const capabilitiesLoadingRef = useRef(capabilitiesLoading)
  capabilitiesRef.current = capabilities
  capabilitiesLoadingRef.current = capabilitiesLoading

  // Workspace plugin components loaded dynamically
  const [workspaceComponents, setWorkspaceComponents] = useState({})

  const components = useMemo(() => {
    const gated = getGatedComponents(createCapabilityGatedPane)
    const merged = { ...gated, ...workspaceComponents }
    if (nativeAgentEnabled) return merged
    const next = { ...merged }
    delete next.terminal
    return next
  }, [nativeAgentEnabled, workspaceComponents])

  const capabilitiesFeatureCount = Object.keys(capabilities?.features || {}).length
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
    ? getUnavailableEssentialPanes(capabilities).filter(
        (pane) => nativeAgentEnabled || pane.id !== 'terminal',
      )
    : []

  const [dockApi, setDockApi] = useState(null)
  const [tabs, setTabs] = useState({}) // path -> { content, isDirty }
  const [approvals, setApprovals] = useState([])
  const [approvalsLoaded, setApprovalsLoaded] = useState(false)
  const [activeFile, setActiveFile] = useState(null)
  const [activeDiffFile, setActiveDiffFile] = useState(null)
  const [menuUserEmail, setMenuUserEmail] = useState('')
  const [userMenuAuthStatus, setUserMenuAuthStatus] = useState('unknown') // unknown | authenticated | unauthenticated | error
  const [userMenuIdentityError, setUserMenuIdentityError] = useState('')
  const [userMenuWorkspaceError, setUserMenuWorkspaceError] = useState('')
  const [workspaceOptions, setWorkspaceOptions] = useState([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() =>
    getWorkspaceIdFromPathname(window.location.pathname),
  )
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false)

  // Detect full-page views from URL path
  const pagePathname = window.location.pathname
  const workspaceSubpath = getWorkspacePathSuffix(pagePathname)
  const isUserSettingsPage = pagePathname === '/auth/settings'
  const isWorkspaceSettingsPage = currentWorkspaceId && workspaceSubpath === 'settings'
  const isFullPageView = isUserSettingsPage || isWorkspaceSettingsPage

  const [collapsed, setCollapsed] = useState(() => {
    const saved = loadCollapsedState(storagePrefix)
    return { filetree: false, terminal: false, shell: false, companion: false, ...saved }
  })
  const [sectionCollapsed, setSectionCollapsed] = useState({})
  const panelSizesRef = useRef({
    ...panelDefaults,
    companion: rightRailDefaults.companion,
    ...(loadPanelSizes(storagePrefix) || {}),
  })
  const collapsedEffectRan = useRef(false)
  const dismissedApprovalsRef = useRef(new Set())
  const agentAutoAddSuppressedRef = useRef({
    terminal: false,
    companion: false,
    pi: false,
  })
  const centerGroupRef = useRef(null)
  const isInitialized = useRef(false)
  const layoutRestored = useRef(false)
  const ensureCorePanelsRef = useRef(null)
  const [projectRoot, setProjectRoot] = useState(null) // null = not loaded yet, '' = loaded but empty
  const projectRootRef = useRef(null) // Stable ref for callbacks
  const frontendStateClientIdRef = useRef('')
  const frontendStateUnavailableRef = useRef(false)
  const frontendCommandUnavailableRef = useRef(false)
  const storagePrefixRef = useRef(storagePrefix) // Stable ref for callbacks
  storagePrefixRef.current = storagePrefix
  const layoutVersionRef = useRef(layoutVersion) // Stable ref for callbacks
  layoutVersionRef.current = layoutVersion
  projectRootRef.current = projectRoot

  if (!frontendStateClientIdRef.current) {
    frontendStateClientIdRef.current = getFrontendStateClientId(storagePrefix)
  }

  // --- DataProvider infrastructure ---
  // If setDataProvider() was called before mount (poc1/poc2), use that;
  // otherwise resolve from config.data.backend (with HTTP fallback).
  const queryClient = useMemo(() => getQueryClient(), [])
  const configuredDataBackend = String(DATA_BACKEND_OVERRIDE || config.data?.backend || 'http')
    .trim()
    .toLowerCase()
  const configuredLightningFsName = String(
    DATA_FS_OVERRIDE || config.data?.lightningfs?.name || 'boring-fs',
  )
    .trim()
  const configuredCheerpXWorkspaceRoot = String(config.data?.cheerpx?.workspaceRoot || '').trim()
  const configuredCheerpXPrimaryDiskUrl = String(config.data?.cheerpx?.primaryDiskUrl || '').trim()
  const configuredCheerpXOverlayName = String(config.data?.cheerpx?.overlayName || '').trim()
  const configuredCheerpXEsmUrl = String(config.data?.cheerpx?.cheerpxEsmUrl || '').trim()
  const strictDataBackend = Boolean(config.data?.strictBackend)
  const dataProvider = useMemo(
    () => {
      const injected = getDataProvider()
      if (injected) return injected

      if (!configuredDataBackend || configuredDataBackend === 'http') {
        return createHttpProvider()
      }

      if (configuredDataBackend === 'lightningfs' || configuredDataBackend === 'lightning-fs') {
        return createLightningDataProvider({ fsName: configuredLightningFsName })
      }

      if (configuredDataBackend === 'cheerpx' || configuredDataBackend === 'cheerp-x') {
        return createCheerpXDataProvider({
          workspaceRoot: configuredCheerpXWorkspaceRoot || undefined,
          primaryDiskUrl: configuredCheerpXPrimaryDiskUrl || undefined,
          overlayName: configuredCheerpXOverlayName || undefined,
          cheerpxEsmUrl: configuredCheerpXEsmUrl || undefined,
        })
      }

      const factory = getDataProviderFactory(configuredDataBackend)
      if (factory) return factory()

      if (strictDataBackend) {
        throw new Error(
          `[DataProvider] Unknown configured backend "${configuredDataBackend}" (strict mode enabled)`,
        )
      }

      console.warn(
        `[DataProvider] Unknown configured backend "${configuredDataBackend}", falling back to http`,
      )
      return createHttpProvider()
    },
    [
      configuredDataBackend,
      configuredLightningFsName,
      configuredCheerpXWorkspaceRoot,
      configuredCheerpXPrimaryDiskUrl,
      configuredCheerpXOverlayName,
      configuredCheerpXEsmUrl,
      strictDataBackend,
    ],
  )

  useEffect(() => {
    frontendStateClientIdRef.current = getFrontendStateClientId(storagePrefix)
    frontendStateUnavailableRef.current = false
    frontendCommandUnavailableRef.current = false
  }, [storagePrefix])

  const publishFrontendState = useCallback(async (api, options = {}) => {
    const targetApi = api || dockApi
    if (!targetApi) return false

    const force = options.force === true
    const transport = options.transport === 'beacon' ? 'beacon' : 'fetch'

    if (frontendStateUnavailableRef.current && !force) {
      return false
    }

    if (!frontendStateClientIdRef.current) {
      frontendStateClientIdRef.current = getFrontendStateClientId(storagePrefixRef.current)
    }

    const route = routes.uiState.upsert()
    const snapshot = collectFrontendStateSnapshot(
      targetApi,
      frontendStateClientIdRef.current,
      projectRootRef.current,
    )

    if (
      transport === 'beacon'
      && typeof navigator !== 'undefined'
      && typeof navigator.sendBeacon === 'function'
    ) {
      try {
        const body = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
        return navigator.sendBeacon(buildApiUrl(route.path, route.query), body)
      } catch {
        return false
      }
    }

    try {
      const response = await apiFetch(route.path, {
        query: route.query,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
        keepalive: true,
      })
      if (response.ok) {
        frontendStateUnavailableRef.current = false
        return true
      }
      if (response.status === 404 || response.status === 405) {
        frontendStateUnavailableRef.current = true
      }
    } catch {
      // Ignore transient publish failures (network/server startup races).
    }
    return false
  }, [dockApi])

  useEffect(() => {
    if (!dockApi || projectRoot === null) return
    void publishFrontendState(dockApi, { force: true })
  }, [dockApi, projectRoot, publishFrontendState])

  // Refs for panel config (used in callbacks)
  const panelCollapsedRef = useRef({ ...panelCollapsed, companion: rightRailDefaults.companionCollapsed })
  panelCollapsedRef.current = { ...panelCollapsed, companion: rightRailDefaults.companionCollapsed }
  const panelMinRef = useRef({ ...panelMin, companion: rightRailDefaults.companionMin })
  panelMinRef.current = { ...panelMin, companion: rightRailDefaults.companionMin }
  const activeWorkspaceName = useMemo(() => {
    const match = workspaceOptions.find((workspace) => workspace.id === currentWorkspaceId)
    if (match?.name) return match.name
    if (!currentWorkspaceId && projectRoot) {
      return projectRoot.split('/').filter(Boolean).pop() || ''
    }
    return ''
  }, [workspaceOptions, currentWorkspaceId, projectRoot])

  const userMenuStatusMessage = userMenuIdentityError || userMenuWorkspaceError
  const userMenuStatusTone = userMenuStatusMessage ? 'error' : ''
  const userMenuCanSwitchWorkspace = useMemo(() => {
    if (!currentWorkspaceId) return false
    return workspaceOptions.some(
      (workspace) => workspace?.id && workspace.id !== currentWorkspaceId,
    )
  }, [workspaceOptions, currentWorkspaceId])
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

  const getLeftSidebarGroups = useCallback((api) => {
    if (!api) return []
    const groups = []
    const seen = new Set()
    leftSidebarPanelIds.forEach((panelId) => {
      const group = api.getPanel(panelId)?.group
      if (!group || seen.has(group.id)) return
      seen.add(group.id)
      groups.push(group)
    })
    return groups
  }, [leftSidebarPanelIds])

  // Toggle sidebar collapse - capture size before collapsing
  const toggleFiletree = useCallback(() => {
    if (!collapsed.filetree && dockApi) {
      // Capture current left-column size before collapsing.
      const leftGroups = getLeftSidebarGroups(dockApi)
      const currentWidth = leftGroups[0]?.api?.width
      const collapsedWidth = leftSidebarCollapsedWidth
      if (Number.isFinite(currentWidth) && currentWidth > collapsedWidth) {
          panelSizesRef.current = { ...panelSizesRef.current, filetree: currentWidth }
          savePanelSizes(panelSizesRef.current, storagePrefixRef.current)
      }
    }
    setCollapsed((prev) => {
      const next = { ...prev, filetree: !prev.filetree }
      saveCollapsedState(next, storagePrefixRef.current)
      return next
    })
  }, [collapsed.filetree, dockApi, getLeftSidebarGroups, leftSidebarCollapsedWidth])

  const toggleTerminal = useCallback(() => {
    if (!nativeAgentEnabled) return
    if (!collapsed.terminal && dockApi) {
      // Capture current size before collapsing
      const terminalPanel = dockApi.getPanel('terminal')
      const terminalGroup = terminalPanel?.group
      if (terminalGroup) {
        const currentWidth = terminalGroup.api.width
        if (currentWidth > panelCollapsedRef.current.terminal) {
          panelSizesRef.current = { ...panelSizesRef.current, terminal: currentWidth }
          savePanelSizes(panelSizesRef.current, storagePrefixRef.current)
        }
      }
    }
    setCollapsed((prev) => {
      const next = { ...prev, terminal: !prev.terminal }
      saveCollapsedState(next, storagePrefixRef.current)
      return next
    })
  }, [collapsed.terminal, dockApi, nativeAgentEnabled])

  const toggleCompanion = useCallback(() => {
    if (!collapsed.companion && dockApi) {
      const companionPanel = dockApi.getPanel('companion')
      const companionGroup = companionPanel?.group
      if (companionGroup) {
        const currentWidth = companionGroup.api.width
        if (currentWidth > panelCollapsedRef.current.companion) {
          panelSizesRef.current = { ...panelSizesRef.current, companion: currentWidth }
          savePanelSizes(panelSizesRef.current, storagePrefixRef.current)
        }
      }
    }
    setCollapsed((prev) => {
      const next = { ...prev, companion: !prev.companion }
      saveCollapsedState(next, storagePrefixRef.current)
      return next
    })
  }, [collapsed.companion, dockApi])

  const SECTION_HEADER_HEIGHT = 28
  const LEFT_PANE_HEADER_HEIGHT = 24
  const PANEL_FOOTER_HEIGHT = 56
  const sectionSizesRef = useRef({})

  const toggleSectionCollapse = useCallback((panelId) => {
    if (!dockApi) return
    const panel = dockApi.getPanel(panelId)
    const group = panel?.group
    // First sidebar panel renders LeftPaneHeader; filetree has always-visible footer
    const isFirstPanel = leftSidebarPanelIds[0] === panelId
    const hasFooter = panelId === 'filetree'
    const collapsedHeight = SECTION_HEADER_HEIGHT
      + (isFirstPanel ? LEFT_PANE_HEADER_HEIGHT : 0)
      + (hasFooter ? PANEL_FOOTER_HEIGHT : 0)
    if (group && !sectionCollapsed[panelId]) {
      // Capture current height before collapsing
      const currentHeight = group.api.height
      if (currentHeight > collapsedHeight) {
        sectionSizesRef.current = { ...sectionSizesRef.current, [panelId]: currentHeight }
      }
    }
    const isLastPanel = leftSidebarPanelIds[leftSidebarPanelIds.length - 1] === panelId
    setSectionCollapsed((prev) => {
      const next = { ...prev, [panelId]: !prev[panelId] }
      // Apply constraints immediately
      if (group) {
        if (next[panelId]) {
          // Last panel keeps flexible max so its footer sticks to bottom
          group.api.setConstraints({
            minimumHeight: collapsedHeight,
            maximumHeight: isLastPanel ? Number.MAX_SAFE_INTEGER : collapsedHeight,
          })
          if (!isLastPanel) {
            group.api.setSize({ height: collapsedHeight })
          }
        } else {
          group.api.setConstraints({
            minimumHeight: 60,
            maximumHeight: Number.MAX_SAFE_INTEGER,
          })
          const savedHeight = sectionSizesRef.current[panelId]
          if (Number.isFinite(savedHeight) && savedHeight > 60) {
            group.api.setSize({ height: savedHeight })
          }
        }
      }
      return next
    })
  }, [dockApi, sectionCollapsed, leftSidebarPanelIds])

  const toggleShell = useCallback(() => {
    if (!collapsed.shell && dockApi) {
      // Capture current size before collapsing
      const shellPanel = dockApi.getPanel('shell')
      const shellGroup = shellPanel?.group
      if (shellGroup) {
        const currentHeight = shellGroup.api.height
        if (currentHeight > panelCollapsedRef.current.shell) {
          panelSizesRef.current = { ...panelSizesRef.current, shell: currentHeight }
          savePanelSizes(panelSizesRef.current, storagePrefixRef.current)
        }
      }
    }
    setCollapsed((prev) => {
      const next = { ...prev, shell: !prev.shell }
      saveCollapsedState(next, storagePrefixRef.current)
      return next
    })
  }, [collapsed.shell, dockApi])

  // Close active tab handler for keyboard shortcut
  const closeTab = useCallback(() => {
    if (!dockApi) return
    const activePanel = dockApi.activePanel
    // Only close editor tabs (not essential panels like filetree, terminal, shell)
    if (activePanel && activePanel.id.startsWith('editor-')) {
      activePanel.api.close()
    }
  }, [dockApi])

  // Toggle theme handler (dispatches event for ThemeProvider to handle)
  const toggleTheme = useCallback(() => {
    // Dispatch custom event that ThemeProvider listens to
    window.dispatchEvent(new CustomEvent('theme-toggle-request'))
  }, [])

  const syncWorkspacePathContext = useCallback(() => {
    setCurrentWorkspaceId(getWorkspaceIdFromPathname(window.location.pathname))
  }, [])

  useEffect(() => {
    syncWorkspacePathContext()
    window.addEventListener('popstate', syncWorkspacePathContext)
    return () => {
      window.removeEventListener('popstate', syncWorkspacePathContext)
    }
  }, [syncWorkspacePathContext])

  const fetchWorkspaceList = useCallback(async () => {
    const route = routes.controlPlane.workspaces.list()
    try {
      const { response, data } = await apiFetchJson(route.path, { query: route.query })
      if (!response.ok) {
        if (response.status === 401) {
          setUserMenuWorkspaceError('Not signed in.')
        } else if (response.status === 403) {
          setUserMenuWorkspaceError('Permission denied while loading workspaces.')
        } else {
          setUserMenuWorkspaceError(getHttpErrorDetail(response, data, 'Failed to load workspaces'))
        }
        return []
      }

      setUserMenuWorkspaceError('')
      const workspaces = normalizeWorkspaceList(data)
      setWorkspaceOptions(workspaces)
      return workspaces
    } catch (error) {
      console.warn('[UserMenu] Workspaces load failed:', error)
      setUserMenuWorkspaceError('Failed to reach control plane for workspaces.')
      return []
    }
  }, [])

  const refreshUserMenuData = useCallback(async () => {
    const meRoute = routes.controlPlane.me.get()
    setUserMenuIdentityError('')

    let meResponse = null
    let meData = {}
    try {
      const result = await apiFetchJson(meRoute.path, { query: meRoute.query })
      meResponse = result.response
      meData = result.data
    } catch (error) {
      console.warn('[UserMenu] Identity load failed:', error)
      setMenuUserEmail('')
      setUserMenuAuthStatus('error')
      setUserMenuIdentityError('Failed to reach control plane for identity.')
      return fetchWorkspaceList()
    }

    const workspaces = await fetchWorkspaceList()

    if (meResponse.ok) {
      setUserMenuAuthStatus('authenticated')
      const email = extractUserEmail(meData)
      setMenuUserEmail(email || '')
      return workspaces
    }

    setMenuUserEmail('')
    if (meResponse.status === 401) {
      setUserMenuAuthStatus('unauthenticated')
      setUserMenuIdentityError('Not signed in.')
    } else if (meResponse.status === 403) {
      setUserMenuAuthStatus('error')
      setUserMenuIdentityError('Permission denied while loading identity.')
    } else {
      setUserMenuAuthStatus('error')
      setUserMenuIdentityError(getHttpErrorDetail(meResponse, meData, 'Failed to load identity'))
    }

    return workspaces
  }, [fetchWorkspaceList])

  useEffect(() => {
    refreshUserMenuData().catch(() => {})
  }, [refreshUserMenuData])

  const handleUserMenuRetry = useCallback(() => {
    setUserMenuIdentityError('')
    setUserMenuWorkspaceError('')
    return refreshUserMenuData()
  }, [refreshUserMenuData])

  const handleSwitchWorkspace = useCallback(async () => {
    const workspaces = await fetchWorkspaceList()
    const candidateWorkspaces = workspaces.filter(
      (workspace) => workspace.id && workspace.id !== currentWorkspaceId,
    )
    if (candidateWorkspaces.length === 0) return

    const defaultId = candidateWorkspaces[0].id
    const optionsText = candidateWorkspaces
      .map((workspace) => `- ${workspace.name || workspace.id} (${workspace.id})`)
      .join('\n')
    const promptValue = window.prompt(
      `Select workspace id to switch:\n${optionsText}`,
      defaultId,
    )
    if (!promptValue) return
    const selectedId = promptValue.trim()
    if (!selectedId || selectedId === currentWorkspaceId) return

    const selectedWorkspace = candidateWorkspaces.find(
      (workspace) => workspace.id === selectedId || workspace.name === selectedId,
    )
    if (!selectedWorkspace?.id) return
    const targetWorkspaceId = selectedWorkspace.id

    if (!controlPlaneOnboardingEnabled) {
      const route = routes.controlPlane.workspaces.scope(
        targetWorkspaceId,
        getWorkspacePathSuffix(window.location.pathname),
      )
      window.location.assign(buildApiUrl(route.path, route.query))
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
      // When preflight fails we cannot safely assume runtime is initialized; route to setup.
      fallbackRoute: routes.controlPlane.workspaces.setup(targetWorkspaceId),
      warningMessage: '[UserMenu] Switch workspace preflight failed:',
    })
    window.location.assign(buildApiUrl(route.path, route.query))
  }, [controlPlaneOnboardingEnabled, currentWorkspaceId, fetchWorkspaceList])

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

    if (!controlPlaneOnboardingEnabled) {
      const route = routes.controlPlane.workspaces.scope(
        createdWorkspaceId,
        getWorkspacePathSuffix(window.location.pathname),
      )
      window.location.assign(buildApiUrl(route.path, route.query))
      return
    }

    const route = await runWithPreflightFallback({
      run: async () => {
        const { runtimePayload } = await syncWorkspaceRuntimeAndSettings({
          workspaceId: createdWorkspaceId,
          writeSettings: true,
          apiFetchJson,
          apiFetch,
        })
        return resolveWorkspaceNavigationRouteFromPathname({
          workspaceId: createdWorkspaceId,
          runtimePayload,
          pathname: window.location.pathname,
        })
      },
      fallbackRoute: routes.controlPlane.workspaces.setup(createdWorkspaceId),
      warningMessage: '[UserMenu] Create workspace preflight failed:',
    })
    window.location.assign(buildApiUrl(route.path, route.query))
  }, [controlPlaneOnboardingEnabled, fetchWorkspaceList])

  const handleOpenUserSettings = useCallback(() => {
    if (userMenuAuthStatus === 'unauthenticated') {
      const route = routes.controlPlane.auth.login(
        `${window.location.pathname}${window.location.search || ''}`,
      )
      window.location.assign(buildApiUrl(route.path, route.query))
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
    const route = currentWorkspaceId
      ? routes.controlPlane.workspaces.scope(currentWorkspaceId, 'settings')
      : routes.controlPlane.auth.settings()
    window.location.assign(buildApiUrl(route.path, route.query))
  }, [userMenuAuthStatus, storagePrefix, projectRoot, currentWorkspaceId])

  const handleLogout = useCallback(() => {
    const route = routes.controlPlane.auth.logout()
    window.location.assign(buildApiUrl(route.path, route.query))
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    toggleFiletree,
    toggleTerminal,
    toggleShell,
    closeTab,
    toggleTheme,
  })

  // Right header actions component - shows collapse button on shell group
  const RightHeaderActions = useCallback(
    (props) => {
      const panels = props.group?.panels || []
      const hasShellPanel = panels.some((p) => p.id === 'shell')

      if (!hasShellPanel) return null

      return (
        <button
          type="button"
          className="tab-collapse-btn"
          onClick={toggleShell}
          title={collapsed.shell ? 'Expand panel' : 'Collapse panel'}
          aria-label={collapsed.shell ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed.shell ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronUp size={14} />
          )}
        </button>
      )
    },
    [collapsed.shell, toggleShell]
  )

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
    const companionGroups = (() => {
      const byId = new Map()
      listDockPanels(dockApi)
        .filter((panel) => {
          if (getPanelComponent(panel) !== 'companion') return false
          return (panel?.params?.provider || 'companion') === 'companion'
        })
        .forEach((panel) => {
          if (panel?.group?.id) byId.set(panel.group.id, panel.group)
        })
      return Array.from(byId.values())
    })()

    if (leftGroups.length > 0) {
      const collapsedWidth = leftSidebarCollapsedWidth
      const minWidth = leftSidebarMinWidth
      if (collapsed.filetree) {
        leftGroups.forEach((group) => {
          group.api.setConstraints({
            minimumWidth: collapsedWidth,
            maximumWidth: collapsedWidth,
          })
          group.api.setSize({ width: collapsedWidth })
        })
      } else {
        leftGroups.forEach((group) => {
          // Use Number.MAX_SAFE_INTEGER to clear max constraint and allow resizing
          group.api.setConstraints({
            minimumWidth: minWidth,
            maximumWidth: Number.MAX_SAFE_INTEGER,
          })
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

    companionGroups.forEach((companionGroup) => {
      if (collapsed.companion) {
        companionGroup.api.setConstraints({
          minimumWidth: panelCollapsedRef.current.companion,
          maximumWidth: panelCollapsedRef.current.companion,
        })
        companionGroup.api.setSize({ width: panelCollapsedRef.current.companion })
      } else {
        companionGroup.api.setConstraints({
          minimumWidth: panelMinRef.current.companion,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (!isFirstRun) {
          companionGroup.api.setSize({ width: panelSizesRef.current.companion })
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
  }, [dockApi, collapsed, getLeftSidebarGroups, leftSidebarCollapsedWidth, leftSidebarMinWidth])

  // Git status polling removed - not currently used in UI

  // Fetch approvals
  useEffect(() => {
    let isActive = true

    const fetchApprovals = () => {
      const route = routes.approval.pending()
      apiFetchJson(route.path, { query: route.query })
        .then(({ data }) => {
          if (!isActive) return
          const requests = Array.isArray(data.requests) ? data.requests : []
          const filtered = requests.filter(
            (req) => !dismissedApprovalsRef.current.has(req.id),
          )
          setApprovals(filtered)
          setApprovalsLoaded(true)
        })
        .catch(() => {})
    }

    fetchApprovals()
    const interval = setInterval(fetchApprovals, 1000)

    return () => {
      isActive = false
      clearInterval(interval)
    }
  }, [])

  const handleDecision = useCallback(
    async (requestId, decision, reason) => {
      if (requestId) {
        dismissedApprovalsRef.current.add(requestId)
        setApprovals((prev) => prev.filter((req) => req.id !== requestId))
        if (dockApi) {
          const panel = dockApi.getPanel(`review-${requestId}`)
          if (panel) {
            panel.api.close()
          }
        }
      } else {
        setApprovals([])
      }
      try {
        const route = routes.approval.decision()
        await apiFetch(route.path, {
          query: route.query,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: requestId, decision, reason }),
        })
      } catch {
        // Ignore decision errors; UI already dismissed.
      }
    },
    [dockApi]
  )

  const normalizeApprovalPath = useCallback(
    (approval) => {
      if (!approval) return ''
      if (approval.project_path) return approval.project_path
      const filePath = approval.file_path || ''
      if (!filePath) return ''
      if (projectRoot) {
        const root = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
        if (filePath.startsWith(root)) {
          return filePath.slice(root.length)
        }
      }
      return filePath
    },
    [projectRoot],
  )

  const getReviewTitle = useCallback(
    (approval) => {
      const approvalPath = normalizeApprovalPath(approval)
      if (approvalPath) {
        return `Review: ${getFileName(approvalPath)}`
      }
      if (approval?.tool_name) {
        return `Review: ${approval.tool_name}`
      }
      return 'Review'
    },
    [normalizeApprovalPath],
  )

  const isLeftSidebarGroup = useCallback((group) => {
    if (!group) return false
    const groupPanels = Array.isArray(group.panels) ? group.panels : []
    return groupPanels.some((panel) => {
      const panelId = typeof panel?.id === 'string' ? panel.id : ''
      return leftSidebarPanelIds.includes(panelId)
    })
  }, [leftSidebarPanelIds])

  const findCenterAnchorPanel = useCallback((api) => {
    if (!api) return null
    const allPanels = Array.isArray(api.panels) ? api.panels : []
    return allPanels.find((panel) => {
      if (!panel?.group || isLeftSidebarGroup(panel.group)) return false
      const panelId = typeof panel?.id === 'string' ? panel.id : ''
      return (
        panelId.startsWith('editor-')
        || panelId.startsWith('review-')
        || panelId.startsWith('deck-')
        || panelId.startsWith('chart-')
      )
    }) || null
  }, [isLeftSidebarGroup])

  const getLiveCenterGroup = useCallback((api) => {
    if (!api) return null
    const candidate = centerGroupRef.current
    if (!candidate) return null

    const groups = Array.isArray(api.groups) ? api.groups : []
    if (groups.includes(candidate) && !isLeftSidebarGroup(candidate)) {
      return candidate
    }
    if (candidate.id) {
      const matchingGroup = groups.find((group) => group?.id === candidate.id)
      if (matchingGroup && !isLeftSidebarGroup(matchingGroup)) {
        centerGroupRef.current = matchingGroup
        return matchingGroup
      }
    }
    centerGroupRef.current = null
    return null
  }, [isLeftSidebarGroup])

  // Open file in a specific position (used for drag-drop)
  const openFileAtPosition = useCallback(
    (path, position, extraParams = {}) => {
      if (!dockApi) return

      const panelId = `editor-${path}`
      const existingPanel = dockApi.getPanel(panelId)

      if (existingPanel) {
        // If opening with initialMode, update the panel params
        if (extraParams.initialMode) {
          existingPanel.api.updateParameters({ initialMode: extraParams.initialMode })
        }
        existingPanel.api.setActive()
        return
      }

      const emptyPanel = dockApi.getPanel('empty-center')
      const centerGroup = getLiveCenterGroup(dockApi)
      if (centerGroup) {
        centerGroup.header.hidden = false
      }

      const addEditorPanel = (content) => {
        setTabs((prev) => ({
          ...prev,
          [path]: { content, isDirty: false },
        }))

        const panel = dockApi.addPanel({
          id: panelId,
          component: 'editor',
          title: getFileName(path),
          position,
          params: {
            path,
            initialContent: content,
            contentVersion: 1,
            ...extraParams,
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
              const panel = dockApi.getPanel(`editor-${p}`)
              if (panel) {
                panel.api.setTitle(getFileName(p) + (dirty ? ' *' : ''))
              }
            },
          },
        })

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
      }

      queryClient.fetchQuery({
        queryKey: queryKeys.files.read(path),
        queryFn: ({ signal }) => dataProvider.files.read(path, { signal }),
      })
        .then((content) => {
          addEditorPanel(typeof content === 'string' ? content : '')
        })
        .catch(() => {
          addEditorPanel('')
        })
    },
    [dataProvider, dockApi, getLiveCenterGroup, queryClient]
  )

  const openFile = useCallback(
    (path) => {
      if (!dockApi) return false

      const panelId = `editor-${path}`
      const existingPanel = dockApi.getPanel(panelId)

      if (existingPanel) {
        existingPanel.api.setActive()
        return true
      }

      // Priority: existing editor group > centerGroupRef > empty panel > shell > fallback
      const emptyPanel = dockApi.getPanel('empty-center')
      const shellPanel = dockApi.getPanel('shell')
      const centerGroup = getLiveCenterGroup(dockApi)
      const existingCenterPanel = findCenterAnchorPanel(dockApi)

      let position
      if (centerGroup) {
        position = { referenceGroup: centerGroup }
      } else if (existingCenterPanel?.group) {
        // Add as tab next to existing center editors/charts/reviews.
        position = { referenceGroup: existingCenterPanel.group }
      } else if (emptyPanel?.group) {
        position = { referenceGroup: emptyPanel.group }
      } else if (shellPanel?.group) {
        // Add above shell to maintain center column structure
        position = { direction: 'above', referenceGroup: shellPanel.group }
      } else {
        position = { direction: 'right', referencePanel: 'filetree' }
      }

      openFileAtPosition(path, position)
      return true
    },
    [dockApi, findCenterAnchorPanel, getLiveCenterGroup, openFileAtPosition]
  )

  const openPanel = useCallback(
    (rawPayload) => {
      if (!dockApi) return false
      const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {}

      const id = String(payload.id || '').trim()
      const component = String(payload.component || '').trim()
      if (!id || !component) return false

      const title = String(payload.title || id)
      const panelParams = payload.params && typeof payload.params === 'object'
        ? payload.params
        : {}

      const existingPanel = dockApi.getPanel(id)
      if (existingPanel) {
        if (Object.keys(panelParams).length > 0) {
          existingPanel.api.updateParameters(panelParams)
        }
        existingPanel.api.setActive()
        return true
      }

      const emptyPanel = dockApi.getPanel('empty-center')
      const companionPanel = dockApi.getPanel('companion')
      const centerGroup = getLiveCenterGroup(dockApi)
      const existingCenterPanel = findCenterAnchorPanel(dockApi)

      let position = payload.position && typeof payload.position === 'object'
        ? payload.position
        : null

      if (!position) {
        if (centerGroup) {
          position = { referenceGroup: centerGroup }
        } else if (existingCenterPanel?.group) {
          position = { referenceGroup: existingCenterPanel.group }
        } else if (emptyPanel?.group) {
          position = { referenceGroup: emptyPanel.group }
        } else if (companionPanel) {
          position = { direction: 'left', referencePanel: companionPanel.id }
        } else {
          position = { direction: 'right', referencePanel: 'filetree' }
        }
      }

      const panel = dockApi.addPanel({
        id,
        component,
        title,
        position,
        params: panelParams,
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
          if (staleEmpty) staleEmpty.api.close()
        })
      }

      return true
    },
    [dockApi, findCenterAnchorPanel, getLiveCenterGroup],
  )

  useEffect(() => {
    const openFileBridge = (path) => openFile(String(path || '').trim())
    const openPanelBridge = (payload) => openPanel(payload)
    const listTabsBridge = () => ({
      activeFile: activeFile || '',
      tabs: Object.keys(tabs),
    })

    window[PI_OPEN_FILE_BRIDGE] = openFileBridge
    window[PI_OPEN_PANEL_BRIDGE] = openPanelBridge
    window[PI_LIST_TABS_BRIDGE] = listTabsBridge

    return () => {
      if (window[PI_OPEN_FILE_BRIDGE] === openFileBridge) {
        delete window[PI_OPEN_FILE_BRIDGE]
      }
      if (window[PI_OPEN_PANEL_BRIDGE] === openPanelBridge) {
        delete window[PI_OPEN_PANEL_BRIDGE]
      }
      if (window[PI_LIST_TABS_BRIDGE] === listTabsBridge) {
        delete window[PI_LIST_TABS_BRIDGE]
      }
    }
  }, [activeFile, openFile, openPanel, tabs])

  const openFileToSide = useCallback(
    (path) => {
      if (!dockApi) return

      const panelId = `editor-${path}`
      const existingPanel = dockApi.getPanel(panelId)

      if (existingPanel) {
        existingPanel.api.setActive()
        return
      }

      // Find the active editor panel to split from (not terminal/filetree)
      const activePanel = dockApi.activePanel
      const centerGroup = getLiveCenterGroup(dockApi)
      let position

      if (activePanel && activePanel.id.startsWith('editor-') && !isLeftSidebarGroup(activePanel.group)) {
        // Split to the right of the current editor
        position = { direction: 'right', referencePanel: activePanel.id }
      } else if (centerGroup) {
        // Split against a concrete center panel id to avoid docking drift.
        const anchorPanelId = centerGroup.activePanel?.id || centerGroup.panels?.[0]?.id
        if (anchorPanelId) {
          position = { direction: 'right', referencePanel: anchorPanelId }
        } else {
          position = { referenceGroup: centerGroup }
        }
      } else {
        // Fallback: to the right of filetree (but will be left of terminal)
        position = { direction: 'right', referencePanel: 'filetree' }
      }

      openFileAtPosition(path, position)
    },
    [dockApi, getLiveCenterGroup, isLeftSidebarGroup, openFileAtPosition]
  )

  const openDiff = useCallback(
    (path, _status) => {
      if (!dockApi) return

      const panelId = `editor-${path}`
      const existingPanel = dockApi.getPanel(panelId)

      if (existingPanel) {
        // Update to diff mode and activate
        existingPanel.api.updateParameters({ initialMode: 'git-diff' })
        existingPanel.api.setActive()
        setActiveDiffFile(path)
        return
      }

      // Use empty panel's group first to maintain layout hierarchy
      const emptyPanel = dockApi.getPanel('empty-center')
      const shellPanel = dockApi.getPanel('shell')
      const centerGroup = getLiveCenterGroup(dockApi)

      let position
      if (emptyPanel?.group) {
        position = { referenceGroup: emptyPanel.group }
      } else if (centerGroup) {
        position = { referenceGroup: centerGroup }
      } else if (shellPanel?.group) {
        position = { direction: 'above', referenceGroup: shellPanel.group }
      } else {
        position = { direction: 'right', referencePanel: 'filetree' }
      }

      // Open regular editor with diff mode enabled
      openFileAtPosition(path, position, { initialMode: 'git-diff' })
      setActiveDiffFile(path)
    },
    [dockApi, getLiveCenterGroup, openFileAtPosition]
  )

  const getCommandPanelPosition = useCallback((api) => {
    const emptyPanel = api.getPanel('empty-center')
    if (emptyPanel?.group) {
      return { referenceGroup: emptyPanel.group }
    }

    const centerGroup = getLiveCenterGroup(api)
    if (centerGroup) {
      return { referenceGroup: centerGroup }
    }

    const shellPanel = api.getPanel('shell')
    if (shellPanel?.group) {
      return { direction: 'above', referenceGroup: shellPanel.group }
    }

    const filetreePanel = api.getPanel('filetree')
    if (filetreePanel) {
      return { direction: 'right', referencePanel: 'filetree' }
    }

    return undefined
  }, [getLiveCenterGroup])

  const openGenericPanelFromCommand = useCallback(
    (api, command) => {
      const component = typeof command?.component === 'string' ? command.component.trim() : ''
      if (!component) return false

      const requestedId = typeof command?.panel_id === 'string' ? command.panel_id.trim() : ''
      const requestedTitle = typeof command?.title === 'string' ? command.title.trim() : ''
      const panelTitle = requestedTitle || component
      const params = command?.params && typeof command.params === 'object' && !Array.isArray(command.params)
        ? command.params
        : {}
      const preferExisting = command?.prefer_existing !== false

      const baseId = requestedId || `cmd-${component}-${Date.now().toString(36)}`
      const existingPanel = preferExisting ? api.getPanel(baseId) : null
      if (existingPanel) {
        if (Object.keys(params).length > 0) {
          existingPanel.api.updateParameters(params)
        }
        existingPanel.api.setActive()
        return true
      }

      const panelId = api.getPanel(baseId) ? `${baseId}-${Date.now().toString(36)}` : baseId
      const position = getCommandPanelPosition(api)
      const panel = api.addPanel({
        id: panelId,
        component,
        title: panelTitle,
        position,
        params,
      })
      if (!panel) return false

      const emptyPanel = api.getPanel('empty-center')
      if (emptyPanel && emptyPanel.id !== panelId) {
        emptyPanel.api.close()
      }

      if (panel?.group) {
        panel.group.header.hidden = false
        centerGroupRef.current = panel.group
        panel.group.api.setConstraints({
          minimumHeight: panelMinRef.current.center,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
      }
      panel.api.setActive()
      return true
    },
    [getCommandPanelPosition],
  )

  const executeFrontendCommand = useCallback(
    async (api, commandEnvelope) => {
      if (!api || !commandEnvelope || typeof commandEnvelope !== 'object') return false
      const command = commandEnvelope.command && typeof commandEnvelope.command === 'object'
        ? commandEnvelope.command
        : commandEnvelope
      const kind = typeof command?.kind === 'string' ? command.kind.trim() : ''
      if (!kind) return false

      if (kind === 'focus_panel') {
        const panelId = typeof command?.panel_id === 'string' ? command.panel_id.trim() : ''
        if (!panelId) return false
        const panel = api.getPanel(panelId)
        if (!panel) return false
        panel.api.setActive()
        await publishFrontendState(api)
        return true
      }

      if (kind === 'open_panel') {
        const opened = openGenericPanelFromCommand(api, command)
        if (opened) {
          await publishFrontendState(api)
        }
        return opened
      }

      return false
    },
    [openGenericPanelFromCommand, publishFrontendState],
  )

  const consumeNextFrontendCommand = useCallback(
    async (api) => {
      const targetApi = api || dockApi
      if (!targetApi) return false
      if (frontendStateUnavailableRef.current || frontendCommandUnavailableRef.current) {
        return false
      }
      if (!frontendStateClientIdRef.current) {
        frontendStateClientIdRef.current = getFrontendStateClientId(storagePrefixRef.current)
      }

      const route = routes.uiState.commands.next(frontendStateClientIdRef.current)
      try {
        const { response, data } = await apiFetchJson(route.path, { query: route.query })
        if (!response.ok) {
          if (response.status === 404 || response.status === 405) {
            frontendCommandUnavailableRef.current = true
          }
          return false
        }
        if (!data?.command) return false
        return executeFrontendCommand(targetApi, data.command)
      } catch {
        return false
      }
    },
    [dockApi, executeFrontendCommand],
  )

  useEffect(() => {
    if (!dockApi) return

    let isDisposed = false
    let timeoutId = null
    const pollLoop = async () => {
      while (!isDisposed) {
        await consumeNextFrontendCommand(dockApi)
        if (isDisposed) break
        await new Promise((resolve) => {
          timeoutId = window.setTimeout(resolve, 750)
        })
        timeoutId = null
      }
    }

    void pollLoop()

    return () => {
      isDisposed = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [dockApi, consumeNextFrontendCommand])

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
      const shellPanel = dockApi.getPanel('shell')

      // Find existing editor/review panels to add as sibling tab
      const allPanels = Array.isArray(dockApi.panels) ? dockApi.panels : []
      const existingEditorPanel = allPanels.find(p => p.id.startsWith('editor-') || p.id.startsWith('review-'))

      // Priority: existing editor group > centerGroupRef > empty panel > shell > fallback
      const centerGroup = getLiveCenterGroup(dockApi)
      let position
      if (existingEditorPanel?.group) {
        // Add as tab next to existing editors/reviews
        position = { referenceGroup: existingEditorPanel.group }
      } else if (centerGroup) {
        position = { referenceGroup: centerGroup }
      } else if (emptyPanel?.group) {
        position = { referenceGroup: emptyPanel.group }
      } else if (shellPanel?.group) {
        // Add above shell to maintain center column structure
        position = { direction: 'above', referenceGroup: shellPanel.group }
      } else {
        position = { direction: 'right', referencePanel: 'filetree' }
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

  const addChatPanel = useCallback(
    ({ mode = 'tab', sourcePanelId = '', piSessionBootstrap = 'latest' } = {}) => {
      if (!dockApi) return false

      const sourcePanel = sourcePanelId ? dockApi.getPanel(sourcePanelId) : null
      const sourceComponent = getPanelComponent(sourcePanel)
      const sourceProvider = sourcePanel?.params?.provider

      let component = sourceComponent
      let provider = sourceProvider

      if (!component) {
        if (companionAgentEnabled && capabilities?.features?.companion === true) {
          component = 'companion'
          provider = 'companion'
        } else if (nativeAgentEnabled) {
          component = 'terminal'
        } else if (piAgentEnabled && capabilities?.features?.pi === true) {
          component = 'companion'
          provider = 'pi'
        } else {
          const fallbackPanel = listDockPanels(dockApi).find((panel) => {
            const panelComponent = getPanelComponent(panel)
            return panelComponent === 'terminal' || panelComponent === 'companion'
          })
          component = getPanelComponent(fallbackPanel)
          provider = fallbackPanel?.params?.provider
        }
      }

      if (!component) return false

      if (component === 'terminal') {
        agentAutoAddSuppressedRef.current.terminal = false
      } else if (provider === 'pi') {
        agentAutoAddSuppressedRef.current.pi = false
      } else {
        agentAutoAddSuppressedRef.current.companion = false
      }

      const panelIdPrefix = component === 'terminal'
        ? 'terminal-chat'
        : provider === 'pi'
          ? 'pi-agent-chat'
          : 'companion-chat'
      const panelId = createUniquePanelId(dockApi, panelIdPrefix)
      const piInitialSessionId = component === 'companion'
        && provider === 'pi'
        && piSessionBootstrap === 'new'
        ? `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        : ''
      const title = component === 'terminal'
        ? 'Code Sessions'
        : 'Agent'
      const matchingPanels = listDockPanels(dockApi).filter(
        (panel) =>
          getPanelComponent(panel) === component
          && (component !== 'companion' || (panel?.params?.provider || 'companion') === (provider || 'companion')),
      )
      const defaultReferencePanel = matchingPanels[0]
      let emptyCenterPanel = dockApi.getPanel('empty-center')
      let centerGroup = getLiveCenterGroup(dockApi) || emptyCenterPanel?.group
      const shellGroup = dockApi.getPanel('shell')?.group

      // Ensure chat panels anchor in the center area, not side rails.
      if (!centerGroup) {
        const filetreePanel = dockApi.getPanel('filetree')
        const emptyCenterPosition = filetreePanel
          ? { direction: 'right', referencePanel: 'filetree' }
          : shellGroup
            ? { direction: 'above', referenceGroup: shellGroup }
            : undefined
        if (!emptyCenterPanel && emptyCenterPosition) {
          emptyCenterPanel = dockApi.addPanel({
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
        const emptyCenter = dockApi.getPanel('empty-center')
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
      } else if (shellGroup) {
        position = { direction: 'above', referenceGroup: shellGroup }
      } else if (dockApi.getPanel('filetree')) {
        position = { direction: 'right', referencePanel: 'filetree' }
      }

      const panel = dockApi.addPanel({
        id: panelId,
        component,
        title,
        position,
        params: component === 'terminal'
          ? {
              panelId,
              collapsed: false,
              onToggleCollapse: undefined,
              approvals,
              onDecision: handleDecision,
              normalizeApprovalPath,
            }
          : {
              panelId,
              collapsed: false,
              onToggleCollapse: undefined,
              provider: provider || 'companion',
              lockProvider: true,
              ...(provider === 'pi'
                ? { piSessionBootstrap, piInitialSessionId }
                : {}),
            },
      })
      if (!panel) return false

      if (panel?.group) {
        panel.group.locked = false
        panel.group.header.hidden = false
        const minWidth = component === 'terminal'
          ? panelMinRef.current.terminal
          : panelMinRef.current.companion
        panel.group.api.setConstraints({
          minimumWidth: minWidth,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (component === 'terminal' && !collapsed.terminal) {
          panel.group.api.setSize({ width: panelSizesRef.current.terminal })
        }
        if (component === 'companion' && provider !== 'pi' && !collapsed.companion) {
          panel.group.api.setSize({ width: panelSizesRef.current.companion })
        }
        if (component === 'companion' && provider === 'pi') {
          panel.group.api.setSize({ width: panelSizesRef.current.companion })
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
      dockApi,
      nativeAgentEnabled,
      companionAgentEnabled,
      piAgentEnabled,
      capabilities,
      createUniquePanelId,
      getLiveCenterGroup,
      collapsed.terminal,
      collapsed.companion,
      approvals,
      handleDecision,
      normalizeApprovalPath,
    ],
  )

  const handleOpenChatTab = useCallback(() => {
    addChatPanel({ mode: 'split', piSessionBootstrap: 'new' })
  }, [addChatPanel])

  const handleSplitChatPanel = useCallback((panelId, options = {}) => {
    if (!panelId) return
    addChatPanel({
      mode: 'split',
      sourcePanelId: panelId,
      piSessionBootstrap: options.piSessionBootstrap || 'latest',
    })
  }, [addChatPanel])

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

    const applyPanelConstraints = (api, registry, capabilityFlags, panelMinRef) => {
      const paneConfigs = typeof registry?.list === 'function' ? registry.list() : []

      paneConfigs.forEach((paneConfig) => {
        const panel = api.getPanel(paneConfig.id)
        const group = panel?.group
        if (!group) return

        const isTerminal = paneConfig.id === 'terminal'
        if (isTerminal && !capabilityFlags.nativeAgentEnabled) {
          return
        }

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
            onOpenChatTab: handleOpenChatTab,
            showSidebarToggle: leftSidebarPanelIds[0] === 'filetree',
            sectionCollapsed: sectionCollapsed.filetree,
            onToggleSection: () => toggleSectionCollapse('filetree'),
            userEmail: menuUserEmail,
            userMenuStatusMessage,
            userMenuStatusTone,
            onUserMenuRetry: handleUserMenuRetry,
            userMenuDisabledActions,
            showSwitchWorkspace: userMenuCanSwitchWorkspace,
            workspaceName: activeWorkspaceName,
            workspaceId: currentWorkspaceId,
            onSwitchWorkspace: handleSwitchWorkspace,
            onCreateWorkspace: handleCreateWorkspace,
            onOpenUserSettings: handleOpenUserSettings,
            onLogout: handleLogout,
          }
        case 'shell':
          return {
            collapsed: false,
            onToggleCollapse: () => {},
          }
        case 'terminal':
          return {
            panelId: 'terminal',
            collapsed: false,
            onToggleCollapse: undefined,
            onSplitPanel: handleSplitChatPanel,
            approvals,
            onDecision: handleDecision,
            normalizeApprovalPath,
          }
        case 'companion':
          return {
            panelId: 'companion',
            collapsed: false,
            onToggleCollapse: undefined,
            onSplitPanel: handleSplitChatPanel,
            provider: 'companion',
            lockProvider: true,
          }
        default:
          if (leftSidebarPanelIds.includes(panelId)) {
            return {
              collapsed: collapsed.filetree,
              onToggleCollapse: toggleFiletree,
              onOpenChatTab: handleOpenChatTab,
              showSidebarToggle: leftSidebarPanelIds[0] === panelId,
              sectionCollapsed: sectionCollapsed[panelId],
              onToggleSection: () => toggleSectionCollapse(panelId),
            }
          }
          return {}
      }
    }

    const ensureCorePanels = () => {
      // Layout goal: [filetree | [editor-chat / shell]]
      //
      // Strategy: Create in order that establishes correct hierarchy
      // 1. filetree (left)
      // 2. empty-center (right of filetree) - center column for editor/chat tabs
      // 4. shell (below empty-center) - bottom of center

      let filetreePanel = api.getPanel('filetree')
      if (!filetreePanel) {
        filetreePanel = api.addPanel({
          id: 'filetree',
          component: 'filetree',
          title: 'Files',
          params: getDefaultParams('filetree'),
        })
      }

      // Add empty panel right of filetree - creates center column
      let emptyPanel = api.getPanel('empty-center')
      if (!emptyPanel) {
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: { direction: 'right', referencePanel: 'filetree' },
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

      // Add shell panel BELOW the center group - splits only center column
      let shellPanel = api.getPanel('shell')
      const shellPaneConfig = getPane('shell')
      if (!shellPanel && emptyPanel?.group) {
        shellPanel = api.addPanel({
          id: 'shell',
          component: 'shell',
          tabComponent: shellPaneConfig?.tabComponent,
          title: 'Shell',
          position: { direction: 'below', referenceGroup: emptyPanel.group },
          params: getDefaultParams('shell'),
        })
      }

      // Show tabs for the shell group
      if (shellPanel?.group) {
        shellPanel.group.header.hidden = false
        shellPanel.group.locked = true // Lock group to prevent closing tabs
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
        { nativeAgentEnabled, companionAgentEnabled },
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
        const rightRailPanel = api.getPanel('terminal') || api.getPanel('companion')
        const emptyPosition = firstCenterPanel?.group
          ? { referenceGroup: firstCenterPanel.group }
          : rightRailPanel
            ? { direction: 'left', referencePanel: rightRailPanel.id }
            : { direction: 'right', referencePanel: 'filetree' }

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
        { nativeAgentEnabled, companionAgentEnabled },
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

    // Check if there's a saved layout - if so, DON'T create panels here
    // Let the layout restoration effect handle it to avoid creating->destroying->recreating
    // We check localStorage directly since projectRoot isn't available yet
    let hasSavedLayout = false
    let invalidLayoutFound = false
    try {
      // Use storagePrefix from config (available via closure from outer scope)
      const layoutKeyPrefix = `${storagePrefix}-`
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(layoutKeyPrefix) && key.endsWith('-layout')) {
          const raw = localStorage.getItem(key)
          if (raw) {
            const parsed = JSON.parse(raw)
            const hasValidVersion = parsed?.version >= LAYOUT_VERSION
            const hasPanels = !!parsed?.panels
            const hasValidStructure = validateLayoutStructure(parsed)

            // Check if layout is valid
            if (hasValidVersion && hasPanels && hasValidStructure) {
              hasSavedLayout = true
              break
            }

            // Invalid layout detected - clean up and reload
            if (!hasValidStructure || !hasValidVersion || !hasPanels) {
              console.warn('[Layout] Invalid layout detected in onReady, clearing and reloading:', key)
              localStorage.removeItem(key)
              // Clear related session storage
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
      // Ignore errors checking localStorage
    }

    // Only create fresh panels if no saved layout exists
    // Otherwise, layout restoration will handle panel creation
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
    if (!hasSavedLayout || invalidLayoutFound) {
      panelBuilder()
    }
    ensureCorePanelsRef.current = panelBuilder

    // Handle panel close to clean up tabs state
    api.onDidRemovePanel((e) => {
      const removedFamily = panelIdToAgentFamily(e.id)
      if (removedFamily && countAgentPanels(api, removedFamily) === 0) {
        agentAutoAddSuppressedRef.current[removedFamily] = true
      }

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

      // Get shell panel to position relative to it
      const shellPanel = api.getPanel('shell')

      let emptyPanel
      if (groupStillExists && centerGroup.panels?.length > 0) {
        // Group still exists with panels, add to it
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: { referenceGroup: centerGroup },
        })
      } else if (shellPanel?.group) {
        // Center group is gone, add above shell panel
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: { direction: 'above', referenceGroup: shellPanel.group },
        })
      } else {
        // Fallback: keep center column between filetree and right-rail agent panel.
        const terminalPanel = api.getPanel('terminal')
        const companionPanel = api.getPanel('companion')
        const rightRailPanel = terminalPanel || companionPanel
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: rightRailPanel
            ? { direction: 'left', referencePanel: rightRailPanel.id }
            : { direction: 'right', referencePanel: 'filetree' },
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
      const companionPanel = api.getPanel('companion')
      const shellPanel = api.getPanel('shell')

      const leftGroups = getLeftSidebarGroups(api)
      const filetreeGroup = filetreePanel?.group
      const terminalGroup = terminalPanel?.group
      const companionGroup = companionPanel?.group
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
      if (companionGroup && companionGroup.api.width > panelCollapsedRef.current.companion) {
        if (newSizes.companion !== companionGroup.api.width) {
          newSizes.companion = companionGroup.api.width
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
      apiFetchJson(route.path, { query: route.query })
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
    // Wait for both dockApi and projectRoot to be available
    // projectRoot === null means not loaded yet
    if (!dockApi || projectRoot === null || layoutRestorationRan.current) return
    layoutRestorationRan.current = true
    const collapsedState = {
      filetree: collapsed.filetree,
      terminal: collapsed.terminal,
      companion: collapsed.companion,
      shell: collapsed.shell,
    }

    const savedLayout = loadLayout(storagePrefix, projectRoot, KNOWN_COMPONENTS, layoutVersion)
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
      // Since onReady skips panel creation when a saved layout exists,
      // we can directly call fromJSON without clearing first
      // This avoids the create->destroy->recreate race condition
      try {
        dockApi.fromJSON(savedLayout)
        layoutRestored.current = true

        // Respect persisted user choice when all agent panels were closed.
        // If none exist in restored layout, suppress automatic re-creation.
        if (countAgentPanels(dockApi, 'terminal') === 0) {
          agentAutoAddSuppressedRef.current.terminal = true
        }
        if (countAgentPanels(dockApi, 'companion') === 0) {
          agentAutoAddSuppressedRef.current.companion = true
        }
        if (countAgentPanels(dockApi, 'pi') === 0) {
          agentAutoAddSuppressedRef.current.pi = true
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
            onOpenChatTab: handleOpenChatTab,
            showSidebarToggle: leftSidebarPanelIds[0] === 'filetree',
            sectionCollapsed: sectionCollapsed.filetree,
            onToggleSection: () => toggleSectionCollapse('filetree'),
            userEmail: menuUserEmail,
            userMenuStatusMessage,
            userMenuStatusTone,
            onUserMenuRetry: handleUserMenuRetry,
            userMenuDisabledActions,
            showSwitchWorkspace: userMenuCanSwitchWorkspace,
            workspaceName: activeWorkspaceName,
            workspaceId: currentWorkspaceId,
            onSwitchWorkspace: handleSwitchWorkspace,
            onCreateWorkspace: handleCreateWorkspace,
            onOpenUserSettings: handleOpenUserSettings,
            onLogout: handleLogout,
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
            onOpenChatTab: handleOpenChatTab,
            showSidebarToggle: leftSidebarPanelIds[0] === panelId,
            sectionCollapsed: panelId ? sectionCollapsed[panelId] : false,
            onToggleSection: panelId ? () => toggleSectionCollapse(panelId) : undefined,
          })
        })

        const terminalGroup = terminalPanel?.group
        if (terminalGroup) {
          terminalGroup.locked = false
          terminalGroup.header.hidden = false
        }

        const shellGroup = shellPanel?.group
        if (shellGroup) {
          // Lock group to prevent closing tabs, but show header
          shellGroup.locked = true
          shellGroup.header.hidden = false
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

        // Handle companion panel restored from saved layout.
        const companionPanel = dockApi.getPanel('companion')
        if (companionPanel) {
          if (!capabilitiesLoading && (!companionAgentEnabled || capabilities?.features?.companion !== true)) {
            companionPanel.api.close()
          } else {
            const companionGroup = companionPanel.group
            if (companionGroup) {
              companionGroup.locked = false
              companionGroup.header.hidden = false
              if (collapsed.companion) {
                companionGroup.api.setConstraints({
                  minimumWidth: panelCollapsedRef.current.companion,
                  maximumWidth: panelCollapsedRef.current.companion,
                })
                companionGroup.api.setSize({ width: panelCollapsedRef.current.companion })
              } else {
                companionGroup.api.setConstraints({
                  minimumWidth: panelMinRef.current.companion,
                  maximumWidth: Number.MAX_SAFE_INTEGER,
                })
                companionGroup.api.setSize({ width: panelSizesRef.current.companion })
              }
            }
          }
        }

        // Handle PI panel restored from saved layout.
        const piPanel = dockApi.getPanel('pi-agent')
        if (piPanel) {
          if (!capabilitiesLoading && (!piAgentEnabled || capabilities?.features?.pi !== true)) {
            piPanel.api.close()
          } else {
            const piGroup = piPanel.group
            if (piGroup) {
              piGroup.locked = false
              piGroup.header.hidden = false
              piGroup.api.setConstraints({
                minimumWidth: panelMinRef.current.companion,
                maximumWidth: Number.MAX_SAFE_INTEGER,
              })
              piGroup.api.setSize({ width: panelSizesRef.current.companion })
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
        const pruned = pruneEmptyGroups(dockApi, KNOWN_COMPONENTS)
        if (pruned && typeof dockApi.toJSON === 'function') {
          saveLayout(storagePrefix, projectRoot, dockApi.toJSON(), layoutVersion)
        }

        // Apply saved panel sizes, respecting collapsed state
        // collapsed state is loaded from localStorage at init, so we can check it here
        requestAnimationFrame(() => {
          const leftGroups = getLeftSidebarGroups(dockApi)
          const tGroup = dockApi.getPanel('terminal')?.group
          const cGroup = dockApi.getPanel('companion')?.group
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
          if (cGroup) {
            const cApi = dockApi.getGroup(cGroup.id)?.api
            if (cApi) {
              if (collapsed.companion) {
                cApi.setConstraints({ minimumWidth: panelCollapsedRef.current.companion, maximumWidth: panelCollapsedRef.current.companion })
                cApi.setSize({ width: panelCollapsedRef.current.companion })
              } else {
                cApi.setConstraints({ minimumWidth: panelMinRef.current.companion, maximumWidth: Number.MAX_SAFE_INTEGER })
                cApi.setSize({ width: panelSizesRef.current.companion })
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
  }, [
    dockApi,
    projectRoot,
    storagePrefix,
    layoutVersion,
    capabilities,
    capabilitiesLoading,
    collapsed.filetree,
    collapsed.terminal,
    collapsed.shell,
    collapsed.companion,
    openFile,
    openFileToSide,
    openDiff,
    activeFile,
    activeDiffFile,
    toggleFiletree,
    handleOpenChatTab,
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
    handleLogout,
    sectionCollapsed,
    toggleSectionCollapse,
    companionAgentEnabled,
    nativeAgentEnabled,
    piAgentEnabled,
    getLeftSidebarGroups,
    leftSidebarCollapsedWidth,
    leftSidebarMinWidth,
    leftSidebarPanelIds,
  ])

  // Track active panel to highlight in file tree and sync URL
  useEffect(() => {
    if (!dockApi) return
    const disposable = dockApi.onDidActivePanelChange((panel) => {
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
        // Clear doc param when not on an editor
        const url = new URL(window.location.href)
        url.searchParams.delete('doc')
        window.history.replaceState({}, '', url)
      }
      void publishFrontendState(dockApi)
    })
    return () => disposable.dispose()
  }, [dockApi, publishFrontendState])

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
        onOpenChatTab: handleOpenChatTab,
        showSidebarToggle: leftSidebarPanelIds[0] === 'filetree',
        sectionCollapsed: sectionCollapsed.filetree,
        onToggleSection: () => toggleSectionCollapse('filetree'),
        userEmail: menuUserEmail,
        userMenuStatusMessage,
        userMenuStatusTone,
        onUserMenuRetry: handleUserMenuRetry,
        userMenuDisabledActions,
        showSwitchWorkspace: userMenuCanSwitchWorkspace,
        workspaceName: activeWorkspaceName,
        workspaceId: currentWorkspaceId,
        onSwitchWorkspace: handleSwitchWorkspace,
        onCreateWorkspace: handleCreateWorkspace,
        onOpenUserSettings: handleOpenUserSettings,
        onLogout: handleLogout,
      })
    }
    linkedSidebarPanels.forEach((panel) => {
      const panelId = panel?.id
      panel.api.updateParameters({
        ...(panel?.params || {}),
        collapsed: collapsed.filetree,
        onToggleCollapse: toggleFiletree,
        onOpenChatTab: handleOpenChatTab,
        showSidebarToggle: leftSidebarPanelIds[0] === panelId,
        sectionCollapsed: panelId ? sectionCollapsed[panelId] : false,
        onToggleSection: panelId ? () => toggleSectionCollapse(panelId) : undefined,
      })
    })
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
    handleOpenChatTab,
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
    handleLogout,
    leftSidebarPanelIds,
  ])

  // Helper to focus a review panel
  const focusReviewPanel = useCallback(
    (requestId) => {
      if (!dockApi) return
      const panel = dockApi.getPanel(`review-${requestId}`)
      if (panel) {
        panel.api.setActive()
      }
    },
    [dockApi]
  )

  // Update terminal panel params
  useEffect(() => {
    if (!dockApi) return
    const terminalPanels = listDockPanels(dockApi).filter(
      (panel) => getPanelComponent(panel) === 'terminal',
    )
    terminalPanels.forEach((panel) => {
      panel.api.updateParameters({
        panelId: panel.id,
        collapsed: false,
        onToggleCollapse: undefined,
        onSplitPanel: handleSplitChatPanel,
        approvals,
        onFocusReview: focusReviewPanel,
        onDecision: handleDecision,
        normalizeApprovalPath,
      })
    })
  }, [
    dockApi,
    collapsed.terminal,
    toggleTerminal,
    handleSplitChatPanel,
    approvals,
    focusReviewPanel,
    handleDecision,
    normalizeApprovalPath,
  ])

  // Update shell panel params
  // projectRoot dependency ensures this runs after layout restoration
  useEffect(() => {
    if (!dockApi) return
    const shellPanel = dockApi.getPanel('shell')
    if (shellPanel) {
      shellPanel.api.updateParameters({
        panelId: shellPanel.id,
        collapsed: collapsed.shell,
        onToggleCollapse: toggleShell,
      })
    }
  }, [dockApi, collapsed.shell, toggleShell, projectRoot])

  // Update companion panel params
  useEffect(() => {
    if (!dockApi) return
    const companionPanels = listDockPanels(dockApi).filter(
      (panel) => getPanelComponent(panel) === 'companion',
    )
    companionPanels.forEach((panel) => {
      const provider = panel?.params?.provider === 'pi' || panel.id === 'pi-agent'
        ? 'pi'
        : 'companion'
      panel.api.updateParameters({
        ...(panel?.params || {}),
        panelId: panel.id,
        collapsed: false,
        onToggleCollapse: undefined,
        onSplitPanel: handleSplitChatPanel,
        provider,
        lockProvider: true,
      })
    })
  }, [dockApi, collapsed.companion, toggleCompanion, handleSplitChatPanel])

  // Load workspace plugin panels when capabilities include them
  const workspacePanesKey = JSON.stringify(capabilities?.workspace_panes || [])
  useEffect(() => {
    const panes = capabilities?.workspace_panes
    if (!panes || panes.length === 0) return

    loadWorkspacePanes(panes).then((loaded) => {
      for (const [id, component] of Object.entries(loaded)) {
        const name = id.replace('ws-', '')
        registerPane({ id, component, title: name, placement: 'center' })
      }
      setWorkspaceComponents(loaded)
    })
  }, [workspacePanesKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!dockApi || capabilitiesLoading || projectRoot === null) return
    if (layoutRestored.current) return
    if (ensureCorePanelsRef.current) {
      ensureCorePanelsRef.current()
    }
  }, [dockApi, capabilitiesLoading, capabilities, nativeAgentEnabled, companionAgentEnabled, projectRoot])

  // Remove legacy fixed right-rail chat panels from older layouts.
  // New chat panels are dynamic tab panels created via addChatPanel.
  useEffect(() => {
    if (!dockApi || capabilitiesLoading) return

    let removedLegacyPanel = false
    ;['terminal', 'companion', 'pi-agent'].forEach((panelId) => {
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
  }, [dockApi, capabilitiesLoading, nativeAgentEnabled, storagePrefix])

  // Always open one chat panel on startup when none exists.
  const startupChatOpened = useRef(false)
  useEffect(() => {
    if (!dockApi || capabilitiesLoading || projectRoot === null) return
    if (!layoutRestored.current || startupChatOpened.current) return

    // Run startup auto-open only once, so user-closing the last chat
    // does not trigger re-creation until a full reload.
    startupChatOpened.current = true
    if (countAllAgentPanels(dockApi) === 0) {
      addChatPanel({ mode: 'split' })
    }
  }, [dockApi, capabilitiesLoading, projectRoot, addChatPanel])

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
  const hasRestoredFromUrl = useRef(false)
  useEffect(() => {
    if (!dockApi || projectRoot === null || hasRestoredFromUrl.current) return

    // Wait for core panels to exist before opening files
    const filetreePanel = dockApi.getPanel('filetree')
    if (!filetreePanel) return

    hasRestoredFromUrl.current = true

    const docPath = new URLSearchParams(window.location.search).get('doc')
    if (docPath) {
      // Small delay to ensure layout is fully ready
      setTimeout(() => {
        openFile(docPath)
      }, 150)
    }
  }, [dockApi, projectRoot, openFile])

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

    return { direction: 'right', referencePanel: 'filetree' }
  }, [dockApi, getLiveCenterGroup, isLeftSidebarGroup])

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
        direction: targetPanel.id === 'companion' ? 'left' : 'right',
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

  if (POC_MODE === 'chat') {
    return (
      <QueryClientProvider client={queryClient}>
        <DataContext.Provider value={dataProvider}>
          <ThemeProvider>
            <ClaudeStreamChat />
          </ThemeProvider>
        </DataContext.Provider>
      </QueryClientProvider>
    )
  }

  // Full-page settings views (render instead of DockView)
  if (isUserSettingsPage) {
    return (
      <ThemeProvider>
        <UserSettingsPage workspaceId={currentWorkspaceId} />
      </ThemeProvider>
    )
  }

  if (isWorkspaceSettingsPage) {
    return (
      <ThemeProvider>
        <WorkspaceSettingsPage workspaceId={currentWorkspaceId} />
      </ThemeProvider>
    )
  }

  // Build className with collapsed state flags for CSS targeting
  const dockviewClassName = [
    'dockview-theme-abyss',
    collapsed.filetree && 'filetree-is-collapsed',
    collapsed.terminal && 'terminal-is-collapsed',
    collapsed.companion && 'companion-is-collapsed',
    collapsed.shell && 'shell-is-collapsed',
  ].filter(Boolean).join(' ')

  return (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={dataProvider}>
        <ThemeProvider>
          <div className="app-container">
            {config.features?.showHeader !== false && (
              <header className="app-header">
                <div className="app-header-brand">
                  <div className="app-header-logo" aria-hidden="true">
                    {config.branding?.logo || 'B'}
                  </div>
                  <div className="app-header-title">
                    {projectRoot?.split('/').pop() || config.branding?.name || 'Workspace'}
                  </div>
                </div>
                <div className="app-header-controls">
                  <ThemeToggle />
                </div>
              </header>
            )}
            {unavailableEssentials.length > 0 && (
              <div className="capability-warning">
                <strong>Warning:</strong> Some features are unavailable.
                Missing capabilities for: {unavailableEssentials.map(p => p.title || p.id).join(', ')}.
              </div>
            )}
            <CapabilitiesStatusContext.Provider value={{ pending: capabilitiesPending }}>
              <CapabilitiesContext.Provider value={capabilities}>
                {capabilitiesPending ? (
                  <div className="workspace-loading" role="status" aria-live="polite">
                    <Loader2 className="workspace-loading-icon" size={40} />
                    <h2 className="workspace-loading-title">Opening workspace</h2>
                    <p className="workspace-loading-message">Connecting to backend services...</p>
                  </div>
                ) : (
                  <div data-testid="dockview" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                    <DockviewReact
                      className={dockviewClassName}
                      components={components}
                      tabComponents={tabComponents}
                      rightHeaderActionsComponent={RightHeaderActions}
                      onReady={onReady}
                      showDndOverlay={showDndOverlay}
                      onDidDrop={onDidDrop}
                    />
                  </div>
                )}
              </CapabilitiesContext.Provider>
            </CapabilitiesStatusContext.Provider>
            {showCreateWorkspaceModal && (
              <CreateWorkspaceModal
                onClose={() => setShowCreateWorkspaceModal(false)}
                onCreate={handleCreateWorkspaceSubmit}
              />
            )}
          </div>
        </ThemeProvider>
      </DataContext.Provider>
    </QueryClientProvider>
  )
}

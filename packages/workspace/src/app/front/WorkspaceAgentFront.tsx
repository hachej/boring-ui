import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import { Plug, Sparkles } from "lucide-react"
import {
  PiChatPanel as DefaultPiChatPanel,
  usePiSessions as useDefaultPiSessions,
  searchPiSessions,
  type SlashCommand,
  type ToolRendererOverrides,
} from "@hachej/boring-agent/front"
import { WorkspaceProvider, type WorkspaceProviderProps } from "../../front/provider/WorkspaceProvider"
import { ChatLayout, TopBar, ThemeToggle, type ChatLayoutProps } from "../../front/layout"
import type { WorkspaceChatPanelProps } from "../../front/chrome/chat/types"
import type {
  OpenPanelConfig,
  SurfaceShellApi,
  SurfaceShellProps,
  SurfaceShellSnapshot,
} from "../../front/chrome/artifact-surface/SurfaceShell"
import { SkillsPage } from "../../front/chrome/skills/SkillsPage"
import { WorkspaceShellCapabilitiesProvider } from "../../front/shell/WorkspaceShellCapabilitiesContext"
import { useWorkspaceShellCapabilitiesHost } from "./WorkspaceShellCapabilitiesHost"
import { PluginsOverlay } from "../../front/chrome/plugins/PluginsOverlay"
import { AppLeftPane } from "../../front/layout/plugin-tabs/AppLeftPane"
import { PluginTabsWorkspaceShell } from "../../front/layout/plugin-tabs/PluginTabsWorkspaceShell"
import { useViewportWidth } from "../../front/layout/useViewportWidth"
import { captureWorkspaceFrontPlugins } from "./workspaceBuiltinPlugins"
import type { FilesystemId } from "../../shared/types/filesystem"
import { UI_COMMAND_EVENT, dispatchUiCommand } from "../../front/bridge"
import type { CommandPaletteSessionItem } from "../../front/components/CommandPalette"
import type { CommandResult, DispatchContext, FileTreeBridge, Unsubscribe } from "../../front/bridge"
import { readStoredBoolean, readStoredNumber, writeStoredBoolean, writeStoredNumber } from "../../front/store/localStorageValues"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "../../front/agentPlugins/reloadEvent"
import { WorkspaceBackgroundBoot } from "./WorkspaceBackgroundBoot"
import { ChatSessionTransitionState, WorkbenchWarmupOverlay } from "./WorkspaceAgentStatusStates"
import { WorkspaceUiStateSync } from "./WorkspaceUiStateSync"
import { AddressedConsoleSessionsHost } from "./addressedConsoleSessions"
import { useWorkspaceAgentSessionCoordinator } from "./useWorkspaceAgentSessionCoordinator"
import { PluginAppLeftOverlayHost, assertUniqueAppLeftActionIds, pluginAppLeftActionIds, usePluginAppLeftActions, type AppLeftOverlayId } from "./PluginAppLeftHost"
import { CloseLeftPaneOnAttention } from "./CloseLeftPaneOnAttention"
import { workspaceRequestHeaders, type WorkspaceWarmupStatus } from "./workspacePreload"
import { createdSessionId } from "./chatPaneState"
import {
  workspaceSessionKey,
  workspaceSessionKeyFor,
  workspaceSessionRef,
  workspaceSessionRefFromKey,
  type WorkspaceSessionRef,
} from "../../front/sessionIdentity"

export interface WorkspaceAgentSession {
  id: string
  /** Addressed Agent owner; omitted for the compatibility default wire. */
  agentTypeId?: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
}

export interface WorkspaceAgentSessionsApi<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> {
  sessions: TSession[]
  /**
   * Agent scope that produced `sessions` and the active-session fields.
   * Addressed consumers reject results whose source does not match their request.
   */
  sourceAgentTypeId?: string | null
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: Error | null
  activeSessionId?: string | null
  /** Explicit owner for controlled colliding ids; falls back to activeSession.agentTypeId. */
  activeSessionAgentTypeId?: string | null
  activeSession?: TSession | null
  workspaceId?: string | null
  switch: (id: string, agentTypeId?: string) => void
  create: (input?: { title?: string }) => void | Promise<unknown>
  delete: (id: string, agentTypeId?: string) => void | Promise<unknown>
  loadMore?: () => void | Promise<unknown>
  refresh?: (options?: { background?: boolean; throwOnError?: boolean }) => void | Promise<unknown>
}

export type UseWorkspaceAgentSessions<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> = (options: {
  requestHeaders: Record<string, string>
  storageKey: string
  agentTypeId?: string
  workspaceId?: string
  apiBaseUrl?: string
  enabled?: boolean
  refreshKey?: unknown
}) => WorkspaceAgentSessionsApi<TSession>

export interface WorkspaceAddressedAgentOption {
  agentTypeId: string
  label: string
  description?: string
}

export interface WorkspaceAddressedAgentSelection {
  agents: WorkspaceAddressedAgentOption[]
  selectedAgentTypeId: string | undefined
  loading: boolean
  error: Error | undefined
  selectAgentTypeId: (agentTypeId: string) => void
}

export type UseWorkspaceAddressedAgentSelection = (options: {
  apiBaseUrl?: string
  requestHeaders?: Record<string, string | undefined>
  storageScope?: string
  enabled?: boolean
}) => WorkspaceAddressedAgentSelection

export type WorkspaceAgentLayout = "classic" | "plugin-tabs"
export type WorkspaceAgentAppLeftLayoutMode = "single-project" | "multi-project"
export type WorkspaceAgentAppLeftHeaderMode = "full" | "workspace" | "hidden"

export interface WorkspaceAgentAppLeftProjectSession {
  id: string
  agentTypeId?: string
  title?: string | null
  updatedAt?: string | number
}

export interface WorkspaceAgentAppLeftProject {
  id: string
  name: string
  available?: boolean
  sessionCount?: number
  blockedCount?: number
  sessions?: WorkspaceAgentAppLeftProjectSession[]
  hasMoreSessions?: boolean
  loadingSessions?: boolean
}

export interface WorkspaceAgentAppLeftAction {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  trailing?: ReactNode
  emphasis?: boolean
  active?: boolean
}

export interface WorkspaceAgentAppLeftOverlayRenderProps {
  onClose: () => void
  headerInsetStart: boolean
  headerInsetEnd: boolean
  workspaceId: string
}

export interface WorkspaceAgentAppLeftOverlayAction {
  id: string
  label: string
  icon: ReactNode
  trailing?: ReactNode
  emphasis?: boolean
  render: (props: WorkspaceAgentAppLeftOverlayRenderProps) => ReactNode
}

export interface WorkspaceAgentFrontProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> extends Omit<WorkspaceProviderProps, "children" | "workspaceId" | "storageKey" | "chatPanel" | "commandPaletteSessionSearch">,
    Omit<ChatLayoutProps,
      | "nav"
      | "navParams"
      | "center"
      | "centerParams"
      | "chatPanes"
      | "chatTopActions"
      | "activeChatPaneId"
      | "onActiveChatPaneChange"
      | "onCloseChatPane"
      | "onCreateChatPaneAfter"
      | "onDropChatSession"
      | "flashChatPaneId"
      | "surface"
      | "surfaceParams"
      | "sidebar"
      | "sidebarParams"
      | "storageKey"
    > {
  workspaceId: string
  /** Selects additive addressed AgentGateway transport; omission preserves legacy routes. */
  agentTypeId?: string
  /** Discovers the Agent fleet, defaults to its first entry, and keeps session operations addressed to the selection. */
  addressedAgentSelection?: boolean
  /** App-injected Agent discovery/selection implementation; workspace owns only the composed selection state. */
  useAddressedAgentSelection?: UseWorkspaceAddressedAgentSelection
  chatPanel?: ComponentType<WorkspaceChatPanelProps>
  useSessions?: UseWorkspaceAgentSessions<TSession>
  requestHeaders?: Record<string, string>
  sessionStorageKey?: string
  providerStorageKey?: string
  surfaceStorageKey?: string
  beforeShell?: ReactNode
  afterShell?: ReactNode
  appTitle?: string
  workspaceLabel?: string
  /** App-left workspace/project section title. Defaults to "Workspaces". */
  workspaceSectionTitle?: string
  /** App-left layout mode. single-project uses the workspace dropdown; multi-project renders workspaces inline. */
  appLeftLayoutMode?: WorkspaceAgentAppLeftLayoutMode
  /** App-left header mode: full brand, workspace picker only, or hidden with collapse-button clearance. */
  appLeftHeaderMode?: WorkspaceAgentAppLeftHeaderMode
  /** Optional cross-project overview rendered in the app-left workspace/project section. */
  appLeftProjects?: WorkspaceAgentAppLeftProject[]
  appLeftActiveProjectId?: string | null
  onSwitchAppLeftProject?: (projectId: string) => void
  onOpenAppLeftProjectSession?: (projectId: string, sessionId: string) => void
  onShowMoreAppLeftProjectSessions?: (projectId: string) => void
  onCreateAppLeftProject?: () => void
  /** Open a project's workspace settings (host wires routing — workspace pkg has no router). */
  onOpenAppLeftProjectSettings?: (projectId: string) => void
  /** Open a project in a new browser tab (host builds the href). */
  onOpenAppLeftProjectInNewTab?: (projectId: string) => void
  defaultSessionTitle?: string
  /**
   * Opt into the Phase 2 app/session left-pane shell. Defaults to the
   * existing classic top-bar + session-drawer workspace layout.
   */
  workspaceLayout?: WorkspaceAgentLayout
  navEnabled?: boolean
  defaultNavOpen?: boolean
  /** Initial collapsed state for the plugin-tabs app-left pane. */
  defaultAppLeftPaneCollapsed?: boolean
  defaultSurfaceOpen?: boolean
  defaultWorkbenchLeftTab?: string
  defaultWorkbenchLeftOpen?: boolean
  surfaceInitialPanels?: SurfaceShellProps["initialPanels"]
  topBarLeft?: ReactNode
  topBarRight?: ReactNode
  /**
   * Show the built-in top-bar theme toggle. Defaults to true for standalone
   * hosts (e.g. the workspace playground) that have no other theme control.
   * Full apps that already expose theme switching elsewhere (e.g. the core
   * UserMenu) should set this to false to avoid a duplicate control.
   */
  showThemeToggle?: boolean
  /** Initial plugin-tabs overlay, useful for demos/deep links. */
  defaultLeftOverlay?: string | null
  /** Show the plugin-tabs Skills action/overlay. Defaults to true. */
  showSkills?: boolean
  /** Show the plugin-tabs Plugins action/overlay. Defaults to true. */
  showPlugins?: boolean
  /** Extra actions inserted into the app-left primary action list before built-in management actions. */
  appLeftActions?: readonly WorkspaceAgentAppLeftAction[]
  /** Extra chat-hosted management overlays opened from the app-left primary action list. */
  appLeftOverlayActions?: readonly WorkspaceAgentAppLeftOverlayAction[]
  sessions?: WorkspaceAgentSession[]
  activeSessionId?: string | null
  /** Explicit owner for controlled colliding ids; falls back to the active session object. */
  activeSessionAgentTypeId?: string | null
  onSwitchSession?: (id: string, agentTypeId?: string) => void
  onCreateSession?: () => unknown | Promise<unknown>
  onDeleteSession?: (id: string, agentTypeId?: string) => void
  onActiveSessionIdChange?: (sessionId: string | null) => void
  chatParams?: Record<string, unknown>
  /**
   * Enable user-authored external plugin UX in the frontend. When `false`,
   * disables front plugin hot reload and hides the chat `/reload` UX. App/
   * internal statically composed plugins still work.
   */
  externalPlugins?: boolean
  /**
   * Forward to ChatPanel — when `false`, the `/reload` slash command is
   * hidden and the PluginUpdateStatus banner above the composer is
   * suppressed. Production apps that don't ship live plugin editing
   * should pass `false`. Defaults to `true` (dev/playground default).
   */
  hotReloadEnabled?: boolean
  extraPanels?: string[]
  extraCommands?: SlashCommand[]
  provisionWorkspace?: boolean
  bootPreloadPaths?: string[]
  onWorkspaceWarmupStatusChange?: (status: WorkspaceWarmupStatus) => void
}

function shellStorageKeyFromSurfaceStorage(
  surfaceKey: string,
  fallback: string,
): string {
  return surfaceKey.endsWith(":surface")
    ? surfaceKey.slice(0, -":surface".length)
    : fallback
}

function useStoredNumberState(
  key: string,
  fallback: number,
  enabled: boolean,
): [number, (next: number | ((previous: number) => number)) => void] {
  const [value, setValue] = useState(() => readStoredNumber(key, fallback, enabled))

  useEffect(() => {
    setValue(readStoredNumber(key, fallback, enabled))
  }, [key, fallback, enabled])

  const setStoredValue = useCallback(
    (next: number | ((previous: number) => number)) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next
        writeStoredNumber(key, resolved, enabled)
        return resolved
      })
    },
    [enabled, key],
  )

  return [value, setStoredValue]
}

function useStoredBooleanState(
  key: string,
  fallback: boolean,
  enabled: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => readStoredBoolean(key, fallback, enabled))

  useEffect(() => {
    setValue(readStoredBoolean(key, fallback, enabled))
  }, [key, fallback, enabled])

  const setStoredValue = useCallback(
    (next: boolean) => {
      setValue(next)
      writeStoredBoolean(key, next, enabled)
    },
    [enabled, key],
  )

  return [value, setStoredValue]
}

function readStoredNullableString(key: string, fallback: string | null, enabled: boolean): string | null {
  if (!enabled || typeof window === "undefined") return fallback
  try {
    const value = window.localStorage.getItem(key)
    return value === null ? fallback : value || null
  } catch {
    return fallback
  }
}

function writeStoredNullableString(key: string, value: string | null, enabled: boolean): void {
  if (!enabled || typeof window === "undefined") return
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Best-effort persistence only.
  }
}

function useStoredNullableStringState(
  key: string,
  fallback: string | null,
  enabled: boolean,
): [string | null, (next: string | null | ((previous: string | null) => string | null)) => void] {
  const [value, setValue] = useState(() => readStoredNullableString(key, fallback, enabled))

  useEffect(() => {
    setValue(readStoredNullableString(key, fallback, enabled))
  }, [enabled, fallback, key])

  const setStoredValue = useCallback(
    (next: string | null | ((previous: string | null) => string | null)) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next
        writeStoredNullableString(key, resolved, enabled)
        return resolved
      })
    },
    [enabled, key],
  )

  return [value, setStoredValue]
}

const EMPTY_HEADERS: Record<string, string> = {}
const PREPARING_WARMUP_STATUS: WorkspaceWarmupStatus = { status: "preparing" }
const NOOP_SELECT_AGENT = () => undefined

function useDisabledAddressedAgentSelection(): WorkspaceAddressedAgentSelection {
  return {
    agents: [],
    selectedAgentTypeId: undefined,
    loading: false,
    error: undefined,
    selectAgentTypeId: NOOP_SELECT_AGENT,
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const emptySurfaceSnapshot: SurfaceShellSnapshot = {
  openTabs: [],
  activeTab: null,
}

function useDefaultWorkspacePiSessions(options: Parameters<UseWorkspaceAgentSessions>[0]): WorkspaceAgentSessionsApi {
  const workspaceId = options.workspaceId ?? workspaceIdFromHeaders(options.requestHeaders) ?? options.storageKey
  const activeSessionStorage = useMemo(() => {
    if (!options.agentTypeId) return undefined
    const key = `${options.storageKey}:agent:${encodeURIComponent(options.agentTypeId)}:active-session`
    return {
      getItem: () => globalThis.localStorage?.getItem(key) ?? null,
      setItem: (_ignored: string, value: string) => globalThis.localStorage?.setItem(key, value),
      removeItem: () => globalThis.localStorage?.removeItem(key),
    }
  }, [options.agentTypeId, options.storageKey])
  const piSessions = useDefaultPiSessions({
    apiBaseUrl: options.apiBaseUrl,
    agentTypeId: options.agentTypeId,
    workspaceId,
    storageScope: workspaceId,
    storage: activeSessionStorage,
    requestHeaders: options.requestHeaders,
    enabled: options.enabled,
    connectActiveSession: false,
    refreshKey: options.refreshKey,
  })
  return {
    ...piSessions,
    sourceAgentTypeId: piSessions.dataAgentTypeId,
    workspaceId: piSessions.dataStorageScope,
  }
}

function workspaceIdFromHeaders(headers?: Record<string, string>): string | null {
  return headers?.["x-boring-workspace-id"] ?? headers?.["X-Boring-Workspace-Id"] ?? null
}

function pluginReloadMessage(payload: { reloaded?: boolean; diagnostics?: Array<{ message?: string }> }): string {
  const base = payload.reloaded ? "Extensions reloaded." : "Extensions will reload on the next message."
  const diagnosticMessages = Array.isArray(payload.diagnostics)
    ? payload.diagnostics.map((item) => item.message).filter((message): message is string => Boolean(message))
    : []
  return diagnosticMessages.length > 0
    ? `${base}\n\nWarnings:\n${diagnosticMessages.join("\n")}`
    : base
}

export function WorkspaceAgentFront<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  workspaceId,
  agentTypeId: explicitAgentTypeId,
  addressedAgentSelection = false,
  useAddressedAgentSelection: useAddressedAgentSelectionProp,
  chatPanel: chatPanelProp,
  useSessions: useSessionsProp,
  requestHeaders,
  sessionStorageKey,
  providerStorageKey,
  surfaceStorageKey,
  beforeShell,
  afterShell,
  panels,
  commands,
  catalogs,
  plugins,
  excludeDefaults,
  capabilities,
  apiBaseUrl,
  authHeaders,
  apiTimeout,
  defaultTheme,
  onThemeChange,
  persistenceEnabled,
  debug,
  bridgeEndpoint,
  fullPageBasePath,
  onAuthError,
  sessions,
  activeSessionId,
  activeSessionAgentTypeId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onActiveSessionIdChange,
  appTitle = "Boring UI",
  workspaceLabel,
  workspaceSectionTitle = "Workspaces",
  appLeftLayoutMode = "single-project",
  appLeftHeaderMode = "full",
  appLeftProjects,
  appLeftActiveProjectId,
  onSwitchAppLeftProject,
  onOpenAppLeftProjectSession,
  onShowMoreAppLeftProjectSessions,
  onCreateAppLeftProject,
  onOpenAppLeftProjectSettings,
  onOpenAppLeftProjectInNewTab,
  defaultSessionTitle = "New session",
  workspaceLayout = "classic",
  navEnabled = true,
  defaultNavOpen = false,
  defaultAppLeftPaneCollapsed,
  defaultSurfaceOpen,
  defaultWorkbenchLeftTab,
  defaultWorkbenchLeftOpen,
  surfaceInitialPanels,
  topBarLeft,
  topBarRight,
  showThemeToggle = true,
  defaultLeftOverlay = null,
  showSkills = true,
  showPlugins = true,
  appLeftActions,
  appLeftOverlayActions,
  chatParams,
  externalPlugins,
  hotReloadEnabled,
  frontPluginHotReload,
  extraPanels,
  extraCommands,
  provisionWorkspace,
  bootPreloadPaths,
  onWorkspaceWarmupStatusChange,
  onOpenNav,
  onOpenSurface,
  surfaceButtonBottomOffset,
  mobileShellEnabled = true,
  className,
}: WorkspaceAgentFrontProps<TSession>) {
  const viewport = useViewportWidth()
  const mobileShellActive = mobileShellEnabled && viewport < 640
  const externalPluginsEnabled = externalPlugins !== false
  const resolvedFrontPluginHotReload = externalPluginsEnabled ? frontPluginHotReload : false
  const resolvedHotReloadEnabled = externalPluginsEnabled ? hotReloadEnabled : false
  const resolvedProviderStorageKey =
    providerStorageKey ?? `boring-ui-v2:layout:${workspaceId}`
  const resolvedSurfaceStorageKey =
    surfaceStorageKey ?? `${resolvedProviderStorageKey}:surface`
  const shellStorageKey = shellStorageKeyFromSurfaceStorage(
    resolvedSurfaceStorageKey,
    resolvedProviderStorageKey,
  )
  const shellPersistenceEnabled = persistenceEnabled !== false
  const isPluginTabsLayout = workspaceLayout === "plugin-tabs"
  const skillsActionEnabled = showSkills !== false
  const pluginsActionEnabled = showPlugins !== false
  // Skills is only ever a chat-left overlay (see leftOverlay node below); it is
  // intentionally NOT registered as a workspace panel so it never appears in the
  // workbench surface.
  const baseProviderPanels = panels
  const resolvedSessionStorageKey =
    sessionStorageKey ?? `boring-workspace:sessions:${workspaceId}`
  const resolvedRequestHeaders = useMemo(
    () => workspaceRequestHeaders(workspaceId, requestHeaders ?? EMPTY_HEADERS),
    [requestHeaders, workspaceId],
  )
  const resolvedAuthHeaders = useMemo(
    () => workspaceRequestHeaders(workspaceId, { ...(requestHeaders ?? EMPTY_HEADERS), ...(authHeaders ?? EMPTY_HEADERS) }),
    [authHeaders, requestHeaders, workspaceId],
  )
  const useAgentSelection = useAddressedAgentSelectionProp ?? useDisabledAddressedAgentSelection
  const [workspaceWarmupState, setWorkspaceWarmupState] = useState<{ workspaceId: string; status: WorkspaceWarmupStatus }>(() => ({
    workspaceId,
    status: PREPARING_WARMUP_STATUS,
  }))
  const [leftOverlay, setLeftOverlay] = useStoredNullableStringState(
    `${shellStorageKey}:appLeftOverlay`,
    defaultLeftOverlay,
    shellPersistenceEnabled,
  ) as [AppLeftOverlayId, (next: AppLeftOverlayId | ((previous: AppLeftOverlayId) => AppLeftOverlayId)) => void]
  const handlePaneFocus = useCallback(() => setLeftOverlay(null), [setLeftOverlay])
  const workspaceWarmupStatus = workspaceWarmupState.workspaceId === workspaceId
    ? workspaceWarmupState.status
    : PREPARING_WARMUP_STATUS
  const chatPanel = (chatPanelProp ?? DefaultPiChatPanel) as ComponentType<WorkspaceChatPanelProps>
  const useSessions = (useSessionsProp ?? useDefaultWorkspacePiSessions) as UseWorkspaceAgentSessions<TSession>
  const requestedAutoSubmitInitialDraft = chatParams?.autoSubmitInitialDraft === true
  const {
    selection: {
      addressedAgentSelectionEnabled,
      multiAgentConsoleEnabled,
      addressedAgentSelectionState,
      agentTypeId,
      handleAgentTypeIdChange,
      controlledAgentSelection,
    },
    addressedHost: {
      remoteSessionHookEnabled,
      publishAddressedSessionController,
      removeAddressedSessionController,
    },
    sessions: {
      shouldUseRemoteSessions,
      remoteSessionApi,
      refreshAddressedSession,
      remoteSessionsPending,
      sessionApi,
      hasExplicitSessionProps,
      remoteSessionsTransitioning,
      selectedAddressedAgentIsEmpty,
      appLeftSessions,
      appLeftAgents,
      effectiveActiveSessionId,
      effectiveActiveSessionAgentTypeId,
      resolvedSessions,
      resolvedSessionTitle,
      rawSwitch,
      resolvedCreate,
    },
    panes: {
      chatSessionId,
      chatSessionKey,
      chatPaneIds,
      activeChatPaneId,
      displayedActiveChatPaneId,
      flashChatPane,
      pinnedIds,
      sessionTitleById,
      emptySessionIds,
      delayAutoSubmitDraft,
      hydrateMessages,
      markInitialHydrationPromptStarted,
      settleAutoSubmitHydration,
      toggleSessionPinned,
      switchToChatPane,
      activateChatPane,
      openChatPane,
      closeChatPane,
      createChatSession,
      createChatPaneAfter,
      createChatSessionPreferNewPane,
      deleteSessionAndPane,
    },
  } = useWorkspaceAgentSessionCoordinator({
    workspaceId,
    explicitAgentTypeId,
    addressedAgentSelection: addressedAgentSelection && Boolean(useAddressedAgentSelectionProp),
    useAgentSelection,
    useSessions,
    chatPanelProvided: Boolean(chatPanelProp),
    useSessionsProvided: Boolean(useSessionsProp),
    resolvedRequestHeaders,
    resolvedSessionStorageKey,
    apiBaseUrl,
    provisionWorkspace,
    isPluginTabsLayout,
    sessions,
    activeSessionId,
    activeSessionAgentTypeId,
    onSwitchSession,
    onCreateSession,
    onDeleteSession,
    onActiveSessionIdChange,
    defaultSessionTitle,
    autoSubmitInitialDraft: requestedAutoSubmitInitialDraft,
    persistenceEnabled: shellPersistenceEnabled,
    onPaneFocus: handlePaneFocus,
  })
  const [navOpen, setNavOpen] = useStoredBooleanState(
    `${shellStorageKey}:drawer`,
    defaultNavOpen,
    shellPersistenceEnabled,
  )
  const [appLeftPaneCollapsed, setAppLeftPaneCollapsed] = useStoredBooleanState(
    `${shellStorageKey}:appLeftPaneCollapsed`,
    defaultAppLeftPaneCollapsed ?? false,
    shellPersistenceEnabled,
  )
  const [appLeftPaneWidth, setAppLeftPaneWidth] = useStoredNumberState(
    `${shellStorageKey}:appLeftPaneWidth`,
    268,
    shellPersistenceEnabled,
  )
  const effectiveAppLeftPaneWidth = clampNumber(appLeftPaneWidth, 220, 420)
  const capturedPlugins = useMemo(() => captureWorkspaceFrontPlugins({
    plugins,
    excludeDefaults,
  }), [excludeDefaults, plugins])
  const pluginOverlayActionIds = useMemo(() => pluginAppLeftActionIds(capturedPlugins), [capturedPlugins])
  useEffect(() => {
    const customOverlayActive = Boolean(leftOverlay && appLeftOverlayActions?.some((action) => action.id === leftOverlay))
    if (
      (leftOverlay === "skills" && !skillsActionEnabled)
      || (leftOverlay === "plugins" && !pluginsActionEnabled)
      || (leftOverlay !== null
        && leftOverlay !== "skills"
        && leftOverlay !== "plugins"
        && !pluginOverlayActionIds.has(leftOverlay)
        && !customOverlayActive)
    ) {
      setLeftOverlay(null)
    }
  }, [appLeftOverlayActions, leftOverlay, pluginOverlayActionIds, pluginsActionEnabled, skillsActionEnabled])
  const effectiveNavOpen = navEnabled && navOpen
  const [surfaceOpen, setSurfaceOpen] = useStoredBooleanState(
    // Key must NOT match resolvedSurfaceStorageKey (which stores the dockview
    // layout JSON at the same ":surface" suffix). Writing "1"/"0" to the same
    // key corrupts the JSON and drops the persisted workbench layout on reload.
    `${shellStorageKey}:workbenchOpen`,
    defaultSurfaceOpen ?? false,
    shellPersistenceEnabled,
  )
  const [surfaceReady, setSurfaceReady] = useState(false)
  const [workbenchLeftOpen, setWorkbenchLeftOpen] = useStoredBooleanState(
    `${shellStorageKey}:workbenchLeftOpen`,
    defaultWorkbenchLeftOpen ?? false,
    shellPersistenceEnabled,
  )
  const [workbenchLeftExplicitOpen, setWorkbenchLeftExplicitOpen] = useState(() => defaultWorkbenchLeftOpen ?? false)
  const effectiveWorkbenchLeftOpen = defaultWorkbenchLeftOpen === false ? workbenchLeftExplicitOpen : workbenchLeftOpen
  // When a plugin attention item opens main content, get it out from behind any default-open left pane.
  const handleAttentionOpen = useCallback(() => {
    setWorkbenchLeftOpen(false)
    setWorkbenchLeftExplicitOpen(false)
    setLeftOverlay(null)
  }, [setWorkbenchLeftOpen])
  const surfaceOpenRef = useRef(surfaceOpen)
  const surfaceKeyRef = useRef(resolvedSurfaceStorageKey)
  const surfaceRef = useRef<{ key: string; api: SurfaceShellApi } | null>(null)
  // Ops issued (e.g. agent openFile/openPanel) while the SurfaceShell isn't
  // mounted yet — collapsed surface or warmup overlay still showing. The
  // dispatcher parks them here instead of dropping after its retry budget;
  // handleSurfaceReady drains them once the surface mounts.
  const pendingSurfaceOpsRef = useRef<Array<(api: SurfaceShellApi) => void>>([])
  // Keep the latest key available to stable command callbacks. We tag the
  // SurfaceShell handle instead of clearing it in an effect: clearing after
  // mount races with Dockview's onReady on the initial render.
  surfaceKeyRef.current = resolvedSurfaceStorageKey
  const [surfaceSnapshotState, setSurfaceSnapshotState] = useState(() => ({
    key: resolvedSurfaceStorageKey,
    snapshot: emptySurfaceSnapshot,
  }))
  const surfaceSnapshot = surfaceSnapshotState.key === resolvedSurfaceStorageKey
    ? surfaceSnapshotState.snapshot
    : emptySurfaceSnapshot

  useEffect(() => {
    setSurfaceReady(false)
    // Drop any ops parked for the previous workspace's surface so we never
    // replay them against a freshly-swapped workspace.
    pendingSurfaceOpsRef.current = []
  }, [resolvedSurfaceStorageKey])

  useEffect(() => {
    surfaceOpenRef.current = surfaceOpen
  }, [surfaceOpen])

  const handleSurfaceReady = useCallback((api: SurfaceShellApi) => {
    surfaceRef.current = { key: resolvedSurfaceStorageKey, api }
    setSurfaceReady(true)
    setSurfaceSnapshotState({
      key: resolvedSurfaceStorageKey,
      snapshot: api.getSnapshot(),
    })
    // Flush ops parked while the surface was unmounted (collapsed/warming up).
    const ops = pendingSurfaceOpsRef.current.splice(0)
    for (const op of ops) op(api)
  }, [resolvedSurfaceStorageKey])

  const enqueueSurfaceOp = useCallback((run: (api: SurfaceShellApi) => void) => {
    pendingSurfaceOpsRef.current.push(run)
  }, [])

  const handleSurfaceChange = useCallback((snapshot: SurfaceShellSnapshot) => {
    setSurfaceSnapshotState({
      key: resolvedSurfaceStorageKey,
      snapshot,
    })
  }, [resolvedSurfaceStorageKey])

  const getSurface = useCallback(() => {
    const ready = surfaceRef.current
    return ready?.key === surfaceKeyRef.current ? ready.api : null
  }, [])
  const isWorkbenchOpen = useCallback(() => surfaceOpenRef.current, [])
  const openWorkbench = useCallback(() => {
    surfaceOpenRef.current = true
    setSurfaceOpen(true)
  }, [setSurfaceOpen])
  const openWorkbenchSources = useCallback(() => {
    surfaceOpenRef.current = true
    setSurfaceOpen(true)
    setWorkbenchLeftOpen(true)
    setWorkbenchLeftExplicitOpen(true)
  }, [setSurfaceOpen, setWorkbenchLeftOpen])
  const closeWorkbench = useCallback(() => {
    surfaceOpenRef.current = false
    surfaceRef.current = null
    setSurfaceReady(false)
    setSurfaceOpen(false)
  }, [setSurfaceOpen])
  const openChatSessionIdsRef = useRef<ReadonlySet<string>>(new Set())
  const switchSessionForSurfaceRef = useRef<(sessionId: string, agentTypeId?: string) => void>(() => undefined)
  useEffect(() => {
    openChatSessionIdsRef.current = new Set(chatPaneIds)
  }, [chatPaneIds])
  useEffect(() => {
    switchSessionForSurfaceRef.current = switchToChatPane
  }, [switchToChatPane])
  const shouldOpenSurface = useCallback<NonNullable<DispatchContext["shouldOpenSurface"]>>((request) => {
    const meta = request.meta
    if (!meta || meta.openOnlyWhenSessionOpen !== true) return true
    const sessionId = typeof meta.sessionId === "string" ? meta.sessionId : null
    if (!sessionId) return false
    const sessionAgentTypeId = typeof (meta as { agentTypeId?: unknown }).agentTypeId === "string"
      ? (meta as { agentTypeId: string }).agentTypeId
      : undefined
    const sessionKey = workspaceSessionKey(sessionId, sessionAgentTypeId)
    if (!openChatSessionIdsRef.current.has(sessionKey)) {
      // A session-scoped surface belongs to a concrete chat session. If the
      // session is not currently mounted (fresh URL, closed split pane, etc.),
      // switch/load that chat first instead of silently skipping the surface and
      // leaving the user in an empty plugin pane.
      switchSessionForSurfaceRef.current(sessionId, sessionAgentTypeId)
    }
    return true
  }, [])

  // One source of truth for the agent → UI command dispatch context, shared by
  // the file-tree bridge, the window CustomEvent handler, and the chat host
  // (via centerParams). Adding a field here reaches every dispatch site.
  const surfaceDispatch = useMemo<DispatchContext>(() => ({
    surface: getSurface,
    isWorkbenchOpen,
    openWorkbench,
    openWorkbenchSources,
    closeWorkbench,
    enqueue: enqueueSurfaceOp,
    shouldOpenSurface,
  }), [getSurface, isWorkbenchOpen, openWorkbench, openWorkbenchSources, closeWorkbench, enqueueSurfaceOp, shouldOpenSurface])

  const openWorkspacePanel = useCallback((panel?: OpenPanelConfig) => {
    surfaceOpenRef.current = true
    setSurfaceOpen(true)
    onOpenSurface?.()
    if (!panel) return
    const run = (api: SurfaceShellApi) => api.openPanel(panel)
    const surface = getSurface()
    if (surface) run(surface)
    else enqueueSurfaceOp(run)
  }, [enqueueSurfaceOp, getSurface, onOpenSurface, setSurfaceOpen])

  // Minimal surface-backed bridge for the file tree. The left-tab file tree
  // only needs click-to-open + active-file reveal. Click-to-open routes through
  // the shared dispatcher so it gets the same open-workbench + surface-ready
  // retry + pending-op queue as agent commands (a direct getSurface().openFile()
  // drops the click when the surface hasn't mounted yet — the first-click race).
  const fileTreeBridge = useMemo<FileTreeBridge>(() => ({
    openFile: async (path: string, opts?: { filesystem?: FilesystemId }): Promise<CommandResult> => {
      dispatchUiCommand({ kind: "openFile", params: { path, ...(opts?.filesystem ? { filesystem: opts.filesystem } : {}) } }, surfaceDispatch)
      return { seq: 0, status: "ok" }
    },
    getActiveFile: () => getSurface()?.getSnapshot().activeTab ?? null,
    select: (): Unsubscribe => () => {},
  }), [getSurface, surfaceDispatch])
  const hasLeftTabs = useMemo(
    () => !isPluginTabsLayout && capturedPlugins.some((plugin) => plugin.registrations.workspaceSources.length > 0),
    [capturedPlugins, isPluginTabsLayout],
  )
  const pluginPanelIds = useMemo(
    () => capturedPlugins.flatMap((plugin) => plugin.registrations.panels.map((panel) => panel.id)),
    [capturedPlugins],
  )
  const pluginToolRenderers = useMemo<ToolRendererOverrides>(() => {
    const renderers: ToolRendererOverrides = {}
    for (const plugin of capturedPlugins) {
      for (const renderer of plugin.registrations.toolRenderers) {
        renderers[renderer.id] = renderer.render as ToolRendererOverrides[string]
      }
    }
    return renderers
  }, [capturedPlugins])
  const shellExtraPanels = useMemo(
    () => [...(extraPanels ?? []), ...pluginPanelIds],
    [extraPanels, pluginPanelIds],
  )
  const handleWorkspaceWarmupStatusChange = useCallback((status: WorkspaceWarmupStatus) => {
    setWorkspaceWarmupState({ workspaceId, status })
    onWorkspaceWarmupStatusChange?.(status)
  }, [onWorkspaceWarmupStatusChange, workspaceId])

  useEffect(() => {
    // postUiCommand also emits a browser CustomEvent so app/plugin bundles
    // loaded through different module graphs can still reach this shell.
    const handler = (event: Event) => {
      const command = (event as CustomEvent).detail
      if (!command || typeof command !== "object") return
      dispatchUiCommand(command, surfaceDispatch)
    }
    globalThis.addEventListener?.(UI_COMMAND_EVENT, handler)
    return () => globalThis.removeEventListener?.(UI_COMMAND_EVENT, handler)
  }, [surfaceDispatch])

  const workbenchBlocked = workspaceWarmupStatus.status !== "ready"
  const workbenchOverlay = workbenchBlocked ? <WorkbenchWarmupOverlay status={workspaceWarmupStatus} /> : undefined
  const reloadAgentPluginsForSession = useCallback(async (sessionId: string) => {
    const endpoint = `${apiBaseUrl?.replace(/\/$/, "") ?? ""}/api/v1/agent/reload`
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { ...resolvedRequestHeaders, "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error || `reload failed (${response.status})`)
    }
    const payload = await response.json().catch(() => ({})) as { reloaded?: boolean; diagnostics?: Array<{ message?: string }> }
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: payload }))
    return { message: pluginReloadMessage(payload), reloaded: payload.reloaded === true }
  }, [apiBaseUrl, resolvedRequestHeaders])

  const reloadAgentPluginsMessageForSession = useCallback(async (sessionId: string) => {
    try {
      return (await reloadAgentPluginsForSession(sessionId)).message
    } catch (error) {
      return error instanceof Error ? error.message : "Agent plugin reload failed."
    }
  }, [reloadAgentPluginsForSession])

  const chatRemoteSessionOptions = useMemo(() => {
    const base = (chatParams?.remoteSessionOptions && typeof chatParams.remoteSessionOptions === "object")
      ? chatParams.remoteSessionOptions as Record<string, unknown>
      : undefined
    if (!apiTimeout) return base
    return { ...(base ?? {}), requestTimeoutMs: apiTimeout }
  }, [apiTimeout, chatParams?.remoteSessionOptions])

  const makeCenterParams = useCallback(
    (sessionKey: string, options: { bridgeEnabled?: boolean } = {}) => {
      const bridgeEnabled = options.bridgeEnabled ?? true
      const sessionRef = workspaceSessionRefFromKey(sessionKey)
      const sessionId = sessionRef.sessionId
      const paneHydrateMessages = hydrateMessages || Boolean(
        multiAgentConsoleEnabled
        && sessionRef.agentTypeId
        && sessionId !== "default"
      )
      const chatToolRenderers = (chatParams?.toolRenderers && typeof chatParams.toolRenderers === "object")
        ? chatParams.toolRenderers as ToolRendererOverrides
        : undefined
      return {
      ...chatParams,
      ...(delayAutoSubmitDraft ? { autoSubmitInitialDraft: false, initialDraft: undefined } : {}),
      sessionId,
      agentTypeId: sessionRef.agentTypeId ?? agentTypeId,
      agentSelection: isPluginTabsLayout ? undefined : controlledAgentSelection,
      apiBaseUrl,
      workspaceId,
      storageScope: workspaceId,
      requestHeaders: resolvedRequestHeaders,
      remoteSessionOptions: chatRemoteSessionOptions,
      showSessions: false,
      onReloadAgentPlugins: chatParams?.onReloadAgentPlugins ?? (() => reloadAgentPluginsForSession(sessionId)),
      toolRenderers: { ...pluginToolRenderers, ...(chatToolRenderers ?? {}) },
      bridgeEndpoint: bridgeEnabled ? bridgeEndpoint : null,
      surfaceDispatch,
      extraCommands,
      workspaceWarmupStatus,
      hydrateMessages: paneHydrateMessages,
      allowPromptDuringInitialHydration: emptySessionIds.has(sessionKey),
      onPromptSubmitStarted: ({ sessionId: submittedSessionId }: { sessionId: string; clientNonce: string }) => {
        markInitialHydrationPromptStarted(submittedSessionId, sessionRef.agentTypeId ?? agentTypeId)
      },
      onTurnComplete: () => {
        if (multiAgentConsoleEnabled && sessionRef.agentTypeId) {
          void refreshAddressedSession(sessionRef)
        } else {
          void sessionApi?.refresh?.({ background: true })
        }
        const existing = chatParams?.onTurnComplete
        if (typeof existing === "function") existing()
      },
      onAutoSubmitInitialDraftSettled: () => {
        settleAutoSubmitHydration()
        const existing = chatParams?.onAutoSubmitInitialDraftSettled
        if (typeof existing === "function") existing()
      },
      // Forward the explicit prop when set. Omitting the key (when undefined)
      // lets ChatPanel apply its own default (true) and avoids overriding a
      // value passed through chatParams.
      ...(resolvedHotReloadEnabled !== undefined ? { hotReloadEnabled: resolvedHotReloadEnabled } : {}),
    }
    },
    [agentTypeId, apiBaseUrl, chatParams, chatRemoteSessionOptions, controlledAgentSelection, delayAutoSubmitDraft, resolvedRequestHeaders, bridgeEndpoint, surfaceDispatch, extraCommands, workspaceWarmupStatus, hydrateMessages, emptySessionIds, isPluginTabsLayout, markInitialHydrationPromptStarted, multiAgentConsoleEnabled, refreshAddressedSession, resolvedHotReloadEnabled, pluginToolRenderers, reloadAgentPluginsForSession, sessionApi, settleAutoSubmitHydration, workspaceId],
  )
  const centerParams = useMemo(
    () => makeCenterParams(chatSessionKey),
    [chatSessionKey, makeCenterParams],
  )
  // Stabilise each pane's params by (sessionId, bridgeEnabled). Switching the
  // active pane only flips one pane's bridge flag, so every *other* open pane
  // must keep its exact same params object — otherwise it re-renders with a
  // fresh-identity-but-equal params and reloads its transcript, which read as
  // "the other pane changed too" when opening a third session. The cache resets
  // whenever makeCenterParams changes (i.e. a real input changed), so genuine
  // updates still flow to every pane.
  const paneParamsCacheRef = useRef<{
    make: typeof makeCenterParams
    cache: Map<string, ReturnType<typeof makeCenterParams>>
  } | null>(null)
  const chatPanes = useMemo(() => {
    if (!paneParamsCacheRef.current || paneParamsCacheRef.current.make !== makeCenterParams) {
      paneParamsCacheRef.current = { make: makeCenterParams, cache: new Map() }
    }
    const { cache } = paneParamsCacheRef.current
    return chatPaneIds.map((id) => {
      const bridgeEnabled = id === displayedActiveChatPaneId
      const cacheKey = `${id}:${bridgeEnabled}`
      let params = cache.get(cacheKey)
      if (!params) {
        params = makeCenterParams(id, { bridgeEnabled })
        cache.set(cacheKey, params)
      }
      const sessionRef = workspaceSessionRefFromKey(id)
      return {
        id,
        title: sessionTitleById.get(id) ?? (sessionRef.sessionId === "default" ? defaultSessionTitle : sessionRef.sessionId),
        panel: "chat",
        params,
      }
    })
  }, [chatPaneIds, defaultSessionTitle, displayedActiveChatPaneId, makeCenterParams, sessionTitleById])
  const providerChatPaneSessionRefs = useMemo(
    () => chatPaneIds.map(workspaceSessionRefFromKey),
    [chatPaneIds],
  )
  const providerChatPaneSessionIds = useMemo(
    () => providerChatPaneSessionRefs.map((ref) => ref.sessionId),
    [providerChatPaneSessionRefs],
  )
  const providerActiveSessionRef = displayedActiveChatPaneId
    ? workspaceSessionRefFromKey(displayedActiveChatPaneId)
    : null
  const providerActiveSessionId = providerActiveSessionRef?.sessionId
  const attentionSessions = useMemo(() => {
    const refs = new Map<string, WorkspaceSessionRef>()
    for (const session of resolvedSessions) {
      const owner = "agentTypeId" in session ? session.agentTypeId : undefined
      refs.set(workspaceSessionKeyFor(session), workspaceSessionRef(session.id, owner))
    }
    for (const ref of providerChatPaneSessionRefs) refs.set(workspaceSessionKey(ref.sessionId, ref.agentTypeId), ref)
    if (effectiveActiveSessionId) {
      const ref = workspaceSessionRef(effectiveActiveSessionId, effectiveActiveSessionAgentTypeId ?? agentTypeId)
      refs.set(workspaceSessionKey(ref.sessionId, ref.agentTypeId), ref)
    }
    return [...refs.values()]
  }, [agentTypeId, effectiveActiveSessionAgentTypeId, effectiveActiveSessionId, providerChatPaneSessionRefs, resolvedSessions])
  const attentionSessionsAuthoritative = !remoteSessionsPending && !(sessionApi?.hasMore ?? false)
  const surfaceParams = useMemo<SurfaceShellProps>(() => ({
    storageKey: resolvedSurfaceStorageKey,
    defaultLeftTab: defaultWorkbenchLeftTab,
    initialPanels: surfaceInitialPanels,
    extraPanels: shellExtraPanels,
    onReloadAgentPlugins: () => reloadAgentPluginsMessageForSession(effectiveActiveSessionId ?? chatSessionId),
    onReady: handleSurfaceReady,
    onChange: handleSurfaceChange,
    onClose: closeWorkbench,
    showCloseAction: false,
  }), [
    closeWorkbench,
    defaultWorkbenchLeftTab,
    surfaceInitialPanels,
    reloadAgentPluginsMessageForSession,
    effectiveActiveSessionId,
    chatSessionId,
    handleSurfaceChange,
    handleSurfaceReady,
    resolvedSurfaceStorageKey,
    shellExtraPanels,
    setSurfaceOpen,
  ])

  const openCommandPalette = () => {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
  }

  const topBarRightContent = (
    <>
      {showThemeToggle ? <ThemeToggle /> : null}
      {topBarRight}
    </>
  )
  const activeChatPaneRef = displayedActiveChatPaneId ? workspaceSessionRefFromKey(displayedActiveChatPaneId) : null
  const openChatPaneRefs = useMemo(() => chatPaneIds.map((id) => workspaceSessionRefFromKey(id)), [chatPaneIds])
  const pinnedRefs = useMemo(() => pinnedIds.map((id) => workspaceSessionRefFromKey(id)), [pinnedIds])
  const navParams = {
    sessions: resolvedSessions,
    activeRef: activeChatPaneRef,
    openRefs: openChatPaneRefs,
    pinnedRefs,
    onTogglePin: toggleSessionPinned,
    onSwitch: switchToChatPane,
    onOpenAsTab: openChatPane,
    onCreate: resolvedCreate,
    onDelete: deleteSessionAndPane,
    onLoadMore: sessionApi?.loadMore,
    hasMore: sessionApi?.hasMore,
    loadingMore: sessionApi?.loadingMore,
    onClose: () => setNavOpen(false),
  }
  const canDeleteSessions = Boolean(sessionApi || onDeleteSession || !hasExplicitSessionProps)
  const commandPaletteSessionSearch = useMemo(() => (
    isPluginTabsLayout
      ? {
          sessions: resolvedSessions,
          activeId: activeChatPaneId,
          openIds: chatPaneIds,
          search: (sessions: readonly CommandPaletteSessionItem[], query: string) => searchPiSessions(sessions, query, { limit: 8 }),
          onSwitch: switchToChatPane,
          onOpenAsTab: openChatPane,
        }
      : undefined
  ), [activeChatPaneId, chatPaneIds, isPluginTabsLayout, openChatPane, resolvedSessions, switchToChatPane])
  const shellCapabilitiesHost = useWorkspaceShellCapabilitiesHost({
    appLeftPaneCollapsed,
    workspaceId,
    effectiveAppLeftPaneWidth,
    sessionTitleById,
    defaultSessionTitle,
    makeCenterParams,
    openChatPane,
    refreshChatSessions: async () => {
      await remoteSessionApi.refresh?.({ background: true, throwOnError: true })
    },
    surfaceDispatch,
    onDockOverlay: () => setLeftOverlay(null),
  })
  const createChatSessionInPopover = useCallback(() => {
    setLeftOverlay(null)
    const previousActiveId = effectiveActiveSessionId ?? activeChatPaneId
    const created = resolvedCreate()
    void Promise.resolve(created).then((session) => {
      const id = createdSessionId(session)
      if (!id) return
      shellCapabilitiesHost.shellCapabilities.openDetachedChat(id, {
        title: defaultSessionTitle,
        composingEnabled: true,
      })
      // Quick chat is an auxiliary popover: creating it must not steal the
      // selected/full chat from the main stage or left session list.
      if (previousActiveId && previousActiveId !== id) rawSwitch(previousActiveId)
    }).catch(() => {
      // Creation errors are surfaced by the session API/chat layer; the menu
      // should not leave a stale detached chat behind.
    })
    return created
  }, [activeChatPaneId, defaultSessionTitle, effectiveActiveSessionId, rawSwitch, resolvedCreate, shellCapabilitiesHost.shellCapabilities])
  const providerPanels = baseProviderPanels
  const pluginAppLeftActions = usePluginAppLeftActions({ plugins: capturedPlugins, activeOverlay: leftOverlay, setActiveOverlay: setLeftOverlay })
  const chatTopOverlayActions = useMemo(() => {
    if (!isPluginTabsLayout || !appLeftOverlayActions?.length) return null
    return (
      <div className="flex items-center gap-1">
        {appLeftOverlayActions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-boring-workspace-part="chat-pane-control"
            className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            aria-label={action.label}
            aria-pressed={leftOverlay === action.id}
            title={action.label}
            onPointerDownCapture={(event) => event.nativeEvent.stopPropagation()}
            onMouseDownCapture={(event) => event.nativeEvent.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setLeftOverlay((cur) => cur === action.id ? null : action.id)
            }}
          >
            {action.icon ? <span className="grid size-3.5 place-items-center">{action.icon}</span> : null}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    )
  }, [appLeftOverlayActions, isPluginTabsLayout, leftOverlay])

  const managementActions = useMemo<WorkspaceAgentAppLeftAction[]>(() => {
    const actions: WorkspaceAgentAppLeftAction[] = [...pluginAppLeftActions, ...(appLeftActions ?? [])]
    for (const action of appLeftOverlayActions ?? []) {
      actions.push({
        id: action.id,
        label: action.label,
        icon: action.icon,
        trailing: action.trailing,
        emphasis: action.emphasis,
        active: leftOverlay === action.id,
        onClick: () => setLeftOverlay((cur) => cur === action.id ? null : action.id),
      })
    }
    if (pluginsActionEnabled) {
      actions.push({
        id: "plugins",
        label: "Plugins",
        icon: <Plug className="h-4 w-4" strokeWidth={1.75} />,
        active: leftOverlay === "plugins",
        onClick: () => setLeftOverlay((cur) => cur === "plugins" ? null : "plugins"),
      })
    }
    if (skillsActionEnabled) {
      actions.push({
        id: "skills",
        label: "Skills",
        icon: <Sparkles className="h-4 w-4" strokeWidth={1.75} />,
        active: leftOverlay === "skills",
        onClick: () => setLeftOverlay((cur) => cur === "skills" ? null : "skills"),
      })
    }
    assertUniqueAppLeftActionIds(actions)
    return actions
  }, [appLeftActions, appLeftOverlayActions, leftOverlay, pluginAppLeftActions, pluginsActionEnabled, skillsActionEnabled])

  const pluginLeftOverlayNode = PluginAppLeftOverlayHost({
    plugins: capturedPlugins,
    activeOverlay: leftOverlay,
    onClose: () => setLeftOverlay(null),
    headerInsetStart: appLeftPaneCollapsed,
    headerInsetEnd: !surfaceOpen,
  })
  const customLeftOverlayNode = useMemo(() => {
    const overlay = appLeftOverlayActions?.find((action) => action.id === leftOverlay)
    if (!overlay) return null
    return overlay.render({
      onClose: () => setLeftOverlay(null),
      headerInsetStart: appLeftPaneCollapsed,
      headerInsetEnd: !surfaceOpen,
      workspaceId,
    })
  }, [appLeftOverlayActions, appLeftPaneCollapsed, leftOverlay, surfaceOpen, workspaceId])

  const leftOverlayNode = pluginLeftOverlayNode ?? customLeftOverlayNode ?? (leftOverlay === "skills" && skillsActionEnabled ? (
    <SkillsPage
      onClose={() => setLeftOverlay(null)}
      headerInsetStart={appLeftPaneCollapsed}
      headerInsetEnd={!surfaceOpen}
    />
  ) : leftOverlay === "plugins" && pluginsActionEnabled ? (
    <PluginsOverlay
      onClose={() => setLeftOverlay(null)}
      onReloadExternalPlugins={() => reloadAgentPluginsMessageForSession(effectiveActiveSessionId ?? chatSessionId)}
      headerInsetStart={appLeftPaneCollapsed}
      headerInsetEnd={!surfaceOpen}
    />
  ) : null)
  const selectedAddressedAgent = addressedAgentSelectionState.agents.find((agent) => agent.agentTypeId === agentTypeId)
  const addressedAgentEmptyState = selectedAddressedAgentIsEmpty ? (
    <div className="max-w-sm text-center">
      <h2 className="text-base font-semibold">No chats yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Start the first chat with {selectedAddressedAgent?.label ?? agentTypeId}.
      </p>
      <button
        type="button"
        className="mt-4 min-h-11 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground md:min-h-0"
        onClick={() => {
          void createChatSession()
        }}
      >
        Start new chat
      </button>
    </div>
  ) : undefined
  const preserveAddressedChatStage = multiAgentConsoleEnabled && chatPaneIds.length > 0
  const mainContent = remoteSessionsTransitioning && !preserveAddressedChatStage ? (
    <ChatSessionTransitionState />
  ) : (
    <ChatLayout
      className={className}
      nav={isPluginTabsLayout ? null : effectiveNavOpen ? "session-list" : null}
      navParams={navParams}
      center="chat"
      centerParams={centerParams}
      chatPanes={chatPanes}
      chatTopActions={chatTopOverlayActions}
      activeChatPaneId={displayedActiveChatPaneId}
      onActiveChatPaneChange={activateChatPane}
      onCloseChatPane={closeChatPane}
      onCreateChatPaneAfter={isPluginTabsLayout ? undefined : createChatPaneAfter}
      onDropChatSession={openChatPane}
      flashChatPaneId={flashChatPane?.workspaceId === workspaceId ? flashChatPane.id : null}
      surface={surfaceOpen ? "artifact-surface" : null}
      surfaceParams={surfaceParams as Record<string, unknown>}
      chatOverlay={isPluginTabsLayout ? leftOverlayNode : null}
      chatEmptyState={addressedAgentEmptyState}
      onCloseChatOverlay={() => setLeftOverlay(null)}
      surfaceOverlay={workbenchOverlay}
      sidebar={surfaceOpen && !workbenchBlocked && hasLeftTabs && effectiveWorkbenchLeftOpen ? "workbench-left" : null}
      sidebarParams={surfaceOpen && !workbenchBlocked && hasLeftTabs ? {
        ...(defaultWorkbenchLeftTab ? { defaultTab: defaultWorkbenchLeftTab } : {}),
        bridge: fileTreeBridge,
        onClose: () => {
          setWorkbenchLeftOpen(false)
          setWorkbenchLeftExplicitOpen(false)
        },
        onCollapse: () => {
          setWorkbenchLeftOpen(false)
          setWorkbenchLeftExplicitOpen(false)
        },
      } : undefined}
      storageKey={shellPersistenceEnabled ? shellStorageKey : undefined}
      onOpenNav={!isPluginTabsLayout && navEnabled ? () => {
        setNavOpen(true)
        onOpenNav?.()
      } : undefined}
      onOpenSurface={() => {
        surfaceOpenRef.current = true
        setSurfaceOpen(true)
        onOpenSurface?.()
      }}
      surfaceButtonBottomOffset={surfaceButtonBottomOffset}
      mobileShellEnabled={mobileShellEnabled}
      onOpenSidebar={hasLeftTabs ? () => {
        surfaceOpenRef.current = true
        setSurfaceOpen(true)
        setWorkbenchLeftOpen(true)
        setWorkbenchLeftExplicitOpen(true)
      } : undefined}
    />
  )
  const shellContent = isPluginTabsLayout ? (
    <PluginTabsWorkspaceShell
      collapsed={appLeftPaneCollapsed}
      onExpand={() => setAppLeftPaneCollapsed(false)}
      onCollapse={() => setAppLeftPaneCollapsed(true)}
      onResizeLeftPane={(delta) => setAppLeftPaneWidth((width) => clampNumber(width + delta, 220, 420))}
      leftPaneWidth={effectiveAppLeftPaneWidth}
      minLeftPaneWidth={220}
      maxLeftPaneWidth={420}
      mobileShellEnabled={mobileShellEnabled}
      leftPane={(
        <AppLeftPane
          width={effectiveAppLeftPaneWidth}
          appTitle={appTitle}
          workspaceLabel={workspaceLabel}
          workspaceSectionTitle={workspaceSectionTitle}
          layoutMode={appLeftLayoutMode}
          headerMode={appLeftHeaderMode}
          projects={appLeftProjects}
          activeProjectId={appLeftActiveProjectId ?? workspaceId}
          onOpenProjectSession={onOpenAppLeftProjectSession}
          onShowMoreProjectSessions={onShowMoreAppLeftProjectSessions}
          onCreateProject={onCreateAppLeftProject}
          onCreateProjectSession={(projectId) => {
            // Active project → create a chat in place. Other project → switch to
            // it (lands in a fresh "new chat" surface). Cross-project new-session
            // without a switch needs the pending-entry contract (plan §5.1) — deferred.
            if (projectId === (appLeftActiveProjectId ?? workspaceId)) {
              setLeftOverlay(null)
              void createChatSessionPreferNewPane()
            } else {
              onSwitchAppLeftProject?.(projectId)
            }
          }}
          onOpenProjectSettings={onOpenAppLeftProjectSettings}
          onOpenProjectInNewTab={onOpenAppLeftProjectInNewTab}
          sessionTitle={remoteSessionsTransitioning ? "Loading sessions…" : resolvedSessionTitle ?? defaultSessionTitle}
          topSlot={topBarLeft}
          bottomSlot={showThemeToggle || topBarRight != null ? <div className="flex w-full min-w-0 items-center gap-2">{topBarRightContent}</div> : undefined}
          sessions={appLeftSessions}
          agents={multiAgentConsoleEnabled ? appLeftAgents : undefined}
          selectedAgentTypeId={addressedAgentSelectionState.selectedAgentTypeId}
          onSelectAgentTypeId={multiAgentConsoleEnabled ? handleAgentTypeIdChange : undefined}
          activeSessionRef={activeChatPaneRef}
          muteActiveSession={Boolean(leftOverlay)}
          openSessionRefs={openChatPaneRefs}
          pinnedSessionRefs={pinnedRefs}
          onCreateSession={() => {
            setLeftOverlay(null)
            void createChatSession()
          }}
          onCreateSplitSession={() => {
            setLeftOverlay(null)
            void createChatPaneAfter(activeChatPaneId)
          }}
          onCreatePopoverSession={createChatSessionInPopover}
          onOpenCommandPalette={openCommandPalette}
          onSwitchSession={switchToChatPane}
          onOpenSessionAsPane={openChatPane}
          onToggleSessionPinned={toggleSessionPinned}
          onDeleteSession={canDeleteSessions ? deleteSessionAndPane : undefined}
          actions={managementActions}
        />
      )}
    >
      {mainContent}
    </PluginTabsWorkspaceShell>
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        appTitle={appTitle}
        sessionTitle={remoteSessionsTransitioning ? "Loading sessions…" : resolvedSessionTitle ?? defaultSessionTitle}
        onCommandPalette={openCommandPalette}
        topBarLeft={topBarLeft}
        topBarRight={topBarRightContent}
      />
      {mainContent}
    </div>
  )
  const floatingChatNode = shellCapabilitiesHost.floatingChatNode
  const publishedNavOpen = isPluginTabsLayout ? !appLeftPaneCollapsed : effectiveNavOpen

  return (
    <div className="relative h-full bg-background text-foreground">
      <WorkspaceShellCapabilitiesProvider value={shellCapabilitiesHost.shellCapabilities}>
      <WorkspaceProvider
        chatPanel={chatPanel}
        panels={providerPanels}
        commands={commands}
        catalogs={catalogs}
        plugins={plugins}
        capturedPlugins={capturedPlugins}
        excludeDefaults={excludeDefaults}
        capabilities={capabilities}
        apiBaseUrl={apiBaseUrl}
        authHeaders={resolvedAuthHeaders}
        apiTimeout={apiTimeout}
        activeSessionId={providerActiveSessionId}
        openSessionIds={providerChatPaneSessionIds}
        attentionSessions={attentionSessions}
        attentionSessionsAuthoritative={attentionSessionsAuthoritative}
        defaultTheme={defaultTheme}
        onThemeChange={onThemeChange}
        workspaceId={workspaceId}
        workspaceLabel={workspaceLabel}
        appTitle={appTitle}
        storageKey={resolvedProviderStorageKey}
        persistenceEnabled={persistenceEnabled}
        debug={mobileShellActive ? false : debug}
        bridgeEndpoint={null}
        onAuthError={onAuthError}
        frontPluginHotReload={resolvedFrontPluginHotReload}
        fullPageBasePath={fullPageBasePath}
        commandPaletteSessionSearch={commandPaletteSessionSearch}
      >
        {beforeShell}
        {multiAgentConsoleEnabled && remoteSessionHookEnabled ? (
          <AddressedConsoleSessionsHost
            agents={addressedAgentSelectionState.agents}
            useSessions={useSessions}
            requestHeaders={resolvedRequestHeaders}
            storageKey={resolvedSessionStorageKey}
            workspaceId={workspaceId}
            apiBaseUrl={apiBaseUrl}
            enabled={remoteSessionHookEnabled}
            onController={publishAddressedSessionController}
            onControllerRemoved={removeAddressedSessionController}
          />
        ) : null}
        <WorkspaceBackgroundBoot
          workspaceId={workspaceId}
          requestHeaders={resolvedRequestHeaders}
          apiBaseUrl={apiBaseUrl}
          preloadPaths={bootPreloadPaths}
          provisionWorkspace={provisionWorkspace}
          onStatusChange={handleWorkspaceWarmupStatusChange}
        />
        <WorkspaceUiStateSync
          bridgeEndpoint={bridgeEndpoint}
          requestHeaders={resolvedRequestHeaders}
          navOpen={publishedNavOpen}
          surfaceOpen={surfaceOpen}
          surfaceReady={surfaceReady}
          snapshot={surfaceSnapshot}
        />
        <CloseLeftPaneOnAttention activeSession={providerActiveSessionRef} onAttentionOpen={handleAttentionOpen} />
        {shellContent}
        {floatingChatNode}
        {afterShell}
      </WorkspaceProvider>
      </WorkspaceShellCapabilitiesProvider>
    </div>
  )
}

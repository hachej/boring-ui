import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react"
import {
  PiChatPanel as DefaultPiChatPanel,
  usePiSessions as useDefaultPiSessions,
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
import { PluginsOverlay } from "../../front/chrome/plugins/PluginsOverlay"
import { AppLeftPane } from "../../front/layout/plugin-tabs/AppLeftPane"
import { PluginTabsWorkspaceShell } from "../../front/layout/plugin-tabs/PluginTabsWorkspaceShell"
import { useRegistry, useSurfaceResolverRegistry } from "../../front/registry"
import { captureFrontPlugin } from "../../shared/plugins/frontFactory"
import { surfaceResolverDescriptor } from "../../shared/types/surface"
import { UI_COMMAND_EVENT, dispatchUiCommand } from "../../front/bridge"
import type { CommandResult, DispatchContext, FileTreeBridge, Unsubscribe } from "../../front/bridge"
import { readStoredBoolean, writeStoredBoolean } from "../../front/store/localStorageValues"
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "./localStorageSessions"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "../../front/agentPlugins/reloadEvent"
import { WorkspaceBackgroundBoot } from "./WorkspaceBackgroundBoot"
import { workspaceRequestHeaders, type WorkspaceWarmupStatus } from "./workspacePreload"
import {
  createdSessionId,
  insertPaneAfter,
  replaceActivePane,
  type ChatPaneState,
} from "./chatPaneState"

interface PendingCreatePane {
  afterId: string
  knownIds: Set<string>
  createdId?: string
}

export interface WorkspaceAgentSession {
  id: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
}

export interface WorkspaceAgentSessionsApi<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> {
  sessions: TSession[]
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: Error | null
  activeSessionId?: string | null
  activeSession?: TSession | null
  workspaceId?: string | null
  switch: (id: string) => void
  create: (input?: { title?: string }) => void | Promise<unknown>
  delete: (id: string) => void | Promise<unknown>
  loadMore?: () => void | Promise<unknown>
}

export type UseWorkspaceAgentSessions<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> = (options: {
  requestHeaders: Record<string, string>
  storageKey: string
  workspaceId?: string
  apiBaseUrl?: string
  enabled?: boolean
  refreshKey?: unknown
}) => WorkspaceAgentSessionsApi<TSession>

export type WorkspaceAgentLayout = "classic" | "plugin-tabs"

export interface WorkspaceAgentFrontProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> extends Omit<WorkspaceProviderProps, "children" | "workspaceId" | "storageKey" | "chatPanel" | "commandPaletteSessionSearch">,
    Omit<ChatLayoutProps,
      | "nav"
      | "navParams"
      | "center"
      | "centerParams"
      | "chatPanes"
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
  defaultSessionTitle?: string
  /**
   * Opt into the Phase 2 app/session left-pane shell. Defaults to the
   * existing classic top-bar + session-drawer workspace layout.
   */
  workspaceLayout?: WorkspaceAgentLayout
  navEnabled?: boolean
  defaultNavOpen?: boolean
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
  sessions?: Array<{ id: string; title?: string | null; updatedAt?: string | number; turnCount?: number }>
  activeSessionId?: string | null
  onSwitchSession?: (id: string) => void
  onCreateSession?: () => unknown | Promise<unknown>
  onDeleteSession?: (id: string) => void
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

const EMPTY_HEADERS: Record<string, string> = {}
const EMPTY_STRING_LIST: string[] = []
const PREPARING_WARMUP_STATUS: WorkspaceWarmupStatus = { status: "preparing" }

const emptySurfaceSnapshot: SurfaceShellSnapshot = {
  openTabs: [],
  activeTab: null,
}

function WorkbenchWarmupOverlay({ status }: { status: WorkspaceWarmupStatus }) {
  const requirement = status.status === "ready" ? undefined : status.requirement
  const preparing = status.status !== "failed"
  const title = preparing
    ? requirement === "workspace-fs"
      ? "Preparing files…"
      : requirement === "sandbox-exec"
        ? "Preparing secure runtime…"
        : requirement === "ui-bridge"
          ? "Connecting workspace…"
          : "Preparing workspace…"
    : "Workspace workbench failed"
  const description = status.status === "failed"
    ? status.message
    : "Chat is ready while files, tools, and workspace panels finish warming up."
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
        {preparing ? (
          <div className="mx-auto mb-3 h-7 w-7 rounded-full border-2 border-muted-foreground/20 border-t-foreground animate-spin" aria-hidden="true" />
        ) : null}
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {status.status === "failed" ? (
          <p className="mt-3 text-xs text-muted-foreground">Reload the workspace to retry.</p>
        ) : null}
      </div>
    </div>
  )
}

function useDefaultWorkspacePiSessions(options: Parameters<UseWorkspaceAgentSessions>[0]): WorkspaceAgentSessionsApi {
  const workspaceId = options.workspaceId ?? workspaceIdFromHeaders(options.requestHeaders) ?? options.storageKey
  const piSessions = useDefaultPiSessions({
    apiBaseUrl: options.apiBaseUrl,
    workspaceId,
    storageScope: workspaceId,
    requestHeaders: options.requestHeaders,
    enabled: options.enabled,
    connectActiveSession: false,
    refreshKey: options.refreshKey,
  })
  return { ...piSessions, workspaceId: piSessions.dataStorageScope }
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

function readStoredSessionId(storageKey: string): string | null {
  try {
    return globalThis.localStorage?.getItem(storageKey) ?? null
  } catch {
    return null
  }
}

function readStoredChatPaneState(storageKey: string, workspaceId: string): ChatPaneState | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ids?: unknown; activeId?: unknown }
    const ids = Array.isArray(parsed.ids)
      ? parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : []
    if (ids.length === 0) return null
    const activeId = typeof parsed.activeId === "string" && ids.includes(parsed.activeId)
      ? parsed.activeId
      : ids[0]
    return { workspaceId, ids, activeId }
  } catch {
    return null
  }
}

function writeStoredChatPaneState(storageKey: string, state: ChatPaneState): void {
  try {
    if (state.ids.length === 0) {
      globalThis.localStorage?.removeItem(storageKey)
      return
    }
    globalThis.localStorage?.setItem(
      storageKey,
      JSON.stringify({ ids: state.ids, activeId: state.activeId }),
    )
  } catch {
    // Best-effort persistence only.
  }
}

function readStoredPinnedSessions(storageKey: string, workspaceId: string): { workspaceId: string; ids: string[] } | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ids?: unknown }
    const ids = Array.isArray(parsed.ids)
      ? parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : []
    return { workspaceId, ids }
  } catch {
    return null
  }
}

function writeStoredPinnedSessions(storageKey: string, ids: string[]): void {
  try {
    if (ids.length === 0) {
      globalThis.localStorage?.removeItem(storageKey)
      return
    }
    globalThis.localStorage?.setItem(storageKey, JSON.stringify({ ids }))
  } catch {
    // Best-effort persistence only.
  }
}

function ChatSessionTransitionState() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mx-auto mb-3 h-7 w-7 rounded-full border-2 border-muted-foreground/20 border-t-foreground animate-spin" aria-hidden="true" />
        <div className="text-sm font-semibold text-foreground">Loading sessions…</div>
        <p className="mt-2 text-sm text-muted-foreground">Finding this workspace’s saved chats.</p>
      </div>
    </div>
  )
}

function uiEndpointBase(endpoint: string | null | undefined): string {
  if (!endpoint) return "/api/v1/ui"
  const normalized = endpoint.replace(/\/$/, "")
  const suffix = "/api/v1/ui"
  if (normalized.endsWith(suffix)) return normalized
  return `${normalized}${suffix}`
}

function uiStateEndpointUrl(endpoint: string | null | undefined): string {
  return `${uiEndpointBase(endpoint)}/state`
}

function activeFileFromSnapshot(snapshot: SurfaceShellSnapshot): string | null {
  const active = snapshot.openTabs.find((tab) => tab.id === snapshot.activeTab)
  const path = active?.params?.path
  return typeof path === "string" ? path : null
}

function WorkspaceUiStateSync({
  bridgeEndpoint,
  requestHeaders,
  navOpen,
  surfaceOpen,
  surfaceReady,
  snapshot,
}: {
  bridgeEndpoint?: string | null
  requestHeaders: Record<string, string>
  navOpen: boolean
  surfaceOpen: boolean
  surfaceReady: boolean
  snapshot: SurfaceShellSnapshot
}) {
  const panelRegistry = useRegistry()
  const surfaceResolverRegistry = useSurfaceResolverRegistry()
  const panelRegistrySnapshot = useSyncExternalStore(
    panelRegistry.subscribe,
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot,
  )
  const surfaceResolverSnapshot = useSyncExternalStore(
    surfaceResolverRegistry.subscribe,
    surfaceResolverRegistry.getSnapshot,
    surfaceResolverRegistry.getSnapshot,
  )
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (bridgeEndpoint === null) return
    // Do not publish a placeholder empty tab snapshot while the workbench
    // is mounted/opening but Dockview has not called onReady yet. That
    // replace-style PUT would clobber the bridge's last known openTabs and
    // make agent verification think every tab disappeared.
    if (surfaceOpen && !surfaceReady) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const state = {
      v: 1,
      drawerOpen: navOpen,
      workbenchOpen: surfaceOpen,
      openTabs: snapshot.openTabs,
      activeTab: snapshot.activeTab,
      activeFile: activeFileFromSnapshot(snapshot),
      availablePanels: panelRegistrySnapshot.map((panel) => panel.id),
      availableSurfaces: surfaceResolverSnapshot.flatMap((surface) => {
        const descriptor = surfaceResolverDescriptor(surface)
        return descriptor ? [descriptor] : []
      }),
    }

    void fetch(uiStateEndpointUrl(bridgeEndpoint), {
      method: "PUT",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ state, causedBy: "user" }),
      signal: controller.signal,
    }).catch(() => {
      // UI state is advisory for the agent; command delivery still works.
    })

    return () => {
      controller.abort()
    }
  }, [bridgeEndpoint, navOpen, panelRegistrySnapshot, requestHeaders, snapshot, surfaceOpen, surfaceReady, surfaceResolverSnapshot])

  return null
}

export function WorkspaceAgentFront<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  workspaceId,
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
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onActiveSessionIdChange,
  appTitle = "Boring UI",
  workspaceLabel,
  defaultSessionTitle = "New session",
  workspaceLayout = "classic",
  navEnabled = true,
  defaultNavOpen = false,
  defaultSurfaceOpen,
  defaultWorkbenchLeftTab,
  defaultWorkbenchLeftOpen,
  surfaceInitialPanels,
  topBarLeft,
  topBarRight,
  showThemeToggle = true,
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
  className,
}: WorkspaceAgentFrontProps<TSession>) {
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
  // Skills is only ever a chat-left overlay (see leftOverlay node below); it is
  // intentionally NOT registered as a workspace panel so it never appears in the
  // workbench surface.
  const providerPanels = panels
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
  const localSessionStore = useMemo(
    () => createLocalStorageSessions({ storageKey: resolvedSessionStorageKey }),
    [resolvedSessionStorageKey],
  )
  const localSessions = useLocalStorageSessions(localSessionStore)
  const [workspaceWarmupState, setWorkspaceWarmupState] = useState<{ workspaceId: string; status: WorkspaceWarmupStatus }>(() => ({
    workspaceId,
    status: PREPARING_WARMUP_STATUS,
  }))
  const [emptySessionsGrace, setEmptySessionsGrace] = useState<{ workspaceId: string; expired: boolean }>(() => ({
    workspaceId,
    expired: false,
  }))
  const [initialRemoteSessionCreating, setInitialRemoteSessionCreating] = useState<{ workspaceId: string; creating: boolean }>(() => ({
    workspaceId,
    creating: false,
  }))
  const [initialRemoteSessionCreateFailed, setInitialRemoteSessionCreateFailed] = useState<{ workspaceId: string; failed: boolean }>(() => ({
    workspaceId,
    failed: false,
  }))
  const [freshEmptySession, setFreshEmptySession] = useState<{ workspaceId: string; id: string } | null>(null)
  const chatPaneStorageKey = `boring-workspace:chat-panes:${workspaceId}`
  const [chatPaneState, setChatPaneState] = useState<ChatPaneState>(() =>
    (shellPersistenceEnabled ? readStoredChatPaneState(chatPaneStorageKey, workspaceId) : null)
      ?? { workspaceId, ids: [], activeId: null },
  )
  const [flashChatPane, setFlashChatPane] = useState<{ workspaceId: string; id: string } | null>(null)
  useEffect(() => {
    if (!flashChatPane) return
    const timer = setTimeout(() => setFlashChatPane(null), 700)
    return () => clearTimeout(timer)
  }, [flashChatPane])

  const pinnedStorageKey = `boring-workspace:pinned-sessions:${workspaceId}`
  const [pinnedState, setPinnedState] = useState<{ workspaceId: string; ids: string[] }>(() =>
    (shellPersistenceEnabled ? readStoredPinnedSessions(pinnedStorageKey, workspaceId) : null)
      ?? { workspaceId, ids: [] },
  )
  const pinnedIds = pinnedState.workspaceId === workspaceId ? pinnedState.ids : EMPTY_STRING_LIST
  useEffect(() => {
    setPinnedState((previous) => {
      if (previous.workspaceId === workspaceId) return previous
      return (shellPersistenceEnabled ? readStoredPinnedSessions(pinnedStorageKey, workspaceId) : null)
        ?? { workspaceId, ids: [] }
    })
  }, [pinnedStorageKey, shellPersistenceEnabled, workspaceId])
  const toggleSessionPinned = useCallback((sessionId: string) => {
    setPinnedState((previous) => {
      const current = previous.workspaceId === workspaceId ? previous.ids : []
      const ids = current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [sessionId, ...current]
      if (shellPersistenceEnabled) writeStoredPinnedSessions(pinnedStorageKey, ids)
      return { workspaceId, ids }
    })
  }, [pinnedStorageKey, shellPersistenceEnabled, workspaceId])
  useEffect(() => {
    if (!shellPersistenceEnabled) return
    if (chatPaneState.workspaceId !== workspaceId) return
    writeStoredChatPaneState(chatPaneStorageKey, chatPaneState)
  }, [chatPaneState, chatPaneStorageKey, shellPersistenceEnabled, workspaceId])
  useEffect(() => {
    setChatPaneState((previous) => {
      if (previous.workspaceId === workspaceId) return previous
      return (shellPersistenceEnabled ? readStoredChatPaneState(chatPaneStorageKey, workspaceId) : null)
        ?? { workspaceId, ids: [], activeId: null }
    })
  }, [chatPaneStorageKey, shellPersistenceEnabled, workspaceId])
  const workspaceWarmupStatus = workspaceWarmupState.workspaceId === workspaceId
    ? workspaceWarmupState.status
    : PREPARING_WARMUP_STATUS
  const chatPanel = (chatPanelProp ?? DefaultPiChatPanel) as ComponentType<WorkspaceChatPanelProps>
  const useSessions = (useSessionsProp ?? useDefaultWorkspacePiSessions) as UseWorkspaceAgentSessions<TSession>
  const shouldUseRemoteSessions = !chatPanelProp || Boolean(useSessionsProp)
  const remoteSessionHookEnabled = shouldUseRemoteSessions && provisionWorkspace !== false
  const remoteSessionActionsUnavailable = () => undefined
  const remoteSessionApi = useSessions({
    requestHeaders: resolvedRequestHeaders,
    storageKey: resolvedSessionStorageKey,
    workspaceId,
    apiBaseUrl,
    enabled: remoteSessionHookEnabled,
  })
  const [remoteSessionSnapshot, setRemoteSessionSnapshot] = useState<{
    workspaceId: string
    sessions: TSession[]
    activeSessionId: string | null | undefined
  }>(() => ({ workspaceId, sessions: [], activeSessionId: null }))
  const remoteSessionsArePreviousWorkspace = remoteSessionHookEnabled
    && remoteSessionApi.workspaceId != null
    && remoteSessionApi.workspaceId !== workspaceId
  const remoteSessionsAvailable = remoteSessionHookEnabled && !remoteSessionApi.loading && !remoteSessionApi.error && !remoteSessionsArePreviousWorkspace
  const remoteSessionsPending = remoteSessionHookEnabled && !remoteSessionsAvailable
  useEffect(() => {
    if (!remoteSessionsAvailable) return
    setRemoteSessionSnapshot((previous) => {
      const sameWorkspace = previous.workspaceId === workspaceId
      const sameActive = previous.activeSessionId === remoteSessionApi.activeSessionId
      const sameSessions = previous.sessions.length === remoteSessionApi.sessions.length
        && previous.sessions.every((session, index) => session.id === remoteSessionApi.sessions[index]?.id)
      if (sameWorkspace && sameActive && sameSessions) return previous
      return {
        workspaceId,
        sessions: remoteSessionApi.sessions,
        activeSessionId: remoteSessionApi.activeSessionId,
      }
    })
  }, [remoteSessionApi.activeSessionId, remoteSessionApi.sessions, remoteSessionsAvailable, workspaceId])
  const remoteSessionsHaveStaleData = remoteSessionsPending
    && remoteSessionSnapshot.workspaceId === workspaceId
    && remoteSessionSnapshot.sessions.length > 0
  const pendingStoredActiveSessionId = remoteSessionsPending ? readStoredSessionId(resolvedSessionStorageKey) : null
  const pendingRemoteActiveSessionId = remoteSessionsPending && !remoteSessionsArePreviousWorkspace
    ? remoteSessionApi.activeSessionId ?? null
    : null
  const activeRemoteSessions = remoteSessionsAvailable
    ? remoteSessionApi.sessions
    : remoteSessionsHaveStaleData
      ? remoteSessionSnapshot.sessions
      : []
  const activeRemoteSessionId = remoteSessionsAvailable
    ? remoteSessionApi.activeSessionId
    : remoteSessionsHaveStaleData
      ? remoteSessionSnapshot.activeSessionId
      : null
  const sessionApi = shouldUseRemoteSessions && (remoteSessionsAvailable || remoteSessionsHaveStaleData) ? remoteSessionApi : undefined
  const hasExplicitSessionProps =
    sessions !== undefined ||
    activeSessionId !== undefined ||
    onSwitchSession !== undefined ||
    onCreateSession !== undefined ||
    onDeleteSession !== undefined
  const emptySessionsGraceExpired = emptySessionsGrace.workspaceId === workspaceId && emptySessionsGrace.expired
  const suppressEmptyAutoCreateRef = useRef(false)
  const remoteEmptySessionsSettling = Boolean(
    remoteSessionsAvailable
    && sessionApi
    && !hasExplicitSessionProps
    && activeRemoteSessions.length === 0
    && !emptySessionsGraceExpired,
  )
  const remoteInitialSessionCreating = initialRemoteSessionCreating.workspaceId === workspaceId
    && initialRemoteSessionCreating.creating
  const remoteInitialSessionFailed = initialRemoteSessionCreateFailed.workspaceId === workspaceId
    && initialRemoteSessionCreateFailed.failed
  const remoteInitialSessionNeeded = Boolean(
    remoteSessionsAvailable
      && sessionApi
      && !hasExplicitSessionProps
      && activeRemoteSessions.length === 0
      && emptySessionsGraceExpired
      && !suppressEmptyAutoCreateRef.current
      && !remoteInitialSessionFailed,
  )
  const remoteSessionsInitialLoading = Boolean(
    remoteSessionsPending
      && remoteSessionApi.loading
      && !remoteSessionApi.error
      && shouldUseRemoteSessions
      && !hasExplicitSessionProps
      && !remoteSessionsHaveStaleData
      && !pendingStoredActiveSessionId
      && !pendingRemoteActiveSessionId,
  )
  const remoteSessionsTransitioning = remoteSessionsInitialLoading || remoteEmptySessionsSettling || remoteInitialSessionCreating || remoteInitialSessionNeeded

  useEffect(() => {
    if (!remoteEmptySessionsSettling) {
      if (emptySessionsGrace.workspaceId !== workspaceId) {
        setEmptySessionsGrace({ workspaceId, expired: false })
      }
      return
    }
    setEmptySessionsGrace({ workspaceId, expired: false })
    const timeout = globalThis.setTimeout(() => {
      setEmptySessionsGrace({ workspaceId, expired: true })
    }, 2000)
    return () => globalThis.clearTimeout(timeout)
  }, [emptySessionsGrace.workspaceId, remoteEmptySessionsSettling, workspaceId])

  const sessionItems = sessionApi ? activeRemoteSessions.map((session) => ({
    ...session,
    title: session.title ?? "New session",
  })) : undefined
  const pendingStoredSessionPlaceholder = pendingStoredActiveSessionId
    ? [{
        id: pendingStoredActiveSessionId,
        title: "Loading sessions…",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        turnCount: 0,
      }]
    : []
  const resolvedSessions = sessionApi
    ? sessionItems ?? []
    : remoteSessionsPending
      ? pendingStoredSessionPlaceholder
      : hasExplicitSessionProps
        ? sessions ?? []
        : localSessions.sessions
  const resolvedActiveId = sessionApi
    ? activeRemoteSessionId ?? null
    : remoteSessionsPending
      ? pendingStoredActiveSessionId ?? pendingRemoteActiveSessionId
      : hasExplicitSessionProps
        ? activeSessionId ?? null
        : localSessions.activeId
  const requestedAutoSubmitInitialDraft = chatParams?.autoSubmitInitialDraft === true
  const needsFreshRemoteSessionForAutoSubmit = requestedAutoSubmitInitialDraft && shouldUseRemoteSessions && !hasExplicitSessionProps
  const [autoSubmitSessionId, setAutoSubmitSessionId] = useState<string | null | undefined>(() => (
    needsFreshRemoteSessionForAutoSubmit ? null : undefined
  ))
  const autoSubmitSessionWorkspaceRef = useRef(workspaceId)
  const autoSubmitSessionCreateRef = useRef(false)
  useEffect(() => {
    if (autoSubmitSessionWorkspaceRef.current !== workspaceId) {
      autoSubmitSessionWorkspaceRef.current = workspaceId
      autoSubmitSessionCreateRef.current = false
      setAutoSubmitSessionId(needsFreshRemoteSessionForAutoSubmit ? null : undefined)
      return
    }
    if (needsFreshRemoteSessionForAutoSubmit && autoSubmitSessionId === undefined) {
      autoSubmitSessionCreateRef.current = false
      setAutoSubmitSessionId(null)
    }
  }, [autoSubmitSessionId, needsFreshRemoteSessionForAutoSubmit, workspaceId])
  useEffect(() => {
    if (!sessionApi || autoSubmitSessionId !== null) return
    if (autoSubmitSessionCreateRef.current) return
    autoSubmitSessionCreateRef.current = true
    void Promise.resolve(sessionApi.create({ title: defaultSessionTitle }))
      .then((session) => {
        if (typeof (session as { id?: unknown } | null | undefined)?.id !== "string") {
          throw new Error("auto_submit_session_create_failed")
        }
        setAutoSubmitSessionId((session as { id: string }).id)
      })
      .catch(() => {
        autoSubmitSessionCreateRef.current = false
        setAutoSubmitSessionId(undefined)
      })
  }, [autoSubmitSessionId, defaultSessionTitle, sessionApi])
  const effectiveActiveSessionId = autoSubmitSessionId !== undefined ? autoSubmitSessionId ?? null : resolvedActiveId
  const rawSwitch = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi?.switch ?? onSwitchSession ?? localSessionStore.switchTo
  const resolvedSwitch = useCallback((nextSessionId: string) => {
    if (effectiveActiveSessionId && nextSessionId !== effectiveActiveSessionId) {
      window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: effectiveActiveSessionId } }))
    }
    return rawSwitch(nextSessionId)
  }, [effectiveActiveSessionId, rawSwitch])
  const resolvedCreate = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi
      ? () => sessionApi.create()
      : onCreateSession
        ? () => onCreateSession()
        : () => localSessionStore.create()
  const rawDelete = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi?.delete ?? onDeleteSession ?? localSessionStore.remove
  const resolvedDelete = useCallback((id: string) => {
    if (sessionApi && activeRemoteSessions.length <= 1) {
      suppressEmptyAutoCreateRef.current = true
    }
    return rawDelete(id)
  }, [activeRemoteSessions.length, rawDelete, sessionApi])
  const resolvedSessionTitle = resolvedSessions.find((session) => session.id === effectiveActiveSessionId)?.title ?? undefined

  const [navOpen, setNavOpen] = useStoredBooleanState(
    `${shellStorageKey}:drawer`,
    defaultNavOpen,
    shellPersistenceEnabled,
  )
  const [appLeftPaneCollapsed, setAppLeftPaneCollapsed] = useStoredBooleanState(
    `${shellStorageKey}:appLeftPaneCollapsed`,
    false,
    shellPersistenceEnabled,
  )
  const [leftOverlay, setLeftOverlay] = useState<"skills" | "plugins" | null>(null)
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
  const autoCreateSessionRef = useRef(false)
  const pendingCreatePaneRef = useRef<PendingCreatePane | null>(null)
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
    autoCreateSessionRef.current = false
    suppressEmptyAutoCreateRef.current = false
    setInitialRemoteSessionCreating({ workspaceId, creating: false })
    setInitialRemoteSessionCreateFailed({ workspaceId, failed: false })
    setFreshEmptySession(null)
  }, [workspaceId])

  useEffect(() => {
    setSurfaceReady(false)
    // Drop any ops parked for the previous workspace's surface so we never
    // replay them against a freshly-swapped workspace.
    pendingSurfaceOpsRef.current = []
  }, [resolvedSurfaceStorageKey])

  useEffect(() => {
    if (!sessionApi || sessionApi.loading) return
    if (remoteEmptySessionsSettling) return
    if (autoSubmitSessionId !== undefined) return
    if (activeRemoteSessions.length > 0) {
      autoCreateSessionRef.current = false
      suppressEmptyAutoCreateRef.current = false
      setInitialRemoteSessionCreating((current) => (
        current.workspaceId === workspaceId && current.creating
          ? { workspaceId, creating: false }
          : current
      ))
      setInitialRemoteSessionCreateFailed((current) => (
        current.workspaceId === workspaceId && current.failed
          ? { workspaceId, failed: false }
          : current
      ))
      return
    }
    if (suppressEmptyAutoCreateRef.current) return
    if (autoCreateSessionRef.current) return
    autoCreateSessionRef.current = true
    setInitialRemoteSessionCreating({ workspaceId, creating: true })
    setInitialRemoteSessionCreateFailed({ workspaceId, failed: false })
    void Promise.resolve(sessionApi.create({ title: defaultSessionTitle }))
      .then((session) => {
        const id = (session as { id?: unknown } | null | undefined)?.id
        if (typeof id === "string") setFreshEmptySession({ workspaceId, id })
      })
      .catch(() => {
        autoCreateSessionRef.current = false
        setInitialRemoteSessionCreating({ workspaceId, creating: false })
        setInitialRemoteSessionCreateFailed({ workspaceId, failed: true })
      })
  }, [activeRemoteSessions.length, autoSubmitSessionId, defaultSessionTitle, remoteEmptySessionsSettling, sessionApi, workspaceId])

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
  }), [getSurface, isWorkbenchOpen, openWorkbench, openWorkbenchSources, closeWorkbench, enqueueSurfaceOp])

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
    openFile: async (path: string): Promise<CommandResult> => {
      dispatchUiCommand({ kind: "openFile", params: { path } }, surfaceDispatch)
      return { seq: 0, status: "ok" }
    },
    getActiveFile: () => getSurface()?.getSnapshot().activeTab ?? null,
    select: (): Unsubscribe => () => {},
  }), [getSurface, surfaceDispatch])
  const capturedPlugins = useMemo(
    () => plugins?.map(captureFrontPlugin) ?? [],
    [plugins],
  )
  const hasLeftTabs = false
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
  const chatSessionId = shouldUseRemoteSessions && !useSessionsProp && remoteSessionSnapshot.workspaceId !== workspaceId
    ? "default"
    : effectiveActiveSessionId ?? (autoSubmitSessionId !== undefined ? "default" : resolvedSessions[0]?.id ?? "default")
  // While remote sessions load, resolvedSessions is a one-item placeholder
  // for the stored active session — never an authoritative list to prune
  // restored panes against.
  const sessionListAuthoritative = !sessionApi?.hasMore && !remoteSessionsPending
  useEffect(() => {
    if (remoteSessionsTransitioning) return
    const pendingCreatePane = pendingCreatePaneRef.current
    const sessionIds = new Set(resolvedSessions.map((session) => session.id))
    const pendingCreatedId = pendingCreatePane
      ? pendingCreatePane.createdId
        ?? (sessionIds.has(chatSessionId) && !pendingCreatePane.knownIds.has(chatSessionId)
          ? chatSessionId
          : resolvedSessions.find((session) => !pendingCreatePane.knownIds.has(session.id))?.id ?? null)
      : null
    if (pendingCreatedId && sessionIds.has(pendingCreatedId)) pendingCreatePaneRef.current = null
    const preservingEphemeralDefault = chatSessionId === "default" && autoSubmitSessionId !== undefined
    const canPruneMissingSessions = sessionListAuthoritative && sessionIds.size > 0 && !preservingEphemeralDefault
    const desiredSessionId = pendingCreatedId
      ?? (canPruneMissingSessions && !sessionIds.has(chatSessionId)
        ? resolvedSessions[0]?.id ?? chatSessionId
        : chatSessionId)
    setChatPaneState((previous) => {
      const current = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [], activeId: null }
      // While remote sessions are still loading, chatSessionId may be the
      // ephemeral "default" placeholder — restored pane state is more
      // trustworthy than it, so leave the layout untouched until the real
      // session list arrives.
      if (remoteSessionsPending && current.ids.length > 0 && !pendingCreatedId) return current
      const rawIds = current.ids.length > 0 ? current.ids : [desiredSessionId]
      const prunedIds = canPruneMissingSessions
        ? rawIds.filter((id) => sessionIds.has(id) || id === pendingCreatedId)
        : rawIds
      const ids = prunedIds.length > 0 ? prunedIds : [desiredSessionId]
      const activeId = current.activeId && ids.includes(current.activeId) ? current.activeId : ids[0] ?? desiredSessionId
      const nextIds = pendingCreatedId
        ? insertPaneAfter(ids, pendingCreatePane?.afterId, pendingCreatedId)
        : desiredSessionId === activeId || ids.includes(desiredSessionId)
          ? ids
          : replaceActivePane(ids, activeId, desiredSessionId)
      const nextActiveId = nextIds.includes(desiredSessionId) ? desiredSessionId : nextIds[0] ?? desiredSessionId
      if (
        previous.workspaceId === workspaceId
        && previous.activeId === nextActiveId
        && previous.ids.length === nextIds.length
        && previous.ids.every((id, index) => id === nextIds[index])
      ) return previous
      return { workspaceId, ids: nextIds, activeId: nextActiveId }
    })
  }, [autoSubmitSessionId, chatSessionId, remoteSessionsPending, remoteSessionsTransitioning, resolvedSessions, sessionListAuthoritative, workspaceId])

  const sessionTitleById = useMemo(() => {
    const titles = new Map<string, string | null | undefined>()
    for (const session of resolvedSessions) titles.set(session.id, session.title)
    return titles
  }, [resolvedSessions])

  const activeChatPaneState = chatPaneState.workspaceId === workspaceId
    ? chatPaneState
    : { workspaceId, ids: [], activeId: null }
  const chatPaneIds = activeChatPaneState.ids.length > 0 ? activeChatPaneState.ids : [chatSessionId]
  const activeChatPaneId = activeChatPaneState.activeId ?? chatPaneIds[0] ?? chatSessionId

  const switchToChatPane = useCallback((nextSessionId: string) => {
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
    const alreadyVisible = current.ids.includes(nextSessionId)
    setChatPaneState((previous) => {
      const paneState = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
      const ids = paneState.ids.includes(nextSessionId)
        ? paneState.ids
        : replaceActivePane(paneState.ids, paneState.activeId, nextSessionId)
      return { workspaceId, ids, activeId: nextSessionId }
    })
    return alreadyVisible ? rawSwitch(nextSessionId) : resolvedSwitch(nextSessionId)
  }, [chatPaneState, chatSessionId, rawSwitch, resolvedSwitch, workspaceId])

  const activateChatPane = useCallback((nextSessionId: string) => {
    setChatPaneState((previous) => {
      const current = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
      return {
        workspaceId,
        ids: current.ids.includes(nextSessionId) ? current.ids : insertPaneAfter(current.ids, current.activeId, nextSessionId),
        activeId: nextSessionId,
      }
    })
    return rawSwitch(nextSessionId)
  }, [chatSessionId, rawSwitch, workspaceId])

  const openChatPane = useCallback((nextSessionId: string) => {
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
    // Opening a session that is already on the stage is a focus, not an
    // insert — flash the pane so the click visibly landed somewhere.
    if (current.ids.includes(nextSessionId)) {
      setFlashChatPane({ workspaceId, id: nextSessionId })
    }
    setChatPaneState((previous) => {
      const paneState = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
      return {
        workspaceId,
        ids: insertPaneAfter(paneState.ids, paneState.activeId, nextSessionId),
        activeId: nextSessionId,
      }
    })
    return rawSwitch(nextSessionId)
  }, [chatPaneState, chatSessionId, rawSwitch, workspaceId])

  const closeChatPane = useCallback((sessionId: string) => {
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
    if (current.ids.length <= 1) return
    const closingIndex = current.ids.indexOf(sessionId)
    if (closingIndex < 0) return
    const nextIds = current.ids.filter((id) => id !== sessionId)
    const nextActiveId = current.activeId === sessionId
      ? nextIds[Math.max(0, closingIndex - 1)] ?? nextIds[0] ?? null
      : current.activeId
    setChatPaneState({ workspaceId, ids: nextIds, activeId: nextActiveId })
    if (nextActiveId && current.activeId === sessionId) rawSwitch(nextActiveId)
  }, [chatPaneState, chatSessionId, rawSwitch, workspaceId])

  const createChatPaneAfter = useCallback((afterId: string) => {
    const pendingCreatePane = {
      afterId,
      knownIds: new Set(resolvedSessions.map((session) => session.id)),
    }
    pendingCreatePaneRef.current = pendingCreatePane
    const created = resolvedCreate()
    void Promise.resolve(created).then((session) => {
      const id = createdSessionId(session)
      if (!id) return
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = { ...pendingCreatePane, createdId: id }
      setChatPaneState((previous) => {
        const current = previous.workspaceId === workspaceId
          ? previous
          : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
        return {
          workspaceId,
          ids: insertPaneAfter(current.ids, afterId, id),
          activeId: id,
        }
      })
    }).catch(() => {
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
    })
    return created
  }, [chatSessionId, resolvedCreate, resolvedSessions, workspaceId])

  const deleteSessionAndPane = useCallback((sessionId: string) => {
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionId], activeId: chatSessionId }
    const deletingIndex = current.ids.indexOf(sessionId)
    let nextActiveId = current.activeId
    if (deletingIndex >= 0) {
      const nextIds = current.ids.filter((id) => id !== sessionId)
      nextActiveId = current.activeId === sessionId
        ? nextIds[Math.max(0, deletingIndex - 1)] ?? nextIds[0] ?? null
        : current.activeId
      setChatPaneState({ workspaceId, ids: nextIds, activeId: nextActiveId })
      if (nextActiveId && current.activeId === sessionId) resolvedSwitch(nextActiveId)
    }
    return resolvedDelete(sessionId)
  }, [chatPaneState, chatSessionId, resolvedDelete, resolvedSwitch, workspaceId])

  const [autoSubmitHydrationDisabled, setAutoSubmitHydrationDisabled] = useState(requestedAutoSubmitInitialDraft)
  const autoSubmitHydrationWorkspaceRef = useRef(workspaceId)
  useEffect(() => {
    if (autoSubmitHydrationWorkspaceRef.current !== workspaceId) {
      autoSubmitHydrationWorkspaceRef.current = workspaceId
      setAutoSubmitHydrationDisabled(requestedAutoSubmitInitialDraft)
      return
    }
    if (requestedAutoSubmitInitialDraft) {
      setAutoSubmitHydrationDisabled(true)
    }
  }, [requestedAutoSubmitInitialDraft, workspaceId])
  const autoSubmittingInitialDraft = requestedAutoSubmitInitialDraft
  const delayAutoSubmitDraft = autoSubmittingInitialDraft && shouldUseRemoteSessions && !effectiveActiveSessionId
  const freshEmptySessionActive = Boolean(
    freshEmptySession
      && freshEmptySession.workspaceId === workspaceId
      && freshEmptySession.id === effectiveActiveSessionId,
  )
  const hydrateMessages = !freshEmptySessionActive && !autoSubmitHydrationDisabled && provisionWorkspace !== false && (
    shouldUseRemoteSessions ? Boolean(effectiveActiveSessionId) : true
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

  useEffect(() => {
    if (remoteSessionsPending) return
    onActiveSessionIdChange?.(effectiveActiveSessionId ?? null)
  }, [effectiveActiveSessionId, onActiveSessionIdChange, remoteSessionsPending])

  const workbenchBlocked = workspaceWarmupStatus.status !== "ready"
  const workbenchOverlay = workbenchBlocked ? <WorkbenchWarmupOverlay status={workspaceWarmupStatus} /> : undefined
  const reloadAgentPluginsForSession = useCallback(async (sessionId: string) => {
    const endpoint = `${apiBaseUrl?.replace(/\/$/, "") ?? ""}/api/v1/agent/reload`
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { ...resolvedRequestHeaders, "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        return payload.error || `reload failed (${response.status})`
      }
      const payload = await response.json().catch(() => ({})) as { reloaded?: boolean; diagnostics?: Array<{ message?: string }> }
      window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: payload }))
      return pluginReloadMessage(payload)
    } catch (error) {
      return error instanceof Error ? error.message : "Agent plugin reload failed."
    }
  }, [apiBaseUrl, resolvedRequestHeaders])

  const makeCenterParams = useCallback(
    (sessionId: string, options: { bridgeEnabled?: boolean } = {}) => {
      const bridgeEnabled = options.bridgeEnabled ?? true
      const chatToolRenderers = (chatParams?.toolRenderers && typeof chatParams.toolRenderers === "object")
        ? chatParams.toolRenderers as ToolRendererOverrides
        : undefined
      return {
      ...chatParams,
      ...(delayAutoSubmitDraft ? { autoSubmitInitialDraft: false, initialDraft: undefined } : {}),
      sessionId,
      apiBaseUrl,
      workspaceId,
      storageScope: workspaceId,
      requestHeaders: resolvedRequestHeaders,
      showSessions: false,
      onReloadAgentPlugins: chatParams?.onReloadAgentPlugins ?? (() => reloadAgentPluginsForSession(sessionId)),
      toolRenderers: { ...pluginToolRenderers, ...(chatToolRenderers ?? {}) },
      bridgeEndpoint: bridgeEnabled ? bridgeEndpoint : null,
      surfaceDispatch,
      extraCommands,
      workspaceWarmupStatus,
      hydrateMessages,
      onAutoSubmitInitialDraftSettled: () => {
        autoSubmitSessionCreateRef.current = false
        setAutoSubmitHydrationDisabled(false)
        setAutoSubmitSessionId(undefined)
        const existing = chatParams?.onAutoSubmitInitialDraftSettled
        if (typeof existing === "function") existing()
      },
      // Forward the explicit prop when set. Omitting the key (when undefined)
      // lets ChatPanel apply its own default (true) and avoids overriding a
      // value passed through chatParams.
      ...(resolvedHotReloadEnabled !== undefined ? { hotReloadEnabled: resolvedHotReloadEnabled } : {}),
    }
    },
    [apiBaseUrl, chatParams, delayAutoSubmitDraft, resolvedRequestHeaders, bridgeEndpoint, surfaceDispatch, extraCommands, workspaceWarmupStatus, hydrateMessages, resolvedHotReloadEnabled, pluginToolRenderers, reloadAgentPluginsForSession, workspaceId],
  )
  const centerParams = useMemo(
    () => makeCenterParams(chatSessionId),
    [chatSessionId, makeCenterParams],
  )
  const chatPanes = useMemo(() => (
    chatPaneIds.map((id) => ({
      id,
      title: sessionTitleById.get(id) ?? (id === "default" ? defaultSessionTitle : id),
      panel: "chat",
      params: makeCenterParams(id, { bridgeEnabled: id === activeChatPaneId }),
    }))
  ), [activeChatPaneId, chatPaneIds, defaultSessionTitle, makeCenterParams, sessionTitleById])
  const surfaceParams = useMemo<SurfaceShellProps>(() => ({
    storageKey: resolvedSurfaceStorageKey,
    defaultLeftTab: defaultWorkbenchLeftTab,
    initialPanels: surfaceInitialPanels,
    extraPanels: shellExtraPanels,
    onReloadAgentPlugins: () => reloadAgentPluginsForSession(effectiveActiveSessionId ?? chatSessionId),
    onReady: handleSurfaceReady,
    onChange: handleSurfaceChange,
    onClose: closeWorkbench,
    showCloseAction: false,
  }), [
    closeWorkbench,
    defaultWorkbenchLeftTab,
    surfaceInitialPanels,
    reloadAgentPluginsForSession,
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
  const navParams = {
    sessions: resolvedSessions,
    activeId: activeChatPaneId,
    openIds: chatPaneIds,
    pinnedIds,
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
  const commandPaletteSessionSearch = useMemo(() => (
    isPluginTabsLayout
      ? {
          sessions: resolvedSessions,
          activeId: activeChatPaneId,
          openIds: chatPaneIds,
          onSwitch: switchToChatPane,
          onOpenAsTab: openChatPane,
        }
      : undefined
  ), [activeChatPaneId, chatPaneIds, isPluginTabsLayout, openChatPane, resolvedSessions, switchToChatPane])
  const mainContent = remoteSessionsTransitioning ? (
    <ChatSessionTransitionState />
  ) : (
    <ChatLayout
      className={className}
      nav={isPluginTabsLayout ? null : effectiveNavOpen ? "session-list" : null}
      navParams={navParams}
      center="chat"
      centerParams={centerParams}
      chatPanes={chatPanes}
      activeChatPaneId={activeChatPaneId}
      onActiveChatPaneChange={activateChatPane}
      onCloseChatPane={closeChatPane}
      onCreateChatPaneAfter={isPluginTabsLayout ? undefined : createChatPaneAfter}
      onDropChatSession={openChatPane}
      flashChatPaneId={flashChatPane?.workspaceId === workspaceId ? flashChatPane.id : null}
      surface={surfaceOpen ? "artifact-surface" : null}
      surfaceParams={surfaceParams as Record<string, unknown>}
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
      onOpenSidebar={hasLeftTabs ? () => {
        surfaceOpenRef.current = true
        setSurfaceOpen(true)
        setWorkbenchLeftOpen(true)
        setWorkbenchLeftExplicitOpen(true)
      } : undefined}
    />
  )
  const leftOverlayNode = leftOverlay === "skills" ? (
    <SkillsPage onClose={() => setLeftOverlay(null)} />
  ) : leftOverlay === "plugins" ? (
    <PluginsOverlay plugins={capturedPlugins} onClose={() => setLeftOverlay(null)} />
  ) : null
  const shellContent = isPluginTabsLayout ? (
    <PluginTabsWorkspaceShell
      collapsed={appLeftPaneCollapsed}
      onExpand={() => setAppLeftPaneCollapsed(false)}
      onCollapse={() => setAppLeftPaneCollapsed(true)}
      leftOverlay={leftOverlayNode}
      leftPane={(
        <AppLeftPane
          appTitle={appTitle}
          sessionTitle={remoteSessionsTransitioning ? "Loading sessions…" : resolvedSessionTitle ?? defaultSessionTitle}
          topSlot={topBarLeft}
          bottomSlot={showThemeToggle || topBarRight != null ? <div className="flex items-center gap-2">{topBarRightContent}</div> : undefined}
          sessions={resolvedSessions}
          activeSessionId={activeChatPaneId}
          openSessionIds={chatPaneIds}
          pinnedSessionIds={pinnedIds}
          onCreateSession={() => { void resolvedCreate() }}
          onOpenCommandPalette={openCommandPalette}
          onSwitchSession={switchToChatPane}
          onOpenSessionAsPane={openChatPane}
          onToggleSessionPinned={toggleSessionPinned}
          onOpenPlugins={() => setLeftOverlay((cur) => cur === "plugins" ? null : "plugins")}
          onOpenSkills={() => setLeftOverlay((cur) => cur === "skills" ? null : "skills")}
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
  const publishedNavOpen = isPluginTabsLayout ? !appLeftPaneCollapsed : effectiveNavOpen

  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        chatPanel={chatPanel}
        panels={providerPanels}
        commands={commands}
        catalogs={catalogs}
        plugins={plugins}
        excludeDefaults={excludeDefaults}
        capabilities={capabilities}
        apiBaseUrl={apiBaseUrl}
        authHeaders={resolvedAuthHeaders}
        apiTimeout={apiTimeout}
        defaultTheme={defaultTheme}
        onThemeChange={onThemeChange}
        workspaceId={workspaceId}
        workspaceLabel={workspaceLabel}
        appTitle={appTitle}
        storageKey={resolvedProviderStorageKey}
        persistenceEnabled={persistenceEnabled}
        debug={debug}
        bridgeEndpoint={null}
        onAuthError={onAuthError}
        frontPluginHotReload={resolvedFrontPluginHotReload}
        fullPageBasePath={fullPageBasePath}
        commandPaletteSessionSearch={commandPaletteSessionSearch}
      >
        {beforeShell}
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
        {shellContent}
        {afterShell}
      </WorkspaceProvider>
    </div>
  )
}

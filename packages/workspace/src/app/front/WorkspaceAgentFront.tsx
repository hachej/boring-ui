import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import { ChatPanel as DefaultChatPanel, useSessions as useDefaultAgentSessions, type SlashCommand } from "@hachej/boring-agent/front"
import { WorkspaceProvider, type WorkspaceProviderProps } from "../../front/provider/WorkspaceProvider"
import { ChatLayout, TopBar, type ChatLayoutProps } from "../../front/layout"
import type { WorkspaceChatPanelProps } from "../../front/chrome/chat/types"
import type {
  SurfaceShellApi,
  SurfaceShellProps,
  SurfaceShellSnapshot,
} from "../../front/chrome/artifact-surface/SurfaceShell"
import { useRegistry } from "../../front/registry"
import { captureFrontPlugin } from "../../shared/plugins/frontFactory"
import { UI_COMMAND_EVENT, dispatchUiCommand } from "../../front/bridge"
import { readStoredBoolean, writeStoredBoolean } from "../../front/store/localStorageValues"
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "./localStorageSessions"

export interface WorkspaceAgentSession {
  id: string
  title?: string | null
  updatedAt?: string | number
}

export interface WorkspaceAgentSessionsApi<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> {
  sessions: TSession[]
  loading: boolean
  activeSessionId?: string | null
  activeSession?: TSession | null
  switch: (id: string) => void
  create: (input?: { title?: string }) => void | Promise<unknown>
  delete: (id: string) => void | Promise<unknown>
}

export type UseWorkspaceAgentSessions<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> = (options: {
  requestHeaders: Record<string, string>
  storageKey: string
}) => WorkspaceAgentSessionsApi<TSession>

export interface WorkspaceAgentFrontProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> extends Omit<WorkspaceProviderProps, "children" | "workspaceId" | "storageKey" | "chatPanel">,
    Omit<ChatLayoutProps, "nav" | "navParams" | "center" | "centerParams" | "surface" | "surfaceParams" | "sidebar" | "sidebarParams" | "storageKey"> {
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
  defaultSessionTitle?: string
  workspaceRoot?: string
  defaultSurfaceOpen?: boolean
  defaultWorkbenchLeftTab?: string
  topBarLeft?: ReactNode
  topBarRight?: ReactNode
  sessions?: Array<{ id: string; title?: string | null; updatedAt?: string | number }>
  activeSessionId?: string | null
  onSwitchSession?: (id: string) => void
  onCreateSession?: () => void
  onDeleteSession?: (id: string) => void
  onActiveSessionIdChange?: (sessionId: string) => void
  chatParams?: Record<string, unknown>
  /**
   * Forward to ChatPanel — when `false`, the `/reload` slash command is
   * hidden and the PluginUpdateStatus banner above the composer is
   * suppressed. Production apps that don't ship live plugin editing
   * should pass `false`. Defaults to `true` (dev/playground default).
   */
  hotReloadEnabled?: boolean
  extraPanels?: string[]
  extraCommands?: SlashCommand[]
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

const emptySurfaceSnapshot: SurfaceShellSnapshot = {
  openTabs: [],
  activeTab: null,
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
  snapshot,
}: {
  bridgeEndpoint?: string | null
  requestHeaders: Record<string, string>
  navOpen: boolean
  surfaceOpen: boolean
  snapshot: SurfaceShellSnapshot
}) {
  const panelRegistry = useRegistry()
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (bridgeEndpoint === null) return
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
      availablePanels: panelRegistry.list().map((panel) => panel.id),
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
  }, [bridgeEndpoint, navOpen, panelRegistry, requestHeaders, snapshot, surfaceOpen])

  return null
}

export function WorkspaceAgentFront<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  workspaceId,
  chatPanel: chatPanelProp,
  useSessions: useSessionsProp,
  requestHeaders = EMPTY_HEADERS,
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
  bridgeEndpoint,
  fullPageBasePath,
  onAuthError,
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onActiveSessionIdChange,
  appTitle = "Boring",
  defaultSessionTitle = "New session",
  workspaceRoot,
  defaultSurfaceOpen,
  defaultWorkbenchLeftTab,
  topBarLeft,
  topBarRight,
  chatParams,
  hotReloadEnabled,
  frontPluginHotReload,
  extraPanels,
  extraCommands,
  onOpenNav,
  onOpenSurface,
  className,
}: WorkspaceAgentFrontProps<TSession>) {
  const resolvedProviderStorageKey =
    providerStorageKey ?? `boring-ui-v2:layout:${workspaceId}`
  const resolvedSurfaceStorageKey =
    surfaceStorageKey ?? `${resolvedProviderStorageKey}:surface`
  const shellStorageKey = shellStorageKeyFromSurfaceStorage(
    resolvedSurfaceStorageKey,
    resolvedProviderStorageKey,
  )
  const shellPersistenceEnabled = persistenceEnabled !== false
  const resolvedSessionStorageKey =
    sessionStorageKey ?? `boring-workspace:sessions:${workspaceId}`
  const localSessionStore = useMemo(
    () => createLocalStorageSessions({ storageKey: resolvedSessionStorageKey }),
    [resolvedSessionStorageKey],
  )
  const localSessions = useLocalStorageSessions(localSessionStore)
  const chatPanel = (chatPanelProp ?? DefaultChatPanel) as ComponentType<WorkspaceChatPanelProps>
  const useSessions = (useSessionsProp ?? (chatPanelProp ? undefined : useDefaultAgentSessions)) as
    | UseWorkspaceAgentSessions<TSession>
    | undefined
  const sessionApi = useSessions?.({
    requestHeaders,
    storageKey: resolvedSessionStorageKey,
  })
  const hasExplicitSessionProps =
    sessions !== undefined ||
    activeSessionId !== undefined ||
    onSwitchSession !== undefined ||
    onCreateSession !== undefined ||
    onDeleteSession !== undefined
  const sessionItems = sessionApi?.sessions.map((session) => ({
    ...session,
    title: session.title ?? "New session",
  }))
  const resolvedSessions = sessionApi
    ? sessionItems ?? []
    : hasExplicitSessionProps
      ? sessions ?? []
      : localSessions.sessions
  const resolvedActiveId = sessionApi
    ? sessionApi.activeSessionId ?? null
    : hasExplicitSessionProps
      ? activeSessionId ?? null
      : localSessions.activeId
  const rawSwitch = sessionApi?.switch ?? onSwitchSession ?? localSessionStore.switchTo
  const resolvedSwitch = useCallback((nextSessionId: string) => {
    if (resolvedActiveId && nextSessionId !== resolvedActiveId) {
      window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: resolvedActiveId } }))
    }
    return rawSwitch(nextSessionId)
  }, [rawSwitch, resolvedActiveId])
  const resolvedCreate = sessionApi
    ? () => sessionApi.create()
    : onCreateSession ?? localSessionStore.create
  const resolvedDelete = sessionApi?.delete ?? onDeleteSession ?? localSessionStore.remove
  const resolvedSessionTitle = resolvedSessions.find((session) => session.id === resolvedActiveId)?.title ?? undefined

  const [navOpen, setNavOpen] = useStoredBooleanState(
    `${shellStorageKey}:drawer`,
    true,
    shellPersistenceEnabled,
  )
  const [surfaceOpen, setSurfaceOpen] = useStoredBooleanState(
    // Key must NOT match resolvedSurfaceStorageKey (which stores the dockview
    // layout JSON at the same ":surface" suffix). Writing "1"/"0" to the same
    // key corrupts the JSON and drops the persisted workbench layout on reload.
    `${shellStorageKey}:workbenchOpen`,
    defaultSurfaceOpen ?? false,
    shellPersistenceEnabled,
  )
  const [workbenchLeftOpen, setWorkbenchLeftOpen] = useStoredBooleanState(
    `${shellStorageKey}:workbenchLeftOpen`,
    true,
    shellPersistenceEnabled,
  )
  const autoCreateSessionRef = useRef(false)
  const surfaceOpenRef = useRef(surfaceOpen)
  const surfaceKeyRef = useRef(resolvedSurfaceStorageKey)
  const surfaceRef = useRef<{ key: string; api: SurfaceShellApi } | null>(null)
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
  }, [workspaceId])

  useEffect(() => {
    if (!sessionApi || sessionApi.loading) return
    if (sessionApi.sessions.length > 0) {
      autoCreateSessionRef.current = false
      return
    }
    if (autoCreateSessionRef.current) return
    autoCreateSessionRef.current = true
    void Promise.resolve(sessionApi.create({ title: defaultSessionTitle })).catch(() => {
      autoCreateSessionRef.current = false
    })
  }, [defaultSessionTitle, sessionApi])

  useEffect(() => {
    surfaceOpenRef.current = surfaceOpen
  }, [surfaceOpen])

  const handleSurfaceReady = useCallback((api: SurfaceShellApi) => {
    surfaceRef.current = { key: resolvedSurfaceStorageKey, api }
    setSurfaceSnapshotState({
      key: resolvedSurfaceStorageKey,
      snapshot: api.getSnapshot(),
    })
  }, [resolvedSurfaceStorageKey])

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
  const closeWorkbench = useCallback(() => {
    surfaceOpenRef.current = false
    setSurfaceOpen(false)
  }, [setSurfaceOpen])
  const capturedPlugins = useMemo(
    () => plugins?.map(captureFrontPlugin) ?? [],
    [plugins],
  )
  const hasLeftTabs = useMemo(
    () => capturedPlugins.some((plugin) => plugin.registrations.leftTabs.length > 0),
    [capturedPlugins],
  )
  const pluginPanelIds = useMemo(
    () => capturedPlugins.flatMap((plugin) => plugin.registrations.panels.map((panel) => panel.id)),
    [capturedPlugins],
  )
  const shellExtraPanels = useMemo(
    () => [...(extraPanels ?? []), ...pluginPanelIds],
    [extraPanels, pluginPanelIds],
  )
  const chatSessionId = resolvedActiveId ?? resolvedSessions[0]?.id ?? "default"

  useEffect(() => {
    // postUiCommand also emits a browser CustomEvent so app/plugin bundles
    // loaded through different module graphs can still reach this shell.
    const handler = (event: Event) => {
      const command = (event as CustomEvent).detail
      if (!command || typeof command !== "object") return
      dispatchUiCommand(command, {
        surface: getSurface,
        isWorkbenchOpen,
        openWorkbench,
      })
    }
    globalThis.addEventListener?.(UI_COMMAND_EVENT, handler)
    return () => globalThis.removeEventListener?.(UI_COMMAND_EVENT, handler)
  }, [getSurface, isWorkbenchOpen, openWorkbench])

  useEffect(() => {
    if (resolvedActiveId) onActiveSessionIdChange?.(resolvedActiveId)
  }, [resolvedActiveId, onActiveSessionIdChange])

  const centerParams = useMemo(
    () => ({
      ...chatParams,
      sessionId: chatSessionId,
      requestHeaders,
      bridgeEndpoint,
      getSurface,
      isWorkbenchOpen,
      openWorkbench,
      closeWorkbench,
      extraCommands,
      // Forward the explicit prop when set. Omitting the key (when undefined)
      // lets ChatPanel apply its own default (true) and avoids overriding a
      // value passed through chatParams.
      ...(hotReloadEnabled !== undefined ? { hotReloadEnabled } : {}),
    }),
    [chatParams, chatSessionId, requestHeaders, bridgeEndpoint, getSurface, isWorkbenchOpen, openWorkbench, closeWorkbench, extraCommands, hotReloadEnabled],
  )
  const resolvedAuthHeaders = useMemo(() => {
    if (!authHeaders && Object.keys(requestHeaders).length === 0) return undefined
    return { ...requestHeaders, ...authHeaders }
  }, [authHeaders, requestHeaders])

  const surfaceParams = useMemo<SurfaceShellProps>(() => ({
    storageKey: resolvedSurfaceStorageKey,
    defaultLeftTab: defaultWorkbenchLeftTab,
    extraPanels: shellExtraPanels,
    workspaceRoot,
    onReady: handleSurfaceReady,
    onChange: handleSurfaceChange,
    onClose: closeWorkbench,
  }), [
    closeWorkbench,
    defaultWorkbenchLeftTab,
    handleSurfaceChange,
    handleSurfaceReady,
    resolvedSurfaceStorageKey,
    shellExtraPanels,
    workspaceRoot,
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

  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        chatPanel={chatPanel}
        panels={panels}
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
        storageKey={resolvedProviderStorageKey}
        persistenceEnabled={persistenceEnabled}
        bridgeEndpoint={null}
        onAuthError={onAuthError}
        frontPluginHotReload={frontPluginHotReload}
        fullPageBasePath={fullPageBasePath}
      >
        {beforeShell}
        <WorkspaceUiStateSync
          bridgeEndpoint={bridgeEndpoint}
          requestHeaders={requestHeaders}
          navOpen={navOpen}
          surfaceOpen={surfaceOpen}
          snapshot={surfaceSnapshot}
        />
        <div className="flex h-full min-h-0 flex-col">
          <TopBar
            appTitle={appTitle}
            sessionTitle={resolvedSessionTitle ?? defaultSessionTitle}
            onCommandPalette={openCommandPalette}
            onNewChat={resolvedCreate}
            topBarLeft={topBarLeft}
            topBarRight={topBarRight}
          />
          <ChatLayout
            className={className}
            nav={navOpen ? "session-list" : null}
            navParams={{
              sessions: resolvedSessions,
              activeId: resolvedActiveId,
              onSwitch: resolvedSwitch,
              onCreate: resolvedCreate,
              onDelete: resolvedDelete,
              onClose: () => setNavOpen(false),
            }}
            center="chat"
            centerParams={centerParams}
            surface={surfaceOpen ? "artifact-surface" : null}
            surfaceParams={surfaceParams as Record<string, unknown>}
            sidebar={surfaceOpen && hasLeftTabs && workbenchLeftOpen ? "workbench-left" : null}
            sidebarParams={surfaceOpen && hasLeftTabs ? {
              ...(defaultWorkbenchLeftTab ? { defaultTab: defaultWorkbenchLeftTab } : {}),
              onClose: () => setWorkbenchLeftOpen(false),
              onCollapse: () => setWorkbenchLeftOpen(false),
            } : undefined}
            storageKey={shellPersistenceEnabled ? shellStorageKey : undefined}
            onOpenNav={() => {
              setNavOpen(true)
              onOpenNav?.()
            }}
            onOpenSurface={() => {
              surfaceOpenRef.current = true
              setSurfaceOpen(true)
              onOpenSurface?.()
            }}
            onOpenSidebar={hasLeftTabs ? () => {
              surfaceOpenRef.current = true
              setSurfaceOpen(true)
              setWorkbenchLeftOpen(true)
            } : undefined}
          />
        </div>
        {afterShell}
      </WorkspaceProvider>
    </div>
  )
}

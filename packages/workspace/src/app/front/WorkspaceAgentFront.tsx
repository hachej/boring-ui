import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react"
import { WorkspaceProvider, type WorkspaceProviderProps } from "../../front/provider/WorkspaceProvider"
import { ChatLayout, type ChatLayoutProps } from "../../front/layout"
import type { WorkspaceChatPanelProps } from "../../front/chrome/chat/types"
import type { SurfaceShellProps } from "../../front/chrome/artifact-surface/SurfaceShell"
import type { Plugin } from "../../shared/plugins"
import type { PanelOutput, PluginOutput } from "../../shared/plugins/types"
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "./localStorageSessions"

export interface WorkspaceAgentSession {
  id: string
  title?: string | null
  updatedAt?: number
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
    Omit<ChatLayoutProps, "nav" | "navParams" | "center" | "centerParams" | "surface" | "surfaceParams" | "sidebar" | "sidebarParams"> {
  workspaceId: string
  chatPanel: ComponentType<WorkspaceChatPanelProps>
  useSessions?: UseWorkspaceAgentSessions<TSession>
  requestHeaders?: Record<string, string>
  sessionStorageKey?: string
  providerStorageKey?: string
  surfaceStorageKey?: string
  beforeShell?: ReactNode
  afterShell?: ReactNode
  appTitle?: string
  topBarLeft?: ReactNode
  topBarRight?: ReactNode
  sessions?: Array<{ id: string; title?: string | null; updatedAt?: number }>
  activeSessionId?: string | null
  onSwitchSession?: (id: string) => void
  onCreateSession?: () => void
  onDeleteSession?: (id: string) => void
  onActiveSessionIdChange?: (sessionId: string) => void
  chatParams?: Record<string, unknown>
  extraPanels?: string[]
}

function isPanelOutput(output: PluginOutput): output is PanelOutput {
  return output.type === "panel"
}

export function WorkspaceAgentFront<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  workspaceId,
  chatPanel,
  useSessions,
  requestHeaders = {},
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
  onAuthError,
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onActiveSessionIdChange,
  appTitle = "Boring",
  topBarLeft,
  topBarRight,
  chatParams,
  extraPanels,
  onOpenNav,
  onOpenSurface,
  className,
}: WorkspaceAgentFrontProps<TSession>) {
  const resolvedSessionStorageKey =
    sessionStorageKey ?? `boring-workspace:sessions:${workspaceId}`
  const localSessionStore = useMemo(
    () => createLocalStorageSessions({ storageKey: resolvedSessionStorageKey }),
    [resolvedSessionStorageKey],
  )
  const localSessions = useLocalStorageSessions(localSessionStore)
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
  const resolvedSwitch = sessionApi?.switch ?? onSwitchSession ?? localSessionStore.switchTo
  const resolvedCreate = sessionApi
    ? () => sessionApi.create()
    : onCreateSession ?? localSessionStore.create
  const resolvedDelete = sessionApi?.delete ?? onDeleteSession ?? localSessionStore.remove

  const [navOpen, setNavOpen] = useState(true)
  const [surfaceOpen, setSurfaceOpen] = useState(false)
  const pluginOutputs = useMemo(
    () => plugins?.flatMap((plugin: Plugin) => plugin.outputs ?? []) ?? [],
    [plugins],
  )
  const hasLeftTabs = useMemo(
    () => pluginOutputs.some((output) => output.type === "left-tab"),
    [pluginOutputs],
  )
  const pluginPanelIds = useMemo(
    () => pluginOutputs.filter(isPanelOutput).map((output) => output.panel.id),
    [pluginOutputs],
  )
  const shellExtraPanels = useMemo(
    () => [...(extraPanels ?? []), ...pluginPanelIds],
    [extraPanels, pluginPanelIds],
  )
  const chatSessionId = resolvedActiveId ?? resolvedSessions[0]?.id ?? "default"

  useEffect(() => {
    if (resolvedActiveId) onActiveSessionIdChange?.(resolvedActiveId)
  }, [resolvedActiveId, onActiveSessionIdChange])

  const centerParams = useMemo(
    () => ({
      ...chatParams,
      sessionId: chatSessionId,
      requestHeaders,
    }),
    [chatParams, chatSessionId, requestHeaders],
  )

  const surfaceParams = useMemo<SurfaceShellProps>(() => ({
    storageKey: surfaceStorageKey ?? `${providerStorageKey ?? `boring-workspace:${workspaceId}`}:surface`,
    extraPanels: shellExtraPanels,
    onClose: () => setSurfaceOpen(false),
  }), [providerStorageKey, shellExtraPanels, surfaceStorageKey, workspaceId])

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
        authHeaders={authHeaders}
        apiTimeout={apiTimeout}
        defaultTheme={defaultTheme}
        onThemeChange={onThemeChange}
        workspaceId={workspaceId}
        storageKey={providerStorageKey}
        persistenceEnabled={persistenceEnabled}
        bridgeEndpoint={bridgeEndpoint}
        onAuthError={onAuthError}
      >
        {beforeShell}
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
          sidebar={surfaceOpen && hasLeftTabs ? "workbench-left" : null}
          onOpenNav={onOpenNav ?? (() => setNavOpen(true))}
          onOpenSurface={onOpenSurface ?? (() => setSurfaceOpen(true))}
        />
        {afterShell}
      </WorkspaceProvider>
    </div>
  )
}

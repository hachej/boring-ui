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
import { WORKSPACE_COMPOSER_STOP_REASONS, emitWorkspaceComposerStop } from "../../front/chrome/chat/composerStop"
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
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "./localStorageSessions"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "../../front/agentPlugins/reloadEvent"
import { WorkspaceBackgroundBoot } from "./WorkspaceBackgroundBoot"
import { ChatSessionTransitionState, WorkbenchWarmupOverlay } from "./WorkspaceAgentStatusStates"
import { WorkspaceUiStateSync } from "./WorkspaceUiStateSync"
import { PluginAppLeftOverlayHost, assertUniqueAppLeftActionIds, pluginAppLeftActionIds, usePluginAppLeftActions, type AppLeftOverlayId } from "./PluginAppLeftHost"
import { CloseLeftPaneOnAttention } from "./CloseLeftPaneOnAttention"
import { workspaceRequestHeaders, type WorkspaceWarmupStatus } from "./workspacePreload"
import {
  createdSessionId,
  insertPaneAfter,
  replaceActivePane,
  type ChatPaneState,
} from "./chatPaneState"
import {
  persistedWorkspaceSessionRef,
  workspaceSessionKey,
  workspaceSessionKeyFor,
  workspaceSessionRef,
  workspaceSessionRefFromKey,
  workspaceSessionRefFromPersisted,
  type WorkspaceSessionRef,
} from "../../front/sessionIdentity"

interface PendingCreatePane {
  afterId: string
  placement: "replace" | "insert"
  knownIds: Set<string>
  createdId?: string
}

export interface WorkspaceAgentSession {
  id: string
  /** Addressed Agent owner; omitted for the compatibility default wire. */
  agentTypeId?: string
  title?: string | null
  updatedAt?: string | number
  turnCount?: number
  ephemeral?: boolean
  hasAssistantReply?: boolean
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
  /** Explicit owner for controlled colliding ids; falls back to activeSession.agentTypeId. */
  activeSessionAgentTypeId?: string | null
  activeSession?: TSession | null
  workspaceId?: string | null
  switch: (id: string, agentTypeId?: string) => void
  create: (input?: { title?: string }) => void | Promise<unknown>
  rename?: (id: string, title: string) => void | Promise<unknown>
  adoptNative?: (localId: string, session: TSession) => void
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
  nativeSessionStartEnabled?: boolean
}) => WorkspaceAgentSessionsApi<TSession>

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
  /** Direct/local-only capability for browser-local first sends. */
  nativeSessionStartEnabled?: boolean
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
const EMPTY_STRING_LIST: string[] = []
const PREPARING_WARMUP_STATUS: WorkspaceWarmupStatus = { status: "preparing" }

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const emptySurfaceSnapshot: SurfaceShellSnapshot = {
  openTabs: [],
  activeTab: null,
}

type DefaultWorkspaceAgentSession = ReturnType<typeof useDefaultPiSessions>["sessions"][number]

interface NativeSessionHandoff {
  fromSessionId: string
  toSessionId: string
  viewId: string
  initialUserMessage?: { clientNonce: string; text: string }
}

interface NativeSessionHandoffsState {
  workspaceId: string
  bySessionId: Record<string, NativeSessionHandoff>
}

function useDefaultWorkspacePiSessions(options: Parameters<UseWorkspaceAgentSessions>[0]): WorkspaceAgentSessionsApi<DefaultWorkspaceAgentSession> {
  const workspaceId = options.workspaceId ?? workspaceIdFromHeaders(options.requestHeaders) ?? options.storageKey
  const piSessions = useDefaultPiSessions({
    apiBaseUrl: options.apiBaseUrl,
    agentTypeId: options.agentTypeId,
    workspaceId,
    storageScope: workspaceId,
    requestHeaders: options.requestHeaders,
    enabled: options.enabled,
    connectActiveSession: false,
    localCreateUntilPrompt: options.nativeSessionStartEnabled === true,
    refreshKey: options.refreshKey,
  })
  // Addressed hosts key panes by workspaceSessionKey(id, agentTypeId). Sessions
  // now carry agentTypeId from the gateway ref, but fall back to the host's
  // agentTypeId so every key derivation stays in one key domain — otherwise
  // pane sync, switching, and adoption compare addressed keys against legacy ones.
  const agentTypeId = options.agentTypeId
  const sessions = useMemo(
    () => (agentTypeId
      ? piSessions.sessions.map((session) => (session.agentTypeId ? session : { ...session, agentTypeId }))
      : piSessions.sessions),
    [agentTypeId, piSessions.sessions],
  )
  const activeSession = piSessions.activeSession && agentTypeId && !piSessions.activeSession.agentTypeId
    ? { ...piSessions.activeSession, agentTypeId }
    : piSessions.activeSession
  return {
    ...piSessions,
    sessions,
    activeSession,
    activeSessionAgentTypeId: activeSession?.agentTypeId ?? agentTypeId ?? null,
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

function focusActiveAgentComposer(): void {
  if (typeof document === "undefined") return
  const activePane = document.querySelector<HTMLElement>('[data-boring-workspace-part="chat-pane"][data-boring-state="active"]')
  const root: Document | HTMLElement = activePane ?? document
  const textarea = root.querySelector<HTMLTextAreaElement>('[data-boring-agent] textarea[name="message"], textarea[name="message"]')
  textarea?.focus()
}

function scheduleActiveAgentComposerFocus(): void {
  if (typeof window === "undefined") return
  window.requestAnimationFrame(() => {
    focusActiveAgentComposer()
    window.setTimeout(focusActiveAgentComposer, 320)
  })
}

function readStoredSessionId(storageKey: string): string | null {
  try {
    return globalThis.localStorage?.getItem(storageKey) ?? null
  } catch {
    return null
  }
}

function persistedRefsFromKeys(keys: readonly string[]) {
  return keys.map((key) => persistedWorkspaceSessionRef(workspaceSessionRefFromKey(key)))
}

function readStoredChatPaneState(storageKey: string, workspaceId: string): ChatPaneState | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: unknown; refs?: unknown; activeRef?: unknown; ids?: unknown; activeId?: unknown }
    const refs = parsed.version === 2 && Array.isArray(parsed.refs)
      ? parsed.refs.map(workspaceSessionRefFromPersisted).filter((ref): ref is WorkspaceSessionRef => Boolean(ref))
      : Array.isArray(parsed.ids)
        // Every pre-v2 string was stored in the unrestricted native-id domain.
        // Migrate it unconditionally as legacy, even if it resembles an old internal key.
        ? parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0).map((sessionId) => workspaceSessionRef(sessionId))
        : []
    const ids = refs.map((ref) => workspaceSessionKey(ref.sessionId, ref.agentTypeId))
    if (ids.length === 0) return null
    const activeRef = parsed.version === 2
      ? workspaceSessionRefFromPersisted(parsed.activeRef)
      : typeof parsed.activeId === "string" ? { sessionId: parsed.activeId } : null
    const activeKey = activeRef ? workspaceSessionKey(activeRef.sessionId, activeRef.agentTypeId) : null
    return { workspaceId, ids, activeId: activeKey && ids.includes(activeKey) ? activeKey : ids[0] }
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
    globalThis.localStorage?.setItem(storageKey, JSON.stringify({
      version: 2,
      refs: persistedRefsFromKeys(state.ids),
      activeRef: state.activeId ? persistedWorkspaceSessionRef(workspaceSessionRefFromKey(state.activeId)) : null,
    }))
  } catch {
    // Best-effort persistence only.
  }
}

function readStoredPinnedSessions(storageKey: string, workspaceId: string): { workspaceId: string; ids: string[] } | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: unknown; refs?: unknown; ids?: unknown }
    const refs = parsed.version === 2 && Array.isArray(parsed.refs)
      ? parsed.refs.map(workspaceSessionRefFromPersisted).filter((ref): ref is WorkspaceSessionRef => Boolean(ref))
      : Array.isArray(parsed.ids)
        ? parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0).map((sessionId) => workspaceSessionRef(sessionId))
        : []
    return { workspaceId, ids: refs.map((ref) => workspaceSessionKey(ref.sessionId, ref.agentTypeId)) }
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
    globalThis.localStorage?.setItem(storageKey, JSON.stringify({ version: 2, refs: persistedRefsFromKeys(ids) }))
  } catch {
    // Best-effort persistence only.
  }
}

export function WorkspaceAgentFront<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  workspaceId,
  agentTypeId,
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
  nativeSessionStartEnabled = false,
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
  const chatPaneStorageKey = `boring-workspace:chat-panes:${workspaceId}`
  const [chatPaneState, setChatPaneState] = useState<ChatPaneState>(() =>
    (shellPersistenceEnabled ? readStoredChatPaneState(chatPaneStorageKey, workspaceId) : null)
      ?? { workspaceId, ids: [], activeId: null },
  )
  const [flashChatPane, setFlashChatPane] = useState<{ workspaceId: string; id: string } | null>(null)
  const [nativeSessionHandoffs, setNativeSessionHandoffs] = useState<NativeSessionHandoffsState>(() => ({
    workspaceId,
    bySessionId: {},
  }))
  const nativeSessionHandoffPromptsRef = useRef(new Map<string, { clientNonce: string; text: string }>())
  useEffect(() => {
    nativeSessionHandoffPromptsRef.current.clear()
  }, [workspaceId])
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
  const toggleSessionPinned = useCallback((sessionId: string, sessionAgentTypeId?: string) => {
    const sessionKey = workspaceSessionKey(sessionId, sessionAgentTypeId)
    setPinnedState((previous) => {
      const current = previous.workspaceId === workspaceId ? previous.ids : []
      const ids = current.includes(sessionKey)
        ? current.filter((id) => id !== sessionKey)
        : [sessionKey, ...current]
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
    agentTypeId,
    workspaceId,
    apiBaseUrl,
    enabled: remoteSessionHookEnabled,
    nativeSessionStartEnabled,
  })
  const [remoteSessionSnapshot, setRemoteSessionSnapshot] = useState<{
    workspaceId: string
    sessions: TSession[]
    activeSessionId: string | null | undefined
    activeSessionAgentTypeId: string | null | undefined
  }>(() => ({ workspaceId, sessions: [], activeSessionId: null, activeSessionAgentTypeId: null }))
  const remoteSessionsArePreviousWorkspace = remoteSessionHookEnabled
    && remoteSessionApi.workspaceId != null
    && remoteSessionApi.workspaceId !== workspaceId
  const remoteSessionsAvailable = remoteSessionHookEnabled && !remoteSessionApi.loading && !remoteSessionApi.error && !remoteSessionsArePreviousWorkspace
  const remoteSessionsPending = remoteSessionHookEnabled && !remoteSessionsAvailable
  useEffect(() => {
    if (!remoteSessionsAvailable) return
    setRemoteSessionSnapshot((previous) => {
      const sameWorkspace = previous.workspaceId === workspaceId
      const remoteActiveOwner = remoteSessionApi.activeSessionAgentTypeId
        ?? remoteSessionApi.activeSession?.agentTypeId
        ?? null
      const sameActive = previous.activeSessionId === remoteSessionApi.activeSessionId
        && previous.activeSessionAgentTypeId === remoteActiveOwner
      const sameSessions = previous.sessions.length === remoteSessionApi.sessions.length
        && previous.sessions.every((session, index) => (
          session.id === remoteSessionApi.sessions[index]?.id
          && session.agentTypeId === remoteSessionApi.sessions[index]?.agentTypeId
        ))
      if (sameWorkspace && sameActive && sameSessions) return previous
      return {
        workspaceId,
        sessions: remoteSessionApi.sessions,
        activeSessionId: remoteSessionApi.activeSessionId,
        activeSessionAgentTypeId: remoteActiveOwner,
      }
    })
  }, [remoteSessionApi.activeSession, remoteSessionApi.activeSessionAgentTypeId, remoteSessionApi.activeSessionId, remoteSessionApi.sessions, remoteSessionsAvailable, workspaceId])
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
  const activeRemoteSessionAgentTypeId = remoteSessionsAvailable
    ? remoteSessionApi.activeSessionAgentTypeId ?? remoteSessionApi.activeSession?.agentTypeId ?? null
    : remoteSessionsHaveStaleData
      ? remoteSessionSnapshot.activeSessionAgentTypeId
      : null
  const sessionApi = shouldUseRemoteSessions && (remoteSessionsAvailable || remoteSessionsHaveStaleData) ? remoteSessionApi : undefined
  const hasExplicitSessionProps =
    sessions !== undefined ||
    activeSessionId !== undefined ||
    activeSessionAgentTypeId !== undefined ||
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
        ephemeral: false,
      }]
    : []
  const resolvedSessions: WorkspaceAgentSession[] = sessionApi
    ? sessionItems ?? []
    : remoteSessionsPending
      ? pendingStoredSessionPlaceholder
      : hasExplicitSessionProps
        ? sessions ?? []
        : localSessions.sessions
  const appLeftSessions = useMemo(() => resolvedSessions.map((session) => ({
    ...session,
    viewId: nativeSessionHandoffs.workspaceId === workspaceId
      ? nativeSessionHandoffs.bySessionId[workspaceSessionKeyFor(session)]?.viewId
      : undefined,
  })), [nativeSessionHandoffs, resolvedSessions, workspaceId])
  const resolvedActiveId = sessionApi
    ? activeRemoteSessionId ?? null
    : remoteSessionsPending
      ? pendingStoredActiveSessionId ?? pendingRemoteActiveSessionId
      : hasExplicitSessionProps
        ? activeSessionId ?? null
        : localSessions.activeId
  const resolvedActiveAgentTypeId = sessionApi
    ? activeRemoteSessionAgentTypeId
    : remoteSessionsPending
      ? null
      : hasExplicitSessionProps
        ? activeSessionAgentTypeId ?? null
        : null
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
  const effectiveActiveSessionAgentTypeId = autoSubmitSessionId !== undefined ? agentTypeId ?? null : resolvedActiveAgentTypeId
  const rawSwitch: (id: string, agentTypeId?: string) => unknown = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi?.switch ?? onSwitchSession ?? localSessionStore.switchTo
  const resolvedSwitch = useCallback((nextSessionId: string, nextAgentTypeId?: string) => {
    if (effectiveActiveSessionId && nextSessionId !== effectiveActiveSessionId) {
      emitWorkspaceComposerStop({ sessionId: effectiveActiveSessionId, reason: WORKSPACE_COMPOSER_STOP_REASONS.sessionSwitch })
    }
    return nextAgentTypeId
      ? rawSwitch(nextSessionId, nextAgentTypeId)
      : rawSwitch(nextSessionId)
  }, [effectiveActiveSessionId, rawSwitch])
  const resolvedCreate = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi
      ? () => sessionApi.create()
      : onCreateSession
        ? () => onCreateSession()
        : () => localSessionStore.create()
  const rawDelete: (id: string, agentTypeId?: string) => void | Promise<unknown> = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi?.delete ?? onDeleteSession ?? localSessionStore.remove
  const resolvedDelete = useCallback((id: string, sessionAgentTypeId?: string) => {
    if (sessionApi && remoteSessionsPending && activeRemoteSessions.length <= 1) {
      suppressEmptyAutoCreateRef.current = true
      return sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
    }
    if (sessionApi && !remoteSessionsPending && activeRemoteSessions.length <= 1) {
      if (sessionApi.hasMore) {
        suppressEmptyAutoCreateRef.current = true
        return sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
      }
      const sessionKey = workspaceSessionKey(id, sessionAgentTypeId)
      if (pendingLastSessionDeleteRef.current.has(sessionKey)) return Promise.resolve()
      pendingLastSessionDeleteRef.current.add(sessionKey)
      autoCreateSessionRef.current = true
      setInitialRemoteSessionCreateFailed({ workspaceId, failed: false })
      const replacement = sessionApi.create({ title: defaultSessionTitle })
      return Promise.resolve(
        replacement && typeof (replacement as PromiseLike<unknown>).then === "function"
          ? Promise.resolve(replacement).then(() => (
              sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
            ))
          : sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id),
      )
        .catch((error) => {
          autoCreateSessionRef.current = false
          setInitialRemoteSessionCreateFailed({ workspaceId, failed: true })
          throw error
        })
        .finally(() => {
          pendingLastSessionDeleteRef.current.delete(sessionKey)
        })
    }
    return sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
  }, [activeRemoteSessions.length, defaultSessionTitle, rawDelete, remoteSessionsPending, sessionApi, workspaceId])

  const resolvedRename = remoteSessionsPending ? undefined : sessionApi?.rename
  const resolvedSessionTitle = resolvedSessions.find((session) => (
    workspaceSessionKeyFor(session) === workspaceSessionKey(
      effectiveActiveSessionId ?? "",
      effectiveActiveSessionAgentTypeId ?? agentTypeId,
    )
  ))?.title ?? undefined

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
  const [leftOverlay, setLeftOverlay] = useStoredNullableStringState(
    `${shellStorageKey}:appLeftOverlay`,
    defaultLeftOverlay,
    shellPersistenceEnabled,
  ) as [AppLeftOverlayId, (next: AppLeftOverlayId | ((previous: AppLeftOverlayId) => AppLeftOverlayId)) => void]
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
  const autoCreateSessionRef = useRef(false)
  const pendingLastSessionDeleteRef = useRef<Set<string>>(new Set())
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
    pendingLastSessionDeleteRef.current.clear()
    suppressEmptyAutoCreateRef.current = false
    setInitialRemoteSessionCreating({ workspaceId, creating: false })
    setInitialRemoteSessionCreateFailed({ workspaceId, failed: false })
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
  const openChatSessionIdsRef = useRef<ReadonlySet<string>>(new Set())
  const switchSessionForSurfaceRef = useRef<(sessionId: string, agentTypeId?: string) => void>(() => undefined)
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
  const chatSessionId = shouldUseRemoteSessions && !useSessionsProp && remoteSessionSnapshot.workspaceId !== workspaceId
    ? "default"
    : effectiveActiveSessionId ?? (autoSubmitSessionId !== undefined ? "default" : resolvedSessions[0]?.id ?? "default")
  const requestedChatSessionAgentTypeId = effectiveActiveSessionAgentTypeId ?? agentTypeId
  const chatSessionOwner = resolvedSessions.find((session) => (
    session.id === chatSessionId
    && (requestedChatSessionAgentTypeId === undefined || (
      "agentTypeId" in session && session.agentTypeId === requestedChatSessionAgentTypeId
    ))
  ))
  const chatSessionAgentTypeId = chatSessionOwner && "agentTypeId" in chatSessionOwner
    ? chatSessionOwner.agentTypeId ?? requestedChatSessionAgentTypeId
    : requestedChatSessionAgentTypeId
  const chatSessionKey = workspaceSessionKey(chatSessionId, chatSessionAgentTypeId)
  // While remote sessions load, resolvedSessions is a one-item placeholder
  // for the stored active session — never an authoritative list to prune
  // restored panes against.
  const sessionListAuthoritative = !sessionApi?.hasMore && !remoteSessionsPending
  useEffect(() => {
    if (remoteSessionsTransitioning) return
    const pendingCreatePane = pendingCreatePaneRef.current
    const sessionKeys = new Set(resolvedSessions.map(workspaceSessionKeyFor))
    const newlyObservedSession = pendingCreatePane
      ? resolvedSessions.find((session) => !pendingCreatePane.knownIds.has(workspaceSessionKeyFor(session)))
      : undefined
    const pendingCreatedId = pendingCreatePane
      ? pendingCreatePane.createdId
        ?? (sessionKeys.has(chatSessionKey) && !pendingCreatePane.knownIds.has(chatSessionKey)
          ? chatSessionKey
          : newlyObservedSession ? workspaceSessionKeyFor(newlyObservedSession) : null)
      : null
    if (pendingCreatedId && sessionKeys.has(pendingCreatedId)) pendingCreatePaneRef.current = null
    const preservingEphemeralDefault = chatSessionId === "default" && autoSubmitSessionId !== undefined
    const canPruneMissingSessions = sessionListAuthoritative && sessionKeys.size > 0 && !preservingEphemeralDefault
    const desiredSessionId = pendingCreatedId
      ?? (canPruneMissingSessions && !sessionKeys.has(chatSessionKey)
        ? resolvedSessions[0] ? workspaceSessionKeyFor(resolvedSessions[0]) : chatSessionKey
        : chatSessionKey)
    setChatPaneState((previous) => {
      const current = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [], activeId: null }
      // While remote sessions are still loading, chatSessionId may be the
      // ephemeral "default" placeholder — restored pane state is more
      // trustworthy than it, so leave the layout untouched until the real
      // session list arrives.
      if (remoteSessionsPending && current.ids.length > 0 && !pendingCreatedId) return current
      const currentActiveRef = current.activeId ? workspaceSessionRefFromKey(current.activeId) : undefined
      const activeOwnerIsExplicit = Boolean(effectiveActiveSessionAgentTypeId ?? agentTypeId)
      const currentMatchesControlledSession = activeOwnerIsExplicit
        ? current.activeId === chatSessionKey
        : currentActiveRef?.sessionId === chatSessionId
      const resolvedDesiredSessionId = !pendingCreatedId
        && current.activeId
        && (!canPruneMissingSessions || sessionKeys.has(current.activeId))
        && currentMatchesControlledSession
        ? current.activeId
        : desiredSessionId
      const rawIds = current.ids.length > 0 ? current.ids : [resolvedDesiredSessionId]
      const prunedIds = canPruneMissingSessions
        ? rawIds.filter((id) => sessionKeys.has(id) || id === pendingCreatedId)
        : rawIds
      const ids = prunedIds.length > 0 ? prunedIds : [resolvedDesiredSessionId]
      const activeId = current.activeId && ids.includes(current.activeId) ? current.activeId : ids[0] ?? resolvedDesiredSessionId
      const nextIds = pendingCreatedId
        ? pendingCreatePane?.placement === "replace"
          ? replaceActivePane(ids, pendingCreatePane.afterId, pendingCreatedId)
          : insertPaneAfter(ids, pendingCreatePane?.afterId, pendingCreatedId)
        : resolvedDesiredSessionId === activeId || ids.includes(resolvedDesiredSessionId)
          ? ids
          : replaceActivePane(ids, activeId, resolvedDesiredSessionId)
      const nextActiveId = nextIds.includes(resolvedDesiredSessionId)
        ? resolvedDesiredSessionId
        : nextIds[0] ?? resolvedDesiredSessionId
      if (
        previous.workspaceId === workspaceId
        && previous.activeId === nextActiveId
        && previous.ids.length === nextIds.length
        && previous.ids.every((id, index) => id === nextIds[index])
      ) return previous
      return { workspaceId, ids: nextIds, activeId: nextActiveId }
    })
  }, [agentTypeId, autoSubmitSessionId, chatSessionId, chatSessionKey, effectiveActiveSessionAgentTypeId, remoteSessionsPending, remoteSessionsTransitioning, resolvedSessions, sessionListAuthoritative, workspaceId])

  const sessionTitleById = useMemo(() => {
    const titles = new Map<string, string | null | undefined>()
    for (const session of resolvedSessions) titles.set(workspaceSessionKeyFor(session), session.title)
    return titles
  }, [resolvedSessions])
  const [initialHydrationPromptStarted, setInitialHydrationPromptStarted] = useState<{ workspaceId: string; ids: Set<string> }>(() => ({
    workspaceId,
    ids: new Set(),
  }))
  const hydratedAssistantReplySessionKeysRef = useRef(new Map<string, symbol>())
  const replaceSessionId = useCallback((
    fromSessionId: string,
    toSessionId: string,
    options: {
      fromAgentTypeId?: string
      toAgentTypeId?: string
      handoff?: NativeSessionHandoff
    } = {},
  ) => {
    const fromSessionKey = workspaceSessionKey(fromSessionId, options.fromAgentTypeId)
    const toSessionKey = workspaceSessionKey(toSessionId, options.toAgentTypeId)
    if (fromSessionKey === toSessionKey) return
    const fromStoreKey = `${workspaceId}:${fromSessionKey}`
    const toStoreKey = `${workspaceId}:${toSessionKey}`
    const handoffPrompt = nativeSessionHandoffPromptsRef.current.get(fromStoreKey)
    if (handoffPrompt) {
      nativeSessionHandoffPromptsRef.current.delete(fromStoreKey)
      nativeSessionHandoffPromptsRef.current.set(toStoreKey, handoffPrompt)
    }
    const hydrationGuard = hydratedAssistantReplySessionKeysRef.current.get(fromStoreKey)
    if (hydrationGuard) {
      hydratedAssistantReplySessionKeysRef.current.delete(fromStoreKey)
      hydratedAssistantReplySessionKeysRef.current.set(toStoreKey, hydrationGuard)
    }
    setNativeSessionHandoffs((current) => {
      const existing = current.workspaceId === workspaceId ? current.bySessionId[fromSessionKey] : undefined
      const handoff = options.handoff ?? existing
      if (!handoff) return current
      const bySessionId = {
        ...(current.workspaceId === workspaceId ? current.bySessionId : {}),
        [toSessionKey]: handoff,
      }
      delete bySessionId[fromSessionKey]
      return { workspaceId, bySessionId }
    })
    setPinnedState((previous) => {
      if (previous.workspaceId !== workspaceId) return previous
      const ids = [...new Set(previous.ids.map((id) => id === fromSessionKey ? toSessionKey : id))]
      if (ids.length === previous.ids.length && ids.every((id, index) => id === previous.ids[index])) return previous
      if (shellPersistenceEnabled) writeStoredPinnedSessions(pinnedStorageKey, ids)
      return { workspaceId, ids }
    })
    setChatPaneState((previous) => {
      if (previous.workspaceId !== workspaceId) return previous
      const ids = [...new Set(previous.ids.map((id) => id === fromSessionKey ? toSessionKey : id))]
      return {
        workspaceId,
        ids,
        activeId: previous.activeId === fromSessionKey ? toSessionKey : previous.activeId,
      }
    })
  }, [pinnedStorageKey, shellPersistenceEnabled, workspaceId])
  const forgetSession = useCallback((sessionId: string, sessionAgentTypeId?: string) => {
    const sessionKey = workspaceSessionKey(sessionId, sessionAgentTypeId)
    const storeKey = `${workspaceId}:${sessionKey}`
    nativeSessionHandoffPromptsRef.current.delete(storeKey)
    hydratedAssistantReplySessionKeysRef.current.delete(storeKey)
    setNativeSessionHandoffs((current) => {
      if (current.workspaceId !== workspaceId || !current.bySessionId[sessionKey]) return current
      const bySessionId = { ...current.bySessionId }
      delete bySessionId[sessionKey]
      return { ...current, bySessionId }
    })
    setPinnedState((previous) => {
      if (previous.workspaceId !== workspaceId || !previous.ids.includes(sessionKey)) return previous
      const ids = previous.ids.filter((id) => id !== sessionKey)
      if (shellPersistenceEnabled) writeStoredPinnedSessions(pinnedStorageKey, ids)
      return { workspaceId, ids }
    })
    setChatPaneState((previous) => {
      if (previous.workspaceId !== workspaceId) return previous
      const deletingIndex = previous.ids.indexOf(sessionKey)
      if (deletingIndex < 0) return previous
      const ids = previous.ids.filter((id) => id !== sessionKey)
      const activeId = previous.activeId === sessionKey
        ? ids[Math.max(0, deletingIndex - 1)] ?? ids[0] ?? null
        : previous.activeId
      return { workspaceId, ids, activeId }
    })
  }, [pinnedStorageKey, shellPersistenceEnabled, workspaceId])
  const emptySessionIds = useMemo(() => {
    const ids = new Set<string>()
    if (!remoteSessionsAvailable) return ids
    const startedIds = initialHydrationPromptStarted.workspaceId === workspaceId
      ? initialHydrationPromptStarted.ids
      : new Set<string>()
    for (const session of activeRemoteSessions) {
      const key = workspaceSessionKeyFor(session)
      if (session.turnCount === 0 && !startedIds.has(key)) ids.add(key)
    }
    return ids
  }, [activeRemoteSessions, initialHydrationPromptStarted, remoteSessionsAvailable, workspaceId])

  useEffect(() => {
    setInitialHydrationPromptStarted((current) => (
      current.workspaceId === workspaceId ? current : { workspaceId, ids: new Set() }
    ))
  }, [workspaceId])

  const activeChatPaneState = chatPaneState.workspaceId === workspaceId
    ? chatPaneState
    : { workspaceId, ids: [], activeId: null }
  const chatPaneIds = activeChatPaneState.ids.length > 0 ? activeChatPaneState.ids : [chatSessionKey]
  useEffect(() => {
    openChatSessionIdsRef.current = new Set(chatPaneIds)
  }, [chatPaneIds])
  const activeChatPaneId = activeChatPaneState.activeId ?? chatPaneIds[0] ?? chatSessionKey

  const switchToChatPane = useCallback((nextSessionId: string, nextAgentTypeId?: string) => {
    setLeftOverlay(null)
    const nextSessionKey = workspaceSessionKey(nextSessionId, nextAgentTypeId)
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
    const alreadyVisible = current.ids.includes(nextSessionKey)
    setChatPaneState((previous) => {
      const paneState = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
      const ids = paneState.ids.includes(nextSessionKey)
        ? paneState.ids
        : replaceActivePane(paneState.ids, paneState.activeId, nextSessionKey)
      return { workspaceId, ids, activeId: nextSessionKey }
    })
    return alreadyVisible
      ? nextAgentTypeId ? rawSwitch(nextSessionId, nextAgentTypeId) : rawSwitch(nextSessionId)
      : nextAgentTypeId ? resolvedSwitch(nextSessionId, nextAgentTypeId) : resolvedSwitch(nextSessionId)
  }, [chatPaneState, chatSessionKey, rawSwitch, resolvedSwitch, workspaceId])
  useEffect(() => {
    switchSessionForSurfaceRef.current = switchToChatPane
  }, [switchToChatPane])

  const activateChatPane = useCallback((nextSessionKey: string) => {
    setLeftOverlay(null)
    setChatPaneState((previous) => {
      const current = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
      return {
        workspaceId,
        ids: current.ids.includes(nextSessionKey) ? current.ids : insertPaneAfter(current.ids, current.activeId, nextSessionKey),
        activeId: nextSessionKey,
      }
    })
    const ref = workspaceSessionRefFromKey(nextSessionKey)
    return ref.agentTypeId ? rawSwitch(ref.sessionId, ref.agentTypeId) : rawSwitch(ref.sessionId)
  }, [chatSessionKey, rawSwitch, workspaceId])

  const openChatPane = useCallback((nextSessionId: string, nextAgentTypeId?: string) => {
    setLeftOverlay(null)
    const nextSessionKey = workspaceSessionKey(nextSessionId, nextAgentTypeId)
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
    // Opening a session that is already on the stage is a focus, not an
    // insert — flash the pane so the click visibly landed somewhere.
    if (current.ids.includes(nextSessionKey)) {
      setFlashChatPane({ workspaceId, id: nextSessionKey })
    }
    setChatPaneState((previous) => {
      const paneState = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
      return {
        workspaceId,
        ids: insertPaneAfter(paneState.ids, paneState.activeId, nextSessionKey),
        activeId: nextSessionKey,
      }
    })
    return nextAgentTypeId ? rawSwitch(nextSessionId, nextAgentTypeId) : rawSwitch(nextSessionId)
  }, [chatPaneState, chatSessionKey, rawSwitch, workspaceId])

  const closeChatPane = useCallback((sessionKey: string) => {
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
    if (current.ids.length <= 1) return
    const closingIndex = current.ids.indexOf(sessionKey)
    if (closingIndex < 0) return
    const nextIds = current.ids.filter((id) => id !== sessionKey)
    const nextActiveId = current.activeId === sessionKey
      ? nextIds[Math.max(0, closingIndex - 1)] ?? nextIds[0] ?? null
      : current.activeId
    setChatPaneState({ workspaceId, ids: nextIds, activeId: nextActiveId })
    if (nextActiveId && current.activeId === sessionKey) {
      const next = workspaceSessionRefFromKey(nextActiveId)
      if (next.agentTypeId) rawSwitch(next.sessionId, next.agentTypeId)
      else rawSwitch(next.sessionId)
    }
  }, [chatPaneState, chatSessionKey, rawSwitch, workspaceId])

  const createChatSession = useCallback(() => {
    const pendingCreatePane = {
      afterId: activeChatPaneId,
      placement: "replace" as const,
      knownIds: new Set(resolvedSessions.map(workspaceSessionKeyFor)),
    }
    pendingCreatePaneRef.current = pendingCreatePane
    const created = resolvedCreate()
    void Promise.resolve(created).then((session) => {
      const id = createdSessionId(session)
      if (!id) return
      const createdAgentTypeId = typeof (session as { agentTypeId?: unknown } | null)?.agentTypeId === "string"
        ? (session as { agentTypeId: string }).agentTypeId
        : agentTypeId
      const createdKey = workspaceSessionKey(id, createdAgentTypeId)
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = { ...pendingCreatePane, createdId: createdKey }
      setChatPaneState((previous) => {
        const current = previous.workspaceId === workspaceId
          ? previous
          : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
        const ids = current.ids.length > 0 ? current.ids : [chatSessionKey]
        const activeId = current.activeId ?? ids[0] ?? chatSessionKey
        return {
          workspaceId,
          ids: replaceActivePane(ids, activeId, createdKey),
          activeId: createdKey,
        }
      })
      // The remote session API's create() already selects/persists the new
      // session. Calling switch() immediately after create races against its
      // stale sessionsRef and can snap back to the previous session.
      if (!sessionApi) {
        if (createdAgentTypeId) rawSwitch(id, createdAgentTypeId)
        else rawSwitch(id)
      }
      scheduleActiveAgentComposerFocus()
    }).catch(() => {
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
      // Creation errors are surfaced by the session API/chat layer; the left
      // action should not leave stale optimistic panes behind.
    })
    return created
  }, [activeChatPaneId, agentTypeId, chatSessionKey, rawSwitch, resolvedCreate, resolvedSessions, sessionApi, workspaceId])

  const createChatPaneAfter = useCallback((afterId: string) => {
    const pendingCreatePane = {
      afterId,
      placement: "insert" as const,
      knownIds: new Set(resolvedSessions.map(workspaceSessionKeyFor)),
    }
    pendingCreatePaneRef.current = pendingCreatePane
    const created = resolvedCreate()
    void Promise.resolve(created).then((session) => {
      const id = createdSessionId(session)
      if (!id) return
      const createdAgentTypeId = typeof (session as { agentTypeId?: unknown } | null)?.agentTypeId === "string"
        ? (session as { agentTypeId: string }).agentTypeId
        : agentTypeId
      const createdKey = workspaceSessionKey(id, createdAgentTypeId)
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = { ...pendingCreatePane, createdId: createdKey }
      setChatPaneState((previous) => {
        const current = previous.workspaceId === workspaceId
          ? previous
          : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
        return {
          workspaceId,
          ids: insertPaneAfter(current.ids, afterId, createdKey),
          activeId: createdKey,
        }
      })
      if (!sessionApi) {
        if (createdAgentTypeId) rawSwitch(id, createdAgentTypeId)
        else rawSwitch(id)
      }
      scheduleActiveAgentComposerFocus()
    }).catch(() => {
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
    })
    return created
  }, [agentTypeId, chatSessionKey, rawSwitch, resolvedCreate, resolvedSessions, sessionApi, workspaceId])

  const deleteSessionAndPane = useCallback((sessionId: string, sessionAgentTypeId?: string): void | Promise<unknown> => {
    const sessionKey = workspaceSessionKey(sessionId, sessionAgentTypeId)
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
    const deletingIndex = current.ids.indexOf(sessionKey)
    let nextActiveId = current.activeId
    let switchAfterDelete = false
    if (deletingIndex >= 0) {
      const nextIds = current.ids.filter((id) => id !== sessionKey)
      nextActiveId = current.activeId === sessionKey
        ? nextIds[Math.max(0, deletingIndex - 1)] ?? nextIds[0] ?? null
        : current.activeId
      switchAfterDelete = Boolean(nextActiveId && current.activeId === sessionKey)
    }
    forgetSession(sessionId, sessionAgentTypeId)
    if (switchAfterDelete && nextActiveId) {
      const next = workspaceSessionRefFromKey(nextActiveId)
      if (next.agentTypeId) resolvedSwitch(next.sessionId, next.agentTypeId)
      else resolvedSwitch(next.sessionId)
    }
    return resolvedDelete(sessionId, sessionAgentTypeId)
  }, [chatPaneState, chatSessionKey, forgetSession, resolvedDelete, resolvedSwitch, workspaceId])

  // "New chat" from the left bar. With a split already open, the new session
  // gets its OWN dedicated pane (inserted after the active one) so the existing
  // panes are never hijacked; with a single pane it just becomes the active
  // chat — no gratuitous split for the common case.
  const createChatSessionPreferNewPane = useCallback(() => {
    if (chatPaneIds.length >= 2) return createChatPaneAfter(activeChatPaneId)
    return createChatSession()
  }, [activeChatPaneId, chatPaneIds.length, createChatPaneAfter, createChatSession])

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
  const hydrateMessages = !autoSubmitHydrationDisabled && provisionWorkspace !== false && (
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
      const chatToolRenderers = (chatParams?.toolRenderers && typeof chatParams.toolRenderers === "object")
        ? chatParams.toolRenderers as ToolRendererOverrides
        : undefined
      const matchingSession = resolvedSessions.find((session) => workspaceSessionKeyFor(session) === sessionKey)
      const sessionHasAssistantReply = matchingSession?.hasAssistantReply === true
      const nativeSessionHandoff = nativeSessionHandoffs.workspaceId === workspaceId
        ? nativeSessionHandoffs.bySessionId[sessionKey]
        : undefined
      const hydratedAssistantReplyKey = `${workspaceId}:${sessionKey}`
      const needsHydratedAssistantReplyRefresh = !sessionHasAssistantReply
      return {
      ...chatParams,
      ...(delayAutoSubmitDraft ? { autoSubmitInitialDraft: false, initialDraft: undefined } : {}),
      sessionId,
      sessionEphemeral: matchingSession?.ephemeral === true,
      agentTypeId: sessionRef.agentTypeId ?? agentTypeId,
      apiBaseUrl,
      workspaceId,
      storageScope: workspaceId,
      requestHeaders: resolvedRequestHeaders,
      remoteSessionOptions: chatRemoteSessionOptions,
      showSessions: false,
      nativeSessionStartEnabled,
      onNativeSessionAdopt: (session: TSession) => {
        const fromAgentTypeId = sessionRef.agentTypeId ?? agentTypeId
        const toAgentTypeId = session.agentTypeId ?? fromAgentTypeId
        const replacement = { fromSessionId: sessionId, toSessionId: session.id }
        const initialUserMessage = nativeSessionHandoffPromptsRef.current.get(`${workspaceId}:${sessionKey}`)
        sessionApi?.adoptNative?.(sessionId, session)
        replaceSessionId(sessionId, session.id, {
          fromAgentTypeId,
          toAgentTypeId,
          handoff: {
            ...replacement,
            viewId: sessionKey,
            ...(initialUserMessage ? { initialUserMessage } : {}),
          },
        })
      },
      onReloadAgentPlugins: chatParams?.onReloadAgentPlugins ?? (() => reloadAgentPluginsForSession(sessionId)),
      toolRenderers: { ...pluginToolRenderers, ...(chatToolRenderers ?? {}) },
      bridgeEndpoint: bridgeEnabled ? bridgeEndpoint : null,
      surfaceDispatch,
      extraCommands,
      workspaceWarmupStatus,
      hydrateMessages,
      allowPromptDuringInitialHydration: emptySessionIds.has(sessionKey),
      // Keep the admitted user prompt on screen while the local pane adopts and
      // hydrates its native session, rather than flashing loading or empty UI.
      initialHydrationOptimisticMessage: nativeSessionHandoff?.initialUserMessage,
      onPromptSubmitStarted: ({ sessionId: submittedSessionId, clientNonce, message }: { sessionId: string; clientNonce: string; message: string }) => {
        const submittedKey = workspaceSessionKey(submittedSessionId, sessionRef.agentTypeId ?? agentTypeId)
        if (matchingSession?.ephemeral === true) {
          nativeSessionHandoffPromptsRef.current.set(`${workspaceId}:${sessionKey}`, { clientNonce, text: message })
        }
        setInitialHydrationPromptStarted((current) => {
          const currentIds = current.workspaceId === workspaceId ? current.ids : new Set<string>()
          if (currentIds.has(submittedKey)) return current.workspaceId === workspaceId ? current : { workspaceId, ids: currentIds }
          const ids = new Set(currentIds)
          ids.add(submittedKey)
          return { workspaceId, ids }
        })
      },
      onTurnComplete: () => {
        void sessionApi?.refresh?.({ background: true })
        const existing = chatParams?.onTurnComplete
        if (typeof existing === "function") existing()
      },
      ...(needsHydratedAssistantReplyRefresh ? {
        onHydratedAssistantReply: () => {
          if (hydratedAssistantReplySessionKeysRef.current.has(hydratedAssistantReplyKey)) return
          const hydrationGuard = Symbol(hydratedAssistantReplyKey)
          hydratedAssistantReplySessionKeysRef.current.set(hydratedAssistantReplyKey, hydrationGuard)
          nativeSessionHandoffPromptsRef.current.delete(hydratedAssistantReplyKey)
          setNativeSessionHandoffs((current) => {
            if (current.workspaceId !== workspaceId) return current
            const handoff = current.bySessionId[sessionKey]
            if (!handoff?.initialUserMessage) return current
            const { initialUserMessage: _settledMessage, ...settledHandoff } = handoff
            return {
              ...current,
              bySessionId: { ...current.bySessionId, [sessionKey]: settledHandoff },
            }
          })
          void (async () => {
            try {
              await sessionApi?.refresh?.({ background: true })
            } catch {
              // Hydration reconciliation is best-effort.
            } finally {
              for (const [key, guard] of hydratedAssistantReplySessionKeysRef.current) {
                if (guard === hydrationGuard) hydratedAssistantReplySessionKeysRef.current.delete(key)
              }
            }
          })()
        },
      } : {}),
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
    [agentTypeId, apiBaseUrl, chatParams, chatRemoteSessionOptions, delayAutoSubmitDraft, resolvedRequestHeaders, bridgeEndpoint, surfaceDispatch, extraCommands, workspaceWarmupStatus, hydrateMessages, emptySessionIds, nativeSessionHandoffs, nativeSessionStartEnabled, pluginToolRenderers, reloadAgentPluginsForSession, replaceSessionId, resolvedHotReloadEnabled, resolvedSessions, sessionApi, workspaceId],
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
      const bridgeEnabled = id === activeChatPaneId
      const cacheKey = `${id}:${bridgeEnabled}`
      let params = cache.get(cacheKey)
      if (!params) {
        params = makeCenterParams(id, { bridgeEnabled })
        cache.set(cacheKey, params)
      }
      const sessionRef = workspaceSessionRefFromKey(id)
      return {
        id,
        viewId: nativeSessionHandoffs.workspaceId === workspaceId
          ? nativeSessionHandoffs.bySessionId[id]?.viewId ?? id
          : id,
        title: sessionTitleById.get(id) ?? (sessionRef.sessionId === "default" ? defaultSessionTitle : sessionRef.sessionId),
        panel: "chat",
        params,
      }
    })
  }, [activeChatPaneId, chatPaneIds, defaultSessionTitle, makeCenterParams, nativeSessionHandoffs, sessionTitleById, workspaceId])
  const providerChatPaneSessionRefs = useMemo(
    () => chatPaneIds.map(workspaceSessionRefFromKey),
    [chatPaneIds],
  )
  const providerChatPaneSessionIds = useMemo(
    () => providerChatPaneSessionRefs.map((ref) => ref.sessionId),
    [providerChatPaneSessionRefs],
  )
  const providerActiveSessionRef = workspaceSessionRefFromKey(activeChatPaneId)
  const providerActiveSessionId = providerActiveSessionRef.sessionId
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
  const activeChatPaneRef = activeChatPaneId ? workspaceSessionRefFromKey(activeChatPaneId) : null
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
  // Detached-chat callers (the Quick chat action, the open-detached-chat window
  // event, and plugins) address sessions by bare id, because that is the public
  // shell-capability contract. Panes key by workspaceSessionKey(id, agentTypeId),
  // so the bare id must be resolved back to an owner here or the surface keys
  // into a different domain and matches no session at all.
  const resolveSessionKey = useCallback((sessionId: string) => {
    const match = resolvedSessions.find((session) => session.id === sessionId)
    return match ? workspaceSessionKeyFor(match) : workspaceSessionKey(sessionId, agentTypeId)
  }, [agentTypeId, resolvedSessions])
  const shellCapabilitiesHost = useWorkspaceShellCapabilitiesHost({
    appLeftPaneCollapsed,
    workspaceId,
    nativeSessionHandoffs: nativeSessionHandoffs.workspaceId === workspaceId
      ? nativeSessionHandoffs.bySessionId
      : null,
    effectiveAppLeftPaneWidth,
    sessionTitleById,
    defaultSessionTitle,
    makeCenterParams,
    resolveSessionKey,
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
      chatTopActions={chatTopOverlayActions}
      activeChatPaneId={activeChatPaneId}
      onActiveChatPaneChange={activateChatPane}
      onCloseChatPane={closeChatPane}
      onCreateChatPaneAfter={isPluginTabsLayout ? undefined : createChatPaneAfter}
      onDropChatSession={openChatPane}
      flashChatPaneId={flashChatPane?.workspaceId === workspaceId ? flashChatPane.id : null}
      surface={surfaceOpen ? "artifact-surface" : null}
      surfaceParams={surfaceParams as Record<string, unknown>}
      chatOverlay={isPluginTabsLayout ? leftOverlayNode : null}
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
            // Active project → replace the active pane with a fresh chat.
            // Split creation remains an explicit action. Other project → switch
            // to it (lands in a fresh "new chat" surface). Cross-project
            // new-session without a switch needs the pending-entry contract
            // (plan §5.1) — deferred.
            if (projectId === (appLeftActiveProjectId ?? workspaceId)) {
              setLeftOverlay(null)
              void createChatSession()
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
          onRenameSession={resolvedRename}
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

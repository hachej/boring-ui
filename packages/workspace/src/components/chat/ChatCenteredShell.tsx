"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { cn } from "../../lib/utils"
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts"
import { ChatShellContext, type ChatShellContextValue } from "./context"
import { ChatTopBar } from "./ChatTopBar"
import { SessionBrowser } from "./SessionBrowser"
import { SurfaceShell } from "./SurfaceShell"
import { ChatStagePlaceholder, type ChatStageHandle } from "./ChatStagePlaceholder"
import type { SessionItem } from "../SessionList"
import type { DataSource, DataPaneConfig } from "./WorkbenchLeftPane"
import { ChatPanel, type ChatSuggestion } from "@boring/agent/ui-shadcn"
import { createWorkspaceToolRenderers } from "./workspaceToolRenderers"
import type { SurfaceShellApi, SurfaceShellSnapshot } from "./SurfaceShell"
import { startUiCommandStream } from "./uiCommandStream"
import { useCommandRegistry, useRegistry } from "../../registry"

export interface ChatCenteredShellProps {
  /** Branding shown in the top bar. */
  appTitle?: string
  /** User initial shown in the avatar bubble. */
  userInitial?: string
  /** Click handler for the avatar bubble. */
  onAvatarClick?: () => void

  /** Session list rendered in the left drawer. */
  sessions?: SessionItem[]
  activeSessionId?: string | null
  onSwitchSession?: (id: string) => void
  onCreateSession?: () => void
  onDeleteSession?: (id: string) => void

  /** Workbench (right surface) configuration. */
  rootDir?: string
  dataSources?: DataSource[]
  /** Plug-in data pane config — takes precedence over dataSources when set. */
  data?: DataPaneConfig
  surfaceStorageKey?: string

  /**
   * Custom chat stage. Receives a handle so the layout can focus the composer
   * on Escape. Defaults to ChatStagePlaceholder.
   */
  stage?: ReactNode | ((api: { ref: React.Ref<ChatStageHandle> }) => ReactNode)

  /** Initial pane state. */
  drawerDefaultOpen?: boolean
  surfaceDefaultOpen?: boolean

  drawerDefaultWidth?: number
  drawerMinWidth?: number
  drawerMaxWidth?: number

  surfaceDefaultWidth?: number
  surfaceMinWidth?: number
  surfaceMaxWidthViewportRatio?: number

  /** Persist drawer/surface open state + widths under this prefix. */
  storageKey?: string

  /**
   * Override the accent CSS variable for the entire shell (button highlights,
   * the divider above the chat card, etc.). Any valid CSS color works; OKLCH
   * is preferred for consistency with the rest of the design tokens.
   */
  accentColor?: string

  /** Mount the global command palette (⌘K / ⌘P). Defaults to true. */
  withCommandPalette?: boolean

  /**
   * Suggested actions shown when the chat is empty (both before any session
   * exists and inside an active session with no messages). Customize per
   * child app — pass `[]` to hide the grid entirely. Omit to inherit
   * `defaultChatSuggestions`.
   */
  chatSuggestions?: ChatSuggestion[]
  /** Eyebrow above the empty-state headline. */
  emptyEyebrow?: string
  /** Empty-state headline. */
  emptyTitle?: string
  /** Empty-state description below the headline. */
  emptyDescription?: string

  /**
   * Fires once the workbench surface dockview is ready. Receives the same
   * imperative handle that `useChatSurface()` exposes inside the tree —
   * use this when the parent renders ChatCenteredShell at its root and
   * therefore can't call `useChatSurface()` (which requires being inside
   * the shell). Typical use: wire `DataPaneConfig.onActivate` to
   * `surface.openPanel({...})` from a parent-level `data` prop.
   */
  onSurfaceReady?: (surface: SurfaceShellApi) => void

  /**
   * Additional panel ids (registered via WorkspaceProvider's `panels` prop)
   * that the workbench is allowed to render. By default only the built-in
   * editor/viewer panels are allowed; pass app-specific pane ids here so
   * `surface.openPanel({ component: "..." })` can instantiate them.
   */
  extraPanels?: string[]

  className?: string
}

const DEFAULTS = {
  drawerWidth: 260,
  drawerMin: 200,
  drawerMax: 360,
  surfaceWidth: 680,
  surfaceMin: 480,
  surfaceMaxRatio: 0.72,
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === "1") return true
    if (raw === "0") return false
  } catch {}
  return fallback
}

function writeNumber(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n))
  } catch {}
}

function writeBool(key: string, b: boolean): void {
  try {
    localStorage.setItem(key, b ? "1" : "0")
  } catch {}
}

function useViewportWidth(): number {
  const [w, setW] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1200))
  useEffect(() => {
    const onResize = () => setW(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return w
}

export function ChatCenteredShell({
  appTitle = "Boring",
  userInitial = "J",
  onAvatarClick,

  sessions = [],
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,

  rootDir = "",
  dataSources = [],
  data,
  surfaceStorageKey,

  stage,

  drawerDefaultOpen = false,
  surfaceDefaultOpen = false,
  drawerDefaultWidth = DEFAULTS.drawerWidth,
  drawerMinWidth = DEFAULTS.drawerMin,
  drawerMaxWidth = DEFAULTS.drawerMax,
  surfaceDefaultWidth = DEFAULTS.surfaceWidth,
  surfaceMinWidth = DEFAULTS.surfaceMin,
  surfaceMaxWidthViewportRatio = DEFAULTS.surfaceMaxRatio,

  storageKey = "boring-ui-v2:chat-centered-shell:v2",
  accentColor,
  withCommandPalette = true,
  chatSuggestions,
  emptyEyebrow,
  emptyTitle,
  emptyDescription,
  onSurfaceReady,
  extraPanels,
  className,
}: ChatCenteredShellProps) {
  const [drawerOpen, setDrawerOpenRaw] = useState(() =>
    readBool(`${storageKey}:drawer`, drawerDefaultOpen),
  )
  const [surfaceOpen, setSurfaceOpenRaw] = useState(() =>
    readBool(`${storageKey}:surface`, surfaceDefaultOpen),
  )
  const [drawerWidth, setDrawerWidth] = useState(() =>
    clamp(readNumber(`${storageKey}:drawerWidth`, drawerDefaultWidth), drawerMinWidth, drawerMaxWidth),
  )
  const [surfaceWidth, setSurfaceWidth] = useState(() =>
    readNumber(`${storageKey}:surfaceWidth`, surfaceDefaultWidth),
  )

  const viewport = useViewportWidth()
  const surfaceMax = Math.max(surfaceMinWidth, Math.floor(viewport * surfaceMaxWidthViewportRatio))

  const setDrawerOpen = useCallback((open: boolean) => {
    setDrawerOpenRaw(open)
    writeBool(`${storageKey}:drawer`, open)
  }, [storageKey])

  const setSurfaceOpen = useCallback((open: boolean) => {
    setSurfaceOpenRaw(open)
    writeBool(`${storageKey}:surface`, open)
  }, [storageKey])

  const toggleDrawer = useCallback(() => setDrawerOpen(!drawerOpen), [drawerOpen, setDrawerOpen])
  const toggleSurface = useCallback(() => setSurfaceOpen(!surfaceOpen), [surfaceOpen, setSurfaceOpen])

  useEffect(() => writeNumber(`${storageKey}:drawerWidth`, drawerWidth), [storageKey, drawerWidth])
  useEffect(() => writeNumber(`${storageKey}:surfaceWidth`, surfaceWidth), [storageKey, surfaceWidth])

  const stageRef = useRef<ChatStageHandle | null>(null)
  const focusComposer = useCallback(() => {
    stageRef.current?.focusComposer()
  }, [])

  // Imperative handle to the workbench surface — set by SurfaceShell on mount
  // via its onReady callback. Used to open files clicked from chat tool
  // outputs (read/write/edit) directly into the workbench.
  const surfaceRef = useRef<SurfaceShellApi | null>(null)
  const surfaceSnapshotRef = useRef<SurfaceShellSnapshot>({ openTabs: [], activeTab: null })
  const surfaceOpenRef = useRef(surfaceOpen)
  surfaceOpenRef.current = surfaceOpen

  // Snapshot of the WorkspaceProvider's panel registry — included in the UI
  // state push so the LLM can answer "what panels can I open with
  // exec_ui({kind:'openPanel', component:'...'})?" without being told via
  // system prompt. Read once at render; the registry is treated as
  // mount-stable (apps register panels at app boot, not during a session).
  // If a host adds dynamic panel registration later, push from a useEffect
  // listening on the registry's change events.
  const panelRegistry = useRegistry()
  const availablePanelIds = useMemo(
    () => panelRegistry.list().map((p) => p.id),
    [panelRegistry],
  )

  // Push a snapshot of the workbench's current state to the agent's UI bridge
  // (PUT /api/v1/ui/state). The LLM's get_ui_state tool returns whatever was
  // last PUT here, so this is what makes the agent aware of which tabs are
  // open / active and whether the workbench pane is visible.
  //
  // Per-push AbortController + last-call-wins: rapid toggles (drawer open
  // → close → open) are common, and without this an older PUT could land
  // at the server AFTER a newer one (network jitter, kept-alive
  // connection reorder). That would permanently poison get_ui_state until
  // the next event. The abort is best-effort — even if the server has
  // already accepted the older request, the newer one will overwrite it
  // because we always re-send full state, never deltas.
  const pushAbortRef = useRef<AbortController | null>(null)
  const pushUiState = useCallback(() => {
    const snapshot = surfaceSnapshotRef.current
    const body = {
      state: {
        v: 1,
        workbenchOpen: surfaceOpenRef.current,
        drawerOpen: drawerOpen,
        openTabs: snapshot.openTabs,
        activeTab: snapshot.activeTab,
        activeFile:
          snapshot.openTabs.find((t) => t.id === snapshot.activeTab)?.params?.path ?? null,
        // Discoverable component names the LLM can pass to
        // exec_ui({kind:'openPanel', params:{component:'...'}}). Includes
        // both built-ins (code-editor, markdown-editor, csv-viewer, ...)
        // and any app-registered panels (e.g. boring-macro's
        // 'series-viewer'). The agent doesn't need a system prompt
        // enumerating these — get_ui_state surfaces them.
        availablePanels: availablePanelIds,
      },
      causedBy: "user" as const,
    }
    pushAbortRef.current?.abort()
    const ac = new AbortController()
    pushAbortRef.current = ac
    void fetch("/api/v1/ui/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch(() => {
      /* Best-effort — UI state push is non-critical and should not break the UI. */
    })
  }, [drawerOpen, availablePanelIds])

  // Mirror the surface ref in state so context consumers re-render when the
  // workbench becomes ready. The ref stays for hot-path callbacks
  // (handleSurfaceReady, openArtifact); the state is for context exposure.
  const [surface, setSurface] = useState<SurfaceShellApi | null>(null)

  const onSurfaceReadyRef = useRef(onSurfaceReady)
  onSurfaceReadyRef.current = onSurfaceReady

  const handleSurfaceReady = useCallback((api: SurfaceShellApi) => {
    surfaceRef.current = api
    surfaceSnapshotRef.current = api.getSnapshot()
    setSurface(api)
    onSurfaceReadyRef.current?.(api)
    pushUiState()
  }, [pushUiState])

  const handleSurfaceChange = useCallback(
    (snapshot: SurfaceShellSnapshot) => {
      surfaceSnapshotRef.current = snapshot
      pushUiState()
    },
    [pushUiState],
  )

  // Re-push when drawer or workbench open state flips so the agent sees it
  // even when the dockview panel set hasn't changed.
  useEffect(() => {
    pushUiState()
  }, [drawerOpen, surfaceOpen, pushUiState])

  // Subscribe to agent → frontend UI commands posted via /api/v1/ui/commands
  // and apply them to the workbench surface. Default transport is SSE
  // (instant, no polling), with an automatic poll fallback if EventSource
  // is unavailable or the stream errors past its reconnect budget. The
  // dispatch context reads from refs on every command, so a late
  // SurfaceShell mount or any open/close toggle is picked up without
  // resubscribing.
  useEffect(() => {
    return startUiCommandStream({
      ctx: {
        surface: () => surfaceRef.current,
        isWorkbenchOpen: () => surfaceOpenRef.current,
        openWorkbench: () => setSurfaceOpen(true),
      },
    })
  }, [setSurfaceOpen])

  const openArtifact = useCallback(
    (path: string) => {
      // Auto-open the workbench so the file appears even if it was collapsed.
      if (!surfaceOpen) setSurfaceOpen(true)
      // Defer if the surface isn't mounted yet — dockview's onReady fires
      // after layout, so a previously-closed workbench needs two frames.
      const open = () => surfaceRef.current?.openFile(path)
      if (surfaceRef.current) open()
      else requestAnimationFrame(() => requestAnimationFrame(open))
    },
    [surfaceOpen, setSurfaceOpen],
  )

  const toolRenderers = useMemo(
    () => createWorkspaceToolRenderers({ onOpenArtifact: openArtifact }),
    [openArtifact],
  )

  useKeyboardShortcuts({
    shortcuts: [
      { key: "1", mod: true, handler: toggleDrawer },
      { key: "2", mod: true, handler: toggleSurface },
      { key: "Escape", allowInEditable: true, handler: focusComposer },
    ],
  })

  // Surface chat-shell actions in the ⌘K palette so they're discoverable
  // alongside the IDE-flavored commands the WorkspaceProvider registers
  // (Toggle Sidebar / Toggle Agent Panel / Close Tab — those target the
  // dockview store and have no visible effect on chat-shell consumers).
  // Re-register on every render: registerCommand is keyed by id, so the
  // closure capturing the latest toggle*/onCreateSession is always
  // current — we never end up running a stale handler.
  const commandRegistry = useCommandRegistry()
  useEffect(() => {
    commandRegistry.registerCommand({
      id: "chat-shell.toggleSessions",
      title: "Toggle Sessions Drawer",
      shortcut: "⌘1",
      run: toggleDrawer,
    })
    commandRegistry.registerCommand({
      id: "chat-shell.toggleWorkbench",
      title: "Toggle Workbench",
      shortcut: "⌘2",
      run: toggleSurface,
    })
    if (onCreateSession) {
      commandRegistry.registerCommand({
        id: "chat-shell.newChat",
        title: "New Chat",
        run: () => onCreateSession(),
      })
    }
    if (onSwitchSession && sessions.length > 0) {
      // Surface each session as a quick-switch command so users can
      // jump between conversations from the palette.
      for (const s of sessions) {
        commandRegistry.registerCommand({
          id: `chat-shell.session.${s.id}`,
          title: `Switch to: ${s.title}`,
          run: () => onSwitchSession(s.id),
        })
      }
    }
  }, [commandRegistry, toggleDrawer, toggleSurface, onCreateSession, onSwitchSession, sessions])

  const openCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }),
    )
  }, [])

  const ctx = useMemo<ChatShellContextValue>(
    () => ({
      drawerOpen,
      setDrawerOpen,
      toggleDrawer,
      surfaceOpen,
      setSurfaceOpen,
      toggleSurface,
      onNewChat: onCreateSession,
      focusComposer,
      surface,
    }),
    [
      drawerOpen,
      setDrawerOpen,
      toggleDrawer,
      surfaceOpen,
      setSurfaceOpen,
      toggleSurface,
      onCreateSession,
      focusComposer,
      surface,
    ],
  )

  const effectiveSurfaceWidth = clamp(surfaceWidth, surfaceMinWidth, surfaceMax)
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const stageNode = useMemo<ReactNode>(() => {
    if (typeof stage === "function") {
      return stage({ ref: stageRef })
    }
    if (stage) return stage
    if (activeSessionId) {
      // key={activeSessionId} forces a full remount on session change so
      // useAgentChat re-hydrates from localStorage + server cleanly. Without
      // the key, the same hook instance survives the prop swap and the
      // session change reads as "click did nothing visible" until messages
      // happen to differ.
      return (
        <ChatPanel
          key={activeSessionId}
          sessionId={activeSessionId}
          chrome={false}
          toolRenderers={toolRenderers}
          suggestions={chatSuggestions}
          emptyEyebrow={emptyEyebrow}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          className="h-full min-h-0"
        />
      )
    }
    return (
      <ChatStagePlaceholder
        ref={stageRef}
        eyebrow={emptyEyebrow}
        title={emptyTitle}
        description={emptyDescription}
        suggestions={chatSuggestions}
        onSelectSuggestion={onCreateSession ? () => onCreateSession() : undefined}
      />
    )
  }, [
    stage,
    activeSessionId,
    toolRenderers,
    chatSuggestions,
    emptyEyebrow,
    emptyTitle,
    emptyDescription,
    onCreateSession,
  ])

  const rootStyle = accentColor
    ? ({ "--accent": accentColor } as React.CSSProperties)
    : undefined

  return (
    <ChatShellContext.Provider value={ctx}>
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-hidden",
          "bg-[color:var(--canvas)]",
          className,
        )}
        style={rootStyle}
      >
        <div className="shrink-0" aria-label="App top bar">
          <ChatTopBar
            appTitle={appTitle}
            sessionTitle={activeSession?.title}
            userInitial={userInitial}
            onAvatarClick={onAvatarClick}
            onCommandPalette={openCommandPalette}
          />
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Sessions drawer — flush, full-height, no shadow */}
          <aside
            aria-label="Session browser"
            aria-hidden={!drawerOpen}
            className={cn(
              "relative shrink-0 overflow-hidden bg-background",
              "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              drawerOpen &&
                "border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
            )}
            style={{
              width: drawerOpen ? drawerWidth : 0,
              minWidth: drawerOpen ? drawerWidth : 0,
              maxWidth: drawerOpen ? drawerWidth : 0,
              willChange: "width",
            }}
          >
            <div
              className={cn(
                "flex h-full min-h-0 flex-col overflow-hidden",
                "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                drawerOpen ? "opacity-100" : "opacity-0",
              )}
            >
              <SessionBrowser
                sessions={sessions}
                activeId={activeSessionId}
                onSwitch={onSwitchSession}
                onCreate={onCreateSession}
                onDelete={onDeleteSession}
              />
            </div>
            {drawerOpen && (
              <ResizeHandle
                side="drawer-right"
                ariaLabel="Resize sessions drawer"
                onResize={(delta) =>
                  setDrawerWidth((w) => clamp(w + delta, drawerMinWidth, drawerMaxWidth))
                }
              />
            )}
          </aside>

          {/* Chat stage — full-bleed, no card chrome */}
          <main
            className="surface-chat-root relative flex min-w-0 flex-1 overflow-hidden bg-background"
            aria-label="Chat stage"
          >
            <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
              {stageNode}

              <FloatingEdgeButton
                side="left"
                open={drawerOpen}
                icon="sessions"
                onClick={toggleDrawer}
                label="Sessions"
                hint="⌘1"
              />
              <FloatingEdgeButton
                side="right"
                open={surfaceOpen}
                icon="workbench"
                onClick={toggleSurface}
                label="Workbench"
                hint="⌘2"
              />
            </div>
          </main>

          {/* Workbench — flush, full-height, no shadow */}
          <aside
            aria-label="Surface"
            aria-hidden={!surfaceOpen}
            className={cn(
              "relative shrink-0 overflow-hidden bg-background",
              "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              surfaceOpen &&
                "border-l border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
            )}
            style={{
              width: surfaceOpen ? effectiveSurfaceWidth : 0,
              minWidth: surfaceOpen ? effectiveSurfaceWidth : 0,
              maxWidth: surfaceOpen ? effectiveSurfaceWidth : 0,
              willChange: "width",
            }}
          >
            <div
              className={cn(
                "flex h-full min-h-0 flex-col overflow-hidden",
                "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                surfaceOpen ? "opacity-100" : "opacity-0",
              )}
            >
              <SurfaceShell
                rootDir={rootDir}
                dataSources={dataSources}
                data={data}
                // Auto-derive a SurfaceShell storage key from this shell's
                // storageKey so file-tree sidebar collapsed/width persist
                // alongside drawer/surface state. Hosts can still override
                // with an explicit `surfaceStorageKey` prop.
                storageKey={surfaceStorageKey ?? `${storageKey}:surface`}
                onReady={handleSurfaceReady}
                onChange={handleSurfaceChange}
                extraPanels={extraPanels}
              />
            </div>
            {surfaceOpen && (
              <ResizeHandle
                side="surface-left"
                ariaLabel="Resize workbench"
                onResize={(delta) =>
                  // Dragging the left edge of the workbench right (positive
                  // delta) shrinks it; left grows it. Invert the sign.
                  setSurfaceWidth((w) => clamp(w - delta, surfaceMinWidth, surfaceMax))
                }
              />
            )}
          </aside>
        </div>

        {/*
         * The command palette is mounted by WorkspaceProvider — every chat
         * shell already lives inside one (it owns the registry the palette
         * reads). Mounting another one here renders a duplicate dialog +
         * doubles the ⌘K listener, which the user reported as a "double
         * layer" palette. The `withCommandPalette` prop is preserved for
         * back-compat but is now a no-op; pass it to WorkspaceProvider if
         * you need to disable.
         */}
        {void withCommandPalette}
      </div>
    </ChatShellContext.Provider>
  )
}

interface FloatingEdgeButtonProps {
  side: "left" | "right"
  open: boolean
  icon: "sessions" | "workbench"
  onClick: () => void
  label: string
  hint?: string
}

interface ResizeHandleProps {
  /** Where the handle lives relative to the pane it resizes. `inner-end`
   *  is the side of the pane closest to the chat stage — i.e. the right
   *  edge of the left drawer / the left edge of the right workbench.
   */
  side: "drawer-right" | "surface-left"
  ariaLabel: string
  onResize: (delta: number) => void
}

function ResizeHandle({ side, ariaLabel, onResize }: ResizeHandleProps) {
  const startXRef = useRef<number | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      startXRef.current = e.clientX
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (startXRef.current === null) return
      const delta = e.clientX - startXRef.current
      startXRef.current = e.clientX
      onResize(delta)
    },
    [onResize],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (startXRef.current === null) return
      startXRef.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    },
    [],
  )

  // Mirrors the dockview sash UX (see dock/dockview-overrides.css §Sash)
  // for cadence — 200ms transition, 150ms hover delay — but uses the brand
  // accent (orange) instead of --primary (gray). The drawer / workbench
  // outer edges are app-level chrome and have always used the accent
  // alongside the floating-edge buttons; the dockview internal sashes are
  // a different surface (intra-workbench splits) and intentionally don't
  // match.
  //
  // Positioned INSIDE the pane (left-0 / right-0) rather than straddling
  // the edge — the parent <aside> uses overflow-hidden so any negative
  // offset would be clipped and the handle would be invisible.
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "absolute top-0 bottom-0 z-20 w-1 cursor-col-resize bg-transparent",
        "transition-colors duration-200",
        "hover:bg-[var(--accent)] hover:[transition-delay:150ms]",
        "active:bg-[var(--accent)]",
        side === "drawer-right" ? "right-0" : "left-0",
      )}
      style={{ touchAction: "none" }}
    />
  )
}

function FloatingEdgeButton({ side, open, icon, onClick, label, hint }: FloatingEdgeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={open}
      title={hint ? `${label} (${hint})` : label}
      className={cn(
        "absolute top-1/2 z-30 -translate-y-1/2",
        side === "left" ? "left-2" : "right-2",
        "flex h-9 w-9 flex-col items-center justify-center gap-0.5 rounded-lg",
        "bg-background text-muted-foreground",
        "shadow-[0_1px_2px_-1px_oklch(0_0_0/0.08),0_2px_8px_-4px_oklch(0_0_0/0.10),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)]",
        "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:text-[color:var(--accent)] hover:shadow-[0_2px_4px_-1px_oklch(0_0_0/0.08),0_4px_12px_-4px_oklch(0.62_0.14_65/0.25),inset_0_0_0_1px_oklch(0.62_0.14_65/0.35)]",
        "hover:-translate-y-[calc(50%+1px)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40",
        open && "pointer-events-none opacity-0 scale-90",
      )}
    >
      {icon === "sessions" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7v5l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 7.5 A1.5 1.5 0 0 1 4.5 6 h4 l2 2 h9 A1.5 1.5 0 0 1 21 9.5 V17.5 A1.5 1.5 0 0 1 19.5 19 H4.5 A1.5 1.5 0 0 1 3 17.5 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

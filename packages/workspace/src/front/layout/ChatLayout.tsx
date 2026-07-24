import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react"
import { IconButton, LoadingState, ResizeHandle as UiResizeHandle } from "@hachej/boring-ui-kit"
import { Maximize2, MessageSquare, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react"
import { cn } from "../lib/utils"
import { ControlTooltip } from "../components/ControlTooltip"
import { dispatchUiCommand, type DispatchContext } from "../bridge"
import { events, useEvent, workspaceEvents } from "../events"
import { useKeyboardShortcuts, type ShortcutBinding } from "../hooks/useKeyboardShortcuts"
import type { SurfaceShellApi } from "../chrome/artifact-surface/SurfaceShell"
import type { LayoutConfig, GroupConfig } from "../dock"
import { useCommandRegistry, useRegistry } from "../registry"
import type { PaneProps } from "../registry/types"
import { readStoredNumber, writeStoredNumber } from "../store/localStorageValues"
import type { ChatLayoutProps } from "./types"
import { useWorkspaceAttention, useWorkspaceContext, workspaceAttentionSessionBadgeForBlocker } from "../provider"
import { ChatPaneStage } from "./ChatPaneStage"
import { CornerChromeButton } from "./cornerChrome"
import { MobileChatBar, MobileSingleChatPane, MobileWorkspaceBar } from "./mobileShell"
import { useViewportWidth } from "./useViewportWidth"

export function buildChatLayout(props: ChatLayoutProps = {}): LayoutConfig {
  const {
    nav = "session-list",
    navParams,
    center = "chat",
    centerParams,
    surface,
    surfaceParams,
    sidebar,
    sidebarParams,
  } = props
  const groups: GroupConfig[] = []

  if (nav) {
    groups.push({
      id: "nav",
      position: "left",
      panel: nav,
      params: navParams,
      locked: true,
      hideHeader: true,
      constraints: { minWidth: 60, maxWidth: 60 },
    })
  }

  groups.push({
    id: "center",
    position: "center",
    panel: center,
    params: centerParams,
    hideHeader: true,
  })

  if (sidebar) {
    groups.push({
      id: "sidebar",
      position: "left",
      panel: sidebar,
      params: sidebarParams,
      hideHeader: true,
      collapsible: true,
      collapsedWidth: 40,
      constraints: { minWidth: 200, maxWidthViewportRatio: 0.5 },
    })
  }

  if (surface) {
    groups.push({
      id: "surface",
      position: "right",
      panel: surface,
      params: surfaceParams,
      hideHeader: true,
      dynamic: true,
      placeholder: "empty",
    })
  }

  return { version: "2.0", groups }
}

export function ChatLayout(props: ChatLayoutProps) {
  const navOpen = props.nav !== null
  const surfaceConfigured = props.surface !== undefined
  const surfaceOpen = Boolean(props.surface)
  const navId = props.nav || "session-list"
  const centerId = props.center ?? "chat"
  const surfaceId = props.surface || "artifact-surface"
  const viewport = useViewportWidth()
  const [navWidth, setNavWidth] = useStoredNumberState(
    props.storageKey ? `${props.storageKey}:drawerWidth` : undefined,
    260,
  )
  const [surfaceWidth, setSurfaceWidth] = useStoredNumberState(
    props.storageKey ? `${props.storageKey}:surfaceWidth` : undefined,
    680,
  )
  const [sidebarWidth, setSidebarWidth] = useStoredNumberState(
    props.storageKey ? `${props.storageKey}:sidebarWidth` : undefined,
    280,
  )
  const [chatCollapsed, setChatCollapsed] = useStoredBooleanState(
    props.storageKey ? `${props.storageKey}:chatCollapsed` : undefined,
    false,
  )
  const [chatRailPulse, setChatRailPulse] = useState(false)
  const { blockers } = useWorkspaceAttention()
  const activeSessionId = (props.activeChatPaneId ?? props.centerParams?.sessionId) as string | undefined
  const activeBlockers = useMemo(
    () => blockers.filter((blocker) => !blocker.sessionId || !activeSessionId || blocker.sessionId === activeSessionId),
    [activeSessionId, blockers],
  )
  const hasSessionAttention = useMemo(
    () => blockers.some((blocker) => !!blocker.sessionId && !!workspaceAttentionSessionBadgeForBlocker(blocker)),
    [blockers],
  )
  const commandRegistry = useCommandRegistry()
  const mobileShell = props.mobileShellEnabled === true && viewport < 640
  const effectiveNavWidth = mobileShell ? Math.min(Math.max(280, Math.floor(viewport * 0.86)), 360) : clamp(navWidth, 200, 360)
  const effectiveSidebarWidth = mobileShell ? viewport : clamp(sidebarWidth, 200, Math.max(240, Math.floor(viewport * 0.5)))
  const surfaceMax = mobileShell ? viewport : Math.max(480, Math.floor(viewport * 0.72))
  const effectiveSurfaceWidth = mobileShell ? viewport : clamp(surfaceWidth, 480, surfaceMax)
  const uiSurface = getFunction<() => SurfaceShellApi | null>(props.centerParams, "getSurface")
  const uiIsWorkbenchOpen = getFunction<() => boolean>(props.centerParams, "isWorkbenchOpen")
  const uiOpenWorkbench = getFunction<() => void>(props.centerParams, "openWorkbench")
  const uiOpenWorkbenchSources = getFunction<() => void>(props.centerParams, "openWorkbenchSources")
  const uiCloseWorkbench = getFunction<() => void>(props.centerParams, "closeWorkbench")
  const uiSurfaceDispatch = getDispatchContext(props.centerParams, "surfaceDispatch")
  const closeNav = getCallback(props.navParams, "onClose")
  const closeSurface = getCallback(props.surfaceParams, "onClose")
  const closeSidebar = getCallback(props.sidebarParams, "onClose")
  const createSession = getCallback(props.navParams, "onCreate")
  const chatPanes = props.chatPanes?.filter((pane) => pane.id.length > 0) ?? []
  const hasChatPanes = chatPanes.length > 0
  const activeMobileChatPane = hasChatPanes
    ? chatPanes.find((pane) => pane.id === props.activeChatPaneId) ?? chatPanes[0]
    : undefined
  const sidebarOpen = Boolean(props.sidebar)
  const canControlNav = navOpen ? Boolean(closeNav) : Boolean(props.onOpenNav)
  const canControlSurface = surfaceOpen ? Boolean(closeSurface) : Boolean(props.onOpenSurface)
  const canControlSidebar = sidebarOpen ? Boolean(closeSidebar) : Boolean(props.onOpenSidebar)
  const toggleNav = useCallback(() => {
    if (navOpen) {
      closeNav?.()
      return
    }
    props.onOpenNav?.()
  }, [closeNav, navOpen, props.onOpenNav])
  const toggleSurface = useCallback(() => {
    if (surfaceOpen) {
      closeSurface?.()
      return
    }
    props.onOpenSurface?.()
  }, [closeSurface, props.onOpenSurface, surfaceOpen])
  const toggleSidebar = useCallback(() => {
    if (sidebarOpen) {
      closeSidebar?.()
      return
    }
    props.onOpenSidebar?.()
  }, [closeSidebar, props.onOpenSidebar, sidebarOpen])
  const focusChat = useCallback(() => {
    if (chatCollapsed) setChatCollapsed(false)
    if (navOpen) closeNav?.()
    if (surfaceOpen) closeSurface?.()
    focusAgentComposer()
    scheduleComposerFocus()
  }, [chatCollapsed, closeNav, closeSurface, navOpen, setChatCollapsed, surfaceOpen])

  const suppressOverlayAutoExpandRef = useRef(false)
  const toggleChatCollapsed = useCallback(() => {
    const collapsing = !chatCollapsed
    // If Plugins/Skills is already open, full-workbench mode should hide the
    // chat stage without losing the overlay state. Suppress the one auto-expand
    // effect below; when the user restores chat, the overlay is still there.
    if (collapsing && props.chatOverlay) suppressOverlayAutoExpandRef.current = true
    setChatCollapsed((current) => {
      const next = !current
      // Collapsing the chat opens the workbench so the freed space is filled
      // instead of leaving an empty canvas.
      if (next && !surfaceOpen) props.onOpenSurface?.()
      return next
    })
    setChatRailPulse(false)
  }, [chatCollapsed, props.chatOverlay, props.onOpenSurface, setChatCollapsed, surfaceOpen])

  useKeyboardShortcuts({
    shortcuts: useMemo(() => {
      const shortcuts: ShortcutBinding[] = []
      if (canControlNav) {
        shortcuts.push({ key: "1", mod: true, handler: toggleNav })
      }
      if (canControlSurface) {
        shortcuts.push({ key: "2", mod: true, handler: toggleSurface })
      }
      if (canControlSidebar) {
        shortcuts.push({ key: "3", mod: true, allowInEditable: true, handler: toggleSidebar })
      }
      if (centerId === "chat") {
        shortcuts.push({ key: "Escape", allowInEditable: true, handler: focusChat })
        shortcuts.push({ key: "\\", mod: true, allowInEditable: true, handler: toggleChatCollapsed })
      }
      return shortcuts
    }, [canControlNav, canControlSidebar, canControlSurface, centerId, focusChat, toggleChatCollapsed, toggleNav, toggleSidebar, toggleSurface]),
  })

  useEffect(() => {
    const pluginId = "workspace:chat-layout"
    const agentPluginId = "agent:chat-layout"

    commandRegistry.unregisterByPluginId(pluginId)
    commandRegistry.unregisterByPluginId(agentPluginId)
    commandRegistry.registerCommand({
      id: "workspace:open-session-history",
      title: navOpen ? "Close Session History" : "Open Session History",
      keywords: ["sessions", "history", "drawer", navOpen ? "close" : "open"],
      shortcut: "⌘1",
      pluginId,
      when: () => canControlNav,
      run: toggleNav,
    })
    commandRegistry.registerCommand({
      id: "workspace:open-workbench",
      title: surfaceOpen ? "Close Workbench" : "Open Workbench",
      keywords: ["surface", "artifacts", "sources", "workbench", surfaceOpen ? "close" : "open"],
      shortcut: "⌘2",
      pluginId,
      when: () => canControlSurface,
      run: toggleSurface,
    })
    commandRegistry.registerCommand({
      id: "workspace:toggle-workbench-left-panel",
      title: sidebarOpen ? "Close Workbench Left Panel" : "Open Workbench Left Panel",
      keywords: ["left", "sidebar", "tabs", "workbench", sidebarOpen ? "close" : "open"],
      shortcut: "⌘3",
      pluginId,
      when: () => canControlSidebar,
      run: toggleSidebar,
    })
    if (centerId === "chat") {
      commandRegistry.registerCommand({
        id: "agent:focus-chat",
        title: "Focus Chat",
        keywords: ["agent", "chat", "prompt", "composer", "input", "focus"],
        pluginId: agentPluginId,
        run: focusChat,
      })
    }
    if (createSession) {
      commandRegistry.registerCommand({
        id: "agent:new-chat",
        title: "New Chat",
        keywords: ["agent", "chat", "session", "new"],
        pluginId: agentPluginId,
        run: createSession,
      })
    }
    return () => {
      commandRegistry.unregisterByPluginId(pluginId)
      commandRegistry.unregisterByPluginId(agentPluginId)
    }
  }, [
    commandRegistry,
    navOpen,
    centerId,
    surfaceConfigured,
    surfaceOpen,
    props.navParams,
    props.surfaceParams,
    props.onOpenNav,
    props.onOpenSurface,
    props.onOpenSidebar,
    canControlNav,
    canControlSurface,
    canControlSidebar,
    closeNav,
    closeSurface,
    closeSidebar,
    createSession,
    focusChat,
    sidebarOpen,
    toggleNav,
    toggleSurface,
    toggleSidebar,
  ])

  useEffect(() => {
    const ctx: DispatchContext | undefined = uiSurfaceDispatch ?? (
      uiSurface && uiIsWorkbenchOpen && uiOpenWorkbench
        ? {
            surface: uiSurface,
            isWorkbenchOpen: uiIsWorkbenchOpen,
            openWorkbench: uiOpenWorkbench,
            openWorkbenchSources: uiOpenWorkbenchSources,
            closeWorkbench: uiCloseWorkbench,
            // Fallback dispatch has no host-owned open-session set. Treat
            // session-gated requests as closed instead of accidentally opening
            // UI for a background session. Full shells should pass
            // `surfaceDispatch.shouldOpenSurface` to make this gate precise.
            shouldOpenSurface: (request) => request.meta?.openOnlyWhenSessionOpen === true ? false : true,
          }
        : undefined
    )
    if (!ctx) return
    return events.on(workspaceEvents.uiCommand, ({ command }) => {
      dispatchUiCommand(command, ctx)
    })
  }, [uiSurfaceDispatch, uiSurface, uiIsWorkbenchOpen, uiOpenWorkbench, uiOpenWorkbenchSources, uiCloseWorkbench])

  useEvent(workspaceEvents.agentData, () => {
    if (chatCollapsed) setChatRailPulse(true)
  })

  useEffect(() => {
    if (!chatCollapsed) {
      setChatRailPulse(false)
      return
    }
    if (activeBlockers.length > 0) {
      setChatCollapsed(false)
      setChatRailPulse(false)
      scheduleComposerFocus()
    }
  }, [activeBlockers.length, chatCollapsed, setChatCollapsed])

  // Switching to a different session re-opens the chat if it was collapsed, so
  // the newly selected conversation is visible. Skips the initial mount (only
  // reacts to an actual change of the active session id).
  const prevSessionIdRef = useRef(activeSessionId)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    prevSessionIdRef.current = activeSessionId
    if (prev !== undefined && activeSessionId !== undefined && activeSessionId !== prev && chatCollapsed) {
      setChatCollapsed(false)
    }
  }, [activeSessionId, chatCollapsed, setChatCollapsed])

  // On compact widths, prefer a one-pane workbench takeover instead of squeezing chat.
  useEffect(() => {
    if (mobileShell || !surfaceOpen || chatCollapsed || props.chatOverlay) return
    if (viewport < 1180) setChatCollapsed(true)
  }, [chatCollapsed, mobileShell, props.chatOverlay, setChatCollapsed, surfaceOpen, viewport])

  // Chat-hosted overlays (Skills/Plugins) must remain visible while workbench
  // content opens beside them. If chat was collapsed by a previous compact
  // workbench takeover, opening an overlay restores the chat area first.
  useEffect(() => {
    if (!props.chatOverlay || !chatCollapsed) return
    if (suppressOverlayAutoExpandRef.current) {
      suppressOverlayAutoExpandRef.current = false
      return
    }
    setChatCollapsed(false)
  }, [chatCollapsed, props.chatOverlay, setChatCollapsed])

  // Never leave a blank middle: if the workbench is closed while the chat is
  // collapsed, re-open the chat. Mirror of "collapsing the chat opens the
  // workbench" so at least one of the two is always visible.
  const prevSurfaceOpenRef = useRef(surfaceOpen)
  useEffect(() => {
    const prevOpen = prevSurfaceOpenRef.current
    prevSurfaceOpenRef.current = surfaceOpen
    if (prevOpen && !surfaceOpen && chatCollapsed) {
      setChatCollapsed(false)
    }
  }, [surfaceOpen, chatCollapsed, setChatCollapsed])

  const chatHidden = chatCollapsed || (mobileShell && surfaceOpen)
  const mobileWorkspaceOpen = mobileShell && surfaceOpen

  return (
    <div
      data-boring-workspace=""
      data-boring-workspace-part="shell"
      data-boring-mobile-shell={props.mobileShellEnabled === true ? "" : undefined}
      data-mobile-shell={mobileShell ? "true" : "false"}
      className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", props.className)}
    >
      {mobileShell && navOpen && closeNav ? (
        <div
          aria-hidden="true"
          data-boring-workspace-part="session-drawer-mobile-scrim"
          className="absolute inset-0 z-40 bg-foreground/30"
          onClick={closeNav}
        />
      ) : null}
      {mobileShell && sidebarOpen && closeSidebar ? (
        <div
          aria-hidden="true"
          data-boring-workspace-part="workbench-left-mobile-scrim"
          className="absolute inset-0 z-30 bg-foreground/30"
          onClick={closeSidebar}
        />
      ) : null}
      <aside
        data-boring-workspace-part="session-drawer"
        data-boring-state={navOpen ? "expanded" : "collapsed"}
        aria-label="Session browser"
        aria-hidden={!navOpen}
        className={cn(
          mobileShell ? "absolute inset-y-0 left-0 z-50 h-full shadow-2xl" : "relative h-full shrink-0",
          "min-h-0 overflow-hidden bg-background",
          "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          navOpen
            ? "border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]"
            : "pointer-events-none z-0",
        )}
        style={{
          width: navOpen ? effectiveNavWidth : 0,
          minWidth: navOpen ? effectiveNavWidth : 0,
          maxWidth: navOpen ? effectiveNavWidth : 0,
          willChange: "width",
        }}
      >
        <div
          className={cn(
            "h-full min-h-0 overflow-hidden",
            "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            navOpen ? "opacity-100" : "invisible pointer-events-none opacity-0",
          )}
        >
          <PanelSlot id={navId} params={props.navParams} />
        </div>
        {navOpen && !mobileShell ? (
          <ResizeHandle
            side="drawer-right"
            ariaLabel="Resize sessions drawer"
            onResize={(delta) => setNavWidth((w) => clamp(w + delta, 200, 360))}
          />
        ) : null}
      </aside>

      <aside
        data-boring-workspace-part="workbench-left-shell"
        data-boring-state={sidebarOpen ? "expanded" : "collapsed"}
        aria-label={sidebarOpen ? "Workbench left panel" : undefined}
        aria-hidden={!sidebarOpen}
        className={cn(
          mobileShell ? "absolute inset-0 z-40 h-full" : "relative h-full shrink-0",
          "min-h-0 overflow-hidden bg-background",
          "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          sidebarOpen && "border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
        )}
        style={{
          width: sidebarOpen ? effectiveSidebarWidth : 0,
          minWidth: sidebarOpen ? effectiveSidebarWidth : 0,
          maxWidth: sidebarOpen ? effectiveSidebarWidth : 0,
          willChange: "width",
        }}
      >
        <div
          className={cn(
            "h-full min-h-0 overflow-hidden",
            "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            sidebarOpen ? "opacity-100" : "opacity-0",
          )}
        >
          {sidebarOpen ? <PanelSlot id={props.sidebar ?? "workbench-left"} params={props.sidebarParams} /> : null}
        </div>
        {sidebarOpen && !mobileShell ? (
          <ResizeHandle
            side="drawer-right"
            ariaLabel="Resize workbench left panel"
            onResize={(delta) => setSidebarWidth((w) => clamp(w + delta, 200, Math.max(240, Math.floor(viewport * 0.5))))}
          />
        ) : null}
      </aside>

      <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        <main
          data-boring-workspace-part="chat-stage"
          data-boring-state={chatHidden ? "collapsed" : "expanded"}
          aria-label={chatHidden ? "Collapsed chat" : "Chat"}
          aria-hidden={chatHidden}
          className={cn(
            "relative h-full min-h-0 min-w-0 overflow-hidden bg-background",
            mobileShell && !chatHidden && "flex flex-col",
            // Animate flex-grow (not just width) so the chat slides open/closed
            // like the fixed-width nav/workbench panes instead of snapping.
            "transition-[flex-grow,flex-basis,width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            chatHidden
              ? "min-w-0 flex-[0_0_0px]"
              : "flex-1 border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
          )}
        >
          {mobileShell && !chatHidden ? (
            <MobileChatBar
              canOpenNav={Boolean(props.onOpenNav)}
              canOpenWorkspace={canControlSurface}
              onOpenNav={props.onOpenNav}
              onOpenWorkspace={toggleSurface}
            />
          ) : null}
          <div
            className={cn(
              mobileShell && !chatHidden ? "min-h-0 flex-1 overflow-hidden" : "h-full min-h-0 overflow-hidden",
              "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              chatHidden ? "opacity-0" : "opacity-100",
            )}
          >
            {hasChatPanes && mobileShell && activeMobileChatPane ? (
              <MobileSingleChatPane
                pane={activeMobileChatPane}
                totalPanes={chatPanes.length}
                topActions={props.chatTopActions}
                onClosePane={props.onCloseChatPane}
                renderPane={(pane) => (
                  <PanelSlot
                    id={pane.panel ?? centerId}
                    params={pane.params ?? props.centerParams}
                  />
                )}
              />
            ) : hasChatPanes ? (
              <ChatPaneStage
                panes={chatPanes}
                topActions={props.chatTopActions}
                activePaneId={props.activeChatPaneId}
                onActivePaneChange={props.onActiveChatPaneChange}
                onClosePane={props.onCloseChatPane}
                onSplitPane={props.onSplitChatPane}
                pendingPanePlacement={props.pendingChatPanePlacement}
                flashPaneId={props.flashChatPaneId}
                storageKey={props.storageKey}
                onDropSession={props.onDropChatSession}
                renderPane={(pane) => (
                  <PanelSlot
                    id={pane.panel ?? centerId}
                    params={pane.params ?? props.centerParams}
                  />
                )}
              />
            ) : (
              <PanelSlot id={centerId} params={props.centerParams} />
            )}
          </div>
          {props.chatOverlay ? (
            <div
              data-boring-workspace-part="chat-left-overlay"
              aria-hidden={chatCollapsed}
              className="absolute inset-0 z-40 flex bg-background"
            >
              <div className="flex h-full w-full flex-col border-r border-border bg-background">
                {props.chatOverlay}
              </div>
            </div>
          ) : null}
        </main>

        {surfaceConfigured ? (
          <aside
            data-boring-workspace-part="workbench"
            data-boring-state={surfaceOpen ? "expanded" : "collapsed"}
            aria-label={surfaceOpen ? "Surface" : undefined}
            aria-hidden={!surfaceOpen}
            className={cn(
              mobileShell ? "absolute inset-0 z-40" : "relative",
              "h-full min-h-0 overflow-hidden bg-background",
              // Collapsed/mobile workbench fills available width; otherwise it is a side panel.
              (chatCollapsed || mobileWorkspaceOpen) && surfaceOpen ? "min-w-0 flex-1" : "shrink-0",
              "transition-[flex-grow,flex-basis,width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              surfaceOpen && !mobileShell && "border-l border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
            )}
            style={
              (chatCollapsed || mobileWorkspaceOpen) && surfaceOpen
                ? { width: surfaceOpen ? effectiveSurfaceWidth : 0, minWidth: surfaceOpen ? effectiveSurfaceWidth : 0, maxWidth: surfaceOpen ? effectiveSurfaceWidth : 0, willChange: "width" }
                : {
                    width: surfaceOpen ? effectiveSurfaceWidth : 0,
                    minWidth: surfaceOpen ? effectiveSurfaceWidth : 0,
                    maxWidth: surfaceOpen ? effectiveSurfaceWidth : 0,
                    willChange: "width",
                  }
            }
          >
            <div
              className={cn(
                "h-full min-h-0 overflow-hidden",
                "transition-[opacity,padding] duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                surfaceOpen ? "opacity-100" : "opacity-0",
              )}
            >
              {mobileWorkspaceOpen ? (
                <div className="flex h-full min-h-0 flex-col">
                  <MobileWorkspaceBar onBack={focusChat} />
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {props.surfaceOverlay ? (
                      <div className="relative h-full min-h-0">
                        {props.surfaceOverlay}
                      </div>
                    ) : <PanelSlot id={surfaceId} params={props.surfaceParams} />}
                  </div>
                </div>
              ) : props.surfaceOverlay ? (
                <div className="relative h-full min-h-0">
                  {props.surfaceOverlay}
                </div>
              ) : <PanelSlot id={surfaceId} params={props.surfaceParams} />}
            </div>
            {surfaceOpen && !chatCollapsed && !mobileShell ? (
              <ResizeHandle
                side="surface-left"
                ariaLabel="Resize workbench"
                onResize={(delta) => setSurfaceWidth((w) => clamp(w - delta, 480, surfaceMax))}
              />
            ) : null}
          </aside>
        ) : null}

      </div>

      {!mobileShell ? (
        <TopRightWorkspaceControls
          surfaceOpen={surfaceOpen}
          canToggleSurface={canControlSurface}
          onToggleSurface={toggleSurface}
          chatCollapsed={chatCollapsed}
          canToggleChat={centerId === "chat" && (!surfaceConfigured || (surfaceOpen && !chatCollapsed))}
          onToggleChat={toggleChatCollapsed}
          chatPulse={chatRailPulse || blockers.length > 0}
          surfaceConfigured={surfaceConfigured}
        />
      ) : null}

      {!mobileShell && !navOpen && props.onOpenNav ? (
        <FloatingEdgeButton
          side="left"
          icon="sessions"
          onClick={props.onOpenNav}
          label="Sessions"
          hint="⌘1"
          pulse={hasSessionAttention}
        />
      ) : null}
      {!mobileShell && !chatCollapsed && !navOpen && hasChatPanes && props.onCreateChatPaneAfter ? (
        <FloatingEdgeButton
          side="left"
          icon="plus"
          onClick={() => {
            const targetId = props.activeChatPaneId ?? chatPanes[chatPanes.length - 1]?.id
            if (targetId) props.onCreateChatPaneAfter?.(targetId)
          }}
          label="New chat"
          // Sits above Sessions; drawer header owns creation while open.
          stackIndex={props.onOpenNav ? 1 : 0}
        />
      ) : null}
    </div>
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

type StoredNumberUpdate = number | ((previous: number) => number)
type StoredBooleanUpdate = boolean | ((previous: boolean) => boolean)

function useStoredNumberState(
  key: string | undefined,
  fallback: number,
): [number, (next: StoredNumberUpdate) => void] {
  const [value, setValue] = useState(() =>
    key ? readStoredNumber(key, fallback) : fallback,
  )

  useEffect(() => {
    setValue(key ? readStoredNumber(key, fallback) : fallback)
  }, [key, fallback])

  const setStoredValue = useCallback(
    (next: StoredNumberUpdate) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next
        if (key) writeStoredNumber(key, resolved)
        return resolved
      })
    },
    [key],
  )

  return [value, setStoredValue]
}

function useStoredBooleanState(
  key: string | undefined,
  fallback: boolean,
): [boolean, (next: StoredBooleanUpdate) => void] {
  const [value, setValue] = useState(() => {
    if (!key || typeof window === "undefined") return fallback
    return window.localStorage.getItem(key) === "1"
  })

  useEffect(() => {
    if (!key || typeof window === "undefined") {
      setValue(fallback)
      return
    }
    const stored = window.localStorage.getItem(key)
    setValue(stored == null ? fallback : stored === "1")
  }, [key, fallback])

  const setStoredValue = useCallback(
    (next: StoredBooleanUpdate) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next
        if (key && typeof window !== "undefined") {
          window.localStorage.setItem(key, resolved ? "1" : "0")
        }
        return resolved
      })
    },
    [key],
  )

  return [value, setStoredValue]
}

interface ResizeHandleProps {
  side: "drawer-right" | "surface-left"
  ariaLabel: string
  onResize: (delta: number) => void
}

function ResizeHandle({ side, ariaLabel, onResize }: ResizeHandleProps) {
  const startXRef = useRef<number | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    startXRef.current = e.clientX
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return
    const delta = e.clientX - startXRef.current
    startXRef.current = e.clientX
    onResize(delta)
  }, [onResize])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return
    startXRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  return (
    <UiResizeHandle
      aria-label={ariaLabel}
      orientation="vertical"
      onResizeStart={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "absolute -top-px -bottom-px z-20 w-3 bg-transparent hover:!bg-transparent active:!bg-transparent",
        "after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:rounded-full after:bg-border/55",
        "after:transition-[width,background-color] after:duration-150 hover:after:w-1 hover:after:bg-foreground/35 active:after:w-1 active:after:bg-foreground/50",
        side === "drawer-right" ? "right-0" : "-left-1.5",
      )}
    />
  )
}

function getDispatchContext(params: Record<string, unknown> | undefined, key: string): DispatchContext | undefined {
  const value = params?.[key]
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Partial<DispatchContext>
  return typeof candidate.surface === "function" && typeof candidate.isWorkbenchOpen === "function" && typeof candidate.openWorkbench === "function"
    ? candidate as DispatchContext
    : undefined
}

function getFunction<T extends (...args: unknown[]) => unknown>(
  params: Record<string, unknown> | undefined,
  key: string,
): T | undefined {
  const value = params?.[key]
  return typeof value === "function" ? value as T : undefined
}

function getCallback(params: Record<string, unknown> | undefined, key: string): (() => void) | undefined {
  return getFunction<() => void>(params, key)
}

function focusAgentComposer(): void {
  if (typeof document === "undefined") return
  const activePane = document.querySelector<HTMLElement>(
    '[data-boring-workspace-part="chat-pane"][data-boring-state="active"]',
  )
  const root: Document | HTMLElement = activePane ?? document
  const textarea = root.querySelector<HTMLTextAreaElement>(
    '[data-boring-agent] textarea[name="message"], textarea[name="message"]',
  )
  textarea?.focus()
}

function scheduleComposerFocus(): void {
  if (typeof window === "undefined") return
  window.requestAnimationFrame(() => {
    focusAgentComposer()
    window.setTimeout(focusAgentComposer, 320)
  })
}

function PanelSlot({ id, params }: { id: string; params?: Record<string, unknown> }) {
  const registry = useRegistry()
  const { debug } = useWorkspaceContext()
  const registrySnapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  )
  const components = useMemo(() => registry.getComponents(), [registry, registrySnapshot])
  const Component = components[id] as ComponentType<PaneProps<Record<string, unknown> | undefined>> | undefined
  const api = useMemo(() => createPanelApi(id), [id])
  if (!Component) return null
  return (
    <Suspense fallback={<LoadingState centered />}>
      <Component
        params={{ ...params, debug }}
        api={api as PaneProps["api"]}
        containerApi={{} as PaneProps["containerApi"]}
      />
    </Suspense>
  )
}

function createPanelApi(id: string): Partial<PaneProps["api"]> {
  return {
    id,
    title: id,
    setTitle: () => {},
    setActive: () => {},
    close: () => {},
    updateParameters: () => {},
    onDidParametersChange: () => ({ dispose() {} }),
    onDidActiveChange: () => ({ dispose() {} }),
    onDidDimensionsChange: () => ({ dispose() {} }),
    onDidLocationChange: () => ({ dispose() {} }),
    onDidTitleChange: () => ({ dispose() {} }),
    onWillFocus: () => ({ dispose() {} }),
    onDidFocus: () => ({ dispose() {} }),
    onDidBlur: () => ({ dispose() {} }),
    onWillVisibilityChange: () => ({ dispose() {} }),
    onDidVisibilityChange: () => ({ dispose() {} }),
    onDidConstraintsChange: () => ({ dispose() {} }),
  } as Partial<PaneProps["api"]>
}

function TopRightWorkspaceControls({
  surfaceOpen,
  canToggleSurface,
  onToggleSurface,
  chatCollapsed,
  canToggleChat,
  onToggleChat,
  chatPulse,
  surfaceConfigured,
}: {
  surfaceOpen: boolean
  canToggleSurface: boolean
  onToggleSurface: () => void
  chatCollapsed: boolean
  canToggleChat: boolean
  onToggleChat: () => void
  chatPulse: boolean
  surfaceConfigured: boolean
}) {
  const showSurfaceToggle = canToggleSurface
  const showChatToggle = canToggleChat
  if (!showSurfaceToggle && !showChatToggle) return null

  const chatLabel = chatCollapsed
    ? "Show chat"
    : surfaceConfigured ? "Expand workbench" : "Collapse chat"

  return (
    <div className="pointer-events-none absolute right-3 top-2.5 z-[70] flex items-center gap-1">
      {showChatToggle ? (
        <CornerChromeButton
          label={chatLabel}
          hint="⌘\\"
          onClick={onToggleChat}
          pressed={chatCollapsed}
          pulse={chatPulse}
        >
          {chatCollapsed ? (
            <Minimize2 className="size-3" strokeWidth={1.75} />
          ) : (
            <Maximize2 className="size-3" strokeWidth={1.75} />
          )}
        </CornerChromeButton>
      ) : null}
      {showSurfaceToggle ? (
        <CornerChromeButton
          label={surfaceOpen ? "Close workbench" : "Open workbench"}
          hint="⌘2"
          onClick={onToggleSurface}
          pressed={surfaceOpen}
        >
          {surfaceOpen ? (
            <PanelRightClose className="size-3" strokeWidth={1.75} />
          ) : (
            <PanelRightOpen className="size-3" strokeWidth={1.75} />
          )}
        </CornerChromeButton>
      ) : null}
    </div>
  )
}

function FloatingEdgeButton({
  side,
  icon,
  onClick,
  label,
  hint,
  bottomOffset,
  stackIndex = 0,
  pulse = false,
}: {
  side: "left" | "right"
  icon: "sessions" | "workbench" | "chat" | "plus"
  onClick: () => void
  label: string
  hint?: string
  bottomOffset?: number
  // Stack offset for multiple buttons sharing the same vertical edge anchor.
  // Each step lifts the button by one button-height + gap above the previous.
  stackIndex?: number
  pulse?: boolean
}) {
  const dockToBottom = side === "right" && bottomOffset !== undefined
  // Buttons are h-9 (36px); stack them with a 8px gap so they never overlap.
  const stackOffset = stackIndex * 44
  return (
    <ControlTooltip label={label} hint={hint} side={side === "left" ? "right" : "left"}>
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute z-30 h-9 w-9 gap-0.5 rounded-lg bg-background text-muted-foreground",
        side === "left" ? "left-2" : "right-2",
        dockToBottom ? "hover:-translate-y-0.5" : "top-1/2 hover:-translate-y-[1px]",
        "shadow-[0_1px_2px_-1px_oklch(0_0_0/0.08),0_2px_8px_-4px_oklch(0_0_0/0.10),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)]",
        "hover:bg-muted/60 hover:text-foreground hover:shadow-[0_2px_4px_-1px_oklch(0_0_0/0.08),0_4px_12px_-4px_oklch(0_0_0/0.10),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.9)]",
        "focus-visible:ring-ring/40",
      )}
      style={
        dockToBottom
          ? { bottom: bottomOffset }
          : { transform: `translateY(calc(-50% - ${stackOffset}px))` }
      }
    >
      {icon === "sessions" ? (
        <span className="relative flex items-center justify-center">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7v5l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {pulse ? (
            <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-[color:var(--accent)]" aria-hidden="true" data-boring-workspace-part="edge-attention-dot" />
          ) : null}
        </span>
      ) : icon === "chat" ? (
        <span className="relative flex items-center justify-center">
          <MessageSquare className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden="true" />
          {pulse ? (
            <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-[color:var(--accent)]" aria-hidden="true" />
          ) : null}
        </span>
      ) : icon === "plus" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 7.5 A1.5 1.5 0 0 1 4.5 6 h4 l2 2 h9 A1.5 1.5 0 0 1 21 9.5 V17.5 A1.5 1.5 0 0 1 19.5 19 H4.5 A1.5 1.5 0 0 1 3 17.5 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      )}
    </IconButton>
    </ControlTooltip>
  )
}

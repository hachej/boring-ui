import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react"
import { IconButton, LoadingState, ResizeHandle as UiResizeHandle } from "@hachej/boring-ui-kit"
import { ChevronLeft, MessageSquare } from "lucide-react"
import { cn } from "../lib/utils"
import { dispatchUiCommand, type DispatchContext } from "../bridge"
import { events, useEvent, workspaceEvents } from "../events"
import { useKeyboardShortcuts, type ShortcutBinding } from "../hooks/useKeyboardShortcuts"
import type { SurfaceShellApi } from "../chrome/artifact-surface/SurfaceShell"
import type { LayoutConfig, GroupConfig } from "../dock"
import { useCommandRegistry, useRegistry } from "../registry"
import type { PaneProps } from "../registry/types"
import { readStoredNumber, writeStoredNumber } from "../store/localStorageValues"
import type { ChatLayoutProps } from "./types"
import { useWorkspaceAttention, useWorkspaceContext } from "../provider"

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
  const [chatCollapsed, setChatCollapsed] = useStoredBooleanState(
    props.storageKey ? `${props.storageKey}:chatCollapsed` : undefined,
    false,
  )
  const [chatRailPulse, setChatRailPulse] = useState(false)
  const { blockers } = useWorkspaceAttention()
  const commandRegistry = useCommandRegistry()
  const effectiveNavWidth = clamp(navWidth, 200, 360)
  const surfaceMax = Math.max(480, Math.floor(viewport * 0.72))
  const effectiveSurfaceWidth = clamp(surfaceWidth, 480, surfaceMax)
  const uiSurface = getFunction<() => SurfaceShellApi | null>(props.centerParams, "getSurface")
  const uiIsWorkbenchOpen = getFunction<() => boolean>(props.centerParams, "isWorkbenchOpen")
  const uiOpenWorkbench = getFunction<() => void>(props.centerParams, "openWorkbench")
  const uiOpenWorkbenchSources = getFunction<() => void>(props.centerParams, "openWorkbenchSources")
  const uiCloseWorkbench = getFunction<() => void>(props.centerParams, "closeWorkbench")
  const closeNav = getCallback(props.navParams, "onClose")
  const closeSurface = getCallback(props.surfaceParams, "onClose")
  const closeSidebar = getCallback(props.sidebarParams, "onClose")
  const createSession = getCallback(props.navParams, "onCreate")
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

  const toggleChatCollapsed = useCallback(() => {
    setChatCollapsed((current) => {
      const next = !current
      // Collapsing the chat opens the workbench so the freed space is filled
      // instead of leaving an empty canvas.
      if (next && !surfaceOpen) props.onOpenSurface?.()
      return next
    })
    setChatRailPulse(false)
  }, [setChatCollapsed, surfaceOpen, props.onOpenSurface])

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
    if (!uiSurface || !uiIsWorkbenchOpen || !uiOpenWorkbench) return
    const ctx: DispatchContext = {
      surface: uiSurface,
      isWorkbenchOpen: uiIsWorkbenchOpen,
      openWorkbench: uiOpenWorkbench,
      openWorkbenchSources: uiOpenWorkbenchSources,
      closeWorkbench: uiCloseWorkbench,
    }
    return events.on(workspaceEvents.uiCommand, ({ command }) => {
      dispatchUiCommand(command, ctx)
    })
  }, [uiSurface, uiIsWorkbenchOpen, uiOpenWorkbench, uiOpenWorkbenchSources, uiCloseWorkbench])

  useEvent(workspaceEvents.agentData, () => {
    if (chatCollapsed) setChatRailPulse(true)
  })

  useEffect(() => {
    if (!chatCollapsed) {
      setChatRailPulse(false)
      return
    }
    if (blockers.length > 0) {
      setChatCollapsed(false)
      setChatRailPulse(false)
      scheduleComposerFocus()
    }
  }, [blockers.length, chatCollapsed, setChatCollapsed])

  // Switching to a different session re-opens the chat if it was collapsed, so
  // the newly selected conversation is visible. Skips the initial mount (only
  // reacts to an actual change of the active session id).
  const activeSessionId = props.centerParams?.sessionId as string | undefined
  const prevSessionIdRef = useRef(activeSessionId)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    prevSessionIdRef.current = activeSessionId
    if (prev !== undefined && activeSessionId !== undefined && activeSessionId !== prev && chatCollapsed) {
      setChatCollapsed(false)
    }
  }, [activeSessionId, chatCollapsed, setChatCollapsed])

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

  return (
    <div
      data-boring-workspace=""
      data-boring-workspace-part="shell"
      className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", props.className)}
    >
      <aside
        data-boring-workspace-part="session-drawer"
        data-boring-state={navOpen ? "expanded" : "collapsed"}
        aria-label="Session browser"
        aria-hidden={!navOpen}
        className={cn(
          "relative h-full min-h-0 shrink-0 overflow-hidden bg-background",
          "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          navOpen && "border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
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
            navOpen ? "opacity-100" : "opacity-0",
          )}
        >
          <PanelSlot id={navId} params={props.navParams} />
        </div>
        {navOpen ? (
          <ResizeHandle
            side="drawer-right"
            ariaLabel="Resize sessions drawer"
            onResize={(delta) => setNavWidth((w) => clamp(w + delta, 200, 360))}
          />
        ) : null}
      </aside>

      <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        <main
          data-boring-workspace-part="chat-stage"
          data-boring-state={chatCollapsed ? "collapsed" : "expanded"}
          aria-label={chatCollapsed ? "Collapsed chat" : "Chat"}
          aria-hidden={chatCollapsed}
          className={cn(
            "relative h-full min-h-0 min-w-0 overflow-hidden bg-background",
            // Animate flex-grow (not just width) so the chat slides open/closed
            // like the fixed-width nav/workbench panes instead of snapping.
            "transition-[flex-grow,flex-basis,width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            chatCollapsed
              ? "min-w-0 flex-[0_0_0px]"
              : "flex-1 border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
          )}
        >
          <div
            className={cn(
              "h-full min-h-0 overflow-hidden",
              "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              chatCollapsed ? "opacity-0" : "opacity-100",
            )}
          >
            {props.statusBanner ? (
              <div className="border-b border-[color:oklch(from_var(--border)_l_c_h/0.6)] bg-muted/40 px-4 py-2 text-sm text-foreground">
                {props.statusBanner.missing
                  ? <>Session <code className="rounded bg-background px-1 py-0.5 text-xs">{props.statusBanner.sessionId}</code> was not found in this workspace.</>
                  : <>Opening session <code className="rounded bg-background px-1 py-0.5 text-xs">{props.statusBanner.sessionId}</code>…</>}
              </div>
            ) : null}
            <PanelSlot id={centerId} params={props.centerParams} />
          </div>
          {!chatCollapsed ? (
            <IconButton
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={toggleChatCollapsed}
              className="absolute right-2 top-2 z-20"
              aria-label="Collapse chat"
              title="Collapse chat (⌘\\)"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            </IconButton>
          ) : null}
        </main>

        {surfaceConfigured ? (
          <aside
            data-boring-workspace-part="workbench"
            data-boring-state={surfaceOpen ? "expanded" : "collapsed"}
            aria-label={surfaceOpen ? "Surface" : undefined}
            aria-hidden={!surfaceOpen}
            className={cn(
              "relative h-full min-h-0 overflow-hidden bg-background",
              // When chat is collapsed the workbench grows to fill the freed
              // space (full width); otherwise it's a fixed-width side panel.
              chatCollapsed && surfaceOpen ? "min-w-0 flex-1" : "shrink-0",
              "transition-[flex-grow,flex-basis,width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              surfaceOpen && "border-l border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
            )}
            style={
              chatCollapsed && surfaceOpen
                ? { willChange: "width" }
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
                // When the chat is collapsed the workbench fills the full width
                // and the left-edge "expand chat" float button would sit on top
                // of the filetree — inset the content to leave a clear gutter.
                chatCollapsed && surfaceOpen && !navOpen && "pl-14",
              )}
            >
              {props.surfaceOverlay ? (
                <div className="relative h-full min-h-0">
                  {props.surfaceOverlay}
                  {closeSurface ? (
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={closeSurface}
                      className="absolute right-3 top-3 z-20 rounded-full bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground"
                      aria-label="Close workbench"
                      title="Close workbench (⌘2)"
                    >
                      <span aria-hidden="true">›</span>
                    </IconButton>
                  ) : null}
                </div>
              ) : <PanelSlot id={surfaceId} params={props.surfaceParams} />}
            </div>
            {surfaceOpen && !chatCollapsed ? (
              <ResizeHandle
                side="surface-left"
                ariaLabel="Resize workbench"
                onResize={(delta) => setSurfaceWidth((w) => clamp(w - delta, 480, surfaceMax))}
              />
            ) : null}
          </aside>
        ) : null}

      </div>

      {!navOpen && props.onOpenNav ? (
        <FloatingEdgeButton
          side="left"
          icon="sessions"
          onClick={props.onOpenNav}
          label="Sessions"
          hint="⌘1"
        />
      ) : null}
      {chatCollapsed ? (
        <FloatingEdgeButton
          side="left"
          icon="chat"
          onClick={toggleChatCollapsed}
          label="Expand chat"
          hint="⌘\\"
          // Anchored to the shell's left edge (not the content region) so it
          // stays pinned to the left even when the session drawer is open and
          // pushes the content rightward.
          stackIndex={1}
          pulse={chatRailPulse || blockers.length > 0}
        />
      ) : null}
      {!surfaceOpen && props.onOpenSurface ? (
        <FloatingEdgeButton
          side="right"
          icon="workbench"
          onClick={props.onOpenSurface}
          label="Workbench"
          hint="⌘2"
          bottomOffset={props.surfaceButtonBottomOffset}
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

function useViewportWidth(): number {
  const [w, setW] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1200))
  useEffect(() => {
    const onResize = () => setW(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return w
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
        "absolute top-0 bottom-0 z-20 bg-transparent",
        "transition-colors duration-200",
        "hover:bg-border/70 hover:[transition-delay:150ms]",
        "active:bg-muted-foreground/30",
        side === "drawer-right" ? "right-0" : "left-0",
      )}
    />
  )
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
  const textarea = document.querySelector<HTMLTextAreaElement>(
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
  icon: "sessions" | "workbench" | "chat"
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
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7v5l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : icon === "chat" ? (
        <span className="relative flex items-center justify-center">
          <MessageSquare className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden="true" />
          {pulse ? (
            <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-[color:var(--accent)]" aria-hidden="true" />
          ) : null}
        </span>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 7.5 A1.5 1.5 0 0 1 4.5 6 h4 l2 2 h9 A1.5 1.5 0 0 1 21 9.5 V17.5 A1.5 1.5 0 0 1 19.5 19 H4.5 A1.5 1.5 0 0 1 3 17.5 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      )}
    </IconButton>
  )
}

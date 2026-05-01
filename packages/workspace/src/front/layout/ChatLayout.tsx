import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { cn } from "../lib/utils"
import { dispatchUiCommand, type DispatchContext } from "../bridge"
import { events, workspaceEvents } from "../events"
import { useKeyboardShortcuts, type ShortcutBinding } from "../hooks/useKeyboardShortcuts"
import type { SurfaceShellApi } from "../chrome/artifact-surface/SurfaceShell"
import type { LayoutConfig, GroupConfig } from "../dock"
import { useCommandRegistry, useRegistry } from "../registry"
import type { PaneProps } from "../registry/types"
import { readStoredNumber, writeStoredNumber } from "../store/localStorageValues"
import type { ChatLayoutProps } from "./types"

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
  const surfaceConfigured = props.surface !== undefined && props.surface !== null
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
  const commandRegistry = useCommandRegistry()
  const effectiveNavWidth = clamp(navWidth, 200, 360)
  const surfaceMax = Math.max(480, Math.floor(viewport * 0.72))
  const effectiveSurfaceWidth = clamp(surfaceWidth, 480, surfaceMax)
  const uiSurface = getFunction<() => SurfaceShellApi | null>(props.centerParams, "getSurface")
  const uiIsWorkbenchOpen = getFunction<() => boolean>(props.centerParams, "isWorkbenchOpen")
  const uiOpenWorkbench = getFunction<() => void>(props.centerParams, "openWorkbench")
  const closeNav = getCallback(props.navParams, "onClose")
  const closeSurface = getCallback(props.surfaceParams, "onClose")
  const createSession = getCallback(props.navParams, "onCreate")
  const canControlNav = navOpen ? Boolean(closeNav) : Boolean(props.onOpenNav)
  const canControlSurface = surfaceOpen ? Boolean(closeSurface) : Boolean(props.onOpenSurface)
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
  const focusChat = useCallback(() => {
    if (navOpen) closeNav?.()
    if (surfaceOpen) closeSurface?.()
    focusAgentComposer()
    scheduleComposerFocus()
  }, [closeNav, closeSurface, navOpen, surfaceOpen])

  useKeyboardShortcuts({
    shortcuts: useMemo(() => {
      const shortcuts: ShortcutBinding[] = []
      if (canControlNav) {
        shortcuts.push({ key: "1", mod: true, handler: toggleNav })
      }
      if (canControlSurface) {
        shortcuts.push({ key: "2", mod: true, handler: toggleSurface })
      }
      if (centerId === "chat") {
        shortcuts.push({ key: "Escape", allowInEditable: true, handler: focusChat })
      }
      return shortcuts
    }, [canControlNav, canControlSurface, centerId, focusChat, toggleNav, toggleSurface]),
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
    canControlNav,
    canControlSurface,
    closeNav,
    closeSurface,
    createSession,
    focusChat,
    toggleNav,
    toggleSurface,
  ])

  useEffect(() => {
    if (!uiSurface || !uiIsWorkbenchOpen || !uiOpenWorkbench) return
    const ctx: DispatchContext = {
      surface: uiSurface,
      isWorkbenchOpen: uiIsWorkbenchOpen,
      openWorkbench: uiOpenWorkbench,
    }
    return events.on(workspaceEvents.uiCommand, ({ command }) => {
      dispatchUiCommand(command, ctx)
    })
  }, [uiSurface, uiIsWorkbenchOpen, uiOpenWorkbench])

  return (
    <div className={cn("relative flex h-full min-h-0 w-full overflow-hidden bg-background", props.className)}>
      <aside
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

      <main
        aria-label="Chat stage"
        className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
      >
        <PanelSlot id={centerId} params={props.centerParams} />
        {!navOpen && props.onOpenNav ? (
          <FloatingEdgeButton
            side="left"
            icon="sessions"
            onClick={props.onOpenNav}
            label="Sessions"
            hint="⌘1"
          />
        ) : null}
        {!surfaceOpen && props.onOpenSurface ? (
          <FloatingEdgeButton
            side="right"
            icon="workbench"
            onClick={props.onOpenSurface}
            label="Workbench"
            hint="⌘2"
          />
        ) : null}
      </main>

      {surfaceConfigured ? (
        <aside
          aria-label="Surface"
          aria-hidden={!surfaceOpen}
          className={cn(
            "relative h-full min-h-0 shrink-0 overflow-hidden bg-background",
            "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            surfaceOpen && "border-l border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
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
              "h-full min-h-0 overflow-hidden",
              "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              surfaceOpen ? "opacity-100" : "opacity-0",
            )}
          >
            <PanelSlot id={surfaceId} params={props.surfaceParams} />
          </div>
          {surfaceOpen ? (
            <ResizeHandle
              side="surface-left"
              ariaLabel="Resize workbench"
              onResize={(delta) => setSurfaceWidth((w) => clamp(w - delta, 480, surfaceMax))}
            />
          ) : null}
        </aside>
      ) : null}
    </div>
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

type StoredNumberUpdate = number | ((previous: number) => number)

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
    '[data-boring-chat] textarea[name="message"], textarea[name="message"]',
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
  const components = useMemo(() => registry.getComponents(), [registry])
  const Component = components[id] as ComponentType<PaneProps<Record<string, unknown> | undefined>> | undefined
  const api = useMemo(() => createPanelApi(id), [id])
  if (!Component) return null
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <Component
        params={params}
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
}: {
  side: "left" | "right"
  icon: "sessions" | "workbench"
  onClick: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
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

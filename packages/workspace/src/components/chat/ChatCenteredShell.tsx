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

export interface ChatCenteredShellProps {
  nav?: ReactNode
  topBar?: ReactNode
  drawer: ReactNode
  stage: ReactNode
  surface?: ReactNode

  /** Whether the sessions drawer is open by default on first load. Defaults to false. */
  drawerDefaultOpen?: boolean
  /** Whether the surface (workbench) is open by default on first load. Defaults to false. */
  surfaceDefaultOpen?: boolean

  drawerDefaultWidth?: number
  drawerMinWidth?: number
  drawerMaxWidth?: number

  surfaceDefaultWidth?: number
  surfaceMinWidth?: number
  surfaceMaxWidthViewportRatio?: number

  storageKey?: string
  onNewChat?: () => void
  focusComposer?: () => void
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

interface ResizeHandleProps {
  onChange: (delta: number) => void
  label: string
  disabled?: boolean
  prominent?: boolean
}

function ResizeHandle({ onChange, label, disabled, prominent }: ResizeHandleProps) {
  const startRef = useRef<number | null>(null)

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    startRef.current = e.clientX
  }, [disabled])

  const onDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startRef.current === null) return
    const delta = e.clientX - startRef.current
    startRef.current = e.clientX
    onChange(delta)
  }, [onChange])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startRef.current === null) return
    startRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={startDrag}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "relative z-[1] shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/50",
        "focus-visible:outline-none focus-visible:bg-primary/70",
        prominent ? "w-px" : "w-px",
        disabled && "pointer-events-none",
      )}
    >
      <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  )
}

export function ChatCenteredShell({
  nav,
  topBar,
  drawer,
  stage,
  surface,
  drawerDefaultOpen = false,
  surfaceDefaultOpen = false,
  drawerDefaultWidth = DEFAULTS.drawerWidth,
  drawerMinWidth = DEFAULTS.drawerMin,
  drawerMaxWidth = DEFAULTS.drawerMax,
  surfaceDefaultWidth = DEFAULTS.surfaceWidth,
  surfaceMinWidth = DEFAULTS.surfaceMin,
  surfaceMaxWidthViewportRatio = DEFAULTS.surfaceMaxRatio,
  storageKey = "boring-ui-v2:chat-centered-shell:v2",
  onNewChat,
  focusComposer,
  className,
}: ChatCenteredShellProps) {
  const [drawerOpen, setDrawerOpenRaw] = useState(() =>
    readBool(`${storageKey}:drawer`, drawerDefaultOpen),
  )
  const [surfaceOpen, setSurfaceOpenRaw] = useState(() =>
    readBool(`${storageKey}:surface`, surfaceDefaultOpen && Boolean(surface)),
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

  const focusComposerRef = useRef(focusComposer)
  focusComposerRef.current = focusComposer

  useKeyboardShortcuts({
    shortcuts: [
      { key: "1", mod: true, handler: toggleDrawer },
      { key: "2", mod: true, handler: toggleSurface },
      { key: "Escape", allowInEditable: true, handler: () => focusComposerRef.current?.() },
    ],
  })

  const onDrawerDrag = useCallback(
    (delta: number) => setDrawerWidth((w) => clamp(w + delta, drawerMinWidth, drawerMaxWidth)),
    [drawerMinWidth, drawerMaxWidth],
  )
  const onSurfaceDrag = useCallback(
    // surface sits on the right, so dragging its left handle to the LEFT should INCREASE width
    (delta: number) => setSurfaceWidth((w) => clamp(w - delta, surfaceMinWidth, surfaceMax)),
    [surfaceMinWidth, surfaceMax],
  )

  const ctx = useMemo<ChatShellContextValue>(
    () => ({
      drawerOpen,
      setDrawerOpen,
      toggleDrawer,
      surfaceOpen: surfaceOpen && Boolean(surface),
      setSurfaceOpen,
      toggleSurface,
      onNewChat,
      focusComposer,
    }),
    [
      drawerOpen,
      setDrawerOpen,
      toggleDrawer,
      surfaceOpen,
      surface,
      setSurfaceOpen,
      toggleSurface,
      onNewChat,
      focusComposer,
    ],
  )

  const showSurface = Boolean(surface) && surfaceOpen
  const effectiveSurfaceWidth = clamp(surfaceWidth, surfaceMinWidth, surfaceMax)

  return (
    <ChatShellContext.Provider value={ctx}>
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-hidden",
          "bg-[color:var(--canvas)]",
          className,
        )}
      >
        {topBar && (
          <div className="shrink-0" aria-label="App top bar">
            {topBar}
          </div>
        )}

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
              {drawer}
            </div>
          </aside>

          {/* Chat stage — floating card */}
          <main
            className="surface-chat-root relative flex min-w-0 flex-1 overflow-hidden p-3"
            aria-label="Chat stage"
          >
            {/* Accent divider — sits only above the chat card, leaving drawer + workbench borderless */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-3 top-0 h-px bg-[color:oklch(from_var(--accent)_l_c_h/0.45)]"
            />
            <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-background shadow-[0_1px_2px_-1px_oklch(0_0_0/0.04),0_8px_32px_-8px_oklch(0_0_0/0.06),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)]">
              {stage}

              <FloatingEdgeButton
                side="left"
                open={drawerOpen}
                icon="sessions"
                onClick={toggleDrawer}
                label="Sessions"
                hint="⌘1"
              />
              {Boolean(surface) && (
                <FloatingEdgeButton
                  side="right"
                  open={showSurface}
                  icon="workbench"
                  onClick={toggleSurface}
                  label="Workbench"
                  hint="⌘2"
                />
              )}
            </div>
          </main>

          {/* Workbench — flush, full-height, no shadow */}
          {Boolean(surface) && (
            <aside
              aria-label="Surface"
              aria-hidden={!showSurface}
              className={cn(
                "relative shrink-0 overflow-hidden bg-background",
                "transition-[width,min-width,max-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                showSurface &&
                  "border-l border-[color:oklch(from_var(--border)_l_c_h/0.6)]",
              )}
              style={{
                width: showSurface ? effectiveSurfaceWidth : 0,
                minWidth: showSurface ? effectiveSurfaceWidth : 0,
                maxWidth: showSurface ? effectiveSurfaceWidth : 0,
                willChange: "width",
              }}
            >
              <div
                className={cn(
                  "flex h-full min-h-0 flex-col overflow-hidden",
                  "transition-opacity duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                  showSurface ? "opacity-100" : "opacity-0",
                )}
              >
                {surface}
              </div>
            </aside>
          )}
        </div>
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

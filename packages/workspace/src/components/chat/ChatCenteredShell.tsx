"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Layers3 } from "lucide-react"
import { cn } from "../../lib/utils"
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts"
import { ChatShellContext, type ChatShellContextValue } from "./context"

export interface ChatCenteredShellProps {
  nav?: ReactNode
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
      { key: "k", mod: true, allowInEditable: true, handler: () => focusComposerRef.current?.() },
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
      <div className={cn("flex h-full min-h-0 w-full overflow-hidden bg-background", className)}>
        {nav && (
          <aside
            className="shrink-0"
            style={{ width: 60, minWidth: 60, maxWidth: 60 }}
            aria-label="Chat navigation"
          >
            {nav}
          </aside>
        )}

        {drawerOpen && (
          <>
            <aside
              className="shrink-0 bg-background"
              style={{ width: drawerWidth, minWidth: drawerWidth, maxWidth: drawerWidth }}
              aria-label="Session browser"
            >
              {drawer}
            </aside>
            <ResizeHandle label="Resize session drawer" onChange={onDrawerDrag} />
          </>
        )}

        <main className="surface-chat-root relative min-w-0 flex-1" aria-label="Chat stage">
          {stage}
        </main>

        {showSurface ? (
          <>
            <ResizeHandle label="Resize surface" onChange={onSurfaceDrag} />
            <aside
              className="workbench-surface-root shrink-0"
              style={{ width: effectiveSurfaceWidth, minWidth: effectiveSurfaceWidth, maxWidth: effectiveSurfaceWidth }}
              aria-label="Surface"
            >
              {surface}
            </aside>
          </>
        ) : (
          Boolean(surface) && (
            <aside
              className="flex shrink-0 flex-col items-center gap-2 bg-muted/40 py-2"
              style={{ width: 36, minWidth: 36, maxWidth: 36 }}
              aria-label="Workbench (collapsed)"
            >
              <button
                type="button"
                onClick={() => setSurfaceOpen(true)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md",
                  "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                aria-label="Open workbench"
                title="Open workbench (⌘2)"
              >
                <Layers3 className="h-4 w-4" />
              </button>
            </aside>
          )
        )}
      </div>
    </ChatShellContext.Provider>
  )
}

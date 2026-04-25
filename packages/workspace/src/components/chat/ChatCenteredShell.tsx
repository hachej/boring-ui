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
import { CommandPalette } from "../CommandPalette"
import type { SessionItem } from "../SessionList"
import type { DataSource } from "./WorkbenchLeftPane"
import { ChatPanel } from "@boring/agent/ui-shadcn"

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
  className,
}: ChatCenteredShellProps) {
  const [drawerOpen, setDrawerOpenRaw] = useState(() =>
    readBool(`${storageKey}:drawer`, drawerDefaultOpen),
  )
  const [surfaceOpen, setSurfaceOpenRaw] = useState(() =>
    readBool(`${storageKey}:surface`, surfaceDefaultOpen),
  )
  const [drawerWidth] = useState(() =>
    clamp(readNumber(`${storageKey}:drawerWidth`, drawerDefaultWidth), drawerMinWidth, drawerMaxWidth),
  )
  const [surfaceWidth] = useState(() =>
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

  useKeyboardShortcuts({
    shortcuts: [
      { key: "1", mod: true, handler: toggleDrawer },
      { key: "2", mod: true, handler: toggleSurface },
      { key: "Escape", allowInEditable: true, handler: focusComposer },
    ],
  })

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
          className="h-full min-h-0"
        />
      )
    }
    return <ChatStagePlaceholder ref={stageRef} />
  }, [stage, activeSessionId])

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
                storageKey={surfaceStorageKey}
              />
            </div>
          </aside>
        </div>

        {withCommandPalette && <CommandPalette />}
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

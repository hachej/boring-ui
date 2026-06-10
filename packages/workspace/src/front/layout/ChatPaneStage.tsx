import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import "../dock/dockview-overrides.css"
import "./chat-pane-stage.css"
import { Plus, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"

export interface ChatPaneDescriptor {
  id: string
  title?: string | null
  panel?: string
  params?: Record<string, unknown>
}

export interface ChatPaneStageProps {
  panes: ChatPaneDescriptor[]
  activePaneId?: string | null
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
  onActivePaneChange?: (id: string) => void
  onClosePane?: (id: string) => void
  onCreatePaneAfter?: (id: string) => void
  /**
   * Pane to flash with a brief highlight ring — feedback when an action
   * targets a pane that is already visible (e.g. "open as pane" on an open
   * session). The parent clears it after a beat; the fade-out is CSS.
   */
  flashPaneId?: string | null
  /**
   * Persist the dockview layout (splits, sizes, tab grouping) under
   * `${storageKey}:chatPaneLayout`. Restored only when the stored layout
   * holds exactly the current pane ids; otherwise panes lay out as a row.
   */
  storageKey?: string
}

const CHAT_PANE_COMPONENT = "chat-pane"
const PANE_MIN_WIDTH = 280
const PERSIST_DEBOUNCE_MS = 300

interface StageContextValue {
  panes: ChatPaneDescriptor[]
  activePaneId: string | null
  flashPaneId: string | null
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
  onActivePaneChange?: (id: string) => void
  onClosePane?: (id: string) => void
}

const StageContext = createContext<StageContextValue | null>(null)

function paneTitle(pane: { title?: string | null }): string {
  return pane.title || "Untitled"
}

function layoutStorageKey(storageKey: string): string {
  return `${storageKey}:chatPaneLayout`
}

interface SerializedDockLayout {
  grid?: unknown
  panels?: Record<string, unknown>
}

function readStoredLayout(storageKey: string, paneIds: string[]): SerializedDockLayout | null {
  try {
    const raw = globalThis.localStorage?.getItem(layoutStorageKey(storageKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SerializedDockLayout
    const storedIds = Object.keys(parsed.panels ?? {})
    if (storedIds.length !== paneIds.length) return null
    const wanted = new Set(paneIds)
    if (!storedIds.every((id) => wanted.has(id))) return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredLayout(storageKey: string, layout: unknown): void {
  try {
    globalThis.localStorage?.setItem(layoutStorageKey(storageKey), JSON.stringify(layout))
  } catch {
    // Best-effort persistence only.
  }
}

function addChatPanel(
  api: DockviewApi,
  pane: ChatPaneDescriptor,
  position: Parameters<DockviewApi["addPanel"]>[0]["position"],
): void {
  const panel = api.addPanel({
    id: pane.id,
    component: CHAT_PANE_COMPONENT,
    title: paneTitle(pane),
    params: { paneId: pane.id },
    position,
  })
  panel.group?.api.setConstraints({ minimumWidth: PANE_MIN_WIDTH })
}

/**
 * Project the authoritative pane list onto the dockview layout: remove
 * panels whose session pane closed, add new ones next to their list
 * neighbour, keep titles fresh, and align the active panel. Geometry that
 * the user arranged (splits, sizes, tab grouping) is dockview's to keep.
 */
function syncPanesToDock(
  api: DockviewApi,
  panes: ChatPaneDescriptor[],
  activePaneId: string | null,
): void {
  const wanted = new Map(panes.map((pane) => [pane.id, pane]))
  for (const panel of [...api.panels]) {
    if (!wanted.has(panel.id)) api.removePanel(panel)
  }
  panes.forEach((pane, index) => {
    if (api.getPanel(pane.id)) return
    const before = index > 0 ? api.getPanel(panes[index - 1].id) : undefined
    const after = !before && index + 1 < panes.length ? api.getPanel(panes[index + 1].id) : undefined
    addChatPanel(
      api,
      pane,
      before
        ? { referencePanel: before, direction: "right" }
        : after
          ? { referencePanel: after, direction: "left" }
          : undefined,
    )
  })
  for (const pane of panes) {
    const panel = api.getPanel(pane.id)
    if (panel && panel.title !== paneTitle(pane)) panel.api.setTitle(paneTitle(pane))
  }
  if (activePaneId) {
    const panel = api.getPanel(activePaneId)
    if (panel && api.activePanel?.id !== activePaneId) panel.api.setActive()
  }
}

export function ChatPaneStage({
  panes,
  activePaneId,
  renderPane,
  onActivePaneChange,
  onClosePane,
  onCreatePaneAfter,
  flashPaneId,
  storageKey,
}: ChatPaneStageProps) {
  const apiRef = useRef<DockviewApi | null>(null)
  // True while this component mutates dockview itself; dockview activation
  // events fired during programmatic sync must not echo back to the parent.
  const syncingRef = useRef(false)
  const disposeRef = useRef<(() => void) | null>(null)

  const latestRef = useRef({ panes, activePaneId: activePaneId ?? null, onActivePaneChange, storageKey })
  latestRef.current = { panes, activePaneId: activePaneId ?? null, onActivePaneChange, storageKey }

  const resolvedActiveId = activePaneId ?? panes[0]?.id ?? null

  const contextValue = useMemo<StageContextValue>(() => ({
    panes,
    activePaneId: resolvedActiveId,
    flashPaneId: flashPaneId ?? null,
    renderPane,
    onActivePaneChange,
    onClosePane: panes.length > 1 ? onClosePane : undefined,
  }), [panes, resolvedActiveId, flashPaneId, renderPane, onActivePaneChange, onClosePane])

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api
    apiRef.current = api
    const { panes: currentPanes, activePaneId: currentActive, storageKey: currentKey } = latestRef.current

    syncingRef.current = true
    try {
      const stored = currentKey ? readStoredLayout(currentKey, currentPanes.map((pane) => pane.id)) : null
      if (stored) {
        try {
          api.fromJSON(stored as Parameters<DockviewApi["fromJSON"]>[0])
        } catch {
          // A stale/incompatible layout must never block the chat stage.
        }
      }
      syncPanesToDock(api, currentPanes, currentActive)
    } finally {
      syncingRef.current = false
    }

    const activeDisposable = api.onDidActivePanelChange((panel) => {
      if (syncingRef.current) return
      const id = panel?.id
      if (id && id !== latestRef.current.activePaneId) {
        latestRef.current.onActivePaneChange?.(id)
      }
    })

    let persistTimer: ReturnType<typeof setTimeout> | null = null
    const layoutDisposable = api.onDidLayoutChange(() => {
      const key = latestRef.current.storageKey
      if (!key) return
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => writeStoredLayout(key, api.toJSON()), PERSIST_DEBOUNCE_MS)
    })

    disposeRef.current = () => {
      if (persistTimer) clearTimeout(persistTimer)
      activeDisposable.dispose()
      layoutDisposable.dispose()
    }
  }, [])

  useEffect(() => () => disposeRef.current?.(), [])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    syncingRef.current = true
    try {
      syncPanesToDock(api, panes, resolvedActiveId)
    } finally {
      syncingRef.current = false
    }
  }, [panes, resolvedActiveId])

  if (panes.length === 0) return null

  return (
    <StageContext.Provider value={contextValue}>
      <div
        data-boring-workspace-part="chat-pane-stage"
        className="relative h-full min-h-0 w-full bg-background"
      >
        <DockviewReact
          className="dv-shell dv-chat-stage h-full"
          components={STAGE_COMPONENTS}
          defaultTabComponent={ChatPaneTab as React.FunctionComponent<IDockviewPanelHeaderProps>}
          onReady={handleReady}
        />
        {onCreatePaneAfter ? (
          // Floating create control on the stage's right edge, one floating
          // control slot above center — the shell's Workbench toggle owns
          // the centered right-edge position.
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            data-boring-workspace-part="chat-pane-control"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              const targetId = latestRef.current.activePaneId ?? panes[panes.length - 1]?.id
              if (targetId) onCreatePaneAfter(targetId)
            }}
            aria-label="New chat to the right"
            title="New chat to the right"
            className={cn(
              "absolute right-2 top-1/2 z-30 h-8 w-8 -translate-y-[calc(50%+44px)] rounded-full bg-background text-muted-foreground",
              "shadow-[0_0_0_1px_oklch(from_var(--border)_l_c_h/0.8),0_6px_18px_-12px_oklch(0_0_0/0.45)]",
              "hover:bg-muted hover:text-foreground",
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </div>
    </StageContext.Provider>
  )
}

function useStage(): StageContextValue {
  const value = useContext(StageContext)
  if (!value) throw new Error("Chat pane components must render inside ChatPaneStage")
  return value
}

function ChatPanePanel(props: IDockviewPanelProps) {
  const stage = useStage()
  const paneId = typeof (props.params as { paneId?: unknown })?.paneId === "string"
    ? (props.params as { paneId: string }).paneId
    : props.api.id
  const pane = stage.panes.find((candidate) => candidate.id === paneId)
  if (!pane) return null

  const active = paneId === stage.activePaneId
  const multiPane = stage.panes.length > 1
  const flash = paneId === stage.flashPaneId
  return (
    <div
      data-boring-workspace-part="chat-pane"
      data-boring-state={active ? "active" : "inactive"}
      aria-label={`Chat session ${paneTitle(pane)}`}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        "transition-[box-shadow] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        // The focus frame only carries meaning when there is more than one
        // pane: a neutral 1px inset ring that reads like editor keyboard
        // focus — obvious when scanning, quiet when reading.
        multiPane && active
          && "shadow-[inset_0_0_0_1px_oklch(from_var(--foreground)_l_c_h/0.45)]",
        flash && "shadow-[inset_0_0_0_2px_oklch(from_var(--foreground)_l_c_h/0.6)]",
      )}
      onMouseDown={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null
        if (target?.closest('[data-boring-workspace-part="chat-pane-control"]')) return
        stage.onActivePaneChange?.(paneId)
      }}
      onFocusCapture={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null
        if (target?.closest('[data-boring-workspace-part="chat-pane-control"]')) return
        stage.onActivePaneChange?.(paneId)
      }}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        {stage.renderPane(pane)}
      </div>
    </div>
  )
}

const STAGE_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  [CHAT_PANE_COMPONENT]: ChatPanePanel,
}

function ChatPaneTab(props: IDockviewPanelHeaderProps) {
  const stage = useStage()
  const { api } = props
  const [title, setTitle] = useState(api.title ?? api.id)

  useEffect(() => {
    const sync = () => setTitle(api.title ?? api.id)
    sync()
    const sub = api.onDidTitleChange?.(sync)
    return () => sub?.dispose?.()
  }, [api])

  const canClose = Boolean(stage.onClosePane)
  return (
    <div
      className="group relative flex h-full w-full min-w-0 select-none items-center gap-1.5 px-2.5 text-[12px] font-medium leading-none tracking-tight"
      title={title}
    >
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground/70">
        {title}
      </span>
      {canClose ? (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          data-boring-workspace-part="chat-pane-control"
          className="h-5 w-5 shrink-0 text-muted-foreground/80 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [.dv-active-tab_&]:opacity-55 [.dv-active-tab_&]:hover:opacity-100"
          // Dockview activates a panel from a NATIVE pointerdown listener on
          // the tab wrapper (an ancestor of this button). React's capture
          // handlers run at root-capture, before that bubble listener — stop
          // the native event there so closing a pane never activates it.
          onPointerDownCapture={(event) => event.nativeEvent.stopPropagation()}
          onMouseDownCapture={(event) => event.nativeEvent.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            stage.onClosePane?.(api.id)
          }}
          aria-label={`Close ${title} pane`}
        >
          <X className="h-3 w-3" strokeWidth={2.25} />
        </IconButton>
      ) : null}
    </div>
  )
}

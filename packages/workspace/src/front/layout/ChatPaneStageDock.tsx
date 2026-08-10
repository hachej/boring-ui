import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import "../dock/dockview-overrides.css"
import "./chat-pane-stage.css"
import { GripVertical, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from "lucide-react"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, Input } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"
import { CornerChromeButton } from "./cornerChrome"
import { WorkspaceTranscriptLoadingSurface } from "../components/WorkspaceLoadingState"
import { CHAT_SESSION_DRAG_TYPE, dispatchChatSessionDragPayload, PaneFocusRing, paneTitle, type ChatPaneDescriptor, type ChatPaneStageProps } from "./ChatPaneStage"
import { workspaceSessionKey } from "../sessionIdentity"

type ChatPaneStageDockProps = ChatPaneStageProps

const CHAT_PANE_COMPONENT = "chat-pane"
const PANE_MIN_WIDTH = 280
const PERSIST_DEBOUNCE_MS = 300
const SINGLE_PANE_LOADING_MIN_MS = 120

export function readablePaneTitle(title: string | undefined, id: string | undefined): string {
  const trimmed = title?.trim()
  const isMachineId = trimmed === id
    || Boolean(trimmed && /(?:^|::)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(trimmed))
  return trimmed && !isMachineId ? trimmed : "New chat"
}

interface StageContextValue {
  panes: ChatPaneDescriptor[]
  activePaneId: string | null
  flashPaneId: string | null
  renderPane: ChatPaneStageProps["renderPane"]
  topActions?: ChatPaneStageProps["topActions"]
  sessionActions?: ChatPaneStageProps["sessionActions"]
  onSplitPane?: ChatPaneStageProps["onSplitPane"]
  splitPending: boolean
  onActivePaneChange?: (id: string) => void
  onClosePane?: (id: string) => void
}

const StageContext = createContext<StageContextValue | null>(null)

function layoutStorageKey(storageKey: string): string {
  return `${storageKey}:chatPaneLayout`
}

type DropDirection = "left" | "right" | "above" | "below" | "within"

interface PendingPlacement {
  referencePanelId: string | null
  direction: DropDirection
}

function dropPositionToDirection(position: string): DropDirection {
  switch (position) {
    case "left": return "left"
    case "right": return "right"
    case "top": return "above"
    case "bottom": return "below"
    default: return "within"
  }
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
 * Project the authoritative pane list onto the dockview layout: reuse the
 * slot of a swapped-out pane for its replacement, add genuinely-new panes
 * next to their list neighbour, keep titles fresh, and align the active
 * panel. Geometry that the user arranged (splits, sizes, orientation) is
 * dockview's to keep.
 */
function syncPanesToDock(
  api: DockviewApi,
  panes: ChatPaneDescriptor[],
  activePaneId: string | null,
  pendingPlacements?: Map<string, PendingPlacement>,
): void {
  const wanted = new Map(panes.map((pane) => [pane.id, pane]))
  // Panels whose session closed or was swapped out. We add replacements
  // BEFORE removing these, so a swap can inherit the freed slot's exact
  // position (a session switch must not reflow a vertical/custom split into
  // the default side-by-side).
  const removable = [...api.panels].filter((panel) => !wanted.has(panel.id))
  const freed = [...removable]
  panes.forEach((pane, index) => {
    if (api.getPanel(pane.id)) {
      pendingPlacements?.delete(pane.id)
      return
    }
    const placement = pendingPlacements?.get(pane.id)
    if (placement) {
      pendingPlacements?.delete(pane.id)
      const reference = placement.referencePanelId ? api.getPanel(placement.referencePanelId) : undefined
      addChatPanel(
        api,
        pane,
        reference
          ? { referencePanel: reference, direction: placement.direction }
          : { direction: placement.direction === "within" ? "right" : placement.direction },
      )
      return
    }
    // A session swap removes one pane and adds another. Drop the new pane
    // INTO the removed pane's group (it's still present here) so it takes
    // over that exact slot — vertical/custom arrangements stay intact.
    const slot = freed.shift()
    if (slot) {
      addChatPanel(api, pane, { referencePanel: slot, direction: "within" })
      return
    }
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
  // Slots have been inherited; drop the swapped-out / closed panels now.
  for (const panel of removable) api.removePanel(panel)
  for (const pane of panes) {
    const panel = api.getPanel(pane.id)
    if (panel && panel.title !== paneTitle(pane)) panel.api.setTitle(paneTitle(pane))
  }
  if (activePaneId) {
    const panel = api.getPanel(activePaneId)
    if (panel && api.activePanel?.id !== activePaneId) panel.api.setActive()
  }
}

/** Dockview-backed chat stage: drag pane headers to split in any direction. */
export function ChatPaneStageDock({
  panes,
  activePaneId,
  renderPane,
  topActions,
  sessionActions,
  onSplitPane,
  splitPending = false,
  pendingPanePlacement,
  onPendingPanePlacementConsumed,
  onActivePaneChange,
  onClosePane,
  flashPaneId,
  storageKey,
  onDropSession,
}: ChatPaneStageDockProps) {
  const apiRef = useRef<DockviewApi | null>(null)
  const [readySinglePaneId, setReadySinglePaneId] = useState<string | null>(null)
  const singlePaneReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True while this component mutates dockview itself; dockview activation
  // events fired during programmatic sync must not echo back to the parent.
  const syncingRef = useRef(false)
  const disposeRef = useRef<(() => void) | null>(null)
  // Drop placements recorded by onDidDrop, consumed by the next pane sync
  // so a dropped session's panel appears where it was dropped.
  const pendingPlacementsRef = useRef(new Map<string, PendingPlacement>())

  const latestRef = useRef({ panes, activePaneId: activePaneId ?? null, onActivePaneChange, onDropSession, pendingPanePlacement, onPendingPanePlacementConsumed, storageKey })
  latestRef.current = { panes, activePaneId: activePaneId ?? null, onActivePaneChange, onDropSession, pendingPanePlacement, onPendingPanePlacementConsumed, storageKey }

  const resolvedActiveId = activePaneId ?? panes[0]?.id ?? null

  const contextValue = useMemo<StageContextValue>(() => ({
    panes,
    activePaneId: resolvedActiveId,
    flashPaneId: flashPaneId ?? null,
    renderPane,
    topActions,
    sessionActions,
    onSplitPane,
    splitPending,
    onActivePaneChange,
    onClosePane,
  }), [panes, resolvedActiveId, flashPaneId, renderPane, topActions, sessionActions, onSplitPane, splitPending, onActivePaneChange, onClosePane])

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api
    apiRef.current = api
    const { panes: currentPanes, activePaneId: currentActive, pendingPanePlacement: currentPendingPlacement, storageKey: currentKey } = latestRef.current

    if (currentPendingPlacement) {
      pendingPlacementsRef.current.set(currentPendingPlacement.paneId, {
        referencePanelId: currentPendingPlacement.referencePaneId,
        direction: currentPendingPlacement.direction,
      })
    }

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
      syncPanesToDock(api, currentPanes, currentActive, pendingPlacementsRef.current)
      if (currentPendingPlacement && api.getPanel(currentPendingPlacement.paneId)) {
        latestRef.current.onPendingPanePlacementConsumed?.(currentPendingPlacement.paneId)
      }
      if (singlePaneReadyTimerRef.current) clearTimeout(singlePaneReadyTimerRef.current)
      if (currentPanes.length === 1) {
        const readyPaneId = currentPanes[0].id
        singlePaneReadyTimerRef.current = setTimeout(() => {
          singlePaneReadyTimerRef.current = null
          setReadySinglePaneId(readyPaneId)
        }, SINGLE_PANE_LOADING_MIN_MS)
      } else {
        singlePaneReadyTimerRef.current = null
        setReadySinglePaneId(null)
      }
    } finally {
      syncingRef.current = false
    }

    const activeDisposable = api.onDidActivePanelChange((event) => {
      if (syncingRef.current) return
      const id = event.panel?.id
      if (id && id !== latestRef.current.activePaneId) {
        latestRef.current.onActivePaneChange?.(id)
      }
    })

    // Panes split, they don't stack: veto tab-strip and center drops so a
    // drag can only dock to pane edges.
    const overlayDisposable = api.onWillShowOverlay((overlayEvent) => {
      if (overlayEvent.kind === "tab" || overlayEvent.kind === "header_space") {
        overlayEvent.preventDefault()
        return
      }
      if (overlayEvent.kind === "content" && overlayEvent.position === "center") {
        overlayEvent.preventDefault()
      }
    })

    // Accept session rows dragged in from outside the dock (the session
    // browser). The drop opens the session as a pane at the drop position.
    const dragOverDisposable = api.onUnhandledDragOver((dragEvent) => {
      const nativeEvent = dragEvent.nativeEvent
      const types = nativeEvent instanceof DragEvent ? nativeEvent.dataTransfer?.types : undefined
      if (types && Array.from(types).includes(CHAT_SESSION_DRAG_TYPE)) dragEvent.accept()
    })
    const dropDisposable = api.onDidDrop((dropEvent) => {
      const nativeEvent = dropEvent.nativeEvent
      const payload = nativeEvent instanceof DragEvent ? nativeEvent.dataTransfer?.getData(CHAT_SESSION_DRAG_TYPE) : undefined
      const session = payload
        ? dispatchChatSessionDragPayload(payload, latestRef.current.onDropSession)
        : null
      if (!session) return
      pendingPlacementsRef.current.set(workspaceSessionKey(session.sessionId, session.agentTypeId), {
        referencePanelId: dropEvent.group?.activePanel?.id ?? null,
        direction: dropPositionToDirection(dropEvent.position),
      })
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
      overlayDisposable.dispose()
      dragOverDisposable.dispose()
      dropDisposable.dispose()
      layoutDisposable.dispose()
    }
  }, [])

  useEffect(() => () => {
    disposeRef.current?.()
    if (singlePaneReadyTimerRef.current) clearTimeout(singlePaneReadyTimerRef.current)
  }, [])

  useEffect(() => {
    if (!pendingPanePlacement) return
    pendingPlacementsRef.current.set(pendingPanePlacement.paneId, {
      referencePanelId: pendingPanePlacement.referencePaneId,
      direction: pendingPanePlacement.direction,
    })
  }, [pendingPanePlacement])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    syncingRef.current = true
    try {
      syncPanesToDock(api, panes, resolvedActiveId, pendingPlacementsRef.current)
      if (pendingPanePlacement && api.getPanel(pendingPanePlacement.paneId)) {
        onPendingPanePlacementConsumed?.(pendingPanePlacement.paneId)
      }
    } finally {
      syncingRef.current = false
    }
  }, [panes, resolvedActiveId, pendingPanePlacement, onPendingPanePlacementConsumed])

  if (panes.length === 0) return null
  const singlePaneTransitioning = panes.length === 1 && readySinglePaneId !== panes[0].id

  return (
    <StageContext.Provider value={contextValue}>
      <div
        data-boring-workspace-part="chat-pane-stage"
        data-multi-pane={panes.length > 1 ? "true" : "false"}
        className="relative h-full min-h-0 w-full bg-background"
      >
        <DockviewReact
          key={panes.length === 1 ? panes[0].id : "multi-pane"}
          className="dv-shell dv-chat-stage h-full"
          components={STAGE_COMPONENTS}
          defaultTabComponent={ChatPaneHeader as React.FunctionComponent<IDockviewPanelHeaderProps>}
          rightHeaderActionsComponent={ChatPaneHeaderActions}
          // Render the active chat directly in its visible group. Dockview's
          // overlay renderer can strand a replacement panel hidden after a
          // one-pane session switch, leaving the titled stage empty.
          defaultRenderer="onlyWhenVisible"
          // Groups always hold exactly one pane (center drops are vetoed),
          // so the single header stretches across the full group width and
          // reads as a flat pane header, not a tab.
          singleTabMode="fullwidth"
          onReady={handleReady}
        />
        {singlePaneTransitioning ? (
          <div
            className="absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-background"
            role="status"
            aria-live="polite"
            aria-busy="true"
            aria-label="Loading chat"
            data-boring-workspace-part="chat-pane-loading-surface"
          >
            <WorkspaceTranscriptLoadingSurface />
          </div>
        ) : null}
      </div>
    </StageContext.Provider>
  )
}

function useStage(): StageContextValue {
  const value = useContext(StageContext)
  if (!value) throw new Error("Chat pane components must render inside ChatPaneStageDock")
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
  const flash = paneId === stage.flashPaneId
  return (
    <div
      data-boring-workspace-part="chat-pane"
      data-boring-state={active ? "active" : "inactive"}
      aria-label={`Chat session ${paneTitle(pane)}`}
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
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
      {/* The active ring lives at the dockview group level (CSS) so it wraps
          the header too; this inner ring only serves the flash pulse. */}
      <PaneFocusRing active={false} dimmed={false} flash={flash} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {stage.renderPane(pane)}
      </div>
    </div>
  )
}

const STAGE_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  [CHAT_PANE_COMPONENT]: ChatPanePanel,
}


function SplitVerticalIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M8 3v10" />
    </svg>
  )
}

function SplitHorizontalIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 8h11" />
    </svg>
  )
}

/**
 * Flat pane header — not a tab. The whole bar is dockview's drag handle;
 * the grip is the visual affordance for it, the X closes the view.
 */
function ChatPaneHeader(props: IDockviewPanelHeaderProps) {
  const stage = useStage()
  const { api } = props
  const [title, setTitle] = useState(() => readablePaneTitle(api.title, api.id))

  useEffect(() => {
    const sync = () => setTitle(readablePaneTitle(api.title, api.id))
    sync()
    const sub = api.onDidTitleChange?.(sync)
    return () => sub?.dispose?.()
  }, [api])

  // With a single pane there is nothing to move — show a plain title.
  const multiPane = stage.panes.length > 1
  // Who owns this chat. The host omits it for single-Agent workspaces, so the
  // header degrades to exactly what it was before.
  const agentLabel = stage.panes.find((candidate) => candidate.id === api.id)?.agentLabel
  return (
    <div
      data-boring-workspace-part="chat-pane-title"
      className={cn(
        "group flex h-full min-w-0 select-none items-center gap-2 px-3 text-[13px] font-medium leading-none tracking-[-0.01em]",
        multiPane && "cursor-grab active:cursor-grabbing",
      )}
      title={agentLabel ? `${title} — ${agentLabel}` : title}
    >
      {multiPane ? (
        <GripVertical
          aria-hidden="true"
          data-boring-workspace-part="chat-pane-grip"
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
          strokeWidth={1.75}
        />
      ) : null}
      <span className="min-w-0 max-w-[min(340px,45vw)] shrink-[2] overflow-hidden text-ellipsis whitespace-nowrap text-foreground/90">
        {title}
      </span>
      {agentLabel ? (
        // Secondary, never competing with the title: the same quiet 11px
        // provenance label the pinned-chat rows use. It shrinks and truncates
        // so it can never push the split/close controls out of the header.
        <span
          data-boring-workspace-part="chat-pane-agent"
          // No hard width cap: a tab is sized to its content, so a percentage
          // ceiling clipped "Concierge" to "Concier…" beside a four-character
          // title at 1440px with room to spare. `min-w-0` + `shrink` already
          // guarantee the label yields under pressure, and the title's
          // `shrink-[2]` makes it yield twice as fast — so the title still
          // truncates first and the label can never push the controls out.
          className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-none text-muted-foreground"
        >
          {agentLabel}
        </span>
      ) : null}
    </div>
  )
}

function ChatPaneSessionMenu({ paneId, title, actions }: {
  paneId: string
  title: string
  actions: NonNullable<ChatPaneStageProps["sessionActions"]>
}) {
  const pinned = actions.isPinned(paneId)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState(title)
  const rename = () => {
    const next = renameDraft.trim()
    if (!actions.onRename || !next || next === title) return setRenameOpen(false)
    void Promise.resolve(actions.onRename(paneId, next)).then(() => setRenameOpen(false))
  }
  const remove = () => {
    if (!actions.onDelete || typeof window === "undefined") return
    if (window.confirm(`Delete “${title}”?`)) void actions.onDelete(paneId)
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          className="border border-transparent bg-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          aria-label={`Chat actions for ${title}`}
          title={`Chat actions for ${title}`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-48">
        <DropdownMenuItem onSelect={() => actions.onTogglePin(paneId)}>
          {pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
          {pinned ? "Unpin chat" : "Pin chat"}
        </DropdownMenuItem>
        {actions.onRename ? (
          <DropdownMenuItem onSelect={() => { setRenameDraft(title); setRenameOpen(true) }}>
            <Pencil className="mr-2 h-4 w-4" />
            Rename chat
          </DropdownMenuItem>
        ) : null}
        {actions.onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={remove} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete chat
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
          <DialogDescription>Choose a concise name for this conversation.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); rename() }}>
          <Input
            autoFocus
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            aria-label="Chat name"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!renameDraft.trim()}>Rename</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}

/** Interactive controls live beside Dockview's tab, never inside role="tab". */
function ChatPaneHeaderActions({ activePanel }: IDockviewHeaderActionsProps) {
  const stage = useStage()
  const api = activePanel?.api
  const [title, setTitle] = useState(() => readablePaneTitle(api?.title, api?.id))

  useEffect(() => {
    if (!api) return
    const sync = () => setTitle(readablePaneTitle(api.title, api.id))
    sync()
    const sub = api.onDidTitleChange?.(sync)
    return () => sub?.dispose?.()
  }, [api])

  if (!api) return null
  return (
      <div data-boring-workspace-part="chat-pane-actions" className="pointer-events-auto flex h-full min-w-0 flex-1 items-center gap-1 pr-2">
        {stage.sessionActions ? (
          <ChatPaneSessionMenu paneId={api.id} title={title} actions={stage.sessionActions} />
        ) : null}
        {stage.onSplitPane ? (
          <div data-boring-workspace-part="chat-pane-split-controls" className="ml-auto flex shrink-0 items-center gap-1">
            <CornerChromeButton
              label={`Split ${title} chat vertically`}
              appearance="chat"
              onClick={() => stage.onSplitPane?.(api.id, "right")}
              disabled={stage.splitPending}
            >
              <SplitVerticalIcon />
            </CornerChromeButton>
            <CornerChromeButton
              label={`Split ${title} chat horizontally`}
              appearance="chat"
              onClick={() => stage.onSplitPane?.(api.id, "below")}
              disabled={stage.splitPending}
            >
              <SplitHorizontalIcon />
            </CornerChromeButton>
          </div>
        ) : null}
        {stage.topActions && api.id === stage.activePaneId ? (
          <div data-boring-workspace-part="chat-pane-top-actions" className="flex shrink-0 items-center gap-1">
            {stage.topActions}
          </div>
        ) : null}
        {stage.onClosePane && stage.panes.length > 1 ? (
          <CornerChromeButton
            label={`Close ${title} pane`}
            appearance="chat"
            disabled={stage.splitPending}
            onClick={() => stage.onClosePane?.(api.id)}
          >
            <X className="h-3 w-3" strokeWidth={2.25} />
          </CornerChromeButton>
        ) : null}
      </div>
  )
}

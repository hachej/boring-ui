import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
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
}

export function ChatPaneStage({
  panes,
  activePaneId,
  renderPane,
  onActivePaneChange,
  onClosePane,
  onCreatePaneAfter,
  flashPaneId,
}: ChatPaneStageProps) {
  // Panes present on the stage's first render must not play the enter
  // animation (a page load would animate every pane in from zero width).
  const stageMountedRef = useRef(false)
  useEffect(() => {
    stageMountedRef.current = true
  }, [])

  if (panes.length === 0) return null

  const lastPane = panes[panes.length - 1]

  return (
    <div
      data-boring-workspace-part="chat-pane-stage"
      className="relative flex h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-background"
    >
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 ? (
            <PaneDivider
              onCreate={
                onCreatePaneAfter
                  ? () => onCreatePaneAfter(panes[index - 1].id)
                  : undefined
              }
            />
          ) : null}
          <ChatPane
            pane={pane}
            active={pane.id === activePaneId || (!activePaneId && index === 0)}
            flash={pane.id === flashPaneId}
            multiPane={panes.length > 1}
            animateIn={stageMountedRef.current}
            renderPane={renderPane}
            onActivePaneChange={onActivePaneChange}
            onClosePane={onClosePane}
          />
        </Fragment>
      ))}
      {onCreatePaneAfter ? (
        // Zero-width in-flow slot so the trailing "+" hugs the stage's right
        // edge without being clipped by pane overflow. Lifted one floating
        // control slot above center — the shell's Workbench toggle owns the
        // centered right-edge position.
        <div className="relative z-30 w-0 shrink-0 self-stretch">
          <CreatePaneButton
            className="absolute right-2 top-1/2 -translate-y-[calc(50%+44px)]"
            onCreate={() => onCreatePaneAfter(lastPane.id)}
          />
        </div>
      ) : null}
    </div>
  )
}

function ChatPane({
  pane,
  active,
  flash,
  multiPane,
  animateIn,
  renderPane,
  onActivePaneChange,
  onClosePane,
}: {
  pane: ChatPaneDescriptor
  active: boolean
  flash: boolean
  multiPane: boolean
  animateIn: boolean
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
  onActivePaneChange?: (id: string) => void
  onClosePane?: (id: string) => void
}) {
  // Enter animation: start collapsed, expand to the normal flex basis on the
  // next frame. Panes restored on initial load mount at full size directly.
  const [entered, setEntered] = useState(!animateIn)
  useEffect(() => {
    if (entered) return
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [entered])

  const title = pane.title || "Untitled"
  return (
    <div
      data-boring-workspace-part="chat-pane"
      data-boring-state={active ? "active" : "inactive"}
      aria-label={`Chat session ${title}`}
      className={cn(
        "group/chat-pane relative flex h-full flex-col overflow-hidden bg-background",
        "transition-[flex-grow,flex-basis,min-width,box-shadow] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        entered ? "min-w-[350px] flex-[1_0_350px]" : "min-w-0 flex-[0_0_0px]",
        // The focus frame only carries meaning when there is more than one
        // pane: a neutral 1px inset ring that reads like editor keyboard
        // focus — obvious when scanning, quiet when reading.
        multiPane && active
          && "shadow-[inset_0_0_0_1px_oklch(from_var(--foreground)_l_c_h/0.45)]",
        flash && "shadow-[inset_0_0_0_2px_oklch(from_var(--foreground)_l_c_h/0.6)]",
      )}
      onMouseDown={() => onActivePaneChange?.(pane.id)}
      onFocusCapture={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null
        if (target?.closest('[data-boring-workspace-part="chat-pane-control"]')) return
        onActivePaneChange?.(pane.id)
      }}
    >
      <div
        data-boring-workspace-part="chat-pane-header"
        className={cn(
          "flex h-8 shrink-0 items-center justify-between border-b border-border/55 px-2",
          multiPane && active ? "bg-muted/60" : "bg-background",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5 px-1">
          <span
            className={cn(
              "truncate text-[12px] font-medium",
              !multiPane || active ? "text-foreground/70" : "text-foreground/40",
            )}
          >
            {title}
          </span>
        </div>
        {multiPane ? (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            data-boring-workspace-part="chat-pane-control"
            className="text-muted-foreground hover:text-foreground"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onClosePane?.(pane.id)
            }}
            aria-label={`Close ${title} pane`}
            title="Close pane"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {renderPane(pane)}
      </div>
    </div>
  )
}

function PaneDivider({ onCreate }: { onCreate?: () => void }) {
  return (
    <div
      data-boring-workspace-part="chat-pane-divider"
      // Zero-ish-width in-flow slot: the "+" straddles the divider line
      // without living inside a pane's overflow-hidden box.
      className="relative z-30 w-px shrink-0 self-stretch bg-[color:oklch(from_var(--border)_l_c_h/0.7)]"
    >
      {onCreate ? (
        <CreatePaneButton
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          onCreate={onCreate}
        />
      ) : null}
    </div>
  )
}

function CreatePaneButton({
  onCreate,
  className,
}: {
  onCreate: () => void
  className?: string
}) {
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      data-boring-workspace-part="chat-pane-control"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onCreate()
      }}
      aria-label="New chat to the right"
      title="New chat to the right"
      className={cn(
        "h-8 w-8 rounded-full bg-background text-muted-foreground",
        "shadow-[0_0_0_1px_oklch(from_var(--border)_l_c_h/0.8),0_6px_18px_-12px_oklch(0_0_0/0.45)]",
        "hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Plus className="h-4 w-4" strokeWidth={1.75} />
    </IconButton>
  )
}

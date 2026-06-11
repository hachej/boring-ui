import { Fragment, useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../lib/utils"
import { ControlTooltip } from "../components/ControlTooltip"
import { PaneFocusRing, paneTitle, type ChatPaneDescriptor, type ChatPaneStageProps } from "./ChatPaneStage"

type ChatPaneStageFlexProps = Omit<ChatPaneStageProps, "engine">

/** Default chat stage: a single row of vertical splits, no drag. */
export function ChatPaneStageFlex({
  panes,
  activePaneId,
  renderPane,
  onActivePaneChange,
  onClosePane,
  flashPaneId,
}: ChatPaneStageFlexProps) {
  // Panes present on the stage's first render must not play the enter
  // animation (a page load would animate every pane in from zero width).
  const stageMountedRef = useRef(false)
  useEffect(() => {
    stageMountedRef.current = true
  }, [])

  if (panes.length === 0) return null

  return (
    <div
      data-boring-workspace-part="chat-pane-stage"
      className="relative flex h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-background"
    >
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 ? (
            <div
              data-boring-workspace-part="chat-pane-divider"
              className="w-px shrink-0 self-stretch bg-[color:oklch(from_var(--border)_l_c_h/0.7)]"
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
  renderPane: (pane: ChatPaneDescriptor) => React.ReactNode
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

  const title = paneTitle(pane)
  return (
    <div
      data-boring-workspace-part="chat-pane"
      data-boring-state={active ? "active" : "inactive"}
      aria-label={`Chat session ${title}`}
      className={cn(
        "group/chat-pane relative flex h-full flex-col overflow-hidden bg-background",
        "transition-[flex-grow,flex-basis,min-width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        entered ? "min-w-[350px] flex-[1_0_350px]" : "min-w-0 flex-[0_0_0px]",
      )}
      onMouseDown={() => onActivePaneChange?.(pane.id)}
      onFocusCapture={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null
        if (target?.closest('[data-boring-workspace-part="chat-pane-control"]')) return
        onActivePaneChange?.(pane.id)
      }}
    >
      <PaneFocusRing active={multiPane && active} flash={flash} />
      <div
        data-boring-workspace-part="chat-pane-header"
        // Seamless with the content: no separating border, no tint — the
        // full-pane focus ring is the active indicator.
        className="flex h-8 shrink-0 items-center justify-between bg-background px-2"
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
          <ControlTooltip label="Close pane" side="bottom">
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
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
          </ControlTooltip>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {renderPane(pane)}
      </div>
    </div>
  )
}

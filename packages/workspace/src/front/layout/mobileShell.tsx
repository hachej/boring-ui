import type { ReactNode } from "react"
import { ArrowLeft, X } from "lucide-react"
import { cn } from "../lib/utils"
import { paneTitle, readablePaneTitle, type ChatPaneDescriptor } from "./ChatPaneStage"

/**
 * One declared height for every mobile bar. `--mobile-bar-height` is the
 * `:root` token (globals.css); the literal is the fallback so this file stays
 * correct on its own. Both bars and the (now merged) chat header are the same
 * row, so there is exactly one number to change.
 */
const MOBILE_BAR_CLASS = cn(
  "flex min-h-[var(--mobile-bar-height,3rem)] items-center gap-2 border-b border-border bg-background pb-2",
  // The floating app-left control sits in the leading gutter. Both this bar and
  // ManagementOverlaySurface reserve it with the SAME token so they cannot
  // disagree about how much room it needs.
  "pl-[calc(var(--mobile-header-inset-start,3.25rem)+var(--sa-left,0px))]",
  "pr-[calc(0.75rem+var(--sa-right,0px))]",
  "pt-[calc(0.5rem+var(--sa-top,0px))]",
)

/**
 * Pills are the only navigation in the mobile shell and are tapped, not
 * hovered: they carry a resting fill so they read as buttons, and an `active:`
 * state so the tap is acknowledged before it resolves. `before:-inset-y-1`
 * expands the hit area without growing the drawn control.
 */
const MOBILE_PILL_CLASS = cn(
  "mobile-shell-bar-action relative inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full",
  "border border-transparent bg-muted/60 px-3 text-sm font-semibold text-foreground",
  "before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
  "transition-[background-color,transform] motion-reduce:transition-none",
  "hover:bg-muted active:bg-muted active:scale-[0.97]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
)

/**
 * The single mobile chat header. It used to be two stacked bars — this one and
 * a second title row inside `MobileSingleChatPane` — which showed the session
 * title twice under a static "Chat" label. One row, one title.
 */
export function MobileChatBar({
  pane,
  totalPanes,
  canOpenNav,
  canOpenWorkspace,
  onOpenNav,
  onOpenWorkspace,
  actions,
  onClosePane,
}: {
  pane?: ChatPaneDescriptor
  totalPanes?: number
  canOpenNav: boolean
  canOpenWorkspace: boolean
  onOpenNav?: () => void
  onOpenWorkspace: () => void
  /** Chrome the surrounding shell owns (e.g. the command palette) when it has
   *  no top bar of its own at this width. */
  actions?: ReactNode
  onClosePane?: (id: string) => void
}) {
  const panes = totalPanes ?? 0
  const title = pane ? readablePaneTitle(paneTitle(pane), pane.id) : "Chat"
  // Only the Agent goes in the subtitle. The pane count used to be glued onto
  // the same truncating line, so the one fact it carried was the first thing
  // cut off; it is a non-truncating pill now.
  const subtitle = pane?.agentLabel
  return (
    <div data-boring-workspace-part="mobile-chat-bar" className={MOBILE_BAR_CLASS}>
      {canOpenNav ? (
        <button type="button" className={MOBILE_PILL_CLASS} onClick={onOpenNav}>
          Sessions
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        {subtitle ? (
          <div
            data-boring-workspace-part="mobile-chat-pane-subtitle"
            className="truncate text-xs font-medium leading-tight text-muted-foreground"
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {panes > 1 ? (
        <span
          data-boring-workspace-part="mobile-chat-pane-count"
          className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground"
        >
          <span aria-hidden="true">{`1/${panes}`}</span>
          <span className="sr-only">{`Showing 1 of ${panes} chats — split panes are disabled on mobile.`}</span>
        </span>
      ) : null}
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      {pane && onClosePane && panes > 1 ? (
        <button
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,transform] motion-reduce:transition-none hover:bg-muted hover:text-foreground active:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => onClosePane(pane.id)}
          aria-label={`Close ${title} pane`}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {canOpenWorkspace ? (
        <button type="button" className={MOBILE_PILL_CLASS} onClick={onOpenWorkspace}>
          Workspace
        </button>
      ) : null}
    </div>
  )
}

/**
 * Body of the single visible chat pane. Its header moved into `MobileChatBar`
 * above — the two were always rendered together, so two headers were two
 * safe-area insets and two copies of the same title.
 */
export function MobileSingleChatPane({
  pane,
  renderPane,
}: {
  pane: ChatPaneDescriptor
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
}) {
  return (
    <div data-boring-workspace-part="mobile-chat-pane" className="flex h-full min-h-0 flex-col bg-background">
      <div data-boring-workspace-part="chat-pane" data-boring-state="active" className="min-h-0 flex-1 overflow-hidden">
        {renderPane(pane)}
      </div>
    </div>
  )
}

export function MobileWorkspaceBar({ onBack }: { onBack: () => void }) {
  return (
    <div data-boring-workspace-part="mobile-workspace-bar" className={MOBILE_BAR_CLASS}>
      <button type="button" className={MOBILE_PILL_CLASS} onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Chat
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">Workspace</div>
      </div>
    </div>
  )
}

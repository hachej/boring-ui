import type { ReactNode } from "react"
import { ArrowLeft, X } from "lucide-react"
import { paneTitle, type ChatPaneDescriptor } from "./ChatPaneStage"
import { readablePaneTitle } from "./ChatPaneStageDock"

export function MobileSingleChatPane({
  pane,
  totalPanes,
  topActions,
  onClosePane,
  renderPane,
}: {
  pane: ChatPaneDescriptor
  totalPanes: number
  topActions?: ReactNode
  onClosePane?: (id: string) => void
  renderPane: (pane: ChatPaneDescriptor) => ReactNode
}) {
  const title = readablePaneTitle(paneTitle(pane), pane.id)
  return (
    <div data-boring-workspace-part="mobile-chat-pane" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-11 items-center gap-2 border-b border-border pb-2 pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))] pt-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          {totalPanes > 1 ? (
            <div className="text-[11px] font-medium text-muted-foreground">Showing 1 of {totalPanes} chats — split panes are disabled on mobile.</div>
          ) : null}
        </div>
        {topActions ? <div className="flex shrink-0 items-center gap-1">{topActions}</div> : null}
        {onClosePane && totalPanes > 1 ? (
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onClosePane(pane.id)}
            aria-label={`Close ${title} pane`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div data-boring-workspace-part="chat-pane" data-boring-state="active" className="min-h-0 flex-1 overflow-hidden">
        {renderPane(pane)}
      </div>
    </div>
  )
}

export function MobileChatBar({
  canOpenNav,
  canOpenWorkspace,
  onOpenNav,
  onOpenWorkspace,
}: {
  canOpenNav: boolean
  canOpenWorkspace: boolean
  onOpenNav?: () => void
  onOpenWorkspace: () => void
}) {
  return (
    <div
      data-boring-workspace-part="mobile-chat-bar"
      className="flex min-h-12 items-center gap-2 border-b border-border bg-background pb-2 pl-[calc(4rem+env(safe-area-inset-left))] pr-[calc(0.5rem+env(safe-area-inset-right))] pt-[calc(0.5rem+env(safe-area-inset-top))]"
    >
      {canOpenNav ? (
        <button
          type="button"
          className="inline-flex min-h-10 items-center rounded-full border border-border px-3 text-sm font-semibold text-foreground"
          onClick={onOpenNav}
        >
          Sessions
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">Chat</div>
      </div>
      {canOpenWorkspace ? (
        <button
          type="button"
          className="inline-flex min-h-10 items-center rounded-full border border-border px-3 text-sm font-semibold text-foreground"
          onClick={onOpenWorkspace}
        >
          Workspace
        </button>
      ) : null}
    </div>
  )
}

export function MobileWorkspaceBar({ onBack }: { onBack: () => void }) {
  return (
    <div
      data-boring-workspace-part="mobile-workspace-bar"
      className="flex min-h-12 items-center gap-2 border-b border-border bg-background pb-2 pl-[calc(4rem+env(safe-area-inset-left))] pr-[calc(0.5rem+env(safe-area-inset-right))] pt-[calc(0.5rem+env(safe-area-inset-top))]"
    >
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-1 rounded-full border border-border px-3 text-sm font-semibold text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Chat
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">Workspace</div>
      </div>
    </div>
  )
}

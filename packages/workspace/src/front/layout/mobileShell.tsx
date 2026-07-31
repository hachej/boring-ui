import type { ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import { paneTitle, type ChatPaneDescriptor } from "./ChatPaneStage"

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
  return (
    <div data-boring-workspace-part="mobile-chat-pane" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-11 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{paneTitle(pane)}</div>
          {totalPanes > 1 ? (
            <div className="text-[11px] font-medium text-muted-foreground">Showing 1 of {totalPanes} chats — split panes are disabled on mobile.</div>
          ) : null}
        </div>
        {topActions ? <div className="flex shrink-0 items-center gap-1">{topActions}</div> : null}
        {totalPanes > 1 && onClosePane ? (
          <button
            type="button"
            className="min-h-9 rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground"
            onClick={() => onClosePane(pane.id)}
          >
            Close
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
    <div data-boring-workspace-part="mobile-chat-bar" className="flex min-h-12 items-center gap-2 border-b border-border bg-background px-2 py-2" style={{ paddingLeft: "4rem" }}>
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
        <div className="truncate text-[11px] font-medium text-muted-foreground">One active thread on mobile</div>
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
    <div data-boring-workspace-part="mobile-workspace-bar" className="flex min-h-12 items-center gap-2 border-b border-border bg-background px-2 py-2" style={{ paddingLeft: "4rem" }}>
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
        <div className="truncate text-[11px] font-medium text-muted-foreground">One active panel on mobile</div>
      </div>
    </div>
  )
}

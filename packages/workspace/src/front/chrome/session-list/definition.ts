import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import type { SessionItem } from "../../components/SessionList"
import { SessionBrowser, type SessionActivityById } from "./SessionBrowser"

interface SessionListPaneParams {
  sessions?: SessionItem[]
  activeId?: string | null
  openIds?: string[]
  pinnedIds?: string[]
  onTogglePin?: (id: string) => void
  onSwitch?: (id: string) => void
  onOpenAsTab?: (id: string) => void
  onCreate?: () => void
  onDelete?: (id: string) => void
  onLoadMore?: () => void
  hasMore?: boolean
  loadingMore?: boolean
  sessionActivityById?: SessionActivityById
  onClose?: () => void
}

function SessionListPane({ params }: PaneProps<SessionListPaneParams | undefined>) {
  return createElement(SessionBrowser, {
    sessions: params?.sessions ?? [],
    activeId: params?.activeId,
    openIds: params?.openIds,
    pinnedIds: params?.pinnedIds,
    onTogglePin: params?.onTogglePin,
    onSwitch: params?.onSwitch,
    onOpenAsTab: params?.onOpenAsTab,
    onCreate: params?.onCreate,
    onDelete: params?.onDelete,
    onLoadMore: params?.onLoadMore,
    hasMore: params?.hasMore,
    loadingMore: params?.loadingMore,
    sessionActivityById: params?.sessionActivityById,
    onClose: params?.onClose,
  })
}

export const sessionListPanel = {
  id: "session-list",
  title: "Sessions",
  component: SessionListPane,
  placement: "left",
  source: "builtin",
}

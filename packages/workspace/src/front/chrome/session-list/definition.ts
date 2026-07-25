import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import type { SessionItem } from "../../components/SessionList"
import type { WorkspaceSessionRef } from "../../sessionIdentity"
import { SessionBrowser } from "./SessionBrowser"

interface SessionListPaneParams {
  sessions?: SessionItem[]
  activeId?: string | null
  activeRef?: WorkspaceSessionRef | null
  openIds?: readonly string[]
  openRefs?: readonly WorkspaceSessionRef[]
  pinnedIds?: readonly string[]
  pinnedRefs?: readonly WorkspaceSessionRef[]
  onTogglePin?: (id: string, agentTypeId?: string) => void
  onSwitch?: (id: string, agentTypeId?: string) => void
  onOpenAsTab?: (id: string, agentTypeId?: string) => void
  onCreate?: () => void
  onDelete?: (id: string, agentTypeId?: string) => void
  onLoadMore?: () => void
  hasMore?: boolean
  loadingMore?: boolean
  onClose?: () => void
}

function SessionListPane({ params }: PaneProps<SessionListPaneParams | undefined>) {
  return createElement(SessionBrowser, {
    sessions: params?.sessions ?? [],
    activeId: params?.activeId,
    activeRef: params?.activeRef,
    openIds: params?.openIds,
    openRefs: params?.openRefs,
    pinnedIds: params?.pinnedIds,
    pinnedRefs: params?.pinnedRefs,
    onTogglePin: params?.onTogglePin,
    onSwitch: params?.onSwitch,
    onOpenAsTab: params?.onOpenAsTab,
    onCreate: params?.onCreate,
    onDelete: params?.onDelete,
    onLoadMore: params?.onLoadMore,
    hasMore: params?.hasMore,
    loadingMore: params?.loadingMore,
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

import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import type { SessionItem } from "../../components/SessionList"
import { SessionBrowser } from "./SessionBrowser"

interface SessionListPaneParams {
  sessions?: SessionItem[]
  activeId?: string | null
  onSwitch?: (id: string) => void
  onCreate?: () => void
  onDelete?: (id: string) => void
  onClose?: () => void
}

function SessionListPane({ params }: PaneProps<SessionListPaneParams | undefined>) {
  return createElement(SessionBrowser, {
    sessions: params?.sessions ?? [],
    activeId: params?.activeId,
    onSwitch: params?.onSwitch,
    onCreate: params?.onCreate,
    onDelete: params?.onDelete,
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

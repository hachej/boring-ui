import { DockviewShell } from "../dock"
import type { LayoutConfig, GroupConfig } from "../dock"
import type { ChatLayoutProps } from "./types"

export function buildChatLayout(props: ChatLayoutProps = {}): LayoutConfig {
  const { nav = "session-list", center = "chat", surface, sidebar } = props
  const groups: GroupConfig[] = [
    {
      id: "nav",
      position: "left",
      panel: nav,
      locked: true,
      hideHeader: true,
      constraints: { minWidth: 60, maxWidth: 60 },
    },
    { id: "center", position: "center", panel: center },
  ]

  if (sidebar) {
    groups.push({
      id: "sidebar",
      position: "left",
      panel: sidebar,
      collapsible: true,
      collapsedWidth: 0,
      constraints: { minWidth: 200, maxWidth: 350 },
    })
  }

  if (surface) {
    groups.push({
      id: "surface",
      position: "right",
      panel: surface,
      dynamic: true,
      placeholder: "empty",
    })
  }

  return { version: "2.0", groups }
}

export function ChatLayout(props: ChatLayoutProps) {
  return <DockviewShell layout={buildChatLayout(props)} className={props.className} />
}

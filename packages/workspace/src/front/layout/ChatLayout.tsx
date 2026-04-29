import type { LayoutConfig, GroupConfig } from "../dock"
import type { ChatLayoutProps } from "./types"
import { ResponsiveDockviewShell } from "./ResponsiveDockviewShell"

export function buildChatLayout(props: ChatLayoutProps = {}): LayoutConfig {
  const {
    nav = "session-list",
    navParams,
    center = "chat",
    centerParams,
    surface,
    surfaceParams,
    sidebar,
    sidebarParams,
  } = props
  const groups: GroupConfig[] = [
    {
      id: "nav",
      position: "left",
      panel: nav,
      params: navParams,
      locked: true,
      hideHeader: true,
      constraints: { minWidth: 60, maxWidth: 60 },
    },
    { id: "center", position: "center", panel: center, params: centerParams },
  ]

  if (sidebar) {
    groups.push({
      id: "sidebar",
      position: "left",
      panel: sidebar,
      params: sidebarParams,
      collapsible: true,
      collapsedWidth: 40,
      constraints: { minWidth: 200, maxWidthViewportRatio: 0.5 },
    })
  }

  if (surface) {
    groups.push({
      id: "surface",
      position: "right",
      panel: surface,
      params: surfaceParams,
      dynamic: true,
      placeholder: "empty",
    })
  }

  return { version: "2.0", groups }
}

export function ChatLayout(props: ChatLayoutProps) {
  return <ResponsiveDockviewShell layout={buildChatLayout(props)} className={props.className} />
}

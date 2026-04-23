import type { LayoutConfig, GroupConfig } from "../dock"
import type { IdeLayoutProps } from "./types"
import { ResponsiveDockviewShell } from "./ResponsiveDockviewShell"

export function buildIdeLayout(props: IdeLayoutProps = {}): LayoutConfig {
  const { sidebar = "filetree", center = "empty", right } = props
  const groups: GroupConfig[] = [
    {
      id: "sidebar",
      position: "left",
      panel: sidebar,
      locked: true,
      collapsible: true,
      collapsedWidth: 40,
      constraints: { minWidth: 200, maxWidthViewportRatio: 0.5 },
    },
    {
      id: "center",
      position: "center",
      panel: center,
      dynamic: true,
      placeholder: "empty",
      constraints: { minWidth: 300 },
    },
  ]

  if (right) {
    groups.push({
      id: "right",
      position: "right",
      panel: right,
      hideHeader: true,
      constraints: { minWidth: 250 },
    })
  }

  return { version: "2.0", groups }
}

export function IdeLayout(props: IdeLayoutProps) {
  return <ResponsiveDockviewShell layout={buildIdeLayout(props)} className={props.className} />
}

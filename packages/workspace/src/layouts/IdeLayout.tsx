import { DockviewShell } from "../dock"
import type { LayoutConfig, GroupConfig } from "../dock"
import type { IdeLayoutProps } from "./types"

export function buildIdeLayout(props: IdeLayoutProps = {}): LayoutConfig {
  const { sidebar = "filetree", center = "empty", right } = props
  const groups: GroupConfig[] = [
    {
      id: "sidebar",
      position: "left",
      panel: sidebar,
      locked: true,
      collapsible: true,
      collapsedWidth: 0,
      constraints: { minWidth: 200, maxWidth: 400 },
    },
    {
      id: "center",
      position: "center",
      panel: center,
      dynamic: true,
      placeholder: "empty",
    },
  ]

  if (right) {
    groups.push({
      id: "right",
      position: "right",
      panel: right,
      hideHeader: true,
      constraints: { minWidth: 300 },
    })
  }

  return { version: "2.0", groups }
}

export function IdeLayout(props: IdeLayoutProps) {
  return <DockviewShell layout={buildIdeLayout(props)} className={props.className} />
}

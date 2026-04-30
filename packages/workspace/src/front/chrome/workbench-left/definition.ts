import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import { WorkbenchLeftPane, type WorkbenchLeftPaneProps } from "./WorkbenchLeftPane"

function WorkbenchLeftPanel({ params }: PaneProps<WorkbenchLeftPaneProps | undefined>) {
  return createElement(WorkbenchLeftPane, params ?? {})
}

export const workbenchLeftPanel = {
  id: "workbench-left",
  title: "Workbench",
  component: WorkbenchLeftPanel,
  placement: "left",
  source: "builtin",
}

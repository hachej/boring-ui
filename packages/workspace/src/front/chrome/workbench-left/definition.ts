import { createElement } from "react"
import { definePanel, type PaneProps } from "../../registry/types"
import { WorkbenchLeftPane, type WorkbenchLeftPaneProps } from "./WorkbenchLeftPane"

function WorkbenchLeftPanel({ params }: PaneProps<WorkbenchLeftPaneProps | undefined>) {
  return createElement(WorkbenchLeftPane, params ?? {})
}

export const workbenchLeftPanel = definePanel<WorkbenchLeftPaneProps | undefined>({
  id: "workbench-left",
  title: "Workbench",
  component: WorkbenchLeftPanel,
  placement: "left",
  source: "builtin",
})

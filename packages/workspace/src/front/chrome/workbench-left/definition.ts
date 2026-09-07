import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import type { WorkbenchLeftPaneProps } from "./WorkbenchLeftPane"

async function importWorkbenchLeftPanel() {
  const { WorkbenchLeftPane } = await import("./WorkbenchLeftPane")
  return {
    default({ params }: PaneProps<WorkbenchLeftPaneProps | undefined>) {
      return createElement(WorkbenchLeftPane, params ?? {})
    },
  }
}

export const workbenchLeftPanel = {
  id: "workbench-left",
  title: "Workbench",
  component: importWorkbenchLeftPanel,
  lazy: true,
  placement: "left",
  source: "builtin",
}

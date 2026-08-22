import { createElement, lazy, Suspense } from "react"
import type { PaneProps } from "../../registry/types"
import type { WorkbenchLeftPaneProps } from "./WorkbenchLeftPane"

const LazyWorkbenchLeftPane = lazy(() => import("./WorkbenchLeftPane").then((module) => ({ default: module.WorkbenchLeftPane })))

function WorkbenchLeftPanel({ params }: PaneProps<WorkbenchLeftPaneProps | undefined>) {
  return createElement(
    Suspense,
    { fallback: createElement("div", { className: "flex h-full items-center justify-center text-sm text-muted-foreground" }, "Loading sources…") },
    createElement(LazyWorkbenchLeftPane, params ?? {}),
  )
}

export const workbenchLeftPanel = {
  id: "workbench-left",
  title: "Workbench",
  component: WorkbenchLeftPanel,
  placement: "left",
  source: "builtin",
}

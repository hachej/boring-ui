import { createElement, lazy, Suspense } from "react"
import type { PaneProps } from "../../registry/types"
import type { SurfaceShellProps } from "./SurfaceShell"

const LazySurfaceShell = lazy(() => import("./SurfaceShell").then((module) => ({ default: module.SurfaceShell })))

function ArtifactSurfacePanel({ params }: PaneProps<SurfaceShellProps | undefined>) {
  return createElement(
    Suspense,
    { fallback: createElement("div", { className: "flex h-full items-center justify-center text-sm text-muted-foreground" }, "Loading workbench…") },
    createElement(LazySurfaceShell, params ?? {}),
  )
}

export const artifactSurfacePanel = {
  id: "artifact-surface",
  title: "Surface",
  component: ArtifactSurfacePanel,
  placement: "right",
  source: "builtin",
}

import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import { SurfaceShell, type SurfaceShellProps } from "./SurfaceShell"

function ArtifactSurfacePanel({ params }: PaneProps<SurfaceShellProps | undefined>) {
  return createElement(SurfaceShell, params ?? {})
}

export const artifactSurfacePanel = {
  id: "artifact-surface",
  title: "Surface",
  component: ArtifactSurfacePanel,
  placement: "right",
  source: "builtin",
}

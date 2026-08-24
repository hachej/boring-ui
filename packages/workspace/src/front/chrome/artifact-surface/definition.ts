import { createElement } from "react"
import type { PaneProps } from "../../registry/types"
import type { SurfaceShellProps } from "./SurfaceShell"

async function importArtifactSurfacePanel() {
  const { SurfaceShell } = await import("./SurfaceShell")
  return {
    default({ params }: PaneProps<SurfaceShellProps | undefined>) {
      return createElement(SurfaceShell, params ?? {})
    },
  }
}

export const artifactSurfacePanel = {
  id: "artifact-surface",
  title: "Surface",
  component: importArtifactSurfacePanel,
  lazy: true,
  placement: "right",
  source: "builtin",
}

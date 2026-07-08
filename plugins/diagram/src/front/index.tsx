import { lazy, Suspense } from "react"
import {
  definePlugin,
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  type BoringFrontFactoryWithId,
  type PaneProps,
} from "@hachej/boring-workspace/plugin"
import {
  DIAGRAM_PANEL_ID,
  DIAGRAM_PLUGIN_ID,
  isDiagramPath,
  titleForPath,
} from "../shared"

interface DiagramPaneParams {
  path?: string
  filesystem?: string
  mode?: string
}

const LazyDiagramPane = lazy(async () => {
  const module = await import("./DiagramPane")
  return { default: module.DiagramPane }
})

function DiagramPanel(props: PaneProps<DiagramPaneParams>) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading Diagram…</div>}>
      <LazyDiagramPane {...props} />
    </Suspense>
  )
}

const diagramPlugin: BoringFrontFactoryWithId = definePlugin({
  id: DIAGRAM_PLUGIN_ID,
  label: "Diagram",
  panels: [{ id: DIAGRAM_PANEL_ID, label: "Diagram", component: DiagramPanel }],
  commands: [{ id: "diagram.open", title: "Open Diagram", panelId: DIAGRAM_PANEL_ID }],
  surfaceResolvers: [
    {
      id: "diagram.open-file",
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      resolve: (request) => {
        if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return null
        if (!isDiagramPath(request.target)) return null
        const filesystem = typeof request.filesystem === "string" && request.filesystem ? request.filesystem : undefined
        return {
          id: `diagram:${encodeURIComponent(filesystem ?? "user")}:${encodeURIComponent(request.target)}`,
          component: DIAGRAM_PANEL_ID,
          title: titleForPath(request.target),
          params: { path: request.target, ...(filesystem ? { filesystem } : {}) },
          score: 1000,
        }
      },
    },
  ],
})

export default diagramPlugin
export { diagramPlugin }

import {
  definePlugin,
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  type BoringFrontFactoryWithId,
} from "@hachej/boring-workspace/plugin"
import {
  DIAGRAM_PANEL_ID,
  DIAGRAM_PLUGIN_ID,
  isDiagramPath,
  titleForPath,
} from "../shared"

const importDiagramPane = async () => {
  const module = await import("./DiagramPane")
  return { default: module.DiagramPane }
}

const diagramPlugin: BoringFrontFactoryWithId = definePlugin({
  id: DIAGRAM_PLUGIN_ID,
  label: "Diagram",
  panels: [{ id: DIAGRAM_PANEL_ID, label: "Diagram", component: importDiagramPane, lazy: true }],
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

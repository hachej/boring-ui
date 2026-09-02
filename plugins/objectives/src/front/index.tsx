import { lazy, Suspense } from "react"
import { definePlugin, type BoringFrontFactoryWithId, type PaneProps } from "@hachej/boring-workspace/plugin"
import { OBJECTIVE_PANEL_ID, OBJECTIVE_PANEL_TITLE, OBJECTIVE_SURFACE_KIND, OBJECTIVES_PLUGIN_ID } from "../shared/constants"

interface ObjectivePaneParams {
  objectiveId?: string
}

const LazyObjectivePane = lazy(async () => {
  const module = await import("./ObjectivePane")
  return { default: module.ObjectivePane }
})

function ObjectivePanel(props: PaneProps<ObjectivePaneParams>) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading Objective…</div>}>
      <LazyObjectivePane {...props} />
    </Suspense>
  )
}

const objectivesPlugin: BoringFrontFactoryWithId = definePlugin({
  id: OBJECTIVES_PLUGIN_ID,
  label: OBJECTIVE_PANEL_TITLE,
  panels: [{ id: OBJECTIVE_PANEL_ID, label: OBJECTIVE_PANEL_TITLE, component: ObjectivePanel }],
  commands: [{ id: "objectives.open", title: "Open Objective", panelId: OBJECTIVE_PANEL_ID }],
  surfaceResolvers: [
    {
      id: `${OBJECTIVES_PLUGIN_ID}.surface`,
      kind: OBJECTIVE_SURFACE_KIND,
      title: OBJECTIVE_PANEL_TITLE,
      description: "Opens a single Objective (the thin Goal primitive) by id.",
      targetHint: "The Objective id returned by create_objective/list_objectives.",
      examples: [{ target: "obj_123", label: "Open an objective by id" }],
      resolve: (request) => {
        if (request.kind !== OBJECTIVE_SURFACE_KIND) return undefined
        if (!request.target) return undefined
        return {
          id: `objective:${encodeURIComponent(request.target)}`,
          component: OBJECTIVE_PANEL_ID,
          title: OBJECTIVE_PANEL_TITLE,
          params: { objectiveId: request.target },
          score: 1000,
        }
      },
    },
  ],
})

export default objectivesPlugin
export { objectivesPlugin }

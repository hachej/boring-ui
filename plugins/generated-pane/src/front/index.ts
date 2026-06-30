import { PanelTop } from "lucide-react"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { GeneratedPanePane } from "./GeneratedPanePane"
import { createGeneratedPaneExplorerPane, GeneratedPaneExplorerPane } from "./GeneratedPaneExplorerPane"
import { GENERATED_PANE_EXPLORER_LEFT_TAB_ID, GENERATED_PANE_PANEL_ID } from "./constants"
import { generatedPaneSurfaceResolver } from "./surfaceResolver"

export { GeneratedPanePane }
export type { GeneratedPanePaneParams } from "./GeneratedPanePane"
export { GeneratedPaneExplorerPane, createGeneratedPaneExplorerPane }
export type { GeneratedPaneExplorerConfig } from "./GeneratedPaneExplorerPane"
export {
  GeneratedPaneRenderer,
  baseGeneratedPaneProfile,
  createGeneratedPaneCatalog,
  defineGeneratedPaneProfile,
  mergeGeneratedPaneProfiles,
} from "./catalog"
export type {
  GeneratedPaneActionDefinition,
  GeneratedPaneActionHandler,
  GeneratedPaneComponentDefinition,
  GeneratedPaneProfile,
} from "./catalog"
export type { GeneratedPaneElementSpec, GeneratedPaneSpec, GeneratedPaneValidationResult } from "../shared"
export { parseGeneratedPaneSpec } from "../shared"
export { GENERATED_PANE_EXPLORER_LEFT_TAB_ID, GENERATED_PANE_PANEL_ID } from "./constants"
export { generatedPaneSurfaceResolver, isGeneratedPanePath } from "./surfaceResolver"

export const generatedPanePlugin = definePlugin({
  id: "generated-pane",
  label: "Generated Pane",
  panels: [
    {
      id: GENERATED_PANE_PANEL_ID,
      label: "Generated Pane",
      icon: PanelTop,
      component: GeneratedPanePane,
      supportsFullPage: true,
    },
  ],
  leftTabs: [
    {
      id: GENERATED_PANE_EXPLORER_LEFT_TAB_ID,
      title: "Panes",
      panelId: GENERATED_PANE_EXPLORER_LEFT_TAB_ID,
      icon: PanelTop,
      component: createGeneratedPaneExplorerPane({
        title: "Panes",
        patterns: ["**/*.pane.json"],
        panelId: GENERATED_PANE_PANEL_ID,
        itemLabel: "Pane",
        emptyDescription: "Create panes/*.pane.json files to list generated panes here.",
      }),
      chromeless: true,
    },
  ],
  surfaceResolvers: [generatedPaneSurfaceResolver],
  commands: [
    {
      id: "generated-pane.open",
      title: "Open Generated Pane",
      panelId: GENERATED_PANE_PANEL_ID,
      keywords: ["json-render", "generated", "custom pane", "pane"],
    },
  ],
})

export default generatedPanePlugin

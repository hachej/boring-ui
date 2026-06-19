import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { BORING_FEEDBACK_PANEL_ID, BORING_FEEDBACK_PLUGIN_ID } from "../shared/constants"
import { BoringFeedbackPanel } from "./panels"
import { boringFeedbackSurfaceResolver } from "./surfaceResolver"

const boringFeedbackPlugin: BoringFrontFactoryWithId = definePlugin({
  id: BORING_FEEDBACK_PLUGIN_ID,
  label: "Feedback",
  panels: [
    {
      id: BORING_FEEDBACK_PANEL_ID,
      label: "Feedback",
      component: BoringFeedbackPanel,
      placement: "center",
      source: "app",
    },
  ],
  commands: [
    {
      id: "boring-feedback.open",
      title: "Open Feedback",
      panelId: BORING_FEEDBACK_PANEL_ID,
    },
  ],
  surfaceResolvers: [boringFeedbackSurfaceResolver],
})

export default boringFeedbackPlugin

export { BoringFeedbackPanel }
export { BORING_FEEDBACK_PANEL_ID } from "../shared/constants"
export { boringFeedbackSurfaceResolver } from "./surfaceResolver"

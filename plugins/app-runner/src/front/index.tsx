import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { APP_RUNNER_PANEL_ID, APP_RUNNER_PANEL_TITLE, APP_RUNNER_PLUGIN_ID } from "../shared/constants"
import { AppRunnerPane } from "./AppRunnerPane"
import { appRunnerSurfaceResolver } from "./surfaceResolver"

export function createAppRunnerPlugin(): BoringFrontFactoryWithId {
  return definePlugin({
    id: APP_RUNNER_PLUGIN_ID,
    label: APP_RUNNER_PANEL_TITLE,
    panels: [
      {
        id: APP_RUNNER_PANEL_ID,
        label: APP_RUNNER_PANEL_TITLE,
        component: AppRunnerPane,
        placement: "center",
        source: "app",
        supportsFullPage: true,
      },
    ],
    surfaceResolvers: [appRunnerSurfaceResolver],
  })
}

const appRunnerPlugin = createAppRunnerPlugin()

export default appRunnerPlugin

export { AppRunnerPane, appRunnerSurfaceResolver }
export type { AppRunnerPaneParams } from "./AppRunnerPane"

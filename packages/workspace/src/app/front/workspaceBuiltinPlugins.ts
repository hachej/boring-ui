import { filesystemPlugin } from "../../plugins/filesystemPlugin/front"
import { urlPanePlugin } from "../../plugins/urlPanePlugin/front"
import { captureBootstrapPlugins } from "../../shared/plugins/bootstrap"
import { PluginError } from "../../shared/plugins/errors"
import type { BoringFrontFactoryWithId, CapturedFrontPlugin } from "../../shared/plugins/frontFactory"

const RESERVED_APP_LEFT_ACTION_IDS = new Set(["plugins", "skills"])

export interface CaptureWorkspaceFrontPluginsOptions {
  plugins?: BoringFrontFactoryWithId[]
  excludeDefaults?: string[]
}

export function captureWorkspaceFrontPlugins({
  plugins,
  excludeDefaults,
}: CaptureWorkspaceFrontPluginsOptions): CapturedFrontPlugin[] {
  const excluded = new Set(excludeDefaults ?? [])
  const defaultPlugins = [filesystemPlugin, urlPanePlugin].filter((plugin) => !excluded.has(plugin.pluginId))
  const captured = captureBootstrapPlugins({ plugins: plugins ?? [], defaults: defaultPlugins, excludeDefaults })

  for (const plugin of captured) {
    for (const action of plugin.registrations.appLeftActions) {
      if (RESERVED_APP_LEFT_ACTION_IDS.has(action.id)) {
        throw new PluginError(
          "duplicate-id",
          `app-left action "${action.id}" from plugin "${plugin.id}" collides with a reserved workspace app-left action`,
        )
      }
    }
  }

  return captured
}

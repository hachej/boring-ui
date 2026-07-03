import { filesystemPlugin } from "../../plugins/filesystemPlugin/front"
import { workspaceInboxPlugin } from "../../plugins/inboxPlugin/front"
import { captureBootstrapPlugins } from "../../shared/plugins/bootstrap"
import { PluginError } from "../../shared/plugins/errors"
import type { BoringFrontFactoryWithId, CapturedFrontPlugin } from "../../shared/plugins/frontFactory"

const RESERVED_APP_LEFT_ACTION_IDS = new Set(["plugins", "skills"])

export interface CaptureWorkspaceFrontPluginsOptions {
  plugins?: BoringFrontFactoryWithId[]
  inboxEnabled: boolean
  excludeDefaults?: string[]
}

export function captureWorkspaceFrontPlugins({
  plugins,
  inboxEnabled,
  excludeDefaults,
}: CaptureWorkspaceFrontPluginsOptions): CapturedFrontPlugin[] {
  const providedPlugins = inboxEnabled
    ? plugins ?? []
    : (plugins ?? []).filter((plugin) => plugin.pluginId !== workspaceInboxPlugin.pluginId)
  const pluginsWithInbox = inboxEnabled && !providedPlugins.some((plugin) => plugin.pluginId === workspaceInboxPlugin.pluginId)
    ? [workspaceInboxPlugin, ...providedPlugins]
    : providedPlugins
  const defaultPlugins = (excludeDefaults ?? []).includes(filesystemPlugin.pluginId) ? [] : [filesystemPlugin]
  const captured = captureBootstrapPlugins({ plugins: pluginsWithInbox, defaults: defaultPlugins, excludeDefaults })

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

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { WorkspaceServerPluginAsset } from "./defineServerPlugin"

export function definePluginAsset(
  importMetaUrl: string,
  name: string,
  relativeSource: string,
  options: { target?: string } = {},
): WorkspaceServerPluginAsset {
  return {
    name,
    source: new URL(relativeSource, importMetaUrl),
    ...(options.target ? { target: options.target } : {}),
  }
}

/**
 * Resolve a packaged static asset owned by a server plugin.
 *
 * Workspace app builds copy declared plugin assets next to compiled plugin
 * server modules, preserving the source layout:
 * `src/plugins/<pluginId>/<asset>` -> `dist/plugins/<pluginId>/<asset>`.
 */
export function resolvePluginAssetPath(
  importMetaUrl: string,
  assetName: string,
): string {
  return join(dirname(fileURLToPath(importMetaUrl)), assetName)
}

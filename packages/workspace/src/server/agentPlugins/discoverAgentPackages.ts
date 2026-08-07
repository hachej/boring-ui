import { join, resolve } from "node:path"

import { BoringPluginAssetManager } from "./manager"
import type { DiscoveredBoringAgentPackage } from "./types"

/**
 * Boot-only persona discovery. The workspace owns the plugin scan and passes
 * the resulting plain descriptors across the package boundary; packages/agent
 * never depends on workspace discovery code.
 */
export async function discoverRepositoryAgentPackages(
  repositoryRoot: string,
): Promise<readonly DiscoveredBoringAgentPackage[]> {
  const root = resolve(repositoryRoot)
  const manager = new BoringPluginAssetManager({
    pluginDirs: [{ rootDir: join(root, ".agents", "personas"), kind: "internal" }],
    errorRoot: join(root, ".pi", "extensions"),
  })
  await manager.load()
  return Object.freeze(manager.inspectAgentPackages())
}

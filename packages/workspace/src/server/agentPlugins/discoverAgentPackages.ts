import { join, resolve } from "node:path"

import { BoringPluginAssetManager } from "./manager"
import type {
  BoringPluginSourceInput,
  DiscoveredBoringAgentPackage,
} from "./types"

export interface DiscoverRepositoryAgentPackagesOptions {
  /**
   * Additional boot-approved package roots. Slice 3 callers pass only local
   * path entries from workspace `.pi/settings.json#packages`; git/npm install
   * roots deliberately never enter this list.
   */
  readonly localPackageSources?: readonly BoringPluginSourceInput[]
}

/**
 * Boot-only persona discovery. The workspace owns the plugin scan and passes
 * the resulting plain descriptors across the package boundary; packages/agent
 * never depends on workspace discovery code.
 */
export async function discoverRepositoryAgentPackages(
  repositoryRoot: string,
  options: DiscoverRepositoryAgentPackagesOptions = {},
): Promise<readonly DiscoveredBoringAgentPackage[]> {
  const root = resolve(repositoryRoot)
  const manager = new BoringPluginAssetManager({
    pluginDirs: [
      { rootDir: join(root, ".agents", "personas"), kind: "internal" },
      ...(options.localPackageSources ?? []),
    ],
    errorRoot: join(root, ".pi", "extensions"),
  })
  await manager.load()
  return Object.freeze(manager.inspectAgentPackages())
}

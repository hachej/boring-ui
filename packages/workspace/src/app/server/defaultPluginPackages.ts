import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join } from "node:path"

export interface ResolveDefaultWorkspacePluginPackagePathsOptions {
  workspaceRoot?: string
  /**
   * Internal plugin packages, listed explicitly in host boot code — npm
   * package names (resolved via require.resolve) or absolute directory
   * paths. Mirrors the front side, where internal plugins are statically
   * imported in the app: both sides declare the same explicit list.
   */
  defaultPluginPackages?: string[]
  /**
   * Directory whose node_modules anchors npm-name resolution (the host
   * package's own root). Defaults to walking up from `workspaceRoot`,
   * then from this module's location.
   */
  anchorDir?: string
}

/**
 * Resolve each entry in `defaultPluginPackages` to an absolute package
 * directory. Accepts either an npm-style name (resolved via
 * `require.resolve('<name>/package.json')`) or an absolute filesystem
 * path. THROWS on unresolved entries — a typo or missing dependency
 * is an app boot-time error, not something to silently drop.
 */
export function resolveDefaultWorkspacePluginPackagePaths({
  workspaceRoot = process.cwd(),
  defaultPluginPackages = [],
  anchorDir,
}: ResolveDefaultWorkspacePluginPackagePathsOptions = {}): string[] {
  if (defaultPluginPackages.length === 0) return []
  // Two anchors only: the host package's own root (explicit) and the
  // workspace root (walk-up). No silent fallback through this module's own
  // node_modules — a host that forgot to declare the plugin as a dependency
  // should fail loudly at boot, not resolve through accidental hoisting.
  const requireFromAnchor = anchorDir ? createRequire(join(anchorDir, "package.json")) : null
  const requireFromWorkspace = createRequire(join(workspaceRoot, "package.json"))
  const resolvers = [requireFromAnchor, requireFromWorkspace]
    .filter((req): req is NodeRequire => req !== null)
  const resolved: string[] = []
  for (const entry of defaultPluginPackages) {
    // isAbsolute handles both POSIX (`/foo`) and Windows (`C:\foo`) paths;
    // startsWith("/") alone misses Windows absolute paths and incorrectly
    // accepts `~/foo` as absolute.
    if (isAbsolute(entry)) {
      if (!existsSync(join(entry, "package.json"))) {
        throw new Error(
          `defaultPluginPackages: "${entry}" has no package.json — provide a path to a directory containing package.json with a "boring" field.`,
        )
      }
      resolved.push(entry)
      continue
    }
    let resolvedPath: string | null = null
    for (const req of resolvers) {
      try {
        resolvedPath = dirname(req.resolve(`${entry}/package.json`))
        break
      } catch {
        // try next anchor
      }
    }
    if (!resolvedPath) {
      throw new Error(
        `defaultPluginPackages: cannot resolve "${entry}" — install it as a dep of the app so require.resolve can find its package.json. Pass an absolute path instead if the package lives outside node_modules.`,
      )
    }
    resolved.push(resolvedPath)
  }
  return resolved
}

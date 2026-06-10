import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join } from "node:path"

/**
 * Read `package.json#boring.defaultPlugins: string[]` from the app's
 * package.json, if `appPackageJsonPath` was provided. Relative entries are
 * resolved against the package.json's own directory so apps can write paths
 * like "./src/plugins/foo" without computing absolutes in their boot code.
 * Returns the resolved absolute paths (or npm names unchanged, for later
 * resolution by resolveDefaultPluginPackagePaths).
 */
function readAppManifestDefaultPlugins(appPackageJsonPath: string | undefined): string[] {
  if (!appPackageJsonPath || !existsSync(appPackageJsonPath)) return []
  let pkg: { boring?: { defaultPlugins?: unknown } }
  try {
    pkg = JSON.parse(readFileSync(appPackageJsonPath, "utf8"))
  } catch {
    return []
  }
  const entries = pkg.boring?.defaultPlugins
  if (!Array.isArray(entries)) return []
  const pkgDir = dirname(appPackageJsonPath)
  return entries
    .filter((e): e is string => typeof e === "string")
    .map((entry) => {
      // Relative paths resolve from the package.json's directory; npm names
      // and absolute paths pass through unchanged.
      if (entry.startsWith("./") || entry.startsWith("../")) {
        return join(pkgDir, entry)
      }
      return entry
    })
}

/**
 * Resolve each entry in `defaultPluginPackages` to an absolute package
 * directory. Accepts either an npm-style name (resolved via
 * `require.resolve('<name>/package.json')`) or an absolute filesystem
 * path. THROWS on unresolved entries — a typo or missing dependency
 * is an app boot-time error, not something to silently drop.
 *
 * Resolution priority for npm package names:
 *   1. `appDir` — the app's own package directory (its node_modules contain
 *      its declared deps; this is the authoritative location for internal
 *      plugins in both published and monorepo layouts).
 *   2. `workspaceRoot` — fallback for callers that omit appPackageJsonPath.
 *   3. `import.meta.url` — last resort (boring-workspace's own node_modules).
 */
function resolveDefaultPluginPackagePaths(
  appDir: string | null,
  workspaceRoot: string,
  defaultPluginPackages: string[],
): string[] {
  if (defaultPluginPackages.length === 0) return []
  // Anchor to the app's own directory first: internal plugins are deps of the
  // app, not of the user's workspace. Fall back to workspaceRoot, then this
  // module's own location.
  const primaryAnchor = appDir ?? workspaceRoot
  const requireFromApp = createRequire(join(primaryAnchor, "package.json"))
  const requireFromWorkspace = appDir ? createRequire(join(workspaceRoot, "package.json")) : requireFromApp
  const requireFromHere = createRequire(import.meta.url)
  const resolved: string[] = []
  for (const entry of defaultPluginPackages) {
    // isAbsolute handles both POSIX (`/foo`) and Windows (`C:\foo`) paths;
    // startsWith("/") alone misses Windows absolute paths and incorrectly
    // accepts `~/foo` as absolute.
    if (isAbsolute(entry)) {
      if (!existsSync(join(entry, "package.json"))) {
        throw new Error(
          `boring.defaultPlugins: "${entry}" has no package.json — provide a path to a directory containing package.json with a "boring" field.`,
        )
      }
      resolved.push(entry)
      continue
    }
    let resolvedPath: string | null = null
    for (const req of [requireFromApp, requireFromWorkspace, requireFromHere]) {
      try {
        resolvedPath = dirname(req.resolve(`${entry}/package.json`))
        break
      } catch {
        // try next anchor
      }
    }
    if (!resolvedPath) {
      throw new Error(
        `boring.defaultPlugins: cannot resolve "${entry}" — install it as a dep of the app so require.resolve can find its package.json. Pass an absolute path instead if the package lives outside node_modules.`,
      )
    }
    resolved.push(resolvedPath)
  }
  return resolved
}

export interface ResolveDefaultWorkspacePluginPackagePathsOptions {
  workspaceRoot?: string
  defaultPluginPackages?: string[]
  appPackageJsonPath?: string
}

/**
 * Resolve app-default plugin package declarations exactly once for app hosts.
 * This is shared by standalone workspace-agent and core composition so both
 * read `package.json#boring.defaultPlugins` with the same relative-path
 * and package-name semantics.
 */
export function resolveDefaultWorkspacePluginPackagePaths({
  workspaceRoot = process.cwd(),
  defaultPluginPackages = [],
  appPackageJsonPath,
}: ResolveDefaultWorkspacePluginPackagePathsOptions = {}): string[] {
  const manifestPluginPackages = readAppManifestDefaultPlugins(appPackageJsonPath)
  const appDir = appPackageJsonPath ? dirname(appPackageJsonPath) : null
  return resolveDefaultPluginPackagePaths(appDir, workspaceRoot, [
    ...manifestPluginPackages,
    ...defaultPluginPackages,
  ])
}

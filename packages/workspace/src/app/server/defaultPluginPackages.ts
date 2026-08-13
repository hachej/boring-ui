import { existsSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

export interface ResolveDefaultWorkspacePluginPackagePathsOptions {
  workspaceRoot?: string
  /**
   * Internal plugin packages, listed explicitly in host boot code — npm
   * package names or absolute directory paths. Named packages are located only
   * beneath the host/workspace node_modules anchors; no package metadata is
   * read during candidate construction.
   */
  defaultPluginPackages?: string[]
  /** Host package root used as the first node_modules anchor. */
  anchorDir?: string
}

/** A plugin declaration and its lexical, not-yet-inspected search candidates. */
export interface DefaultWorkspacePluginPackageCandidate {
  readonly declaration: string
  readonly paths: readonly string[]
}

/**
 * Build lexical candidates without require.resolve, package.json reads, or
 * module imports. The embedding host must authorize every candidate before it
 * calls resolveDefaultWorkspacePluginPackagePaths.
 */
export function defaultWorkspacePluginPackageCandidates({
  workspaceRoot = process.cwd(),
  defaultPluginPackages = [],
  anchorDir,
}: ResolveDefaultWorkspacePluginPackagePathsOptions = {}): DefaultWorkspacePluginPackageCandidate[] {
  const anchors = [...new Set([
    ...(anchorDir ? [resolve(anchorDir)] : []),
    resolve(workspaceRoot),
  ])]
  return defaultPluginPackages.map((declaration) => ({
    declaration,
    paths: isAbsolute(declaration)
      ? [resolve(declaration)]
      : [...new Set(anchors.map((anchor) => resolve(anchor, "node_modules", declaration)))],
  }))
}

/**
 * Inspect already-authorized lexical candidates and choose the first package
 * directory containing package.json. This function intentionally performs no
 * Node package resolution: callers authorize the exact names before this first
 * filesystem read.
 */
export function resolveDefaultWorkspacePluginPackagePaths(
  options: ResolveDefaultWorkspacePluginPackagePathsOptions = {},
): string[] {
  const resolved: string[] = []
  for (const candidate of defaultWorkspacePluginPackageCandidates(options)) {
    const packageRoot = candidate.paths.find((path) => existsSync(join(path, "package.json")))
    if (!packageRoot) {
      if (isAbsolute(candidate.declaration)) {
        throw new Error(
          `defaultPluginPackages: "${candidate.declaration}" has no package.json — provide a path to a directory containing package.json with a "boring" field.`,
        )
      }
      throw new Error(
        `defaultPluginPackages: cannot resolve "${candidate.declaration}" — install it as a dep of the app so its lexical node_modules package directory exists. Pass an absolute path instead if the package lives outside node_modules.`,
      )
    }
    resolved.push(packageRoot)
  }
  return resolved
}

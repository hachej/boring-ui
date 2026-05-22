import { existsSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { isSafePluginRelativePath } from "../../shared/plugins/manifest"

function isInsideRoot(rootReal: string, targetReal: string): boolean {
  const rel = relative(rootReal, targetReal)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function nearestExistingAncestor(path: string, rootDir: string): string | undefined {
  let current = path
  const root = resolve(rootDir)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return undefined
    if (!isInsideRoot(root, parent) && parent !== root) return undefined
    current = parent
  }
  return current
}

export interface ResolveContainedPluginPathOptions {
  mustExist?: boolean
}

/**
 * Resolve a plugin-manifest path under `rootDir` while enforcing both
 * lexical safety (`..`, absolute, backslash, null-byte rejection) and realpath
 * containment (symlink escapes). Returns undefined instead of throwing so scan
 * preflight can convert failures into manifest diagnostics.
 */
export function resolveContainedPluginPath(
  rootDir: string,
  value: string | undefined,
  options: ResolveContainedPluginPathOptions = {},
): string | undefined {
  if (!value || !isSafePluginRelativePath(value)) return undefined
  if (!existsSync(rootDir)) return undefined

  const root = resolve(rootDir)
  const resolved = resolve(root, value)
  const rootReal = realpathSync(root)
  const existing = nearestExistingAncestor(resolved, root)
  if (!existing) return undefined
  const existingReal = realpathSync(existing)
  if (!isInsideRoot(rootReal, existingReal)) return undefined

  if (!existsSync(resolved)) return options.mustExist ? undefined : resolved
  const resolvedReal = realpathSync(resolved)
  if (!isInsideRoot(rootReal, resolvedReal)) return undefined
  return resolvedReal
}

export interface ResolveSafePluginEntryPathOptions {
  rootDir: string
  explicit: string | false | undefined
  conventions: readonly string[]
  field: string
  manifestPath: string
}

/**
 * Resolve a plugin entry point that will be imported by the server. Explicit
 * manifest entries are validated before existence checks; convention entries
 * are also containment-checked before import so a symlinked conventional path
 * cannot escape the plugin package root.
 */
export function resolveSafePluginEntryPath({
  rootDir,
  explicit,
  conventions,
  field,
  manifestPath,
}: ResolveSafePluginEntryPathOptions): string | null {
  if (explicit === false) return null

  if (explicit !== undefined) {
    if (typeof explicit !== "string" || !isSafePluginRelativePath(explicit)) {
      throw new Error(`${field}: ${JSON.stringify(explicit)} must be a safe relative path inside the plugin root`)
    }
    const path = resolveContainedPluginPath(rootDir, explicit, { mustExist: true })
    if (!path) {
      const resolved = resolve(rootDir, explicit)
      if (!existsSync(resolved)) {
        throw new Error(
          `boring plugin entry declared but not found: ${resolved}\n` +
            `  declared in: ${manifestPath}#boring`,
        )
      }
      throw new Error(`${field}: resolved path escapes plugin root: ${explicit}`)
    }
    return path
  }

  for (const candidate of conventions) {
    if (!isSafePluginRelativePath(candidate)) {
      throw new Error(`conventional ${field} path ${JSON.stringify(candidate)} is not a safe relative path`)
    }
    const path = resolveContainedPluginPath(rootDir, candidate, { mustExist: true })
    if (path) return path
    if (existsSync(resolve(rootDir, candidate))) {
      throw new Error(`conventional ${field} path escapes plugin root: ${candidate}`)
    }
  }
  return null
}

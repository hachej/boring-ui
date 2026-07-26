import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import { SandboxProviderError } from '../../shared/providerV1'

function invalidRoot(): never {
  throw new SandboxProviderError(
    'CONFIG_INVALID',
    'readonly workspace shell roots must exist and contain no symlinks or special files',
  )
}

async function inspectTree(path: string): Promise<void> {
  const stat = await lstat(path).catch(() => invalidRoot())
  if (stat.isSymbolicLink()) invalidRoot()
  if (stat.isFile()) return
  if (!stat.isDirectory()) invalidRoot()
  for (const name of await readdir(path)) {
    await inspectTree(join(path, name))
  }
}

/**
 * Strong bwrap mode needs every readonly bind source to exist before the
 * namespace is constructed. Reject symlinks throughout the protected tree so
 * a link inside a readonly mount cannot escape to a writable sibling.
 */
export async function validateBwrapReadonlyWorkspaceRootsForSpawn(
  workspaceRoot: string,
  readonlyPaths: readonly string[],
): Promise<string[]> {
  if (!isAbsolute(workspaceRoot)) invalidRoot()
  const rootStat = await lstat(workspaceRoot).catch(() => invalidRoot())
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) invalidRoot()

  const canonicalRoot = await realpath(workspaceRoot).catch(() => invalidRoot())
  const roots: string[] = []
  for (const readonlyPath of readonlyPaths) {
    const segments = readonlyPath.replace(/\\/g, '/').split('/')
    if (
      readonlyPath.length === 0
      || readonlyPath.startsWith('/')
      || readonlyPath.includes('\0')
      || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) invalidRoot()

    let current = workspaceRoot
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment)
      const stat = await lstat(current).catch(() => invalidRoot())
      if (stat.isSymbolicLink()) invalidRoot()
      if (index < segments.length - 1 && !stat.isDirectory()) invalidRoot()
    }

    const canonical = await realpath(current).catch(() => invalidRoot())
    const rel = relative(canonicalRoot, canonical)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) invalidRoot()
    roots.push(current)
  }
  return roots
}

/** Construction-time qualification additionally rejects links/special files inside each protected tree. */
export async function validateBwrapReadonlyWorkspaceRoots(
  workspaceRoot: string,
  readonlyPaths: readonly string[],
): Promise<void> {
  const roots = await validateBwrapReadonlyWorkspaceRootsForSpawn(workspaceRoot, readonlyPaths)
  for (const root of roots) await inspectTree(root)
}

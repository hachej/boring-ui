import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { AgentSkillResource } from '../../shared/skill-resource'

function relativePathWithin(root: string, candidate: string): string | undefined {
  const rel = relative(resolve(root), resolve(candidate))
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return undefined
  return rel
}

/**
 * Resolve one Pi loader path from runtime coordinates. Workspace-local paths
 * require an explicit RuntimeBundle.storageRoot; remote guest paths without a
 * host mirror are withheld rather than guessed.
 */
export function projectRuntimeSkillPathToHost(input: {
  readonly skillPath: string
  readonly runtimeWorkspaceRoot: string
  readonly hostStorageRoot?: string
}): string | undefined {
  const { skillPath, runtimeWorkspaceRoot, hostStorageRoot } = input
  if (!isAbsolute(skillPath)) return skillPath

  const rel = relativePathWithin(runtimeWorkspaceRoot, skillPath)
  if (rel === undefined) return skillPath
  if (!hostStorageRoot) return undefined
  if (resolve(hostStorageRoot) === resolve(runtimeWorkspaceRoot)) return skillPath
  return rel === '' ? resolve(hostStorageRoot) : resolve(hostStorageRoot, rel)
}

/** Project an internally host-loaded workspace skill to a tool-readable locator. */
export function locateHostWorkspaceSkill(input: {
  readonly filePath: string
  readonly runtimeWorkspaceRoot: string
  readonly hostStorageRoot?: string
}): AgentSkillResource | undefined {
  const { filePath, runtimeWorkspaceRoot, hostStorageRoot } = input
  if (!hostStorageRoot || resolve(hostStorageRoot) === resolve(runtimeWorkspaceRoot)) return undefined
  const rel = relativePathWithin(hostStorageRoot, filePath)
  return rel === undefined || rel === ''
    ? undefined
    : { filesystem: 'user', path: rel.split(sep).join('/') }
}

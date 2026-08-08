import { realpath, stat } from 'node:fs/promises'
import { sep } from 'node:path'

import {
  ENVIRONMENT_MOUNT_ERROR_CODES,
  type SandboxEnvironmentMountV1,
} from '../../shared/mounts'
import { SandboxProviderError } from '../../shared/providerV1'

function invalid(message: string, cause?: unknown): SandboxProviderError {
  return new SandboxProviderError(
    ENVIRONMENT_MOUNT_ERROR_CODES.invalid,
    message,
    cause === undefined ? undefined : { cause },
  )
}

function isSameOrInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

/**
 * Resolves an environment mount set exactly once, at lease/pair create time
 * (gh-1123 mount hygiene). Every `sourceRoot` is realpath-resolved here and
 * the resolved paths are what every subsequent exec binds — bwrap re-spawns
 * per command, so per-exec re-resolution would reopen the check-then-use
 * race. `--bind` itself still follows symlinks at mount time; this rule
 * bounds that residual risk to create time.
 *
 * Rejections use the stable `SANDBOX_MOUNT_INVALID` code:
 * - source root missing or not a directory
 * - resolved source root aliasing the primary workspace root (shadowing)
 */
export async function resolveEnvironmentMounts(
  workspaceRoot: string,
  mounts: readonly SandboxEnvironmentMountV1[],
): Promise<readonly SandboxEnvironmentMountV1[]> {
  if (mounts.length === 0) return []

  const resolvedWorkspaceRoot = await realpath(workspaceRoot)
  const resolved: SandboxEnvironmentMountV1[] = []
  for (const mount of mounts) {
    let sourceRoot: string
    try {
      sourceRoot = await realpath(mount.sourceRoot)
    } catch (error) {
      throw invalid(
        `mount source root does not exist: ${mount.sourceRoot}`,
        error,
      )
    }

    const stats = await stat(sourceRoot)
    if (!stats.isDirectory()) {
      throw invalid(`mount source root is not a directory: ${mount.sourceRoot}`)
    }

    if (
      isSameOrInside(sourceRoot, resolvedWorkspaceRoot)
      || isSameOrInside(resolvedWorkspaceRoot, sourceRoot)
    ) {
      throw invalid(
        `mount source root must not alias the primary workspace root: ${mount.sourceRoot}`,
      )
    }

    resolved.push({ ...mount, sourceRoot })
  }

  return resolved
}

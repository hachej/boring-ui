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
 * Accepted residual TOCTOU (documented for the SBX gates): between the
 * realpath resolution here and the first bwrap bind (and on every re-spawn),
 * a path component of a resolved sourceRoot could be swapped for a symlink,
 * and `--bind` would follow it at mount time. We accept this window because
 * bwrap only ever receives the create-time resolved paths (no per-exec
 * re-derivation from untrusted input), sourceRoots come from trusted
 * host-side configuration, and full elimination would require fd-based
 * binds (open the directory once, bind the fd), which bwrap's CLI contract
 * does not offer today.
 *
 * Rejections use the stable `SANDBOX_MOUNT_INVALID` code:
 * - source root missing or not a directory
 * - resolved source root aliasing the primary workspace root (shadowing)
 * - the same resolved source root appearing twice, or one mount's resolved
 *   source root nesting inside another's (ancestor/descendant in either
 *   declaration order) — overlapping sources make bind semantics
 *   order-dependent and alias the same host data at two logical paths
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

    for (const prior of resolved) {
      if (prior.sourceRoot === sourceRoot) {
        throw invalid(
          `duplicate mount source root: ${mount.sourceRoot} resolves to ${sourceRoot}, already mounted at ${prior.logicalPath}`,
        )
      }
      if (
        isSameOrInside(sourceRoot, prior.sourceRoot)
        || isSameOrInside(prior.sourceRoot, sourceRoot)
      ) {
        throw invalid(
          `overlapping mount source roots: ${sourceRoot} and ${prior.sourceRoot} nest within each other`,
        )
      }
    }

    resolved.push({ ...mount, sourceRoot })
  }

  return resolved
}

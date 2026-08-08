import { isAbsolute, posix } from 'node:path'

import {
  ENVIRONMENT_MOUNT_NAMESPACE,
  type SandboxEnvironmentMountV1,
} from '../../shared/mounts'

const SANDBOX_HOME = '/workspace'
const MAX_WORKSPACE_ROOT_LENGTH = 4096

export const BWRAP_TIMEOUT_SECONDS = 30
export const KILL_GRACE_SECONDS = 5

export const RO_BIND_DIRS = [
  '/usr',
  '/lib',
  '/lib64',
  '/bin',
  '/sbin',
  '/etc',
  '/etc/ssl',
  '/etc/ca-certificates',
]

export const RO_BIND_TRY_DIRS = [
  // Ubuntu/systemd commonly makes /etc/resolv.conf a symlink to this
  // directory. The sandbox already shares the network namespace, but DNS
  // still fails if the symlink target is hidden by the tmpfs root.
  '/run/systemd/resolve',
]

function validateHostPath(value: string, name: string): void {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`)
  }

  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`)
  }

  for (const segment of value.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new Error(`${name} must not contain traversal segments`)
    }
  }

  if (value.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`)
  }

  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`${name} must not contain newlines`)
  }

  if (Buffer.byteLength(value, 'utf8') > MAX_WORKSPACE_ROOT_LENGTH) {
    throw new Error(`${name} exceeds max path length`)
  }
}

function validateWorkspaceRoot(workspaceRoot: string): void {
  validateHostPath(workspaceRoot, 'workspaceRoot')
}

function validateMounts(
  mounts: readonly SandboxEnvironmentMountV1[],
  sandboxHome: string,
): void {
  const seenLogicalPaths = new Set<string>()
  for (const mount of mounts) {
    validateHostPath(mount.sourceRoot, 'mount sourceRoot')
    validateHostPath(mount.logicalPath, 'mount logicalPath')

    if (posix.normalize(mount.logicalPath) !== mount.logicalPath) {
      throw new Error('mount logicalPath must be normalized')
    }

    // Dedicated namespace outside the primary rw root: avoids bind shadowing
    // and readonly-under-HOME breakage (gh-1123 mount hygiene).
    if (!mount.logicalPath.startsWith(`${ENVIRONMENT_MOUNT_NAMESPACE}/`)) {
      throw new Error(
        `mount logicalPath must live under ${ENVIRONMENT_MOUNT_NAMESPACE}/`,
      )
    }

    if (
      mount.logicalPath === sandboxHome
      || mount.logicalPath.startsWith(`${sandboxHome}/`)
    ) {
      throw new Error('mount logicalPath must not live under the workspace root')
    }

    if (seenLogicalPaths.has(mount.logicalPath)) {
      throw new Error(`duplicate mount logicalPath: ${mount.logicalPath}`)
    }
    seenLogicalPaths.add(mount.logicalPath)
  }
}

export interface BwrapArgsOptions {
  extraArgs?: string[]
  postWorkspaceArgs?: string[]
  network?: 'shared' | 'isolated'
  newSession?: boolean
  dropAllCapabilities?: boolean
  /**
   * Sandbox-visible home/primary root. Defaults to `/workspace`; reconciles
   * the `local-sandbox` strategy's `sandboxRoot` option (gh-1123 slice 1).
   */
  sandboxHome?: string
  /**
   * Environment mounts (gh-1123). Source roots must already be
   * realpath-resolved once at lease create; this builder re-emits the
   * resolved paths verbatim on every spawn.
   */
  mounts?: readonly SandboxEnvironmentMountV1[]
}

export function buildBwrapArgs(workspaceRoot: string, options?: BwrapArgsOptions): string[] {
  validateWorkspaceRoot(workspaceRoot)

  const sandboxHome = options?.sandboxHome ?? SANDBOX_HOME
  validateHostPath(sandboxHome, 'sandboxHome')
  const mounts = options?.mounts ?? []
  validateMounts(mounts, sandboxHome)

  const network = options?.network ?? 'shared'
  const args: string[] = [
    '--unshare-all',
    ...(network === 'shared' ? ['--share-net'] : []),
    '--die-with-parent',
    ...(options?.newSession === false ? [] : ['--new-session']),
    ...(options?.dropAllCapabilities ? ['--cap-drop', 'ALL'] : []),
    '--tmpfs', '/',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
  ]

  for (const dir of RO_BIND_DIRS) {
    args.push('--ro-bind', dir, dir)
  }

  for (const dir of RO_BIND_TRY_DIRS) {
    args.push('--ro-bind-try', dir, dir)
  }

  if (options?.extraArgs) {
    args.push(...options.extraArgs)
  }

  args.push(
    '--bind',
    workspaceRoot,
    sandboxHome,
    '--chdir',
    sandboxHome,
    '--setenv',
    'HOME',
    sandboxHome,
  )

  for (const mount of mounts) {
    args.push(
      mount.access === 'rw' ? '--bind' : '--ro-bind',
      mount.sourceRoot,
      mount.logicalPath,
    )
  }

  if (options?.postWorkspaceArgs) {
    args.push(...options.postWorkspaceArgs)
  }

  args.push('--')

  return args
}

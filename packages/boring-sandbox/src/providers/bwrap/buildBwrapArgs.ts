import { isAbsolute } from 'node:path'

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

function validateWorkspaceRoot(workspaceRoot: string): void {
  if (workspaceRoot.length === 0) {
    throw new Error('workspaceRoot must not be empty')
  }

  if (!isAbsolute(workspaceRoot)) {
    throw new Error('workspaceRoot must be an absolute path')
  }

  for (const segment of workspaceRoot.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new Error('workspaceRoot must not contain traversal segments')
    }
  }

  if (workspaceRoot.includes('\0')) {
    throw new Error('workspaceRoot must not contain null bytes')
  }

  if (workspaceRoot.includes('\n') || workspaceRoot.includes('\r')) {
    throw new Error('workspaceRoot must not contain newlines')
  }

  if (Buffer.byteLength(workspaceRoot, 'utf8') > MAX_WORKSPACE_ROOT_LENGTH) {
    throw new Error('workspaceRoot exceeds max path length')
  }
}

export interface BwrapArgsOptions {
  extraArgs?: string[]
  postWorkspaceArgs?: string[]
  network?: 'shared' | 'isolated'
  newSession?: boolean
  dropAllCapabilities?: boolean
}

export function buildBwrapArgs(workspaceRoot: string, options?: BwrapArgsOptions): string[] {
  validateWorkspaceRoot(workspaceRoot)

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
    SANDBOX_HOME,
    '--chdir',
    SANDBOX_HOME,
    '--setenv',
    'HOME',
    SANDBOX_HOME,
  )

  if (options?.postWorkspaceArgs) {
    args.push(...options.postWorkspaceArgs)
  }

  args.push('--')

  return args
}

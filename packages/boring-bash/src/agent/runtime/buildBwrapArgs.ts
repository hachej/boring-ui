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
  /**
   * Workspace-relative prefixes re-bound readonly on top of the writable
   * workspace mount, so spawned shells cannot mutate protected paths that the
   * Operations layer already refuses to mutate.
   */
  readonlyPaths?: readonly string[]
}

function normalizeReadonlyPath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('readonly path must be a non-empty workspace-relative path')
  }
  if (input.includes('\0') || input.includes('\n') || input.includes('\r')) {
    throw new Error('readonly path must not contain null bytes or newlines')
  }
  const normalized = input.replace(/\\/g, '/')
  if (normalized.startsWith('/')) {
    throw new Error('readonly path must be workspace-relative')
  }
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0 || segments.includes('..')) {
    throw new Error('readonly path must not be empty or contain traversal segments')
  }
  return segments.join('/')
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

  // Order matters: bwrap applies binds sequentially, so these must follow the
  // writable workspace bind to shadow it. `--ro-bind-try` keeps a policy entry
  // that does not exist yet from failing the whole spawn.
  for (const path of options?.readonlyPaths ?? []) {
    const relative = normalizeReadonlyPath(path)
    args.push('--ro-bind-try', `${workspaceRoot.replace(/\/$/, '')}/${relative}`, `${SANDBOX_HOME}/${relative}`)
  }

  if (options?.postWorkspaceArgs) {
    args.push(...options.postWorkspaceArgs)
  }

  args.push('--')

  return args
}

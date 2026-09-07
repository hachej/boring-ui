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

export type BwrapNamespaceProfile = 'full' | 'docker'

export interface BwrapArgsOptions {
  extraArgs?: string[]
  postWorkspaceArgs?: string[]
  network?: 'shared' | 'isolated'
  newSession?: boolean
  dropAllCapabilities?: boolean
  /**
   * `full` preserves bwrap's default isolation by unsharing every supported
   * namespace. `docker` avoids a nested user namespace for hardened outer
   * containers that forbid mounting proc there; it must drop all capabilities.
   */
  namespaceProfile?: BwrapNamespaceProfile
  /**
   * Workspace-relative prefixes re-bound readonly on top of the writable
   * workspace mount, so spawned shells cannot mutate protected paths that the
   * Operations layer already refuses to mutate.
   */
  readonlyPaths?: readonly string[]
}

const DOCKER_FORBIDDEN_RAW_FLAGS = new Set([
  '--args',
  '--cap-add',
  '--share-net',
  '--unshare-all',
  '--userns',
  '--userns2',
  '--pidns',
  '--uid',
  '--gid',
  '--disable-userns',
  '--assert-userns-disabled',
  '--userns-block-fd',
])

function assertDockerRawArgsSafe(args: readonly string[] | undefined, source: string): void {
  for (const arg of args ?? []) {
    const flag = arg.split('=', 1)[0]
    if (
      flag === '--'
      || flag.startsWith('--unshare-')
      || DOCKER_FORBIDDEN_RAW_FLAGS.has(flag)
    ) {
      throw new Error(`docker namespace profile forbids ${flag} in ${source}`)
    }
  }
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
  if (network !== 'shared' && network !== 'isolated') {
    throw new Error(`unsupported bwrap network mode: ${String(network)}`)
  }
  const namespaceProfile = options?.namespaceProfile ?? 'full'
  if (namespaceProfile !== 'full' && namespaceProfile !== 'docker') {
    throw new Error(`unsupported bwrap namespace profile: ${String(namespaceProfile)}`)
  }
  if (namespaceProfile === 'docker') {
    // Raw argument seams are needed for controlled mounts, but must not be able
    // to counteract the namespace/capability policy emitted below.
    assertDockerRawArgsSafe(options?.extraArgs, 'extraArgs')
    assertDockerRawArgsSafe(options?.postWorkspaceArgs, 'postWorkspaceArgs')
  }
  const namespaceArgs = namespaceProfile === 'full'
    ? [
        '--unshare-all',
        ...(network === 'shared' ? ['--share-net'] : []),
      ]
    : [
        // bwrap always creates a mount namespace. Avoid only the nested user
        // namespace that some hardened Docker hosts reject when mounting proc.
        '--unshare-ipc',
        '--unshare-pid',
        '--unshare-uts',
        '--unshare-cgroup',
        ...(network === 'isolated' ? ['--unshare-net'] : []),
      ]
  // Docker-compatible mode executes outside a user namespace while the outer
  // container has SYS_ADMIN. Capabilities must never reach the sandbox command.
  const dropAllCapabilities = namespaceProfile === 'docker' || options?.dropAllCapabilities === true
  const args: string[] = [
    ...namespaceArgs,
    '--die-with-parent',
    ...(options?.newSession === false ? [] : ['--new-session']),
    ...(dropAllCapabilities ? ['--cap-drop', 'ALL'] : []),
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

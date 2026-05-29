import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BoringAgentRuntimePaths } from '../../workspace/runtimeLayout'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningExecResult } from '../../workspace/provisioning'
import {
  assertRealPathWithinWorkspace,
  validatePath,
} from '../../workspace/paths'
import { buildBwrapArgs } from '../../sandbox/bwrap/buildBwrapArgs'

const LOCAL_SANDBOX_WORKSPACE_ROOT = '/workspace'

interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

type CommandRunner = (command: string, args: string[], opts: Required<ExecOptions>) => Promise<WorkspaceProvisioningExecResult | void>

function sourceToPath(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source
}

async function assertExistingInsideWorkspace(root: string, relPath: string): Promise<string | null> {
  const absPath = validatePath(root, relPath)
  try {
    await assertRealPathWithinWorkspace(root, absPath)
    return absPath
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
}

async function prepareWritablePath(root: string, relPath: string): Promise<string> {
  const absPath = validatePath(root, relPath)
  await mkdir(dirname(absPath), { recursive: true })
  await assertRealPathWithinWorkspace(root, dirname(absPath))

  try {
    const targetStat = await lstat(absPath)
    if (targetStat.isSymbolicLink()) {
      throw Object.assign(new Error('Target path is a symlink'), {
        statusCode: 400,
        reason: 'symlink-escape',
        requestedPath: relPath,
      })
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }

  return absPath
}

async function spawnCommand(command: string, args: string[], opts: Required<ExecOptions>): Promise<WorkspaceProvisioningExecResult> {
  return await new Promise<WorkspaceProvisioningExecResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timeout: NodeJS.Timeout | null = null
    let settled = false

    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (error) rejectPromise(error)
      else resolvePromise({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', settle)
    child.on('close', (code) => {
      if (code === 0) {
        settle()
        return
      }
      const message = Buffer.concat(stderr).toString('utf8').trim()
      settle(new Error(`Command failed (${command}) with exit code ${code ?? 'unknown'}${message ? `: ${message}` : ''}`))
    })

    timeout = setTimeout(() => {
      child.kill('SIGTERM')
      settle(new Error(`Command timed out after ${opts.timeoutMs}ms: ${command}`))
    }, opts.timeoutMs)
  })
}

function defaultExecOptions(paths: BoringAgentRuntimePaths, opts?: ExecOptions): Required<ExecOptions> {
  return {
    cwd: opts?.cwd ?? paths.workspaceRoot,
    env: opts?.env ?? {},
    timeoutMs: opts?.timeoutMs ?? 120_000,
  }
}

function mapWorkspacePathToLocalSandbox(paths: BoringAgentRuntimePaths, value: string): string {
  const absolute = isAbsolute(value) ? value : resolve(paths.workspaceRoot, value)
  const relPath = relative(paths.workspaceRoot, absolute)
  if (relPath === '') return LOCAL_SANDBOX_WORKSPACE_ROOT
  if (relPath === '..' || relPath.startsWith(`..${sep}`)) return value
  return `${LOCAL_SANDBOX_WORKSPACE_ROOT}/${relPath.split(sep).join('/')}`
}

function mapValueToLocalSandbox(paths: BoringAgentRuntimePaths, value: string): string {
  return value.startsWith(paths.workspaceRoot)
    ? mapWorkspacePathToLocalSandbox(paths, value)
    : value
}

function mapEnvToLocalSandbox(paths: BoringAgentRuntimePaths, env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, mapValueToLocalSandbox(paths, value)]),
  )
}

function sanitizeInstallSourcePart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized.length > 0 ? sanitized : 'source'
}

async function copyExternalSourceIntoWorkspace(
  paths: BoringAgentRuntimePaths,
  sourcePath: string,
  opts: { kind: string; id: string; fingerprint: string },
): Promise<string> {
  const fingerprint = opts.fingerprint.replace(/^sha256:/, '')
  const relTarget = `.boring-agent/tmp/${sanitizeInstallSourcePart(opts.kind)}-${sanitizeInstallSourcePart(opts.id)}-${sanitizeInstallSourcePart(fingerprint)}-source`
  const absTarget = validatePath(paths.workspaceRoot, relTarget)
  await rm(absTarget, { recursive: true, force: true })
  await mkdir(dirname(absTarget), { recursive: true })
  await assertRealPathWithinWorkspace(paths.workspaceRoot, dirname(absTarget))
  const sourceStat = await stat(sourcePath)
  await cp(sourcePath, absTarget, {
    recursive: sourceStat.isDirectory(),
    force: false,
    errorOnExist: true,
  })
  if (sourceStat.isDirectory()) {
    await stripWorkspaceProtocolDeps(absTarget)
  }
  return `${LOCAL_SANDBOX_WORKSPACE_ROOT}/${relTarget}`
}

/**
 * When the source is a pnpm-monorepo package, its package.json may carry
 * `workspace:*` dependency values that npm rejects with EUNSUPPORTEDPROTOCOL
 * once `--install-links` forces actual resolution. The source's node_modules
 * is already copied alongside the package files, so dropping these entries
 * is safe: npm sees no unmet deps and skips fetching, while the runtime
 * still finds them under the copied node_modules tree.
 */
async function stripWorkspaceProtocolDeps(packageDir: string): Promise<void> {
  const pkgJsonPath = `${packageDir}/package.json`
  let raw: string
  try {
    raw = await readFile(pkgJsonPath, 'utf8')
  } catch {
    return
  }
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  let mutated = false
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field] as Record<string, string> | undefined
    if (!deps) continue
    for (const [name, value] of Object.entries(deps)) {
      if (typeof value === 'string' && value.startsWith('workspace:')) {
        delete deps[name]
        mutated = true
      }
    }
    if (Object.keys(deps).length === 0) delete pkg[field]
  }
  if (mutated) {
    await writeFile(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  }
}

function createWorkspaceFs(workspaceRoot: string): WorkspaceProvisioningAdapter['workspaceFs'] {
  return {
    async exists(workspaceRelativePath) {
      const absPath = await assertExistingInsideWorkspace(workspaceRoot, workspaceRelativePath)
      if (!absPath) return false
      await lstat(absPath)
      return true
    },
    async rm(workspaceRelativePath) {
      const absPath = await assertExistingInsideWorkspace(workspaceRoot, workspaceRelativePath)
      if (!absPath) return
      await rm(absPath, { recursive: true, force: true })
    },
    async mkdir(workspaceRelativePath) {
      const absPath = validatePath(workspaceRoot, workspaceRelativePath)
      await mkdir(absPath, { recursive: true })
      await assertRealPathWithinWorkspace(workspaceRoot, absPath)
    },
    async writeText(workspaceRelativePath, content) {
      const absPath = await prepareWritablePath(workspaceRoot, workspaceRelativePath)
      await writeFile(absPath, content, 'utf8')
    },
    async readText(workspaceRelativePath) {
      const absPath = await assertExistingInsideWorkspace(workspaceRoot, workspaceRelativePath)
      if (!absPath) return null
      return await readFile(absPath, 'utf8')
    },
    async copyFromHost(hostSourcePath, workspaceRelativeTarget) {
      const sourcePath = sourceToPath(hostSourcePath)
      const absTarget = await prepareWritablePath(workspaceRoot, workspaceRelativeTarget)
      const sourceStat = await stat(sourcePath)
      await cp(sourcePath, absTarget, {
        recursive: sourceStat.isDirectory(),
        force: false,
        errorOnExist: true,
      })
    },
  }
}

export function createDirectProvisioningAdapter(
  paths: BoringAgentRuntimePaths,
  runner: CommandRunner = spawnCommand,
): WorkspaceProvisioningAdapter {
  return {
    mode: 'direct',
    async exec(command, args, opts) {
      return await runner(command, args, defaultExecOptions(paths, opts))
    },
    async resolveInstallSource(source) {
      return sourceToPath(source)
    },
    workspaceFs: createWorkspaceFs(paths.workspaceRoot),
    getRuntimeCacheRoot() {
      return paths.cache
    },
  }
}

export function createLocalProvisioningAdapter(
  paths: BoringAgentRuntimePaths,
  runner: CommandRunner = spawnCommand,
): WorkspaceProvisioningAdapter {
  const sourceMounts = new Map<string, string>()

  return {
    mode: 'local',
    async exec(command, args, opts) {
      const execOpts = defaultExecOptions(paths, opts)
      const bwrapArgs = buildBwrapArgs(paths.workspaceRoot, {
        extraArgs: [
          '--dir', '/mnt',
          '--dir', '/mnt/boring-agent-sources',
          ...[...sourceMounts.entries()].flatMap(([host, sandbox]) => ['--ro-bind', host, sandbox]),
        ],
      })
      return await runner('bwrap', [
        ...bwrapArgs,
        mapValueToLocalSandbox(paths, command),
        ...args.map((arg) => mapValueToLocalSandbox(paths, arg)),
      ], {
        ...execOpts,
        cwd: paths.workspaceRoot,
        env: mapEnvToLocalSandbox(paths, execOpts.env),
      })
    },
    async resolveInstallSource(source, opts) {
      const hostPath = sourceToPath(source)
      const realWorkspaceRoot = await realpath(paths.workspaceRoot)
      const realSource = await realpath(hostPath)
      const relPath = relative(realWorkspaceRoot, realSource)
      if (relPath === '') return LOCAL_SANDBOX_WORKSPACE_ROOT
      if (!relPath.startsWith('..') && !isAbsolute(relPath)) {
        return `${LOCAL_SANDBOX_WORKSPACE_ROOT}/${relPath.split(sep).join('/')}`
      }

      return await copyExternalSourceIntoWorkspace(paths, realSource, opts)
    },
    workspaceFs: createWorkspaceFs(paths.workspaceRoot),
    getRuntimeCacheRoot() {
      return paths.cache
    },
  }
}

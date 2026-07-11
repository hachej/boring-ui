import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BoringAgentRuntimePaths } from '@hachej/boring-sandbox/providers/node-workspace'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningExecResult } from '../../workspace/provisioning'
import {
  assertRealPathWithinWorkspace,
  buildBwrapArgs,
  validatePath,
} from '@hachej/boring-sandbox/providers'
import {
  packProvisioningArtifact,
  resolveArtifactInstallSource,
} from '../../workspace/provisioning/packArtifact'

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

async function assertExistingInsideWorkspace(
  root: string,
  relPath: string,
  enforceSymlinkBoundary: boolean,
): Promise<string | null> {
  const absPath = validatePath(root, relPath)
  try {
    if (enforceSymlinkBoundary) {
      await assertRealPathWithinWorkspace(root, absPath)
    } else {
      // Direct mode has no sandbox boundary; a lexical validatePath() is
      // enough. Skip the realpath check so npm-created bin symlinks pointing
      // at the host's npm-global install (e.g. boring-ui) don't trip the
      // sandbox guard during the post-install output existence probe.
      await lstat(absPath)
    }
    return absPath
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
}

async function prepareWritablePath(
  root: string,
  relPath: string,
  enforceSymlinkBoundary: boolean,
): Promise<string> {
  const absPath = validatePath(root, relPath)
  await mkdir(dirname(absPath), { recursive: true })
  if (enforceSymlinkBoundary) {
    await assertRealPathWithinWorkspace(root, dirname(absPath))
  }

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

function createWorkspaceFs(
  workspaceRoot: string,
  opts: { enforceSymlinkBoundary: boolean },
): WorkspaceProvisioningAdapter['workspaceFs'] {
  const { enforceSymlinkBoundary } = opts
  return {
    async exists(workspaceRelativePath) {
      // Existence is a target-reachability check used by provisioning's
      // skip-vs-reinstall probe, not a content read — so it does NOT enforce
      // the realpath boundary. That lets an in-workspace bin shim pointing at
      // the host's npm-global install (e.g.
      // .boring-agent/node/node_modules/.bin/boring-ui) report as present
      // instead of tripping the sandbox guard and aborting provisioning. The
      // lexical validatePath() still rejects ../ escapes, and a boolean
      // reachability check leaks no out-of-sandbox content, so this stays safe
      // in sandbox modes (local/bwrap, vercel-sandbox) too. Content ops below
      // keep the strict realpath boundary via enforceSymlinkBoundary.
      //
      // Use stat() (follows symlinks), not lstat(): a dangling shim — e.g. the
      // global CLI was moved/uninstalled — must report missing so the probe
      // reinstalls and self-heals, rather than skipping forever and bricking
      // the workspace on a broken link.
      const absPath = validatePath(workspaceRoot, workspaceRelativePath)
      try {
        await stat(absPath)
        return true
      } catch (error: unknown) {
        if ((error as { code?: string }).code === 'ENOENT') return false
        throw error
      }
    },
    async rm(workspaceRelativePath) {
      const absPath = await assertExistingInsideWorkspace(workspaceRoot, workspaceRelativePath, enforceSymlinkBoundary)
      if (!absPath) return
      await rm(absPath, { recursive: true, force: true })
    },
    async mkdir(workspaceRelativePath) {
      const absPath = validatePath(workspaceRoot, workspaceRelativePath)
      await mkdir(absPath, { recursive: true })
      if (enforceSymlinkBoundary) {
        await assertRealPathWithinWorkspace(workspaceRoot, absPath)
      }
    },
    async writeText(workspaceRelativePath, content) {
      const absPath = await prepareWritablePath(workspaceRoot, workspaceRelativePath, enforceSymlinkBoundary)
      await writeFile(absPath, content, 'utf8')
    },
    async readText(workspaceRelativePath) {
      const absPath = await assertExistingInsideWorkspace(workspaceRoot, workspaceRelativePath, enforceSymlinkBoundary)
      if (!absPath) return null
      return await readFile(absPath, 'utf8')
    },
    async copyFromHost(hostSourcePath, workspaceRelativeTarget) {
      const sourcePath = sourceToPath(hostSourcePath)
      const absTarget = await prepareWritablePath(workspaceRoot, workspaceRelativeTarget, enforceSymlinkBoundary)
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
    workspaceFs: createWorkspaceFs(paths.workspaceRoot, { enforceSymlinkBoundary: false }),
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
  const workspaceFs = createWorkspaceFs(paths.workspaceRoot, { enforceSymlinkBoundary: true })

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

      // External source: pack it into a self-contained in-workspace tarball via
      // the SAME path the vercel-sandbox mode uses, so `npm install <.tgz>` /
      // `uv pip install <.tar.gz>` extract a real copy and leave no directory
      // symlink escaping the workspace (and invisible inside the bwrap mount).
      return await resolveArtifactInstallSource({
        workspaceFs,
        prepareArtifact: packProvisioningArtifact,
        runtimeTmpDir: `${LOCAL_SANDBOX_WORKSPACE_ROOT}/.boring-agent/tmp`,
        source: realSource,
        opts,
      })
    },
    workspaceFs,
    getRuntimeCacheRoot() {
      return paths.cache
    },
  }
}

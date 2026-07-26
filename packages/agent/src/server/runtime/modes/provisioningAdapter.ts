import { spawn } from 'node:child_process'
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BoringAgentRuntimePaths } from '@hachej/boring-sandbox/providers/node-workspace'
import type { Workspace } from '../../../shared/workspace'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningExecResult } from '../../workspace/provisioning'
import type { AgentRuntimeHostOperations } from '../runtimeHost'
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
  runtimeHost: AgentRuntimeHostOperations,
): Promise<string | null> {
  const absPath = runtimeHost.validatePath(root, relPath)
  try {
    if (enforceSymlinkBoundary) {
      await runtimeHost.assertRealPathWithinWorkspace(root, absPath)
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
  runtimeHost: AgentRuntimeHostOperations,
): Promise<string> {
  const absPath = runtimeHost.validatePath(root, relPath)
  await mkdir(dirname(absPath), { recursive: true })
  if (enforceSymlinkBoundary) {
    await runtimeHost.assertRealPathWithinWorkspace(root, dirname(absPath))
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

async function ensureWorkspaceParent(workspace: Workspace, workspaceRelativePath: string): Promise<void> {
  const parent = dirname(workspaceRelativePath).split(sep).join('/')
  if (parent === '.' || parent === '') return
  try {
    await workspace.stat(parent)
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
    await workspace.mkdir(parent, { recursive: true })
  }
}

async function copyHostIntoWorkspace(
  sourcePath: string,
  workspaceRelativeTarget: string,
  workspace: Workspace,
  workspaceHostRoot: string | undefined,
): Promise<void> {
  let targetExists = true
  try {
    await workspace.stat(workspaceRelativeTarget)
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
    targetExists = false
  }
  if (targetExists) throw new Error('provisioning copy target already exists')
  const sourceStat = await stat(sourcePath)
  if (sourceStat.isDirectory()) {
    await workspace.mkdir(workspaceRelativeTarget, { recursive: true })
    for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
      await copyHostIntoWorkspace(
        resolve(sourcePath, entry.name),
        `${workspaceRelativeTarget.replace(/\/$/, '')}/${entry.name}`,
        workspace,
        workspaceHostRoot,
      )
    }
    return
  }
  await ensureWorkspaceParent(workspace, workspaceRelativeTarget)
  if (!sourceStat.isFile()) return
  if (!workspace.writeBinaryFile) throw new Error('Workspace binary writes are required for provisioning copy')
  await workspace.writeBinaryFile(workspaceRelativeTarget, new Uint8Array(await readFile(sourcePath)))
  if (workspaceHostRoot) {
    await chmod(resolve(workspaceHostRoot, workspaceRelativeTarget), sourceStat.mode)
  }
}

function createWorkspaceFs(
  workspaceRoot: string,
  opts: {
    enforceSymlinkBoundary: boolean
    runtimeHost: AgentRuntimeHostOperations
    workspace?: Workspace
  },
): WorkspaceProvisioningAdapter['workspaceFs'] {
  const { enforceSymlinkBoundary, runtimeHost, workspace } = opts
  const exists = async (workspaceRelativePath: string): Promise<boolean> => {
    // Reachability probe intentionally follows an in-workspace shim to an
    // external runtime install; it reads no content and remains lexically confined.
    const absPath = runtimeHost.validatePath(workspaceRoot, workspaceRelativePath)
    try {
      await stat(absPath)
      return true
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT') return false
      throw error
    }
  }
  if (workspace) {
    return {
      exists,
      async rm(workspaceRelativePath) {
        try {
          await workspace.unlink(workspaceRelativePath)
        } catch (error: unknown) {
          if ((error as { code?: string }).code !== 'ENOENT') throw error
        }
      },
      async mkdir(workspaceRelativePath) {
        await workspace.mkdir(workspaceRelativePath, { recursive: true })
      },
      async writeText(workspaceRelativePath, content) {
        await ensureWorkspaceParent(workspace, workspaceRelativePath)
        await workspace.writeFile(workspaceRelativePath, content)
      },
      async readText(workspaceRelativePath) {
        try {
          return await workspace.readFile(workspaceRelativePath)
        } catch (error: unknown) {
          if ((error as { code?: string }).code === 'ENOENT') return null
          throw error
        }
      },
      async copyFromHost(hostSourcePath, workspaceRelativeTarget) {
        await copyHostIntoWorkspace(
          sourceToPath(hostSourcePath),
          workspaceRelativeTarget,
          workspace,
          runtimeHost.getNodeWorkspaceHostRoot(workspace),
        )
      },
    }
  }
  return {
    exists,
    async rm(workspaceRelativePath) {
      const absPath = await assertExistingInsideWorkspace(workspaceRoot, workspaceRelativePath, enforceSymlinkBoundary, runtimeHost)
      if (!absPath) return
      await rm(absPath, { recursive: true, force: true })
    },
    async mkdir(workspaceRelativePath) {
      const absPath = runtimeHost.validatePath(workspaceRoot, workspaceRelativePath)
      await mkdir(absPath, { recursive: true })
      if (enforceSymlinkBoundary) {
        await runtimeHost.assertRealPathWithinWorkspace(workspaceRoot, absPath)
      }
    },
    async writeText(workspaceRelativePath, content) {
      const absPath = await prepareWritablePath(workspaceRoot, workspaceRelativePath, enforceSymlinkBoundary, runtimeHost)
      await writeFile(absPath, content, 'utf8')
    },
    async readText(workspaceRelativePath) {
      const absPath = await assertExistingInsideWorkspace(workspaceRoot, workspaceRelativePath, enforceSymlinkBoundary, runtimeHost)
      if (!absPath) return null
      return await readFile(absPath, 'utf8')
    },
    async copyFromHost(hostSourcePath, workspaceRelativeTarget) {
      const sourcePath = sourceToPath(hostSourcePath)
      const absTarget = await prepareWritablePath(workspaceRoot, workspaceRelativeTarget, enforceSymlinkBoundary, runtimeHost)
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
  runtimeHost: AgentRuntimeHostOperations,
  runner: CommandRunner = spawnCommand,
  workspace?: Workspace,
): WorkspaceProvisioningAdapter {
  return {
    mode: 'direct',
    async exec(command, args, opts) {
      return await runner(command, args, defaultExecOptions(paths, opts))
    },
    async resolveInstallSource(source) {
      return sourceToPath(source)
    },
    workspaceFs: createWorkspaceFs(paths.workspaceRoot, {
      enforceSymlinkBoundary: false,
      runtimeHost,
      workspace,
    }),
    getRuntimeCacheRoot() {
      return paths.cache
    },
  }
}

async function validateReadonlyMountSourcesForProvisioning(
  workspaceRoot: string,
  readonlyPaths: readonly string[],
): Promise<void> {
  const rootStat = await lstat(workspaceRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('readonly provisioning mount root is unsafe')
  const canonicalRoot = await realpath(workspaceRoot)
  for (const readonlyPath of readonlyPaths) {
    const segments = readonlyPath.replace(/\\/g, '/').split('/')
    if (!readonlyPath || readonlyPath.startsWith('/') || readonlyPath.includes('\0')
      || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('readonly provisioning mount path is unsafe')
    }
    let current = workspaceRoot
    for (const [index, segment] of segments.entries()) {
      current = resolve(current, segment)
      const currentStat = await lstat(current)
      if (currentStat.isSymbolicLink() || (index < segments.length - 1 && !currentStat.isDirectory())) {
        throw new Error('readonly provisioning mount path is unsafe')
      }
    }
    const canonical = await realpath(current)
    const rel = relative(canonicalRoot, canonical)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('readonly provisioning mount path escapes workspace')
    }
  }
}

export function createLocalProvisioningAdapter(
  paths: BoringAgentRuntimePaths,
  runtimeHost: AgentRuntimeHostOperations,
  runner: CommandRunner = spawnCommand,
  workspace?: Workspace,
  readonlyWorkspacePaths?: readonly string[],
): WorkspaceProvisioningAdapter {
  const sourceMounts = new Map<string, string>()
  const workspaceFs = createWorkspaceFs(paths.workspaceRoot, {
    enforceSymlinkBoundary: true,
    runtimeHost,
    workspace,
  })

  return {
    mode: 'local',
    async exec(command, args, opts) {
      const execOpts = defaultExecOptions(paths, opts)
      if (readonlyWorkspacePaths?.length) {
        await validateReadonlyMountSourcesForProvisioning(paths.workspaceRoot, readonlyWorkspacePaths)
      }
      const bwrapArgs = runtimeHost.buildBwrapArgs(paths.workspaceRoot, {
        readonlyWorkspacePaths,
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

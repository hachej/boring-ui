import { mkdtemp, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { Sandbox as VercelSandbox } from '@vercel/sandbox'

import { type SandboxHandleStore } from '../../../shared/sandbox-handle-store'
import { safeCapture, type TelemetrySink } from '../../../shared/telemetry'
import { getEnv, setEnvDefault } from '../../config/env'
import { createVercelSandboxExec } from '../../sandbox/vercel-sandbox/createVercelSandboxExec'
import { createVercelProvisioningAdapter } from '../../sandbox/vercel-sandbox/provisioningAdapter'
import { packProvisioningArtifact } from '../../workspace/provisioning/packArtifact'
import { isNodeFamilyRuntime, uvSetupCommandsForRuntime, VERCEL_UV_BIN } from '../../sandbox/snapshots/deploymentSnapshot'
import { FileHandleStore } from '../../sandbox/vercel-sandbox/FileHandleStore'
import {
  collectFiles,
  computeTemplateHash,
  packageTemplate,
  type PackageTemplateOptions,
} from '../../sandbox/vercel-sandbox/packageTemplate'
import {
  type ExpiredSandboxPolicy,
  type VercelSandboxClient,
  resolveSandboxHandle,
} from '../../sandbox/vercel-sandbox/resolveSandboxHandle'
import type { PeriodicSnapshotScheduler } from '../../sandbox/vercel-sandbox/periodicSnapshot'
import {
  createVercelSandboxWorkspace,
  VERCEL_SANDBOX_REMOTE_ROOT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '../../workspace/createVercelSandboxWorkspace'
import { createServerFileSearch } from '../createServerFileSearch'
import type { ModeContext, RuntimeModeAdapter } from '../mode'
import type { BoringAgentRuntimePaths } from '../../workspace/runtimeLayout'
import type { WorkspaceProvisioningAdapter } from '../../workspace/provisioning'

interface ModeLogger {
  info(message: string, metadata: Record<string, unknown>): void
  warn?(message: string, metadata?: Record<string, unknown>): void
}

type EnvGetter = (name: string) => string | undefined
const ORPHAN_GUARD_MAX_IDLE_MS = 24 * 60 * 60 * 1000
const VERCEL_SANDBOX_TIMEOUT_MS_ENV = 'BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS'
const VERCEL_SANDBOX_RUNTIME_ENV = 'BORING_AGENT_VERCEL_SANDBOX_RUNTIME'
const DEFAULT_VERCEL_SANDBOX_RUNTIME = 'node24'

export interface VercelSandboxModeAdapterOptions {
  store?: SandboxHandleStore
  vercelClient?: VercelSandboxClient
  getEnvVar?: EnvGetter
  logger?: ModeLogger
  packageTemplateOpts?: PackageTemplateOptions
  expiredSandboxPolicy?: ExpiredSandboxPolicy
  orphanGuardMaxIdleMs?: number | null
  snapshotScheduler?: PeriodicSnapshotScheduler | null
}

interface VercelAuthConfig {
  token: string
  teamId: string
  projectId?: string
}

type SandboxSetupStatus = 'started' | 'ok' | 'error'

function sandboxTelemetryProperties(
  ctx: ModeContext | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    runtimeMode: 'vercel-sandbox',
    workspaceId: ctx?.workspaceId,
    sessionId: ctx?.sessionId,
    requestId: ctx?.requestId,
    ...extra,
  }
}

function captureSandboxSetupEvent(
  telemetry: TelemetrySink | undefined,
  ctx: ModeContext | undefined,
  name: string,
  properties?: Record<string, unknown>,
): void {
  if (!telemetry) return
  safeCapture(telemetry, {
    name,
    properties: sandboxTelemetryProperties(ctx, properties),
  })
}

async function runSandboxSetupStep<T>(options: {
  telemetry?: TelemetrySink
  ctx?: ModeContext
  phase: string
  run: () => Promise<T>
}): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await options.run()
    captureSandboxSetupEvent(options.telemetry, options.ctx, 'agent.runtime.sandbox.setup.step', {
      phase: options.phase,
      status: 'ok' satisfies SandboxSetupStatus,
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    captureSandboxSetupEvent(options.telemetry, options.ctx, 'agent.runtime.sandbox.setup.step', {
      phase: options.phase,
      status: 'error' satisfies SandboxSetupStatus,
      durationMs: Date.now() - startedAt,
      ...(typeof code === 'string' ? { errorCode: code } : {}),
    })
    throw error
  }
}

function createDefaultVercelClient(
  auth: VercelAuthConfig,
  opts: { timeoutMs?: number; runtime?: string } = {},
): VercelSandboxClient {
  const credentials = {
    token: auth.token,
    teamId: auth.teamId,
    ...(auth.projectId ? { projectId: auth.projectId } : {}),
  }
  const createOptions = opts.timeoutMs
    ? { ...credentials, timeout: opts.timeoutMs }
    : credentials

  return {
    async create(params) {
      const base = {
        ...createOptions,
        ...(params?.name ? { name: params.name } : {}),
        ...(opts.runtime ? { runtime: opts.runtime } : {}),
        persistent: params?.persistent ?? true,
        snapshotExpiration: params?.snapshotExpiration ?? 0,
      }
      if (params?.source?.type === 'snapshot') {
        const { runtime: _runtime, ...snapshotBase } = base
        return await VercelSandbox.create({
          ...snapshotBase,
          source: { type: 'snapshot', snapshotId: params.source.snapshotId },
        })
      }
      if (params?.source?.type === 'tarball') {
        return await VercelSandbox.create({
          ...base,
          source: { type: 'tarball', url: params.source.url },
        })
      }
      return await VercelSandbox.create(base)
    },
    async get(params) {
      const getParams = {
        ...credentials,
        name: params.name ?? params.sandboxId ?? '',
        resume: params.resume ?? true,
      } as unknown as Parameters<typeof VercelSandbox.get>[0] & { name?: string }
      return await VercelSandbox.get(getParams)
    },
  }
}

type VercelSandboxWithRunCommand = VercelSandbox & {
  fs?: { mkdir(path: string, opts?: { recursive?: boolean }): Promise<unknown> }
  mkDir?: (path: string) => Promise<void>
  runCommand?: (params: { cmd: string; args?: string[] }) => Promise<{ exitCode?: number }>
}

async function ensureVercelWorkspaceRoot(sandbox: VercelSandboxWithRunCommand): Promise<void> {
  let rootCreated = false
  if (sandbox.fs?.mkdir) {
    await sandbox.fs.mkdir(VERCEL_SANDBOX_REMOTE_ROOT, { recursive: true })
    rootCreated = true
  } else if (sandbox.mkDir) {
    try {
      await sandbox.mkDir(VERCEL_SANDBOX_REMOTE_ROOT)
      rootCreated = true
    } catch {
      // Fall through to mkdir -p for already-existing parents or SDK variants.
    }
  }
  if (!sandbox.runCommand) {
    if (rootCreated) return
    throw new Error(`failed to initialize ${VERCEL_SANDBOX_REMOTE_ROOT}: sandbox runCommand is unavailable`)
  }
  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `mkdir -p ${VERCEL_SANDBOX_REMOTE_ROOT} && (ln -sfn ${VERCEL_SANDBOX_REMOTE_ROOT} ${VERCEL_SANDBOX_WORKSPACE_ROOT} 2>/dev/null || true)`],
  })
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(`failed to initialize ${VERCEL_SANDBOX_REMOTE_ROOT} (exit ${result.exitCode ?? 'unknown'})`)
  }
}

/**
 * Install/verify the low-level runtime primitives provisioning needs (Layer A).
 * Vercel `node*` runtimes ship node/npm/pnpm + python3 but NO pip/uv, so this
 * installs Astral uv via its standalone installer (no pip/dnf — ~1.3s). It is
 * idempotent (skips when uv is already present) and runs on the SAME sandbox
 * provisioning will use, so `provisionWorkspaceRuntime()` finds uv at the
 * explicit `VERCEL_UV_BIN`. Without this, a fresh (no-snapshot) workspace cannot
 * provision the Python runtime at all.
 */
async function ensureVercelRuntimePrimitives(
  sandbox: VercelSandboxWithRunCommand,
  runtime: string | undefined,
): Promise<void> {
  if (!sandbox.runCommand) return
  const script = uvSetupCommandsForRuntime(runtime).join(' && ')
  const result = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script] })
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(`runtime bootstrap (uv) failed (exit ${result.exitCode ?? 'unknown'})`)
  }
  // Provisioning invokes uv by explicit path (correctness must not depend on the
  // non-interactive exec PATH). Default BORING_AGENT_UV_BIN to where the Node
  // bootstrap installs uv; an explicit deploy-config value still wins. Routed
  // through config/env so we never touch process.env directly (invariant).
  if (isNodeFamilyRuntime(runtime)) {
    setEnvDefault('BORING_AGENT_UV_BIN', VERCEL_UV_BIN)
  }
}

async function seedTemplateIntoVercelWorkspace(
  workspace: {
    stat(path: string): Promise<unknown>
    writeFile(path: string, data: string): Promise<void>
    writeBinaryFile?: (path: string, data: Uint8Array) => Promise<void>
  },
  templatePath: string,
  logger: ModeLogger,
): Promise<void> {
  const files = await collectFiles(templatePath)
  const hash = computeTemplateHash(files)
  const markerPath = `.boring-agent/templates/${hash}.json`

  try {
    await workspace.stat(markerPath)
    logger.info('[vercel-sandbox:mode] template already seeded', {
      hash,
      fileCount: files.length,
    })
    return
  } catch {
    // Missing marker means this sandbox predates the template or was created
    // from an empty handle. Seed below without deleting user files.
  }

  for (const file of files) {
    if (workspace.writeBinaryFile) {
      await workspace.writeBinaryFile(file.rel, new Uint8Array(file.content))
    } else {
      await workspace.writeFile(file.rel, file.content.toString('utf-8'))
    }
  }
  await workspace.writeFile(markerPath, JSON.stringify({ hash, seededAt: new Date().toISOString() }, null, 2))
  logger.info('[vercel-sandbox:mode] template seeded into workspace', {
    hash,
    fileCount: files.length,
  })
}

function provisioningSourceToPath(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function copyHostPathToVercelWorkspace(options: {
  workspace: ReturnType<typeof createVercelSandboxWorkspace>
  source: string | URL
  targetRel: string
}): Promise<void> {
  const sourcePath = provisioningSourceToPath(options.source)
  const sourceStat = await stat(sourcePath)
  if (sourceStat.isDirectory()) {
    await options.workspace.mkdir(options.targetRel, { recursive: true })
    for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
      await copyHostPathToVercelWorkspace({
        workspace: options.workspace,
        source: join(sourcePath, entry.name),
        targetRel: `${options.targetRel}/${entry.name}`,
      })
    }
    return
  }
  if (!sourceStat.isFile()) return

  const bytes = new Uint8Array(await readFile(sourcePath))
  if (options.workspace.writeBinaryFile) await options.workspace.writeBinaryFile(options.targetRel, bytes)
  else await options.workspace.writeFile(options.targetRel, Buffer.from(bytes).toString('utf8'))
}

function isMissingWorkspacePathError(error: unknown): boolean {
  if ((error as { code?: string }).code === 'ENOENT') return true
  const message = error instanceof Error ? error.message : String(error)
  return /\bENOENT\b|no such file|file not found/i.test(message)
}

function createVercelWorkspaceFs(options: {
  workspace: ReturnType<typeof createVercelSandboxWorkspace>
  sandbox: VercelSandboxWithRunCommand
}): WorkspaceProvisioningAdapter['workspaceFs'] {
  const exists = async (rel: string): Promise<boolean> => {
    try {
      await options.workspace.stat(rel)
      return true
    } catch (error: unknown) {
      if (isMissingWorkspacePathError(error)) return false
      throw error
    }
  }

  return {
    exists,
    async rm(rel) {
      const targetExists = await exists(rel)
      if (!targetExists) return
      const target = `${VERCEL_SANDBOX_REMOTE_ROOT}/${rel.replace(/^\/+/, '')}`
      const result = await options.sandbox.runCommand({
        cmd: 'sh',
        args: ['-c', `rm -rf -- ${shellSingleQuote(target)}`],
      })
      if ((result.exitCode ?? 1) !== 0) {
        const err = await (result.stderr?.() ?? Promise.resolve(''))
        throw new Error(err || `failed to remove ${rel}`)
      }
    },
    async mkdir(rel) {
      await options.workspace.mkdir(rel, { recursive: true })
    },
    async writeText(rel, content) {
      await options.workspace.writeFile(rel, content)
    },
    async readText(rel) {
      try {
        return await options.workspace.readFile(rel)
      } catch (error: unknown) {
        if (isMissingWorkspacePathError(error)) return null
        throw error
      }
    },
    async copyFromHost(source, targetRel) {
      await copyHostPathToVercelWorkspace({ workspace: options.workspace, source, targetRel })
    },
  }
}

async function ensureVercelProvisioningParts(options: {
  store: SandboxHandleStore
  getEnvVar: EnvGetter
  logger: ModeLogger
  vercelClient?: VercelSandboxClient
  runtimeLayout: BoringAgentRuntimePaths
  ctx?: ModeContext
  expiredSandboxPolicy?: ExpiredSandboxPolicy
  orphanGuardMaxIdleMs?: number | null
}): Promise<{
  workspace: ReturnType<typeof createVercelSandboxWorkspace>
  workspaceFs: WorkspaceProvisioningAdapter['workspaceFs']
  sandbox: ReturnType<typeof createVercelSandboxExec>
  sandboxHandle: VercelSandboxWithRunCommand
}> {
  const auth = resolveVercelAuth(options.getEnvVar)
  const teamId = requireEnvVar('VERCEL_TEAM_ID', options.getEnvVar)
  const projectId = options.getEnvVar('VERCEL_PROJECT_ID')?.trim()
  const timeoutMs = readOptionalPositiveIntegerEnv(VERCEL_SANDBOX_TIMEOUT_MS_ENV, options.getEnvVar)
  const runtime = options.getEnvVar(VERCEL_SANDBOX_RUNTIME_ENV)?.trim() || DEFAULT_VERCEL_SANDBOX_RUNTIME
  const vercelClient = options.vercelClient ?? createDefaultVercelClient({
    token: auth.token,
    teamId,
    projectId,
  }, { timeoutMs, runtime })
  const workspaceId = options.ctx?.workspaceId ?? options.ctx?.workspaceRoot ?? options.runtimeLayout.workspaceRoot
  const telemetry = options.ctx?.telemetry
  const totalStartedAt = Date.now()
  captureSandboxSetupEvent(telemetry, options.ctx, 'agent.runtime.sandbox.setup.started', {
    status: 'started',
  })
  try {
    const sandboxHandle = await runSandboxSetupStep({
      telemetry,
      ctx: options.ctx,
      phase: 'resolve-handle',
      run: async () => await resolveSandboxHandle(workspaceId, options.store, vercelClient, {
        logger: options.logger,
        maxIdleMs: options.orphanGuardMaxIdleMs === null
          ? undefined
          : options.orphanGuardMaxIdleMs ?? ORPHAN_GUARD_MAX_IDLE_MS,
        expiredSandboxPolicy: options.expiredSandboxPolicy,
      }) as VercelSandboxWithRunCommand,
    })
    await runSandboxSetupStep({
      telemetry,
      ctx: options.ctx,
      phase: 'ensure-workspace-root',
      run: async () => { await ensureVercelWorkspaceRoot(sandboxHandle) },
    })
    await runSandboxSetupStep({
      telemetry,
      ctx: options.ctx,
      phase: 'runtime-bootstrap',
      run: async () => { await ensureVercelRuntimePrimitives(sandboxHandle, runtime) },
    })
    const workspace = createVercelSandboxWorkspace(sandboxHandle)
    const workspaceFs = createVercelWorkspaceFs({ workspace, sandbox: sandboxHandle })
    const sandbox = createVercelSandboxExec(sandboxHandle)
    await runSandboxSetupStep({
      telemetry,
      ctx: options.ctx,
      phase: 'sandbox-init',
      run: async () => { await sandbox.init?.({ workspace, sessionId: options.ctx?.sessionId ?? 'default' }) },
    })
    captureSandboxSetupEvent(telemetry, options.ctx, 'agent.runtime.sandbox.setup.completed', {
      status: 'ok',
      durationMs: Date.now() - totalStartedAt,
    })
    return { workspace, workspaceFs, sandbox, sandboxHandle }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    captureSandboxSetupEvent(telemetry, options.ctx, 'agent.runtime.sandbox.setup.failed', {
      status: 'error',
      durationMs: Date.now() - totalStartedAt,
      ...(typeof code === 'string' ? { errorCode: code } : {}),
    })
    throw error
  }
}

async function ensureTemplateExecutables(sandbox: VercelSandboxWithRunCommand): Promise<void> {
  if (!sandbox.runCommand) return
  await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `chmod +x ${VERCEL_SANDBOX_REMOTE_ROOT}/.boring-agent/bin/* 2>/dev/null || true`],
  })
}

const DEFAULT_MODE_LOGGER: ModeLogger = {
  info(message, metadata) {
    process.stderr.write(`${message} ${JSON.stringify(metadata)}\n`)
  },
}

function requireEnvVar(name: string, getEnvVar: EnvGetter): string {
  const value = getEnvVar(name)?.trim()
  if (!value) {
    throw new Error(`${name} is required for vercel-sandbox mode`)
  }
  return value
}

function readOptionalPositiveIntegerEnv(
  name: string,
  getEnvVar: EnvGetter,
): number | undefined {
  const raw = getEnvVar(name)?.trim()
  if (!raw) return undefined
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function resolveVercelAuth(getEnvVar: EnvGetter): { token: string; source: 'VERCEL_OIDC_TOKEN' | 'VERCEL_ACCESS_TOKEN' | 'VERCEL_TOKEN' } {
  const oidc = getEnvVar('VERCEL_OIDC_TOKEN')?.trim()
  if (oidc) {
    return { token: oidc, source: 'VERCEL_OIDC_TOKEN' }
  }

  const accessToken = getEnvVar('VERCEL_ACCESS_TOKEN')?.trim()
  if (accessToken) {
    return { token: accessToken, source: 'VERCEL_ACCESS_TOKEN' }
  }

  const apiToken = getEnvVar('VERCEL_TOKEN')?.trim()
  if (apiToken) {
    return { token: apiToken, source: 'VERCEL_TOKEN' }
  }

  throw new Error('VERCEL_OIDC_TOKEN or VERCEL_ACCESS_TOKEN or VERCEL_TOKEN is required for vercel-sandbox mode')
}

export function createVercelSandboxModeAdapter(
  opts: VercelSandboxModeAdapterOptions = {},
): RuntimeModeAdapter {
  const store = opts.store ?? new FileHandleStore()
  const getEnvVar = opts.getEnvVar ?? getEnv
  const logger = opts.logger ?? DEFAULT_MODE_LOGGER
  // @vercel/sandbox@beta persistent sandboxes auto-snapshot when their
  // session stops and auto-resume on the next command. Do not run the old
  // periodic snapshotter here: sandbox.snapshot() stops the active session.
  const snapshotScheduler = opts.snapshotScheduler ?? null

  return {
    id: 'vercel-sandbox',
    workspaceFsCapability: 'best-effort',
    async dispose() {
      await snapshotScheduler?.shutdown()
    },
    createProvisioningAdapter(runtimeLayout, ctx) {
      let partsPromise: Promise<Awaited<ReturnType<typeof ensureVercelProvisioningParts>>> | null = null
      const getParts = () => {
        partsPromise ??= ensureVercelProvisioningParts({
          store,
          getEnvVar,
          logger,
          vercelClient: opts.vercelClient,
          runtimeLayout,
          ctx,
          expiredSandboxPolicy: opts.expiredSandboxPolicy,
          orphanGuardMaxIdleMs: opts.orphanGuardMaxIdleMs,
        })
        return partsPromise
      }
      return createVercelProvisioningAdapter({
        runtimeLayout,
        workspaceFs: {
          async exists(rel) { return await (await getParts()).workspaceFs.exists(rel) },
          async rm(rel) { return await (await getParts()).workspaceFs.rm(rel) },
          async mkdir(rel) { return await (await getParts()).workspaceFs.mkdir(rel) },
          async writeText(rel, content) { return await (await getParts()).workspaceFs.writeText(rel, content) },
          async readText(rel) { return await (await getParts()).workspaceFs.readText(rel) },
          async copyFromHost(source, target) { return await (await getParts()).workspaceFs.copyFromHost(source, target) },
        },
        async exec(command, args, execOpts) {
          const { sandbox } = await getParts()
          const commandLine = [command, ...args].map(shellSingleQuote).join(' ')
          const result = await sandbox.exec(commandLine, {
            cwd: execOpts?.cwd,
            env: execOpts?.env,
            timeoutMs: execOpts?.timeoutMs,
          })
          const stdout = Buffer.from(result.stdout).toString('utf8')
          const stderr = Buffer.from(result.stderr).toString('utf8')
          if (result.exitCode !== 0) {
            throw new Error(`Command failed (${command}) with exit code ${result.exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
          }
          return { stdout, stderr }
        },
        prepareArtifact: packProvisioningArtifact,
      })
    },
    async create(ctx) {
      const telemetry = ctx.telemetry
      const totalStartedAt = Date.now()
      captureSandboxSetupEvent(telemetry, ctx, 'agent.runtime.sandbox.setup.started', {
        status: 'started',
      })
      const auth = resolveVercelAuth(getEnvVar)
      const teamId = requireEnvVar('VERCEL_TEAM_ID', getEnvVar)
      const projectId = getEnvVar('VERCEL_PROJECT_ID')?.trim()
      const timeoutMs = readOptionalPositiveIntegerEnv(
        VERCEL_SANDBOX_TIMEOUT_MS_ENV,
        getEnvVar,
      )
      const runtime = getEnvVar(VERCEL_SANDBOX_RUNTIME_ENV)?.trim() || DEFAULT_VERCEL_SANDBOX_RUNTIME

      const vercelClient = opts.vercelClient ?? createDefaultVercelClient({
        token: auth.token,
        teamId,
        projectId,
      }, { timeoutMs, runtime })

      logger.info('[vercel-sandbox:mode] auth resolved', {
        source: auth.source,
        hasProjectId: Boolean(projectId),
        timeoutMs: timeoutMs ?? null,
        runtime,
      })

      const workspaceId = ctx.workspaceId ?? ctx.workspaceRoot
      let tarballUrl: string | undefined

      try {
        if (ctx.templatePath) {
          try {
            const result = await runSandboxSetupStep({
              telemetry,
              ctx,
              phase: 'template-package',
              run: async () => await packageTemplate(ctx.templatePath!, opts.packageTemplateOpts),
            })
            tarballUrl = result.url
            logger.info('[vercel-sandbox:mode] template packaged', {
              hash: result.hash,
              url: result.url,
            })
          } catch (error) {
            logger.info('[vercel-sandbox:mode] template packaging failed, will use writeFiles fallback', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        const sandboxHandle = await runSandboxSetupStep({
          telemetry,
          ctx,
          phase: 'resolve-handle',
          run: async () => await resolveSandboxHandle(
            workspaceId,
            store,
            vercelClient,
            {
              tarballUrl,
              logger,
              maxIdleMs: opts.orphanGuardMaxIdleMs === null
                ? undefined
                : opts.orphanGuardMaxIdleMs ?? ORPHAN_GUARD_MAX_IDLE_MS,
              expiredSandboxPolicy: opts.expiredSandboxPolicy,
            },
          ),
        })

        const sandboxId = sandboxHandle.name ?? sandboxHandle.sandboxId ?? 'unknown-sandbox'
        logger.info('[vercel-sandbox:mode] resolved sandbox handle', {
          workspaceId,
          sandboxId,
          snapshotId: sandboxHandle.currentSnapshotId ?? sandboxHandle.sourceSnapshotId ?? null,
          tarballUrl: tarballUrl ?? null,
        })

        if (snapshotScheduler && sandboxHandle.sandboxId) {
          snapshotScheduler.trackWorkspace({
            workspaceId,
            sandbox: sandboxHandle as typeof sandboxHandle & { sandboxId: string; snapshot(opts?: { signal?: AbortSignal }): Promise<{ snapshotId: string }> },
            store,
          })
        }
        const markDirty = () => snapshotScheduler?.markDirty(workspaceId)

        const workspace = createVercelSandboxWorkspace(sandboxHandle, {
          onMutation: markDirty,
        })

        // Fresh Vercel sandboxes do not guarantee our logical workspace root
        // exists. Create it before any file-tree, mkdir, or rename operation so
        // first user actions do not fail with ENOENT/404. This bootstrap is
        // intentionally outside Workspace.mkdir so it does not mark the user's
        // filesystem dirty or emit a fake mkdir event.
        await runSandboxSetupStep({
          telemetry,
          ctx,
          phase: 'ensure-workspace-root',
          run: async () => { await ensureVercelWorkspaceRoot(sandboxHandle) },
        })

        if (ctx.templatePath) {
          if (!tarballUrl) {
            logger.info('[vercel-sandbox:mode] falling back to writeFiles for template', {
              templatePath: ctx.templatePath,
            })
          }
          await runSandboxSetupStep({
            telemetry,
            ctx,
            phase: 'template-seed',
            run: async () => {
              await seedTemplateIntoVercelWorkspace(workspace, ctx.templatePath!, logger)
              await ensureTemplateExecutables(sandboxHandle)
            },
          })
        }

        const sandbox = createVercelSandboxExec(sandboxHandle, {
          onMutation: markDirty,
        })
        await runSandboxSetupStep({
          telemetry,
          ctx,
          phase: 'sandbox-init',
          run: async () => { await sandbox.init?.({ workspace, sessionId: ctx.sessionId }) },
        })

        captureSandboxSetupEvent(telemetry, ctx, 'agent.runtime.sandbox.setup.completed', {
          status: 'ok',
          durationMs: Date.now() - totalStartedAt,
        })
        return {
          workspace,
          sandbox,
          fileSearch: createServerFileSearch(workspace, sandbox),
          runtimeContext: workspace.runtimeContext,
        }
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code
        captureSandboxSetupEvent(telemetry, ctx, 'agent.runtime.sandbox.setup.failed', {
          status: 'error',
          durationMs: Date.now() - totalStartedAt,
          ...(typeof code === 'string' ? { errorCode: code } : {}),
        })
        throw error
      }
    },
  }
}

export const vercelSandboxModeAdapter = createVercelSandboxModeAdapter()

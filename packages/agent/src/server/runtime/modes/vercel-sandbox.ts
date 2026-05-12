import { Sandbox as VercelSandbox } from '@vercel/sandbox'

import { type SandboxHandleStore } from '../../../shared/sandbox-handle-store'
import { getEnv } from '../../config/env'
import { createVercelSandboxExec } from '../../sandbox/vercel-sandbox/createVercelSandboxExec'
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
import type { RuntimeModeAdapter } from '../mode'

interface ModeLogger {
  info(message: string, metadata: Record<string, unknown>): void
  warn?(message: string, metadata?: Record<string, unknown>): void
}

type EnvGetter = (name: string) => string | undefined
const ORPHAN_GUARD_MAX_IDLE_MS = 24 * 60 * 60 * 1000
const VERCEL_SANDBOX_TIMEOUT_MS_ENV = 'BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS'

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

function createDefaultVercelClient(
  auth: VercelAuthConfig,
  opts: { timeoutMs?: number } = {},
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
        persistent: params?.persistent ?? true,
        snapshotExpiration: params?.snapshotExpiration ?? 0,
      }
      if (params?.source?.type === 'snapshot') {
        return await VercelSandbox.create({
          ...base,
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
    async create(ctx) {
      const auth = resolveVercelAuth(getEnvVar)
      const teamId = requireEnvVar('VERCEL_TEAM_ID', getEnvVar)
      const projectId = getEnvVar('VERCEL_PROJECT_ID')?.trim()
      const timeoutMs = readOptionalPositiveIntegerEnv(
        VERCEL_SANDBOX_TIMEOUT_MS_ENV,
        getEnvVar,
      )

      const vercelClient = opts.vercelClient ?? createDefaultVercelClient({
        token: auth.token,
        teamId,
        projectId,
      }, { timeoutMs })

      logger.info('[vercel-sandbox:mode] auth resolved', {
        source: auth.source,
        hasProjectId: Boolean(projectId),
        timeoutMs: timeoutMs ?? null,
      })

      const workspaceId = ctx.workspaceId ?? ctx.workspaceRoot
      let tarballUrl: string | undefined

      if (ctx.templatePath) {
        try {
          const result = await packageTemplate(ctx.templatePath, opts.packageTemplateOpts)
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

      const sandboxHandle = await resolveSandboxHandle(
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
      )

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
      await ensureVercelWorkspaceRoot(sandboxHandle)

      if (ctx.templatePath) {
        if (!tarballUrl) {
          logger.info('[vercel-sandbox:mode] falling back to writeFiles for template', {
            templatePath: ctx.templatePath,
          })
        }
        await seedTemplateIntoVercelWorkspace(workspace, ctx.templatePath, logger)
        await ensureTemplateExecutables(sandboxHandle)
      }

      const sandbox = createVercelSandboxExec(sandboxHandle, {
        onMutation: markDirty,
      })
      await sandbox.init?.({ workspace, sessionId: ctx.sessionId })

      return {
        workspace,
        sandbox,
        fileSearch: createServerFileSearch(workspace, sandbox),
      }
    },
  }
}

export const vercelSandboxModeAdapter = createVercelSandboxModeAdapter()

import { Sandbox as VercelSandbox } from '@vercel/sandbox'

import { type SandboxHandleStore } from '../../../shared/sandbox-handle-store'
import { getEnv } from '../../config/env'
import { createVercelSandboxExec } from '../../sandbox/vercel-sandbox/createVercelSandboxExec'
import { FileHandleStore } from '../../sandbox/vercel-sandbox/FileHandleStore'
import {
  collectFiles,
  packageTemplate,
  type PackageTemplateOptions,
} from '../../sandbox/vercel-sandbox/packageTemplate'
import {
  type ExpiredSandboxPolicy,
  type VercelSandboxClient,
  resolveSandboxHandle,
} from '../../sandbox/vercel-sandbox/resolveSandboxHandle'
import {
  createPeriodicSnapshotScheduler,
  type PeriodicSnapshotScheduler,
} from '../../sandbox/vercel-sandbox/periodicSnapshot'
import { createVercelSandboxWorkspace } from '../../workspace/createVercelSandboxWorkspace'
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
      if (params?.source?.type === 'snapshot') {
        return await VercelSandbox.create({
          ...createOptions,
          source: { type: 'snapshot', snapshotId: params.source.snapshotId },
        })
      }
      if (params?.source?.type === 'tarball') {
        return await VercelSandbox.create({
          ...createOptions,
          source: { type: 'tarball', url: params.source.url },
        })
      }
      return await VercelSandbox.create({ ...createOptions })
    },
    async get(params) {
      return await VercelSandbox.get({ ...credentials, ...params })
    },
  }
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
  const snapshotScheduler = opts.snapshotScheduler === null
    ? null
    : opts.snapshotScheduler ?? createPeriodicSnapshotScheduler({ logger })

  return {
    id: 'vercel-sandbox',
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

      logger.info('[vercel-sandbox:mode] resolved sandbox handle', {
        workspaceId,
        sandboxId: sandboxHandle.sandboxId,
        snapshotId: sandboxHandle.sourceSnapshotId ?? null,
        tarballUrl: tarballUrl ?? null,
      })

      snapshotScheduler?.trackWorkspace({
        workspaceId,
        sandbox: sandboxHandle,
        store,
      })
      const markDirty = () => snapshotScheduler?.markDirty(workspaceId)

      const workspace = createVercelSandboxWorkspace(sandboxHandle, {
        onMutation: markDirty,
      })

      if (ctx.templatePath && !tarballUrl) {
        logger.info('[vercel-sandbox:mode] falling back to writeFiles for template', {
          templatePath: ctx.templatePath,
        })
        const files = await collectFiles(ctx.templatePath)
        for (const file of files) {
          await workspace.writeFile(file.rel, file.content.toString('utf-8'))
        }
        logger.info('[vercel-sandbox:mode] writeFiles fallback complete', {
          fileCount: files.length,
        })
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

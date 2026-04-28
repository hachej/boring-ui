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
  type VercelSandboxClient,
  resolveSandboxHandle,
} from '../../sandbox/vercel-sandbox/resolveSandboxHandle'
import { createVercelSandboxWorkspace } from '../../workspace/createVercelSandboxWorkspace'
import { createServerFileSearch } from '../createServerFileSearch'
import type { RuntimeModeAdapter } from '../mode'

interface ModeLogger {
  info(message: string, metadata: Record<string, unknown>): void
}

type EnvGetter = (name: string) => string | undefined
const ORPHAN_GUARD_MAX_IDLE_MS = 24 * 60 * 60 * 1000

export interface VercelSandboxModeAdapterOptions {
  store?: SandboxHandleStore
  vercelClient?: VercelSandboxClient
  getEnvVar?: EnvGetter
  logger?: ModeLogger
  packageTemplateOpts?: PackageTemplateOptions
}

const DEFAULT_VERCEL_CLIENT: VercelSandboxClient = {
  async create(params) {
    if (params?.source?.type === 'snapshot') {
      return await VercelSandbox.create({
        source: { type: 'snapshot', snapshotId: params.source.snapshotId },
      })
    }
    if (params?.source?.type === 'tarball') {
      return await VercelSandbox.create({
        source: { type: 'tarball', url: params.source.url },
      })
    }
    return await VercelSandbox.create()
  },
  async get(params) {
    return await VercelSandbox.get(params)
  },
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

export function createVercelSandboxModeAdapter(
  opts: VercelSandboxModeAdapterOptions = {},
): RuntimeModeAdapter {
  const store = opts.store ?? new FileHandleStore()
  const vercelClient = opts.vercelClient ?? DEFAULT_VERCEL_CLIENT
  const getEnvVar = opts.getEnvVar ?? getEnv
  const logger = opts.logger ?? DEFAULT_MODE_LOGGER

  return {
    id: 'vercel-sandbox',
    async create(ctx) {
      requireEnvVar('VERCEL_OIDC_TOKEN', getEnvVar)
      requireEnvVar('VERCEL_TEAM_ID', getEnvVar)

      const workspaceId = ctx.workspaceRoot
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
          maxIdleMs: ORPHAN_GUARD_MAX_IDLE_MS,
        },
      )

      logger.info('[vercel-sandbox:mode] resolved sandbox handle', {
        workspaceId,
        sandboxId: sandboxHandle.sandboxId,
        snapshotId: sandboxHandle.sourceSnapshotId ?? null,
        tarballUrl: tarballUrl ?? null,
      })

      const workspace = createVercelSandboxWorkspace(sandboxHandle)

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

      const sandbox = createVercelSandboxExec(sandboxHandle)
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

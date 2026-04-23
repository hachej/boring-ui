import { Sandbox as VercelSandbox } from '@vercel/sandbox'

import { type SandboxHandleStore } from '../../../shared/sandbox-handle-store'
import { getEnv } from '../../config/env'
import { createVercelSandboxExec } from '../../sandbox/vercel-sandbox/createVercelSandboxExec'
import { FileHandleStore } from '../../sandbox/vercel-sandbox/FileHandleStore'
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

export interface VercelSandboxModeAdapterOptions {
  store?: SandboxHandleStore
  vercelClient?: VercelSandboxClient
  getEnvVar?: EnvGetter
  logger?: ModeLogger
}

const DEFAULT_VERCEL_CLIENT: VercelSandboxClient = {
  async create(params) {
    if (params?.source) {
      return await VercelSandbox.create({
        source: params.source,
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
      const sandboxHandle = await resolveSandboxHandle(
        workspaceId,
        store,
        vercelClient,
      )

      logger.info('[vercel-sandbox:mode] resolved sandbox handle', {
        workspaceId,
        sandboxId: sandboxHandle.sandboxId,
        snapshotId: sandboxHandle.sourceSnapshotId ?? null,
      })

      const workspace = createVercelSandboxWorkspace(sandboxHandle)
      const sandbox = createVercelSandboxExec(sandboxHandle)
      await sandbox.init({ workspace, sessionId: ctx.sessionId })

      return {
        workspace,
        sandbox,
        fileSearch: createServerFileSearch(workspace, sandbox),
        uiBridge: ctx.uiBridge,
      }
    },
  }
}

export const vercelSandboxModeAdapter = createVercelSandboxModeAdapter()

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createVercelSandboxProvider } from '@hachej/boring-sandbox/providers/vercel-sandbox'
import type { SandboxProviderV1 } from '@hachej/boring-sandbox/shared'
import { createSandboxServerPlugin, SandboxLeaseService } from '@hachej/boring-sandbox-plugin/server'
import { createLocalDisposableProvider } from './localDisposableProvider'
import { createExactShaTemplateProvider } from './remoteSnapshotProvider'

export const FACTORY_WORKSPACE_SCOPE_ID = 'factory-playground'
export const FACTORY_WORKER_AGENT_TYPE_ID = 'boring-worker'

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function sandboxPluginContentDigest(): `sha256:${string}` {
  const require = createRequire(import.meta.url)
  const packageRoot = dirname(require.resolve('@hachej/boring-sandbox-plugin/package.json'))
  return sha256(readFileSync(resolve(packageRoot, 'dist/server/index.js')))
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function createProvider(workspaceRoot: string, stateRoot: string, env: NodeJS.ProcessEnv): SandboxProviderV1 {
  if (env.BORING_FACTORY_SANDBOX_PROVIDER !== 'vercel') {
    return createLocalDisposableProvider(workspaceRoot)
  }
  const immutableSnapshotId = env.BORING_FACTORY_VERCEL_SNAPSHOT_ID?.trim()
  if (!immutableSnapshotId) {
    throw new Error('BORING_FACTORY_VERCEL_SNAPSHOT_ID is required for the Vercel Factory provider')
  }
  const inner = createVercelSandboxProvider({
    lifecycle: 'disposable',
    immutableSnapshotId,
    timeoutMs: positiveInteger(env.BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS, 15 * 60_000),
    telemetrySalt: env.BORING_SANDBOX_TELEMETRY_SALT,
  })
  return createExactShaTemplateProvider({
    inner,
    sourceRoot: workspaceRoot,
    scratchRoot: resolve(stateRoot, 'snapshots'),
  })
}

export function createFactorySandboxPlugin(
  workspaceRoot: string,
  stateRoot: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const ttlMs = positiveInteger(env.BORING_FACTORY_SANDBOX_TTL_MS, 30 * 60_000)
  const maxPerWorker = positiveInteger(env.BORING_FACTORY_SANDBOX_MAX_PER_WORKER, 2)
  const maxTotal = positiveInteger(env.BORING_FACTORY_SANDBOX_MAX_TOTAL, 4)
  const authorityDigest = sha256(JSON.stringify({
    provider: env.BORING_FACTORY_SANDBOX_PROVIDER === 'vercel' ? 'vercel' : 'local-simulation',
    snapshot: env.BORING_FACTORY_VERCEL_SNAPSHOT_ID ? sha256(env.BORING_FACTORY_VERCEL_SNAPSHOT_ID) : null,
    ttlMs,
    maxPerWorker,
    maxTotal,
  }))
  const provider = createProvider(workspaceRoot, stateRoot, env)

  return createSandboxServerPlugin({
    workspaceScopeId: FACTORY_WORKSPACE_SCOPE_ID,
    authorizedAgentTypeIds: [FACTORY_WORKER_AGENT_TYPE_ID],
    pluginContentDigest: sandboxPluginContentDigest(),
    authorityDigest,
    createLeaseService: ({ agentTypeId }) => new SandboxLeaseService({
      workspaceRoot: resolve(stateRoot, 'leases', agentTypeId),
      provider,
      providerWorkspaceId: FACTORY_WORKSPACE_SCOPE_ID,
      serviceDigest: authorityDigest,
      ttlMs,
      reapIntervalMs: Math.min(60_000, ttlMs),
      drainTimeoutMs: 15_000,
      maxActiveLeasesPerOwner: maxPerWorker,
      maxActiveLeasesTotal: maxTotal,
    }),
  })
}

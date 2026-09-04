import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createVercelSandboxProvider } from '@hachej/boring-sandbox/providers/vercel-sandbox'
import { DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1, PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '@hachej/boring-sandbox/shared'
import type { DisposableSandboxProviderProfileV1, DisposableSandboxProviderV1, SandboxProviderV1 } from '@hachej/boring-sandbox/shared'
import { createSandboxServerPlugin, SandboxLeaseService } from '@hachej/boring-sandbox-plugin/server'
import { createLocalDisposableProvider } from './localDisposableProvider'
import {
  createExactShaTemplateProvider,
  getFactoryBootstrapLog,
  isBootstrapRefreshNeeded,
  resolveFactoryGitToken,
} from './remoteSnapshotProvider'
import { invalidateEpicSnapshot, peekEpicSnapshot, resolveEpicSnapshot } from './snapshotRegistry'
import type { WarmSnapshotAuth } from './warmSnapshot'

const execFileAsync = promisify(execFile)

export const FACTORY_WORKSPACE_SCOPE_ID = 'factory-playground'
export const FACTORY_WORKER_AGENT_TYPE_ID = 'factory-worker'

/** Default Vercel disposable-lease timeout. Raised from 15 to 30 minutes: a warm snapshot whose baseSha has drifted from the epic branch (before the per-epic snapshot registry existed) blew past the old 15-minute cap on the incremental rebuild alone. Env override kept via `BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS`. */
const DEFAULT_VERCEL_LEASE_TIMEOUT_MS = 30 * 60_000
/** Default vCPUs for every Factory lease sandbox (fixed or per-epic snapshot): verified live that a default-resource (1 vCPU) lease OOMs rebuilding memory-heavy packages during the warm bootstrap. Read by `createVercelSandboxProvider` itself via `BORING_AGENT_VERCEL_SANDBOX_VCPUS`; the composition only supplies the default when unset. */
const DEFAULT_VERCEL_LEASE_VCPUS = 4

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

function decodeMaybe(value: Uint8Array | string | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
}

/** Best-effort current branch name of `root`; falls back to `root`'s basename (not a git repo, detached HEAD with no override, etc). Shared by `app.ts` (the app's own epicKey) and the per-epic snapshot provider (which needs the same key when the caller didn't already resolve one). */
export async function resolveFactoryEpicKey(workspaceRoot: string, env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.BORING_FACTORY_EPIC_KEY?.trim()
  if (configured) return configured
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspaceRoot })
    const branch = stdout.trim()
    if (branch && branch !== 'HEAD') return branch
  } catch {
    // not a git repo (or git unavailable): fall back to the workspace directory name below.
  }
  return basename(workspaceRoot)
}

function resolveVercelAuth(env: NodeJS.ProcessEnv): WarmSnapshotAuth | undefined {
  const token = env.VERCEL_TOKEN?.trim() || env.VERCEL_ACCESS_TOKEN?.trim() || env.VERCEL_OIDC_TOKEN?.trim()
  const teamId = env.VERCEL_TEAM_ID?.trim()
  const projectId = env.VERCEL_PROJECT_ID?.trim()
  if (!token || !teamId || !projectId) return undefined
  return { token, teamId, projectId }
}

function applyDefaultVercelLeaseVcpus(env: NodeJS.ProcessEnv): void {
  const configured = env.BORING_AGENT_VERCEL_SANDBOX_VCPUS?.trim()
  // createVercelSandboxProvider reads this env var directly from process.env at
  // every create() call (not from whatever `env` object the caller passed in),
  // so the default has to land there too.
  if (!configured && !process.env.BORING_AGENT_VERCEL_SANDBOX_VCPUS) {
    process.env.BORING_AGENT_VERCEL_SANDBOX_VCPUS = String(DEFAULT_VERCEL_LEASE_VCPUS)
  }
}

interface VercelInnerProviderOptions {
  readonly leaseTimeoutMs: number
  readonly telemetrySalt: string | undefined
  readonly sourceRoot: string
  readonly scratchRoot: string
  readonly remoteSource: 'fetch' | 'archive' | undefined
  readonly gitToken?: string
}

function buildVercelInnerProvider(snapshotId: string, options: VercelInnerProviderOptions): DisposableSandboxProviderV1 {
  const inner = createVercelSandboxProvider({
    lifecycle: 'disposable',
    immutableSnapshotId: snapshotId,
    timeoutMs: options.leaseTimeoutMs,
    telemetrySalt: options.telemetrySalt,
  })
  return createExactShaTemplateProvider({
    inner,
    sourceRoot: options.sourceRoot,
    scratchRoot: options.scratchRoot,
    ...(options.remoteSource ? { source: options.remoteSource } : {}),
    ...(options.gitToken ? { gitToken: options.gitToken } : {}),
  })
}

/**
 * Wraps the exact-SHA-template Vercel provider so it resolves *which* warm
 * snapshot to boot from lazily, per `create()`, instead of requiring a fixed
 * `BORING_FACTORY_VERCEL_SNAPSHOT_ID` at construction time.
 *
 * Each `create()`:
 *  1. Resolves (or builds, on a cache miss) the epic's warm snapshot via
 *     `resolveEpicSnapshot` — this is the fix for the observed failure mode:
 *     a snapshot baked from `main` while the epic branch diverges across
 *     most packages makes the bootstrap's changed-since selector match
 *     nearly everything and blow the lease timeout. A per-epic snapshot only
 *     ever differs from a lease's exact SHA by that epic's own commits.
 *  2. Delegates to a (cached, by snapshot id) `createExactShaTemplateProvider`
 *     wrapping `createVercelSandboxProvider` pinned to that snapshot.
 *  3. Eagerly probes the pair with a trivial `exec('true')` so the bootstrap
 *     script's changed-package-count guard (`buildFactoryBootstrapScript`)
 *     runs here, synchronously with `create()`, rather than surfacing on
 *     whatever the caller's first real command happens to be. If that guard
 *     fired (`isBootstrapRefreshNeeded`), the snapshot is stale enough to be
 *     worth refreshing: invalidate the registry entry, build a fresh
 *     snapshot from the workspace's current HEAD, and retry `create()` once
 *     against the new snapshot before giving up.
 */
export interface CreatePerEpicVercelProviderOptions {
  readonly workspaceRoot: string
  readonly stateRoot: string
  readonly epicKey: string | undefined
  readonly env: NodeJS.ProcessEnv
  readonly leaseTimeoutMs: number
  readonly telemetrySalt: string | undefined
  readonly scratchRoot: string
  readonly remoteSource: 'fetch' | 'archive' | undefined
  readonly log: (message: string) => void
  /** Injectable for tests. Defaults to `buildVercelInnerProvider` (real `createVercelSandboxProvider` + `createExactShaTemplateProvider`). */
  readonly buildInnerProvider?: (snapshotId: string, options: VercelInnerProviderOptions) => DisposableSandboxProviderV1
  /** Injectable for tests. Defaults to `resolveEpicSnapshot`. */
  readonly resolveSnapshotFn?: typeof resolveEpicSnapshot
  /** Injectable for tests. Defaults to `invalidateEpicSnapshot`. */
  readonly invalidateSnapshotFn?: typeof invalidateEpicSnapshot
}

/** Exported for tests exercising the lazy-resolve + retry-on-refresh behavior with fakes; production callers go through `createFactorySandboxPlugin`. */
export function createPerEpicVercelProvider(options: CreatePerEpicVercelProviderOptions): DisposableSandboxProviderV1 {
  const providerCache = new Map<string, DisposableSandboxProviderV1>()
  const buildInnerProvider = options.buildInnerProvider ?? buildVercelInnerProvider
  const resolveSnapshotFn = options.resolveSnapshotFn ?? resolveEpicSnapshot
  const invalidateSnapshotFn = options.invalidateSnapshotFn ?? invalidateEpicSnapshot
  const cachedGitToken = resolveFactoryGitToken(options.env)
  // `SandboxLeaseService` requires every provider it wraps to advertise this profile *before* the
  // first `create()` (see `isDisposableSandboxProviderV1`): the lazy per-epic snapshot resolution
  // happening inside `create()` must not gate whether the provider is accepted as disposable at all.
  // The epic key and remote-source mode are both known at construction time (or fall back to the same
  // basename `resolveFactoryEpicKey` uses when it can't shell out to git), so the digest is static.
  const disposableProfile: DisposableSandboxProviderProfileV1 = {
    contractVersion: DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1,
    resume: false,
    publishedCleanupOwner: 'returned-pair',
    ambiguousCreate: 'correlated-reconciliation',
    providerConfigDigest: sha256(`per-epic-vercel:${options.epicKey ?? basename(options.workspaceRoot)}:${options.remoteSource ?? 'fetch'}`),
  }

  function getProviderForSnapshot(snapshotId: string): DisposableSandboxProviderV1 {
    let provider = providerCache.get(snapshotId)
    if (!provider) {
      provider = buildInnerProvider(snapshotId, {
        leaseTimeoutMs: options.leaseTimeoutMs,
        telemetrySalt: options.telemetrySalt,
        sourceRoot: options.workspaceRoot,
        scratchRoot: options.scratchRoot,
        remoteSource: options.remoteSource,
        ...(cachedGitToken ? { gitToken: cachedGitToken } : {}),
      })
      providerCache.set(snapshotId, provider)
    }
    return provider
  }

  async function resolveSnapshot() {
    const auth = resolveVercelAuth(options.env)
    if (!auth) throw new Error('VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID are required to build a per-epic Factory snapshot')
    const epicKey = options.epicKey ?? await resolveFactoryEpicKey(options.workspaceRoot, options.env)
    return resolveSnapshotFn({
      epicKey,
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
      auth,
      ...(cachedGitToken ? { gitToken: cachedGitToken } : {}),
      log: options.log,
    })
  }

  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'vercel-sandbox',
    capabilities: PROVIDER_CAPABILITIES['vercel-sandbox'],
    disposableProfile,
    resolveRuntimeRoot: (context) => context.workspaceRoot,
    async create(context) {
      let resolved = await resolveSnapshot()
      options.log(`resolved epic snapshot ${resolved.snapshotId} (reused=${resolved.reused}, baseSha=${resolved.baseSha})`)
      let provider = getProviderForSnapshot(resolved.snapshotId)
      let pair = await provider.create(context)

      const health = await pair.checkHealth?.()
      if (health && health.state !== 'ok') return pair

      const probe = await pair.sandbox.exec('true')
      if (probe.exitCode === 0) return pair

      const probeOutput = getFactoryBootstrapLog(pair.sandbox) ?? `${decodeMaybe(probe.stdout)}\n${decodeMaybe(probe.stderr)}`
      if (!isBootstrapRefreshNeeded(probeOutput)) return pair

      options.log(
        `factory-bootstrap: refresh triggered for epic snapshot ${resolved.snapshotId} ` +
        `(${probeOutput.trim().split('\n').pop()}); rebuilding and retrying once`,
      )
      await pair.dispose().catch(() => {})
      await invalidateSnapshotFn(options.stateRoot, resolved.epicKey, resolved.lockfileSha256)
      providerCache.delete(resolved.snapshotId)

      resolved = await resolveSnapshot()
      provider = getProviderForSnapshot(resolved.snapshotId)
      pair = await provider.create(context)
      const retryProbe = await pair.sandbox.exec('true')
      if (retryProbe.exitCode !== 0) {
        const retryOutput = getFactoryBootstrapLog(pair.sandbox) ?? `${decodeMaybe(retryProbe.stdout)}\n${decodeMaybe(retryProbe.stderr)}`
        throw new Error(`factory-bootstrap failed even after refreshing the epic snapshot: ${retryOutput.trim()}`)
      }
      return pair
    },
    async close() {
      await Promise.all([...providerCache.values()].map((provider) => provider.close?.()))
    },
  }
}

/**
 * Builds the sandbox provider used for every Factory lease: local simulation
 * when `BORING_FACTORY_SANDBOX_PROVIDER` isn't `'vercel'`, otherwise the
 * exact-SHA-template Vercel provider pinned to either a fixed
 * `BORING_FACTORY_VERCEL_SNAPSHOT_ID` or (when unset) the lazy per-epic
 * snapshot provider. Exported (not just used internally by
 * `createFactorySandboxPlugin`) so `scripts/vercel-lease-smoke.mts` can
 * exercise the exact same composition the running app uses, including the
 * per-epic registry path, instead of hand-rolling its own provider wiring.
 */
export function createFactorySandboxProvider(
  workspaceRoot: string,
  stateRoot: string,
  env: NodeJS.ProcessEnv,
  epicKey: string | undefined,
): SandboxProviderV1 {
  if (env.BORING_FACTORY_SANDBOX_PROVIDER !== 'vercel') {
    return createLocalDisposableProvider(workspaceRoot)
  }
  applyDefaultVercelLeaseVcpus(env)
  const leaseTimeoutMs = positiveInteger(env.BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS, DEFAULT_VERCEL_LEASE_TIMEOUT_MS)
  const remoteSourceRaw = env.BORING_FACTORY_REMOTE_SOURCE?.trim()
  if (remoteSourceRaw && remoteSourceRaw !== 'fetch' && remoteSourceRaw !== 'archive') {
    throw new Error("BORING_FACTORY_REMOTE_SOURCE must be 'fetch' or 'archive'")
  }
  const remoteSource = remoteSourceRaw as 'fetch' | 'archive' | undefined
  const scratchRoot = resolve(stateRoot, 'snapshots')
  const log = (message: string) => console.error(`[factory-sandbox] ${message}`)

  const immutableSnapshotId = env.BORING_FACTORY_VERCEL_SNAPSHOT_ID?.trim()
  if (immutableSnapshotId) {
    const gitToken = resolveFactoryGitToken(env)
    return buildVercelInnerProvider(immutableSnapshotId, {
      leaseTimeoutMs,
      telemetrySalt: env.BORING_SANDBOX_TELEMETRY_SALT,
      sourceRoot: workspaceRoot,
      scratchRoot,
      remoteSource,
      ...(gitToken ? { gitToken } : {}),
    })
  }
  return createPerEpicVercelProvider({
    workspaceRoot,
    stateRoot,
    epicKey,
    env,
    leaseTimeoutMs,
    telemetrySalt: env.BORING_SANDBOX_TELEMETRY_SALT,
    scratchRoot,
    remoteSource,
    log,
  })
}

export function createFactorySandboxPlugin(
  workspaceRoot: string,
  stateRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  epicKey?: string,
) {
  const ttlMs = positiveInteger(env.BORING_FACTORY_SANDBOX_TTL_MS, 30 * 60_000)
  const maxPerWorker = positiveInteger(env.BORING_FACTORY_SANDBOX_MAX_PER_WORKER, 2)
  const maxTotal = positiveInteger(env.BORING_FACTORY_SANDBOX_MAX_TOTAL, 4)
  const authorityDigest = sha256(JSON.stringify({
    provider: env.BORING_FACTORY_SANDBOX_PROVIDER === 'vercel' ? 'vercel' : 'local-simulation',
    snapshot: env.BORING_FACTORY_VERCEL_SNAPSHOT_ID ? sha256(env.BORING_FACTORY_VERCEL_SNAPSHOT_ID) : null,
    remoteSource: env.BORING_FACTORY_REMOTE_SOURCE?.trim() || null,
    ttlMs,
    maxPerWorker,
    maxTotal,
  }))
  const provider = createFactorySandboxProvider(workspaceRoot, stateRoot, env, epicKey)

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

export type FactorySandboxSnapshotMode = 'fixed' | 'per-epic'

export interface FactorySandboxSnapshotInfo {
  readonly mode: FactorySandboxSnapshotMode
  readonly snapshotId?: string
  readonly baseSha?: string
}

/**
 * Best-effort, non-blocking snapshot info for `/api/v1/workspace/meta`.
 * `undefined` when the provider isn't `vercel`. Never triggers a build: in
 * `'per-epic'` mode this reads whatever the registry already has cached for
 * `epicKey` (populated by `warmUpFactorySandboxSnapshot` at boot, or by the
 * first real lease) — `snapshotId`/`baseSha` are omitted until then.
 */
export async function getFactorySandboxSnapshotInfo(options: {
  readonly stateRoot: string
  readonly epicKey: string
  readonly env: NodeJS.ProcessEnv
}): Promise<FactorySandboxSnapshotInfo | undefined> {
  if (options.env.BORING_FACTORY_SANDBOX_PROVIDER !== 'vercel') return undefined
  const fixedId = options.env.BORING_FACTORY_VERCEL_SNAPSHOT_ID?.trim()
  if (fixedId) return { mode: 'fixed', snapshotId: fixedId }
  const entry = await peekEpicSnapshot(options.stateRoot, options.epicKey)
  return { mode: 'per-epic', ...(entry ? { snapshotId: entry.snapshotId, baseSha: entry.baseSha } : {}) }
}

/**
 * Host-side warm-up: when the Vercel provider is configured with no fixed
 * snapshot id, kicks off `resolveEpicSnapshot` for this epic so the first
 * Worker lease's `create()` reuses an already-built snapshot instead of
 * paying the ~4-minute warm-snapshot build cost inline. Fire-and-forget by
 * design — callers should not `await` this on the boot path; it shares the
 * same single-flight/registry-cache key as the lazy per-epic provider's own
 * `resolveSnapshot()`, so whichever of the two calls resolveEpicSnapshot
 * first, the other reuses its result.
 */
export async function warmUpFactorySandboxSnapshot(options: {
  readonly workspaceRoot: string
  readonly stateRoot: string
  readonly epicKey: string
  readonly env: NodeJS.ProcessEnv
  readonly log?: (message: string) => void
}): Promise<void> {
  const log = options.log ?? ((message: string) => console.error(`[factory-sandbox-warmup] ${message}`))
  if (options.env.BORING_FACTORY_SANDBOX_PROVIDER !== 'vercel') return
  if (options.env.BORING_FACTORY_VERCEL_SNAPSHOT_ID?.trim()) return
  const auth = resolveVercelAuth(options.env)
  if (!auth) {
    log('skipped: VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID not fully configured')
    return
  }
  try {
    const start = Date.now()
    const resolved = await resolveEpicSnapshot({
      epicKey: options.epicKey,
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
      auth,
      log,
    })
    log(`ready: snapshot ${resolved.snapshotId} (reused=${resolved.reused}, baseSha=${resolved.baseSha}, ${Date.now() - start}ms)`)
  } catch (error) {
    log(`failed (non-fatal, boot continues): ${(error as Error).message}`)
  }
}

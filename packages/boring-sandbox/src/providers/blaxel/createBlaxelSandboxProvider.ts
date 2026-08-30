import { createHash, randomUUID } from 'node:crypto'

import type { SandboxHandleStore } from '@hachej/boring-agent/shared'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import type { DisposableSandboxProviderV1, SandboxProviderV1 } from '../../shared/providerV1'
import { SandboxProviderError } from '../../shared/providerV1'
import {
  disposableProviderConfigDigestV1,
  registerDisposableSandboxProviderV1,
} from '../disposableProviderRegistration'
import { createBlaxelClient } from './client'
import {
  assertBlaxelCredentials,
  BLAXEL_WORKSPACE_ROOT,
  resolveBlaxelConfig,
  type BlaxelSandboxProviderOptions,
} from './config'
import { createBlaxelSandboxExec } from './createBlaxelSandboxExec'
import { createBlaxelSandboxWorkspace } from './createBlaxelSandboxWorkspace'
import { isBlaxelAlreadyExists, isBlaxelNotFound, normalizeBlaxelError } from './errors'
import { BlaxelFileHandleStore } from './FileHandleStore'
import {
  createBlaxelProvisioningAdapter,
  fingerprintBlaxelHostTree,
  type BlaxelProvisioningAdapter,
} from './provisioningAdapter'
import {
  createBlaxelSandboxHandleResolver,
} from './resolveSandboxHandle'
import { shellQuote } from './runtimeHelpers'

const PROVISIONING_ROOT = '.boring/provisioning'
const MARKER = `${PROVISIONING_ROOT}/template.json`
const TRANSACTION = `${PROVISIONING_ROOT}/seed-transaction.json`
const SEED_LOCK = `${PROVISIONING_ROOT}/seed.lock`
const SEED_LOCK_GUARD = `${PROVISIONING_ROOT}/seed.lock.guard`
const SEED_LOCK_TTL_MS = 5 * 60 * 1_000
const SEED_LOCK_HEARTBEAT_MS = 60 * 1_000
const STAGING_PREFIX = 'staging-'

interface SeedTransaction {
  schemaVersion: 1
  fingerprint: string
  staging: string
  entries: string[]
}

// The Blaxel base image ships busybox flock, which supports -x/-n but not
// -w <seconds>. Emulate the bounded wait host-side: retry a non-blocking
// acquire until the deadline. Portable across busybox and util-linux.
async function execFlockWithWait(
  provisioning: BlaxelProvisioningAdapter,
  waitSeconds: number,
  args: string[],
): Promise<void> {
  const deadline = Date.now() + waitSeconds * 1000
  for (;;) {
    try {
      await provisioning.exec('flock', ['-x', '-n', ...args])
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

async function seedTemplate(input: {
  workspace: ReturnType<typeof createBlaxelSandboxWorkspace>
  provisioning: BlaxelProvisioningAdapter
  templatePath: string
  fingerprint: string
}): Promise<void> {
  const { workspace, provisioning, templatePath, fingerprint } = input
  const marker = JSON.stringify({ schemaVersion: 1, fingerprint })
  async function readOptional(path: string): Promise<string | null> {
    try { return await workspace.readFile(path) }
    catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 'ENOENT') throw error
      return null
    }
  }

  function parseTransaction(raw: string): SeedTransaction {
    try {
      const value = JSON.parse(raw) as Partial<SeedTransaction>
      if (
        value.schemaVersion !== 1
        || value.fingerprint !== fingerprint
        || typeof value.staging !== 'string'
        || !/^\.boring\/provisioning\/staging-[a-f0-9]{16}-[a-f0-9-]{36}$/.test(value.staging)
        || !Array.isArray(value.entries)
        || value.entries.some((entry) => typeof entry !== 'string' || entry.length === 0 || entry.includes('/') || entry === '.' || entry === '..' || entry === '.boring')
      ) throw new Error('invalid seed transaction')
      return value as SeedTransaction
    } catch {
      throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Blaxel durable seed transaction is invalid or belongs to another template')
    }
  }

  async function publish(transaction: SeedTransaction): Promise<void> {
    const allowed = new Set(['.boring', ...transaction.entries])
    const rootEntries = await workspace.readdir('.')
    if (rootEntries.some((entry) => !allowed.has(entry.name))) {
      throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Durable Blaxel workspace changed during template publication')
    }
    for (const entry of transaction.entries) {
      const source = `${transaction.staging}/${entry}`
      const sourceExists = await provisioning.workspaceFs.exists(source)
      const destinationExists = await provisioning.workspaceFs.exists(entry)
      if (sourceExists && !destinationExists) await workspace.rename(source, entry)
      else if (sourceExists === destinationExists) {
        throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Blaxel seed transaction has an ambiguous published entry')
      }
    }
    await provisioning.workspaceFs.rm(transaction.staging)
    const temporaryMarker = `${PROVISIONING_ROOT}/.template-${fingerprint.slice(0, 16)}.tmp`
    await workspace.writeFile(temporaryMarker, marker)
    await workspace.rename(temporaryMarker, MARKER)
    await provisioning.workspaceFs.rm(TRANSACTION)
  }

  await workspace.mkdir(PROVISIONING_ROOT, { recursive: true })
  const lockOwner = randomUUID()
  const lockPath = `${BLAXEL_WORKSPACE_ROOT}/${SEED_LOCK}`
  const guardPath = `${BLAXEL_WORKSPACE_ROOT}/${SEED_LOCK_GUARD}`
  const acquireScript = `set -eu
lock=$1; owner=$2; now=$3; expires=$4; lease="$lock/lease"
if ! mkdir -- "$lock" 2>/dev/null; then
  if test -f "$lease"; then
    current_owner=$(sed -n '1p' "$lease")
    current_expires=$(sed -n '2p' "$lease")
    case "$current_expires" in (*[!0-9]*|'') exit 76;; esac
    test "$current_expires" -le "$now" || exit 75
  fi
  rm -rf -- "$lock"
  mkdir -- "$lock"
fi
printf '%s\n%s\n' "$owner" "$expires" >"$lease.tmp"
mv -T -- "$lease.tmp" "$lease"`
  let lockAcquired = false
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await execFlockWithWait(provisioning, 1, [
        guardPath, 'sh', '-c', acquireScript, 'boring-seed-lock',
        lockPath, lockOwner, String(Date.now()), String(Date.now() + SEED_LOCK_TTL_MS),
      ])
      lockAcquired = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (!lockAcquired) {
    throw new SandboxProviderError('BLAXEL_VOLUME_BUSY', 'Blaxel template seed lock is still held')
  }

  const renewScript = `set -eu
lock=$1; owner=$2; expires=$3; lease="$lock/lease"
test -f "$lease"
test "$(sed -n '1p' "$lease")" = "$owner"
printf '%s\n%s\n' "$owner" "$expires" >"$lease.tmp"
mv -T -- "$lease.tmp" "$lease"`
  let heartbeatFailure: unknown
  let renewal = Promise.resolve()
  const heartbeat = setInterval(() => {
    renewal = renewal.then(async () => {
      await execFlockWithWait(provisioning, 10, [
        guardPath, 'sh', '-c', renewScript, 'boring-seed-lock',
        lockPath, lockOwner, String(Date.now() + SEED_LOCK_TTL_MS),
      ])
    }).catch((error) => { heartbeatFailure = error })
  }, SEED_LOCK_HEARTBEAT_MS)

  try {
  const existing = await readOptional(MARKER)
  const pendingRaw = await readOptional(TRANSACTION)
  if (existing !== null) {
    if (existing !== marker) {
      throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Blaxel workspace template fingerprint differs from the durable marker')
    }
    if (pendingRaw !== null) {
      const pending = parseTransaction(pendingRaw)
      await provisioning.workspaceFs.rm(pending.staging)
      await provisioning.workspaceFs.rm(TRANSACTION)
    }
    return
  }
  if (pendingRaw !== null) {
    await publish(parseTransaction(pendingRaw))
    return
  }

  let rootEntries = await workspace.readdir('.')
  if (rootEntries.some((entry) => entry.name !== '.boring')) {
    throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Durable Blaxel workspace has content but no provisioning marker')
  }
  if (rootEntries.some((entry) => entry.name === '.boring')) {
    const boringEntries = await workspace.readdir('.boring')
    if (boringEntries.some((entry) => entry.name !== 'provisioning')) {
      throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Durable Blaxel workspace has unowned .boring content but no provisioning marker')
    }
    if (boringEntries.some((entry) => entry.name === 'provisioning')) {
      const provisioningEntries = await workspace.readdir(PROVISIONING_ROOT)
      for (const entry of provisioningEntries) {
        if (entry.name === 'seed.lock' || entry.name === 'seed.lock.guard') continue
        if (
          !entry.name.startsWith(STAGING_PREFIX)
          && !entry.name.startsWith('.template-')
          && !entry.name.startsWith('.seed-transaction-')
          && !entry.name.startsWith('.seed-lock-stale-')
          && !entry.name.startsWith('.seed-lock-release-')
        ) {
          throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Durable Blaxel workspace has unowned provisioning content but no template marker')
        }
        await workspace.unlink(`${PROVISIONING_ROOT}/${entry.name}`)
      }
    }
  }

  const nonce = randomUUID()
  const staging = `${PROVISIONING_ROOT}/${STAGING_PREFIX}${fingerprint.slice(0, 16)}-${nonce}`
  const temporaryTransaction = `${PROVISIONING_ROOT}/.seed-transaction-${nonce}.tmp`
  await workspace.mkdir(staging, { recursive: true })
  let transactionWritten = false
  try {
    await provisioning.workspaceFs.copyFromHost(templatePath, staging)
    const stagedEntries = (await workspace.readdir(staging)).sort((a, b) => a.name.localeCompare(b.name))
    if (stagedEntries.some((entry) => entry.name === '.boring')) {
      throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Blaxel templates may not replace the reserved .boring provider directory')
    }
    rootEntries = await workspace.readdir('.')
    if (rootEntries.some((entry) => entry.name !== '.boring')) {
      throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Durable Blaxel workspace changed while the template was staged')
    }
    const transaction: SeedTransaction = {
      schemaVersion: 1,
      fingerprint,
      staging,
      entries: stagedEntries.map((entry) => entry.name),
    }
    await workspace.writeFile(temporaryTransaction, JSON.stringify(transaction))
    await workspace.rename(temporaryTransaction, TRANSACTION)
    transactionWritten = true
    await publish(transaction)
  } catch (error) {
    if (!transactionWritten) {
      try { await workspace.unlink(staging) } catch { /* clean only the adapter-owned staging path */ }
      try { await workspace.unlink(temporaryTransaction) } catch { /* clean only the adapter-owned transaction temp */ }
    }
    throw error
  }
  } finally {
    clearInterval(heartbeat)
    await renewal
    const releaseScript = `set -eu
lock=$1; owner=$2; lease="$lock/lease"
test -f "$lease"
test "$(sed -n '1p' "$lease")" = "$owner"
rm -rf -- "$lock"`
    await execFlockWithWait(provisioning, 10, [
      guardPath, 'sh', '-c', releaseScript, 'boring-seed-lock',
      lockPath, lockOwner,
    ])
    if (heartbeatFailure) {
      throw new SandboxProviderError('BLAXEL_VOLUME_BUSY', 'Blaxel template seed lock heartbeat failed')
    }
  }
}

function isDefinitiveBlaxelCreateRejection(error: unknown): boolean {
  const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' && status >= 400 && status < 500
    && status !== 408 && status !== 409 && status !== 429
}

function disposableBlaxelIdentity(context: { workspaceId?: string; sessionId: string; requestId?: string }) {
  if (!context.workspaceId?.trim() || !context.requestId?.trim()) {
    throw new SandboxProviderError('CONFIG_INVALID', 'disposable Blaxel requires host workspace and request identity')
  }
  const digest = createHash('sha256')
    .update(`${context.workspaceId}:${context.sessionId}:${context.requestId}`)
    .digest('hex')
  return { name: `boring-lease-${digest.slice(0, 40)}`, externalId: `boring-lease-${digest}` }
}

export function createBlaxelSandboxProvider(
  options: BlaxelSandboxProviderOptions & { leaseMode: 'disposable' },
): DisposableSandboxProviderV1
export function createBlaxelSandboxProvider(
  options?: BlaxelSandboxProviderOptions,
): SandboxProviderV1
export function createBlaxelSandboxProvider(
  options: BlaxelSandboxProviderOptions = {},
): SandboxProviderV1 {
  const store: SandboxHandleStore | undefined = options.leaseMode === 'disposable'
    ? undefined
    : options.handleStore ?? new BlaxelFileHandleStore()
  const client = options.client ?? createBlaxelClient()
  const handles = createBlaxelSandboxHandleResolver()
  const seeds = new Map<string, { fingerprint: string; promise: Promise<void> }>()
  const unpublished = new Set<() => Promise<void>>()
  const reservedDisposableNames = new Set<string>()
  const publishedDisposableNames = new Set<string>()
  const pendingCreates = new Set<Promise<void>>()
  const disposableConfig = options.leaseMode === 'disposable'
    ? resolveBlaxelConfig(options)
    : undefined
  let closed = false

  const provider: SandboxProviderV1 = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'blaxel',
    capabilities: PROVIDER_CAPABILITIES.blaxel,
    resolveRuntimeRoot: () => BLAXEL_WORKSPACE_ROOT,
    async create(context) {
      if (closed) throw new SandboxProviderError('BLAXEL_API_ERROR', 'Blaxel provider is closed')
      let finishCreate!: () => void
      const pendingCreate = new Promise<void>((resolve) => { finishCreate = resolve })
      pendingCreates.add(pendingCreate)
      try {
      if (!options.client) assertBlaxelCredentials()
      const config = disposableConfig ?? resolveBlaxelConfig(options)
      const workspaceId = context.workspaceId?.trim() || context.workspaceRoot.trim()
      if (!workspaceId) throw new SandboxProviderError('CONFIG_INVALID', 'workspaceId is required for blaxel mode')
      if (options.leaseMode === 'disposable' && (config.volume.enabled || options.handleStore)) {
        throw new SandboxProviderError('CONFIG_INVALID', 'disposable Blaxel forbids volumes and handle persistence')
      }
      let cleanupRemote: (() => Promise<void>) | undefined
      let remoteCleanupPhase: 'creating' | 'created' | 'returned' | undefined
      let remote
      if (options.leaseMode === 'disposable') {
        const identity = disposableBlaxelIdentity(context)
        if (reservedDisposableNames.has(identity.name) || publishedDisposableNames.has(identity.name)) {
          throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'disposable Blaxel request identity is already owned')
        }
        reservedDisposableNames.add(identity.name)
        remoteCleanupPhase = 'creating'
        let deleted = false
        let deletion: Promise<void> | undefined
        cleanupRemote = async () => {
          if (deleted) return
          if (deletion) return await deletion
          const operation = (async () => {
            try {
              const current = await client.getSandbox(identity.name)
              if (current.externalId !== identity.externalId) {
                throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Blaxel cleanup identity does not match')
              }
              await client.deleteSandbox(identity.name)
            } catch (error) {
              if (!isBlaxelNotFound(error) || remoteCleanupPhase === 'creating') {
                throw normalizeBlaxelError(error)
              }
            }
            deleted = true
            reservedDisposableNames.delete(identity.name)
            publishedDisposableNames.delete(identity.name)
            unpublished.delete(cleanupRemote!)
          })()
          deletion = operation
          try { await operation } finally { if (deletion === operation) deletion = undefined }
        }
        unpublished.add(cleanupRemote)
        try {
          remote = await client.createFreshSandbox({
            name: identity.name,
            externalId: identity.externalId,
            image: config.image,
            memory: config.memoryMb,
            region: config.region,
            ttl: config.ttl,
            lifecycle: config.lifecycle,
            labels: { owner: 'boring-ui', lease: identity.externalId.slice(-32) },
          })
        } catch (error) {
          if (isDefinitiveBlaxelCreateRejection(error)) {
            unpublished.delete(cleanupRemote)
            reservedDisposableNames.delete(identity.name)
            cleanupRemote = undefined
            remoteCleanupPhase = undefined
          } else try { await cleanupRemote() } catch { /* retained for provider close reconciliation */ }
          throw normalizeBlaxelError(error)
        }
        remoteCleanupPhase = 'created'
        if (remote.name !== identity.name || remote.externalId !== identity.externalId) {
          throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Blaxel create identity does not match')
        }
      } else {
        remote = await handles.resolve({
          workspaceId,
          store: store!,
          client,
          config,
          now: options.now,
        })
      }
      let disposed = false
      let workspaceDisposed = false
      let sandboxDisposed = false
      let disposeInFlight: Promise<void> | undefined
      const workspace = createBlaxelSandboxWorkspace(remote)
      const sandbox = createBlaxelSandboxExec(remote, {
        onMutation: workspace.invalidateMetadataCache,
      })
      const provisioning = createBlaxelProvisioningAdapter({ workspace, sandbox })
      let setupError: unknown
      const readiness = (async () => {
        if (!config.volume.enabled) {
          try { await remote.fs.mkdir(BLAXEL_WORKSPACE_ROOT) }
          catch (error) {
            if (!isBlaxelAlreadyExists(error)) throw normalizeBlaxelError(error)
          }
        }
        const preflight = await sandbox.exec(
          `set -eu; export LC_ALL=C; command -v sh >/dev/null; command -v stat >/dev/null; command -v mv >/dev/null; command -v mkdir >/dev/null; command -v realpath >/dev/null; command -v mktemp >/dev/null; command -v rm >/dev/null; command -v sed >/dev/null; command -v flock >/dev/null; test -d ${shellQuote(BLAXEL_WORKSPACE_ROOT)}; d=$(mktemp -d /tmp/boring-blaxel-preflight.XXXXXX); volume_lock=$(mktemp ${shellQuote(`${BLAXEL_WORKSPACE_ROOT}/.boring-blaxel-flock-preflight.XXXXXX`)}); trap 'rm -rf -- "$d"; rm -f -- "$volume_lock"' EXIT; mkdir -p -- "$d/a"; printf x >"$d/a/f"; stat -Lc '%s|%Y|%F' -- "$d/a/f" >/dev/null; realpath "$d/a/f" >/dev/null; realpath "$d/a/missing" >/dev/null; mv -T -- "$d/a/f" "$d/a/g"; flock -x -n "$volume_lock" true`,
          { timeoutMs: 10_000, maxOutputBytes: 8 * 1024 },
        )
        if (preflight.exitCode !== 0) {
          throw new SandboxProviderError('BLAXEL_RUNTIME_UNQUALIFIED', 'Blaxel runtime image failed workspace/tool preflight')
        }
        if (context.templatePath) {
          const fingerprint = await fingerprintBlaxelHostTree(context.templatePath)
          const seedKey = options.leaseMode === 'disposable' ? remote.name : workspaceId
          const existingSeed = seeds.get(seedKey)
          if (existingSeed && existingSeed.fingerprint !== fingerprint) {
            throw new SandboxProviderError('BLAXEL_CONFIG_DRIFT', 'Concurrent Blaxel seed requests use different template content')
          }
          const seed = existingSeed?.promise ?? seedTemplate({
            workspace,
            provisioning,
            templatePath: context.templatePath,
            fingerprint,
          })
          if (!existingSeed) seeds.set(seedKey, { fingerprint, promise: seed })
          try { await seed } finally {
            if (seeds.get(seedKey)?.promise === seed) seeds.delete(seedKey)
          }
        }
      })().catch((error: unknown) => { setupError = error })
      const disposePair = async (): Promise<void> => {
        if (disposed) return
        if (disposeInFlight) return await disposeInFlight
        const operation = (async () => {
          const attempts: Promise<void>[] = []
          if (!workspaceDisposed) attempts.push(Promise.resolve().then(() => {
            workspace.dispose()
            workspaceDisposed = true
          }))
          if (!sandboxDisposed) attempts.push(Promise.resolve().then(async () => {
            await sandbox.dispose()
            sandboxDisposed = true
          }))
          if (cleanupRemote) attempts.push(cleanupRemote())
          const results = await Promise.allSettled(attempts)
          const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
          if (failures.length) throw new AggregateError(failures, 'Blaxel sandbox cleanup failed')
          disposed = true
        })()
        disposeInFlight = operation
        try { await operation } finally { if (disposeInFlight === operation) disposeInFlight = undefined }
      }
      const pair = {
        workspace,
        sandbox,
        provisioning,
        async checkHealth() {
          await readiness
          if (setupError) {
            if (setupError instanceof SandboxProviderError) throw setupError
            throw normalizeBlaxelError(setupError)
          }
          try {
            const current = await client.getSandbox(remote.name)
            return /failed|terminated|deleted/i.test(current.status ?? '')
              ? { state: 'recreate' as const, error: normalizeBlaxelError(new Error(`sandbox status ${current.status}`)) }
              : { state: 'ok' as const }
          } catch (error) {
            if (isBlaxelNotFound(error)) return { state: 'recreate' as const, error: normalizeBlaxelError(error) }
            throw normalizeBlaxelError(error)
          }
        },
        dispose: disposePair,
      }
      if (options.leaseMode !== 'disposable') {
        await readiness
        if (setupError) {
          try { await disposePair() }
          catch (cleanupError) {
            throw new AggregateError([setupError, cleanupError], 'Blaxel sandbox creation cleanup failed')
          }
          if (setupError instanceof SandboxProviderError) throw setupError
          throw normalizeBlaxelError(setupError)
        }
      }
      if (closed) {
        try { await disposePair() }
        catch (cleanupError) {
          throw new AggregateError([
            new SandboxProviderError('BLAXEL_API_ERROR', 'Blaxel provider closed during create'),
            cleanupError,
          ], 'Blaxel sandbox creation cleanup failed')
        }
        throw new SandboxProviderError('BLAXEL_API_ERROR', 'Blaxel provider closed during create')
      }
      if (cleanupRemote) {
        unpublished.delete(cleanupRemote)
        reservedDisposableNames.delete(remote.name)
        publishedDisposableNames.add(remote.name)
        remoteCleanupPhase = 'returned'
      }
      return pair
      } finally {
        finishCreate()
        pendingCreates.delete(pendingCreate)
      }
    },
    invalidate({ workspaceId }) {
      if (options.leaseMode !== 'disposable') handles.invalidate(workspaceId)
    },
    async close() {
      closed = true
      await Promise.allSettled([...pendingCreates])
      if (options.leaseMode !== 'disposable') handles.clear()
      seeds.clear()
      const results = await Promise.allSettled([...unpublished].map(async (cleanup) => await cleanup()))
      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason))
    },
  }
  return options.leaseMode === 'disposable'
    ? registerDisposableSandboxProviderV1(
        provider,
        disposableProviderConfigDigestV1('blaxel', {
          leaseMode: 'disposable',
          image: disposableConfig!.image,
          memoryMb: disposableConfig!.memoryMb,
          region: disposableConfig!.region,
          ttl: disposableConfig!.ttl ?? null,
          lifecycle: disposableConfig!.lifecycle ?? null,
          volume: disposableConfig!.volume,
          workspaceRoot: disposableConfig!.workspaceRoot,
          client: options.client ? 'host-injected-v1' : 'sdk-default-v1',
        }),
      )
    : provider
}

export type { BlaxelSandboxProviderOptions }

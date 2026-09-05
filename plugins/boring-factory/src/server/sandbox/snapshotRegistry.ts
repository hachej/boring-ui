import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { normalizeRemoteUrl } from './remoteSnapshotProvider'
import { createWarmSnapshot, type WarmSnapshotAuth } from './warmSnapshot'

const execFileAsync = promisify(execFile)

/** Registry entry expiry window: matches the underlying Vercel snapshot's own 7-day expiration, minus a 1-hour safety margin so we never hand out an entry the snapshot itself might reject. */
export const SNAPSHOT_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000

export interface SnapshotRegistryEntry {
  readonly snapshotId: string
  readonly baseSha: string
  readonly lockfileSha256: `sha256:${string}`
  readonly builtAt: string
  readonly expiresAt: string
  readonly epicKey: string
}

interface SnapshotRegistryFile {
  entries: Record<string, SnapshotRegistryEntry>
}

function emptyRegistryFile(): SnapshotRegistryFile {
  return { entries: {} }
}

async function readRegistryFile(path: string): Promise<SnapshotRegistryFile> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SnapshotRegistryFile>
    return { entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistryFile()
    return emptyRegistryFile()
  }
}

/** Atomic write: write to a sibling temp file, then rename over the real path. */
async function writeRegistryFileAtomic(path: string, file: SnapshotRegistryFile): Promise<void> {
  const tmpPath = `${path}.${randomUUID()}.tmp`
  await writeFile(tmpPath, JSON.stringify(file, null, 2))
  await rename(tmpPath, path)
}

export function registryKey(epicKey: string, lockfileSha256: string): string {
  return `${epicKey}:${lockfileSha256}`
}

export async function sha256File(path: string): Promise<`sha256:${string}`> {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return `sha256:${hash.digest('hex')}`
}

async function gitRevParseHead(cwd: string): Promise<string> {
  return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim()
}

async function credentialStrippedOriginUrl(cwd: string): Promise<string> {
  const raw = (await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd })).stdout.trim()
  if (!raw) throw new Error(`epic worktree ${cwd} has no origin URL`)
  return normalizeRemoteUrl(raw)
}

async function resolveBranchRef(cwd: string): Promise<string> {
  const branch = (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })).stdout.trim()
  return branch && branch !== 'HEAD' ? branch : 'HEAD'
}

/**
 * Verifies `sha` (the workspace's current HEAD) is reachable on `origin` by
 * comparing `git ls-remote origin <branch>` against it — `ls-remote` only
 * resolves refs (branches/tags/HEAD), not arbitrary commit SHAs, so this
 * checks the epic branch's remote tip rather than querying the SHA
 * directly. A mismatch (branch not pushed yet, or pushed at an older commit)
 * fails with a message telling the caller exactly what to do.
 */
async function verifyPushed(workspaceRoot: string, sha: string): Promise<void> {
  let stdout: string
  try {
    const ref = await resolveBranchRef(workspaceRoot)
    ;({ stdout } = await execFileAsync('git', ['ls-remote', 'origin', ref], { cwd: workspaceRoot }))
  } catch (error) {
    throw new Error(`push the epic branch first: failed to check if ${sha} is reachable on origin (${(error as Error).message})`)
  }
  const remoteSha = stdout.split(/\s+/)[0]
  if (remoteSha !== sha) {
    throw new Error(`push the epic branch first: ${sha} is not reachable on origin (found ${remoteSha || 'nothing'})`)
  }
}

export interface ResolveEpicSnapshotOptions {
  /** Stable key identifying the epic (e.g. the epic branch name). */
  readonly epicKey: string
  /** Git working tree whose HEAD + `pnpm-lock.yaml` this snapshot is built from. */
  readonly workspaceRoot: string
  /** Directory the registry file (`snapshots.json`) lives under. */
  readonly stateRoot: string
  readonly auth: WarmSnapshotAuth
  /** Optional git access token for cloning a private `remoteUrl`. See `createWarmSnapshot`. */
  readonly gitToken?: string
  readonly vcpus?: number
  readonly timeoutMs?: number
  readonly log?: (message: string) => void
  /** Injectable for tests. Defaults to `createWarmSnapshot`. */
  readonly createSnapshot?: typeof createWarmSnapshot
  /** Injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number
}

export interface ResolvedEpicSnapshot extends SnapshotRegistryEntry {
  /** `true` when a cached, non-expired entry was reused; `false` when a new snapshot was just built. */
  readonly reused: boolean
}

// Single-flight: concurrent resolveEpicSnapshot calls for the same registry
// key await the same in-flight promise instead of racing to build the
// snapshot twice. Keyed by `${stateRoot}:${key}` so distinct hosts (tests)
// never collide.
const inflight = new Map<string, Promise<ResolvedEpicSnapshot>>()
const registryWrites = new Map<string, Promise<void>>()

async function mutateRegistryFile(
  registryPath: string,
  mutator: (file: SnapshotRegistryFile) => void,
): Promise<void> {
  const previous = registryWrites.get(registryPath) ?? Promise.resolve()
  const operation = previous.then(async () => {
    const file = await readRegistryFile(registryPath)
    mutator(file)
    await writeRegistryFileAtomic(registryPath, file)
  })
  registryWrites.set(registryPath, operation.catch(() => undefined))
  await operation
}

/**
 * Resolves the per-epic warm snapshot to boot Factory leases from.
 *
 * Reuses a cached, non-expired registry entry keyed by
 * `${epicKey}:${lockfileSha256}` even if `workspaceRoot`'s HEAD has advanced
 * since that entry was built — the bootstrap script's changed-since rebuild
 * handles the epic's own commits on top of the cached snapshot's `baseSha`.
 * A cache miss (new epic, or the lockfile changed) builds a fresh warm
 * snapshot from the workspace's current HEAD, which must already be pushed
 * (verified via `git ls-remote origin`), and stores it with a 7-day-minus-
 * 1-hour expiry.
 */
export async function resolveEpicSnapshot(options: ResolveEpicSnapshotOptions): Promise<ResolvedEpicSnapshot> {
  const registryPath = resolve(options.stateRoot, 'snapshots.json')
  // Keyed by epicKey (not epicKey+lockfileHash): the lockfile hash requires
  // an async file read, and reserving the in-flight slot must happen
  // synchronously — before that read — so two calls issued back-to-back
  // (no await between them) can't both miss the check and race into two
  // separate builds. All callers for the same epic share one build even if,
  // in the (rare) case the lockfile changes between them, that build content
  // ends up cached under whichever lockfile hash the winner observed — an
  // acceptable trade since a moving lockfile mid-flight is not a case this
  // registry needs to optimize for.
  const inflightKey = `${registryPath}::${options.epicKey}`

  const existing = inflight.get(inflightKey)
  if (existing) return existing

  const promise = (async (): Promise<ResolvedEpicSnapshot> => {
    const now = options.now ?? Date.now
    await mkdir(options.stateRoot, { recursive: true })
    const lockfileSha256 = await sha256File(resolve(options.workspaceRoot, 'pnpm-lock.yaml'))
    const key = registryKey(options.epicKey, lockfileSha256)
    const file = await readRegistryFile(registryPath)
    const cached = file.entries[key]
    if (cached && new Date(cached.expiresAt).getTime() > now()) {
      return { ...cached, reused: true }
    }

    const [headSha, remoteUrl] = await Promise.all([
      gitRevParseHead(options.workspaceRoot),
      credentialStrippedOriginUrl(options.workspaceRoot),
    ])
    await verifyPushed(options.workspaceRoot, headSha)

    const createSnapshot = options.createSnapshot ?? createWarmSnapshot
    const built = await createSnapshot({
      ref: headSha,
      remoteUrl,
      auth: options.auth,
      ...(options.gitToken ? { gitToken: options.gitToken } : {}),
      ...(options.vcpus !== undefined ? { vcpus: options.vcpus } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.log ? { log: options.log } : {}),
    })

    // `lockfileSha256` here is deliberately the locally-computed hash (the
    // one the registry key above was built from), not `built.lockfileSha256`
    // (hashed inside the sandbox after checkout): they're expected to agree
    // in production (same file content), but keeping the entry keyed
    // consistently with its own `lockfileSha256` field is what makes
    // `invalidateEpicSnapshot(stateRoot, epicKey, entry.lockfileSha256)`
    // reconstruct the exact same key deterministically.
    const entry: SnapshotRegistryEntry = {
      snapshotId: built.snapshotId,
      baseSha: built.baseSha,
      lockfileSha256,
      builtAt: built.builtAt,
      expiresAt: new Date(now() + SNAPSHOT_ENTRY_TTL_MS).toISOString(),
      epicKey: options.epicKey,
    }

    // Re-read before writing: another process may have written a different
    // key's entry concurrently. Merge rather than clobber.
    await mutateRegistryFile(registryPath, (latest) => {
      latest.entries[key] = entry
    })

    return { ...entry, reused: false }
  })()

  inflight.set(inflightKey, promise)
  try {
    return await promise
  } finally {
    inflight.delete(inflightKey)
  }
}

/** Best-effort, non-blocking read of the most-recently-built registry entry for `epicKey` (any lockfile hash), for reporting purposes (e.g. `/api/v1/workspace/meta`). Never triggers a build; returns `undefined` when nothing has been resolved for this epic yet. */
export async function peekEpicSnapshot(stateRoot: string, epicKey: string): Promise<SnapshotRegistryEntry | undefined> {
  const registryPath = resolve(stateRoot, 'snapshots.json')
  const file = await readRegistryFile(registryPath)
  const matches = Object.values(file.entries).filter((entry) => entry.epicKey === epicKey)
  if (matches.length === 0) return undefined
  return matches.reduce((latest, entry) => (
    new Date(entry.builtAt).getTime() > new Date(latest.builtAt).getTime() ? entry : latest
  ))
}

/** Removes a registry entry (by epicKey + lockfileSha256) so the next `resolveEpicSnapshot` call builds a fresh one. Used when a snapshot is found stale at lease-bootstrap time (e.g. too many packages changed since baseSha). */
export async function invalidateEpicSnapshot(
  stateRoot: string,
  epicKey: string,
  lockfileSha256: string,
): Promise<void> {
  const registryPath = resolve(stateRoot, 'snapshots.json')
  const key = registryKey(epicKey, lockfileSha256)
  await mutateRegistryFile(registryPath, (file) => {
    delete file.entries[key]
  })
}

/** Removes every cached snapshot for an epic, regardless of lockfile version. */
export async function invalidateAllEpicSnapshots(stateRoot: string, epicKey: string): Promise<void> {
  const registryPath = resolve(stateRoot, 'snapshots.json')
  await mutateRegistryFile(registryPath, (file) => {
    for (const [key, entry] of Object.entries(file.entries)) {
      if (entry.epicKey === epicKey) delete file.entries[key]
    }
  })
}

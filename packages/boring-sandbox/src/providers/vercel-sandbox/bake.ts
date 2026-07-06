import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const DEFAULT_RUNTIME = 'python3.13'
const DEFAULT_CACHE_PATH = path.join(
  homedir(),
  '.config',
  'boring-agent',
  'vercel-snapshot-cache.json',
)

interface SnapshotCacheEntry {
  hash: string
  snapshotId: string
  runtime: string
  pythonPackages: string[]
  systemPackages: string[]
  setupCommands: string[]
  createdAt: string
  updatedAt: string
}

interface SnapshotCacheStore {
  version: 1
  entries: Record<string, SnapshotCacheEntry>
}

interface VercelCommandResult {
  exitCode: number
  stdout(opts?: { signal?: AbortSignal }): Promise<string>
  stderr(opts?: { signal?: AbortSignal }): Promise<string>
}

export interface VercelBakeSandbox {
  runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<VercelCommandResult>
  snapshot(opts?: { signal?: AbortSignal }): Promise<{ snapshotId: string }>
  stop?(opts?: { signal?: AbortSignal }): Promise<void>
}

export interface VercelBakeClient {
  create(params?: { runtime?: string }): Promise<VercelBakeSandbox>
}

export interface BakeLogger {
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

export type SnapshotBakeStatus =
  | 'skipped'
  | 'cache-hit'
  | 'baked'
  | 'failed'

export type SnapshotBakeReason =
  | 'snapshot-id-configured'
  | 'no-packages'
  | 'cache-hit'
  | 'baked'
  | 'bake-failed'

export interface SnapshotBakeResult {
  status: SnapshotBakeStatus
  reason: SnapshotBakeReason
  hash?: string
  snapshotId?: string
  error?: unknown
}

export interface SnapshotBakeOptions {
  client: VercelBakeClient
  pythonPackages?: readonly string[]
  systemPackages?: readonly string[]
  setupCommands?: readonly string[]
  snapshotId?: string
  runtime?: string
  cachePath?: string
  logger?: BakeLogger
  now?: () => Date
}

function normalizePackages(packages: readonly string[] | undefined): string[] {
  if (!packages) return []
  return packages
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort()
}

function normalizeSetupCommands(commands: readonly string[] | undefined): string[] {
  if (!commands) return []
  return commands
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function makeInstallCommand(binary: 'dnf' | 'pip', packages: string[]): string {
  const quoted = packages.map(shellQuote).join(' ')
  if (binary === 'dnf') {
    // The Vercel sandbox runs as the unprivileged `vercel-sandbox` user; dnf
    // requires sudo. (Astral `uv` is NOT available via dnf — installed via pip.)
    return `sudo dnf install -y ${quoted}`
  }
  return `python3 -m pip install ${quoted}`
}

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString()
}

function defaultCacheStore(): SnapshotCacheStore {
  return { version: 1, entries: {} }
}

async function readCache(cachePath: string): Promise<SnapshotCacheStore> {
  try {
    const raw = await readFile(cachePath, 'utf8')
    if (!raw.trim()) {
      return defaultCacheStore()
    }
    const parsed = JSON.parse(raw) as Partial<SnapshotCacheStore>
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      return defaultCacheStore()
    }
    return {
      version: 1,
      entries: parsed.entries as Record<string, SnapshotCacheEntry>,
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      return defaultCacheStore()
    }
    throw error
  }
}

async function writeCache(cachePath: string, store: SnapshotCacheStore): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 })

  const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`
  const content = `${JSON.stringify(store, null, 2)}\n`
  let tmpWritten = false
  let renamed = false

  try {
    await writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 })
    tmpWritten = true
    await chmod(tmpPath, 0o600)
    await rename(tmpPath, cachePath)
    renamed = true
    await chmod(cachePath, 0o600)
  } finally {
    if (tmpWritten && !renamed) {
      try {
        await unlink(tmpPath)
      } catch {
        // tmp file may have already been removed.
      }
    }
  }
}

async function runCheckedCommand(
  sandbox: VercelBakeSandbox,
  script: string,
  signal?: AbortSignal,
): Promise<void> {
  const command = await sandbox.runCommand('sh', ['-c', script], { signal })
  const [stdout, stderr] = await Promise.all([
    command.stdout({ signal }),
    command.stderr({ signal }),
  ])
  if ((command.exitCode ?? 1) === 0) {
    return
  }

  const output = stderr.trim() || stdout.trim()
  throw new Error(
    `Command failed (${script}) with exit code ${command.exitCode}: ${output}`,
  )
}

async function disposeSeedSandbox(sandbox: VercelBakeSandbox): Promise<void> {
  const asyncDisposeSymbol = (Symbol as typeof Symbol & { asyncDispose?: symbol }).asyncDispose
  if (asyncDisposeSymbol) {
    const maybeDispose = (sandbox as unknown as Record<symbol, unknown>)[asyncDisposeSymbol]
    if (typeof maybeDispose === 'function') {
      await (maybeDispose as () => Promise<void>).call(sandbox)
      return
    }
  }

  if (typeof sandbox.stop === 'function') {
    await sandbox.stop()
  }
}

export function buildPackageHash(input: {
  pythonPackages?: readonly string[]
  systemPackages?: readonly string[]
}): string {
  const normalized = {
    pythonPackages: normalizePackages(input.pythonPackages),
    systemPackages: normalizePackages(input.systemPackages),
  }
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
}

export function buildSnapshotRecipeHash(input: {
  runtime?: string
  pythonPackages?: readonly string[]
  systemPackages?: readonly string[]
  setupCommands?: readonly string[]
}): string {
  const normalized = {
    runtime: input.runtime?.trim() || DEFAULT_RUNTIME,
    pythonPackages: normalizePackages(input.pythonPackages),
    systemPackages: normalizePackages(input.systemPackages),
    setupCommands: normalizeSetupCommands(input.setupCommands),
  }
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
}

export async function bakeSnapshotIfNeeded(
  opts: SnapshotBakeOptions,
): Promise<SnapshotBakeResult> {
  const snapshotId = opts.snapshotId?.trim()
  if (snapshotId) {
    return {
      status: 'skipped',
      reason: 'snapshot-id-configured',
      snapshotId,
    }
  }

  const pythonPackages = normalizePackages(opts.pythonPackages)
  const systemPackages = normalizePackages(opts.systemPackages)
  const setupCommands = normalizeSetupCommands(opts.setupCommands)
  if (pythonPackages.length === 0 && systemPackages.length === 0 && setupCommands.length === 0) {
    return {
      status: 'skipped',
      reason: 'no-packages',
    }
  }

  const cachePath = opts.cachePath ?? DEFAULT_CACHE_PATH
  const runtime = opts.runtime?.trim() || DEFAULT_RUNTIME
  const hash = buildSnapshotRecipeHash({ runtime, pythonPackages, systemPackages, setupCommands })
  const cache = await readCache(cachePath)

  const cached = cache.entries[hash]
  if (cached?.snapshotId) {
    opts.logger?.info?.(
      '[vercel-sandbox:bake] using cached snapshot',
      { hash, snapshotId: cached.snapshotId },
    )
    return {
      status: 'cache-hit',
      reason: 'cache-hit',
      hash,
      snapshotId: cached.snapshotId,
    }
  }

  let seedSandbox: VercelBakeSandbox | null = null
  try {
    seedSandbox = await opts.client.create({ runtime })

    if (systemPackages.length > 0) {
      await runCheckedCommand(
        seedSandbox,
        makeInstallCommand('dnf', systemPackages),
      )
    }
    for (const setupCommand of setupCommands) {
      await runCheckedCommand(seedSandbox, setupCommand)
    }
    if (pythonPackages.length > 0) {
      await runCheckedCommand(
        seedSandbox,
        makeInstallCommand('pip', pythonPackages),
      )
    }

    const snapshot = await seedSandbox.snapshot()
    const timestamp = nowIso(opts.now)
    cache.entries[hash] = {
      hash,
      snapshotId: snapshot.snapshotId,
      runtime,
      pythonPackages,
      systemPackages,
      setupCommands,
      createdAt: cache.entries[hash]?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await writeCache(cachePath, cache)

    opts.logger?.info?.(
      '[vercel-sandbox:bake] baked snapshot successfully',
      { hash, snapshotId: snapshot.snapshotId },
    )
    return {
      status: 'baked',
      reason: 'baked',
      hash,
      snapshotId: snapshot.snapshotId,
    }
  } catch (error) {
    opts.logger?.warn?.(
      '[vercel-sandbox:bake] bake failed, falling back to per-call installs',
      { hash, error: error instanceof Error ? error.message : String(error) },
    )
    return {
      status: 'failed',
      reason: 'bake-failed',
      hash,
      error,
    }
  } finally {
    if (seedSandbox) {
      await disposeSeedSandbox(seedSandbox)
    }
  }
}

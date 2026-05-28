import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type {
  Entry,
  Stat,
  Workspace,
  WorkspaceChangeEvent,
  WorkspaceWatcher,
} from '../../shared/workspace'
import { validatePath } from './paths'

export const VERCEL_SANDBOX_REMOTE_ROOT = '/vercel/sandbox'
export const VERCEL_SANDBOX_WORKSPACE_ROOT = '/workspace'

type VercelSandboxStat = {
  size: number
  mtimeMs: number
  isDirectory(): boolean
}
const CACHE_TTL_MS = 15_000
const CACHE_MAX_ENTRIES = 512
const MAX_INLINE_WRITE_BYTES = 128 * 1024
const metadataInvalidators = new WeakMap<VercelSandbox, Set<() => void>>()

function toSandboxPath(relPath: string): string {
  return validatePath(VERCEL_SANDBOX_REMOTE_ROOT, relPath)
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

function createTimedLruCache<T>(ttlMs: number, maxEntries: number) {
  const entries = new Map<string, CacheEntry<T>>()

  return {
    get(key: string): T | undefined {
      const now = Date.now()
      const entry = entries.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= now) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key: string, value: T): void {
      entries.delete(key)
      entries.set(key, { value, expiresAt: Date.now() + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string | undefined
        if (!oldest) return
        entries.delete(oldest)
      }
    },
    clear(): void {
      entries.clear()
    },
  }
}

function cloneStat(stat: Stat): Stat {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    kind: stat.kind,
  }
}

function cloneEntries(entries: Entry[]): Entry[] {
  return entries.map((entry) => ({ name: entry.name, kind: entry.kind }))
}

function mapSandboxStat(fileStat: VercelSandboxStat): Stat {
  return {
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    kind: fileStat.isDirectory() ? 'dir' : 'file',
  }
}

async function readSandboxDirectoryEntries(
  sandbox: VercelSandbox,
  sandboxPath: string,
): Promise<Entry[]> {
  const directoryStat = await sandbox.fs.stat(sandboxPath)
  if (!directoryStat.isDirectory()) {
    const error = new Error(`ENOTDIR: not a directory, scandir '${sandboxPath}'`) as NodeJS.ErrnoException
    error.code = 'ENOTDIR'
    throw error
  }

  const result = await sandbox.runCommand('find', [
    '-H',
    sandboxPath,
    '-maxdepth',
    '1',
    '-mindepth',
    '1',
    '-printf',
    '%f\\0%y\\0',
  ])
  const [out, err] = await Promise.all([result.stdout(), result.stderr()])
  if (result.exitCode !== 0) {
    const error = new Error(err || `sandbox command failed with exit code ${result.exitCode}`) as NodeJS.ErrnoException
    if (err.includes('No such file or directory')) error.code = 'ENOENT'
    throw error
  }

  const parts = out.split('\0')
  const entries: Entry[] = []
  for (let i = 0; i < parts.length - 1; i += 2) {
    const name = parts[i]
    if (!name) continue
    entries.push({ name, kind: parts[i + 1] === 'd' ? 'dir' : 'file' })
  }
  return entries
}

function registerMetadataInvalidator(
  sandbox: VercelSandbox,
  invalidate: () => void,
): void {
  const existing = metadataInvalidators.get(sandbox)
  if (existing) {
    existing.add(invalidate)
    return
  }
  metadataInvalidators.set(sandbox, new Set([invalidate]))
}

export function invalidateVercelSandboxWorkspaceMetadataCache(
  sandbox: VercelSandbox,
): void {
  const invalidators = metadataInvalidators.get(sandbox)
  if (!invalidators) return
  for (const invalidate of invalidators) {
    invalidate()
  }
}

export interface VercelSandboxWorkspace extends Workspace {
  invalidateMetadataCache(): void
}

export interface VercelSandboxWorkspaceOptions {
  onMutation?: () => void
}

/**
 * Internal change-event broadcaster. The sandbox runtime can't run
 * chokidar against the remote container, so we surface "events" from
 * the only thing the server can observe: its own write paths
 * (writeFile / unlink / rename / mkdir below). External mutations
 * inside the sandbox aren't visible — sandbox is single-tenant by
 * design, so this is acceptable.
 *
 * From the client's POV the SSE channel looks identical to the Node
 * impl: it emits `WorkspaceChangeEvent`s, the client doesn't care
 * which production source generated them.
 */
function createSandboxBroadcaster(): {
  emit: (e: WorkspaceChangeEvent) => void
  watcher: WorkspaceWatcher
} {
  const listeners = new Set<(e: WorkspaceChangeEvent) => void>()
  let closed = false

  const emit = (event: WorkspaceChangeEvent) => {
    if (closed) return
    for (const l of [...listeners]) {
      try { l(event) } catch { /* swallow */ }
    }
  }

  const watcher: WorkspaceWatcher = {
    subscribe(listener) {
      if (closed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      listeners.clear()
    },
  }

  return { emit, watcher }
}

export function createVercelSandboxWorkspace(
  sandbox: VercelSandbox,
  workspaceOpts: VercelSandboxWorkspaceOptions = {},
): VercelSandboxWorkspace {
  const statCache = createTimedLruCache<Stat>(CACHE_TTL_MS, CACHE_MAX_ENTRIES)
  const readdirCache = createTimedLruCache<Entry[]>(
    CACHE_TTL_MS,
    CACHE_MAX_ENTRIES,
  )

  let metadataVersion = 0

  function invalidateMetadataCache() {
    metadataVersion += 1
    statCache.clear()
    readdirCache.clear()
  }

  registerMetadataInvalidator(sandbox, invalidateMetadataCache)

  const { emit: emitChange, watcher } = createSandboxBroadcaster()
  const remote = sandbox

  return {
    root: VERCEL_SANDBOX_WORKSPACE_ROOT,
    fsCapability: 'best-effort',
    watch() {
      return watcher
    },
    invalidateMetadataCache,
    async readFile(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      return await remote.fs.readFile(sandboxPath, 'utf8')
    },
    async readBinaryFile(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const content = await remote.fs.readFile(sandboxPath)
      return new Uint8Array(Buffer.from(content))
    },
    async writeFile(relPath, data) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.writeFiles([
        {
          path: sandboxPath,
          content: Buffer.from(data, 'utf-8'),
        },
      ])
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'write', path: relPath })
    },
    async writeBinaryFile(relPath, data) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.writeFiles([
        {
          path: sandboxPath,
          content: Buffer.from(data),
        },
      ])
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'write', path: relPath })
    },
    async readFileWithStat(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const cachedStat = statCache.get(sandboxPath)
      if (cachedStat) {
        const content = await remote.fs.readFile(sandboxPath, 'utf8')
        return { content, stat: cloneStat(cachedStat) }
      }

      const [content, fileStat] = await Promise.all([
        remote.fs.readFile(sandboxPath, 'utf8'),
        remote.fs.stat(sandboxPath),
      ])
      const stat = mapSandboxStat(fileStat)
      statCache.set(sandboxPath, stat)
      return { content, stat: cloneStat(stat) }
    },
    async writeFileWithStat(relPath, data) {
      const sandboxPath = toSandboxPath(relPath)
      const payload = Buffer.from(data, 'utf-8')

      if (payload.byteLength > MAX_INLINE_WRITE_BYTES) {
        await sandbox.writeFiles([
          {
            path: sandboxPath,
            content: payload,
          },
        ])
        invalidateMetadataCache()
        workspaceOpts.onMutation?.()
        const writtenStat = mapSandboxStat(await remote.fs.stat(sandboxPath))
        statCache.set(sandboxPath, writtenStat)
        emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
        return cloneStat(writtenStat)
      }

      await remote.fs.writeFile(sandboxPath, payload)
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      const writtenStat = mapSandboxStat(await remote.fs.stat(sandboxPath))
      statCache.set(sandboxPath, writtenStat)
      emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
      return cloneStat(writtenStat)
    },
    async writeBinaryFileWithStat(relPath, data) {
      const sandboxPath = toSandboxPath(relPath)
      const payload = Buffer.from(data)

      if (payload.byteLength > MAX_INLINE_WRITE_BYTES) {
        await sandbox.writeFiles([
          {
            path: sandboxPath,
            content: payload,
          },
        ])
        invalidateMetadataCache()
        workspaceOpts.onMutation?.()
        const writtenStat = mapSandboxStat(await remote.fs.stat(sandboxPath))
        statCache.set(sandboxPath, writtenStat)
        emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
        return cloneStat(writtenStat)
      }

      await remote.fs.writeFile(sandboxPath, payload)
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      const writtenStat = mapSandboxStat(await remote.fs.stat(sandboxPath))
      statCache.set(sandboxPath, writtenStat)
      emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
      return cloneStat(writtenStat)
    },
    async unlink(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      await remote.fs.rm(sandboxPath, { recursive: false, force: false })
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'unlink', path: relPath })
    },
    async readdir(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const cached = readdirCache.get(sandboxPath)
      if (cached) return cloneEntries(cached)

      const version = metadataVersion
      const mappedEntries = await readSandboxDirectoryEntries(remote, sandboxPath)

      if (metadataVersion === version) {
        readdirCache.set(sandboxPath, mappedEntries)
      }
      return cloneEntries(mappedEntries)
    },
    async stat(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const cached = statCache.get(sandboxPath)
      if (cached) return cloneStat(cached)

      const version = metadataVersion
      const mappedStat = mapSandboxStat(await remote.fs.stat(sandboxPath))
      if (metadataVersion === version) {
        statCache.set(sandboxPath, mappedStat)
      }
      return cloneStat(mappedStat)
    },
    async mkdir(relPath, opts) {
      const sandboxPath = toSandboxPath(relPath)
      await remote.fs.mkdir(sandboxPath, { recursive: opts?.recursive ?? false })
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'mkdir', path: relPath })
    },
    async rename(fromRelPath, toRelPath) {
      const fromSandboxPath = toSandboxPath(fromRelPath)
      const toSandboxAbsolutePath = toSandboxPath(toRelPath)
      await remote.fs.rename(fromSandboxPath, toSandboxAbsolutePath)
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'rename', path: toRelPath, oldPath: fromRelPath })
    },
  }
}

import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type {
  Entry,
  Stat,
  Workspace,
  WorkspaceChangeEvent,
  WorkspaceWatcher,
} from '../../shared/workspace'
import { validatePath } from './paths'

const VERCEL_SANDBOX_ROOT = '/vercel/sandbox'
const CACHE_TTL_MS = 15_000
const CACHE_MAX_ENTRIES = 512
const metadataInvalidators = new WeakMap<VercelSandbox, Set<() => void>>()

function toSandboxPath(relPath: string): string {
  return validatePath(VERCEL_SANDBOX_ROOT, relPath)
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

  function invalidateMetadataCache() {
    statCache.clear()
    readdirCache.clear()
  }

  registerMetadataInvalidator(sandbox, invalidateMetadataCache)

  const { emit: emitChange, watcher } = createSandboxBroadcaster()

  return {
    root: VERCEL_SANDBOX_ROOT,
    fsCapability: 'best-effort',
    watch() {
      return watcher
    },
    invalidateMetadataCache,
    async readFile(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const content = await sandbox.fs.readFile(sandboxPath, 'utf8')
      if (typeof content === 'string') {
        return content
      }
      return Buffer.from(content).toString('utf-8')
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
    async unlink(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.fs.rm(sandboxPath, { recursive: false, force: false })
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'unlink', path: relPath })
    },
    async readdir(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const cached = readdirCache.get(sandboxPath)
      if (cached) return cloneEntries(cached)

      const entries = await sandbox.fs.readdir(sandboxPath, {
        withFileTypes: true,
      })
      const mappedEntries: Entry[] = entries.map((entry): Entry => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' : 'file',
      }))
      readdirCache.set(sandboxPath, mappedEntries)
      return cloneEntries(mappedEntries)
    },
    async stat(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const cached = statCache.get(sandboxPath)
      if (cached) return cloneStat(cached)

      const fileStat = await sandbox.fs.stat(sandboxPath)
      const mappedStat: Stat = {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
      statCache.set(sandboxPath, mappedStat)
      return cloneStat(mappedStat)
    },
    async mkdir(relPath, opts) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.fs.mkdir(sandboxPath, { recursive: opts?.recursive ?? false })
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'mkdir', path: relPath })
    },
    async rename(fromRelPath, toRelPath) {
      const fromSandboxPath = toSandboxPath(fromRelPath)
      const toSandboxAbsolutePath = toSandboxPath(toRelPath)
      await sandbox.fs.rename(fromSandboxPath, toSandboxAbsolutePath)
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'rename', path: toRelPath, oldPath: fromRelPath })
    },
  }
}

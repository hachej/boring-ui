import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type { Entry, Stat } from '../../shared/workspace'
import type { Workspace } from '../../shared/workspace'
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

export function createVercelSandboxWorkspace(
  sandbox: VercelSandbox,
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

  return {
    root: VERCEL_SANDBOX_ROOT,
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
    },
    async unlink(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.fs.rm(sandboxPath, { recursive: false, force: false })
      invalidateMetadataCache()
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
    },
    async rename(fromRelPath, toRelPath) {
      const fromSandboxPath = toSandboxPath(fromRelPath)
      const toSandboxAbsolutePath = toSandboxPath(toRelPath)
      await sandbox.fs.rename(fromSandboxPath, toSandboxAbsolutePath)
      invalidateMetadataCache()
    },
  }
}

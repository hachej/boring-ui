import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

import type {
  Workspace,
  WorkspaceChangeEvent,
  WorkspaceWatcher,
} from '../../shared/workspace'
import {
  assertRealPathWithinWorkspace,
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  validatePath,
} from './paths'

const EPERM_CODE = 'EPERM'

const DEFAULT_WATCH_IGNORES = [
  'node_modules',
  '.git',
  '.DS_Store',
  'dist',
  '.next',
  '.turbo',
  'test-results',
] as const

function shouldIgnoreWatchPath(path: string): boolean {
  const parts = path.split(sep)
  return parts.some((part) =>
    DEFAULT_WATCH_IGNORES.includes(part as (typeof DEFAULT_WATCH_IGNORES)[number]) ||
    part.endsWith('.tsbuildinfo'),
  )
}

/**
 * One chokidar instance per workspace root, fanned out to N
 * subscribers. Created lazily on first `watch()` call so unit tests
 * and watch-free hosts pay nothing.
 */
function createNodeWatcher(root: string): WorkspaceWatcher {
  const listeners = new Set<(e: WorkspaceChangeEvent) => void>()
  let fsw: FSWatcher | null = null
  let closed = false

  const ensureFsw = (): FSWatcher => {
    if (fsw) return fsw
    fsw = chokidar.watch(root, {
      ignored: shouldIgnoreWatchPath,
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      // Avoid chokidar's awaitWriteFinish polling loop in long-lived app
      // servers. Consumers already reconcile by mtime after invalidation.
      // No native renames from chokidar — `unlinkDir`/`addDir`/
      // `unlink`/`add` are the primitives we get. We surface them as
      // separate `unlink` + `write`/`mkdir` events; renames are best
      // recovered at the consumer level if needed.
    })
    fsw.on('add', (p, s) => emit({ op: 'write', path: rel(p), mtimeMs: s?.mtimeMs }))
    fsw.on('change', (p, s) => emit({ op: 'write', path: rel(p), mtimeMs: s?.mtimeMs }))
    fsw.on('addDir', (p) => emit({ op: 'mkdir', path: rel(p) }))
    fsw.on('unlink', (p) => emit({ op: 'unlink', path: rel(p) }))
    fsw.on('unlinkDir', (p) => emit({ op: 'unlink', path: rel(p) }))
    fsw.on('error', () => { /* swallowed: errors are best-effort */ })
    return fsw
  }

  const rel = (abs: string): string => {
    const r = relative(root, abs)
    // Normalize Windows separators so the wire format stays POSIX.
    return r.split(sep).join('/')
  }

  const emit = (event: WorkspaceChangeEvent) => {
    if (closed) return
    if (event.path === '' || event.path.startsWith('..')) return
    for (const l of [...listeners]) {
      try { l(event) } catch { /* one bad listener doesn't kill the chain */ }
    }
  }

  return {
    subscribe(listener) {
      if (closed) return () => {}
      listeners.add(listener)
      ensureFsw()
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      if (closed) return
      closed = true
      listeners.clear()
      fsw?.close().catch(() => {})
      fsw = null
    },
  }
}

export function createNodeWorkspace(root: string): Workspace {
  // Lazy singleton: a single chokidar instance shared by every caller
  // of `watch()` on this workspace. Codex flagged "one watcher per
  // SSE client" as a fd leak — this avoids it.
  let cachedWatcher: WorkspaceWatcher | null = null

  return {
    root,
    fsCapability: 'strong',
    watch() {
      if (!cachedWatcher) cachedWatcher = createNodeWatcher(root)
      return cachedWatcher
    },
    async readFile(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      return await readFile(absPath, 'utf-8')
    },
    async readBinaryFile(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      return new Uint8Array(await readFile(absPath))
    },
    async writeFile(relPath, data) {
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data, 'utf-8')
    },
    async writeBinaryFile(relPath, data) {
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data)
    },
    async readFileWithStat(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      const [content, fileStat] = await Promise.all([
        readFile(absPath, 'utf-8'),
        stat(absPath),
      ])
      return {
        content,
        stat: {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          kind: fileStat.isDirectory() ? 'dir' : 'file',
        },
      }
    },
    async writeFileWithStat(relPath, data) {
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data, 'utf-8')
      const fileStat = await stat(absPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    },
    async writeBinaryFileWithStat(relPath, data) {
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data)
      const fileStat = await stat(absPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    },
    async unlink(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      if (absPath === resolve(root)) {
        throw Object.assign(new Error('cannot remove workspace root'), { code: EPERM_CODE })
      }
      const pathStat = await lstat(absPath)
      if (pathStat.isDirectory()) {
        await rm(absPath, { recursive: true, force: false })
        return
      }
      await unlink(absPath)
    },
    async readdir(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      const entries = await readdir(absPath, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' : 'file',
      }))
    },
    async stat(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      const fileStat = await stat(absPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    },
    async mkdir(relPath, opts) {
      const absPath = validatePath(root, relPath)
      let existingAncestor = absPath
      while (true) {
        try {
          await stat(existingAncestor)
          break
        } catch (error: unknown) {
          const code = (error as { code?: string }).code
          if (code !== 'ENOENT') throw error
          const parent = dirname(existingAncestor)
          if (parent === existingAncestor) throw error
          existingAncestor = parent
        }
      }
      await assertRealPathWithinWorkspace(root, existingAncestor)
      await mkdir(absPath, { recursive: opts?.recursive ?? false })
    },
    async rename(fromRelPath, toRelPath) {
      validatePath(root, toRelPath)
      const fromAbsPath = await ensureExistingWorkspacePath(root, fromRelPath)
      const toAbsPath = await ensureWritableWorkspacePath(root, toRelPath)
      await rename(fromAbsPath, toAbsPath)
    },
  }
}

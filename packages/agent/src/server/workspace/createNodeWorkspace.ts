import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

import type { WorkspaceRuntimeContext } from '../../shared/runtime'
import type {
  Workspace,
  WorkspaceChangeEvent,
  WorkspaceWatcher,
  WorkspaceWatcherReadiness,
} from '../../shared/workspace'
import {
  assertRealPathWithinWorkspace,
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  validatePath,
} from './paths'
import { isIgnoredDirName } from './ignore'

const EPERM_CODE = 'EPERM'

function shouldIgnoreWatchPath(root: string, path: string): boolean {
  const relPath = relative(root, path)
  const parts = relPath.split(sep)
  return parts.some((part) => isIgnoredDirName(part))
}

/**
 * Watcher with one host-facing extra: `emitRename`. Chokidar has no
 * rename primitive — a moved directory surfaces as an `unlink` per old
 * path plus an `add` per new path, thousands of events for a big tree.
 * When the host performed the rename itself (the files/move API), it
 * announces it here: subscribers get ONE synthetic `rename` event and
 * the watcher absorbs the unlink/add echo for both subtrees while it
 * lasts (sliding idle window, hard-capped).
 */
interface NodeWorkspaceWatcher extends WorkspaceWatcher {
  emitRename(fromRel: string, toRel: string): void
}

/** Echo absorption stops this long after the last suppressed event. */
const RENAME_ECHO_IDLE_MS = 1_000
/** Absolute ceiling so a prefix can never be muted indefinitely. */
const RENAME_ECHO_MAX_MS = 30_000

interface EchoSuppression {
  prefix: string
  idleDeadline: number
  hardDeadline: number
}

/**
 * Watching a workspace means chokidar enumerates (and on some
 * platforms opens an fd for) every non-ignored entry under the root.
 * Pointed at a huge directory (~ or a data dump) that is a multi-
 * minute scan, unbounded heap growth, and on macOS without fsevents an
 * silent EMFILE storm. Refuse to watch past this many entries — the
 * workspace stays fully usable, clients just fall back to non-live
 * behavior and the user gets told to start in a subfolder.
 */
const DEFAULT_MAX_WATCHED_ENTRIES = 50_000

function maxWatchedEntries(): number {
  const raw = process.env.BORING_MAX_WATCHED_ENTRIES
  if (!raw) return DEFAULT_MAX_WATCHED_ENTRIES
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_WATCHED_ENTRIES
}

/**
 * Bounded entry count: readdir-only walk (no stat, no fds held) that
 * skips the same dirs the watcher ignores and exits as soon as the cap
 * is crossed — on an over-sized workspace this returns in the time it
 * takes to enumerate cap+1 entries, not the whole tree.
 */
async function countWatchableEntries(root: string, cap: number): Promise<number> {
  let count = 0
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable dir — chokidar would skip it too
    }
    for (const entry of entries) {
      count += 1
      if (count > cap) return count
      // Mirrors the watch config: don't descend ignored names, don't
      // follow symlinks.
      if (entry.isDirectory() && !isIgnoredDirName(entry.name)) {
        stack.push(join(dir, entry.name))
      }
    }
  }
  return count
}

/**
 * One chokidar instance per workspace root, fanned out to N
 * subscribers. Created lazily on first `watch()` call so unit tests
 * and watch-free hosts pay nothing.
 */
function createNodeWatcher(root: string): NodeWorkspaceWatcher {
  const listeners = new Set<(e: WorkspaceChangeEvent) => void>()
  const suppressions: EchoSuppression[] = []
  let fsw: FSWatcher | null = null
  let closed = false
  let readiness: Promise<WorkspaceWatcherReadiness> | null = null

  const startFsw = (): void => {
    if (fsw || closed) return
    fsw = chokidar.watch(root, {
      ignored: (path) => shouldIgnoreWatchPath(root, path),
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      // Avoid chokidar's awaitWriteFinish polling loop in long-lived app
      // servers. Consumers already reconcile by mtime after invalidation.
      // No native renames from chokidar — `unlinkDir`/`addDir`/
      // `unlink`/`add` are the primitives we get. We surface them as
      // separate `unlink` + `write`/`mkdir` events. Renames the host
      // performs itself arrive via `emitRename` instead, which also
      // mutes this echo.
    })
    fsw.on('add', (p, s) => emit({ op: 'write', path: rel(p), mtimeMs: s?.mtimeMs }))
    fsw.on('change', (p, s) => emit({ op: 'write', path: rel(p), mtimeMs: s?.mtimeMs }))
    fsw.on('addDir', (p) => emit({ op: 'mkdir', path: rel(p) }))
    fsw.on('unlink', (p) => emit({ op: 'unlink', path: rel(p) }))
    fsw.on('unlinkDir', (p) => emit({ op: 'unlink', path: rel(p) }))
    let loggedError = false
    fsw.on('error', (err) => {
      // Watch errors are best-effort, but a silent EMFILE storm (macOS
      // fd limit without fsevents) looked like the app hanging. Log the
      // first one so there's a trail.
      if (loggedError) return
      loggedError = true
      console.error(
        `[boring-agent] file watcher error in ${root} (live file events may be incomplete):`,
        err instanceof Error ? err.message : err,
      )
    })
  }

  // Size guard runs once, before the first chokidar instance: counting
  // entries is a cheap readdir walk with an early exit, while letting
  // chokidar loose on an over-sized tree can OOM the process.
  const ensureFsw = (): Promise<WorkspaceWatcherReadiness> => {
    if (readiness) return readiness
    readiness = (async () => {
      const cap = maxWatchedEntries()
      const count = await countWatchableEntries(root, cap)
      if (closed) return { ok: true } as const
      if (count > cap) {
        const message =
          `workspace at ${root} has more than ${cap} entries — file watching disabled. `
          + `Start boring-ui in a smaller subfolder for live file updates, `
          + `or raise BORING_MAX_WATCHED_ENTRIES.`
        console.error(`[boring-agent] ${message}`)
        return { ok: false, reason: 'workspace_too_large', message } as const
      }
      startFsw()
      return { ok: true } as const
    })()
    return readiness
  }

  const rel = (abs: string): string => {
    const r = relative(root, abs)
    // Normalize Windows separators so the wire format stays POSIX.
    return r.split(sep).join('/')
  }

  const fanout = (event: WorkspaceChangeEvent) => {
    if (closed) return
    if (event.path === '' || event.path.startsWith('..')) return
    for (const l of [...listeners]) {
      try { l(event) } catch { /* one bad listener doesn't kill the chain */ }
    }
  }

  const isSuppressedEcho = (path: string): boolean => {
    const now = Date.now()
    for (let i = suppressions.length - 1; i >= 0; i--) {
      const s = suppressions[i]!
      if (now > s.idleDeadline || now > s.hardDeadline) {
        suppressions.splice(i, 1)
        continue
      }
      if (path === s.prefix || path.startsWith(`${s.prefix}/`)) {
        s.idleDeadline = Math.min(now + RENAME_ECHO_IDLE_MS, s.hardDeadline)
        return true
      }
    }
    return false
  }

  // Chokidar events go through the suppression filter; synthetic
  // events from `emitRename` bypass it (their own `to` prefix is in
  // the suppression list).
  const emit = (event: WorkspaceChangeEvent) => {
    if (isSuppressedEcho(event.path)) return
    fanout(event)
  }

  return {
    subscribe(listener) {
      if (closed) return () => {}
      listeners.add(listener)
      void ensureFsw()
      return () => {
        listeners.delete(listener)
      }
    },
    whenReady() {
      return ensureFsw()
    },
    emitRename(fromRel, toRel) {
      if (closed) return
      const now = Date.now()
      for (const prefix of [fromRel, toRel]) {
        suppressions.push({
          prefix,
          idleDeadline: now + RENAME_ECHO_IDLE_MS,
          hardDeadline: now + RENAME_ECHO_MAX_MS,
        })
      }
      fanout({ op: 'rename', path: toRel, oldPath: fromRel })
    },
    close() {
      if (closed) return
      closed = true
      listeners.clear()
      suppressions.length = 0
      fsw?.close().catch(() => {})
      fsw = null
    },
  }
}

export interface CreateNodeWorkspaceOptions {
  runtimeContext?: WorkspaceRuntimeContext
}

const nodeWorkspaceHostRoots = new WeakMap<Workspace, string>()

export function getNodeWorkspaceHostRoot(workspace: Workspace): string | undefined {
  return nodeWorkspaceHostRoots.get(workspace)
}

export function createNodeWorkspace(root: string, opts: CreateNodeWorkspaceOptions = {}): Workspace {
  const runtimeContext = opts.runtimeContext ?? { runtimeCwd: root }

  // Lazy singleton: a single chokidar instance shared by every caller
  // of `watch()` on this workspace. Codex flagged "one watcher per
  // SSE client" as a fd leak — this avoids it.
  let cachedWatcher: NodeWorkspaceWatcher | null = null

  const relPosix = (absPath: string): string =>
    relative(root, absPath).split(sep).join('/')

  const workspace: Workspace = {
    root: runtimeContext.runtimeCwd,
    runtimeContext,
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
      // One synthetic rename instead of the unlink/add event storm
      // chokidar would stream for every file under a moved directory.
      // No watcher yet → no subscribers → nothing to announce.
      cachedWatcher?.emitRename(relPosix(fromAbsPath), relPosix(toAbsPath))
    },
  }

  nodeWorkspaceHostRoots.set(workspace, root)
  return workspace
}

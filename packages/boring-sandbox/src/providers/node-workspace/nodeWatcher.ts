import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

import type {
  WorkspaceChangeEvent,
  WorkspaceWatcher,
  WorkspaceWatcherReadiness,
} from '../contracts'
import { isIgnoredDirName } from './ignore'

interface LogFields {
  [key: string]: unknown
}

const SENSITIVE_KEYS = new Set([
  'apiKey',
  'api_key',
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'oidcToken',
  'accessToken',
  'refreshToken',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'VERCEL_TEAM_ID',
].map((key) => key.toLowerCase()))

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

function redactValue(key: string | undefined, value: unknown, seen: WeakSet<object>): unknown {
  if (key && isSensitiveKey(key) && value != null) return '***'
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Date) return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    const out = value.map((item) => redactValue(undefined, item, seen))
    seen.delete(value)
    return out
  }

  const out: LogFields = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactValue(childKey, childValue, seen)
  }
  seen.delete(value)
  return out
}

function redact(fields: LogFields): LogFields {
  const out: LogFields = {}
  const seen = new WeakSet<object>()
  for (const [key, value] of Object.entries(fields)) {
    out[key] = redactValue(key, value, seen)
  }
  return out
}

function shouldIgnoreWatchPath(root: string, path: string): boolean {
  const relPath = relative(root, path)
  const parts = relPath.split(sep)
  return parts.some((part) => isIgnoredDirName(part))
}

function logWatcherError(msg: string, fields?: LogFields): void {
  console.error(JSON.stringify({
    level: 'error',
    prefix: 'workspace-watch',
    msg,
    ...(fields ? redact(fields) : {}),
    t: new Date().toISOString(),
  }))
}

/** Workspace-relative path with POSIX separators — the wire format for
 * every `WorkspaceChangeEvent.path`. */
export function toPosixRel(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/')
}

/**
 * Watcher with one host-facing extra: `emitRename`. Chokidar has no
 * rename primitive — a moved directory surfaces as an `unlink` per old
 * path plus an `add` per new path, thousands of events for a big tree.
 * When the host performed the rename itself (the files/move API), it
 * announces it here: subscribers get ONE synthetic `rename` event and
 * the watcher absorbs exactly the echo that rename predicts —
 * `unlink`/`unlinkDir` under the old prefix, `add`/`addDir` under the
 * new one — while it lasts (sliding idle window, hard-capped). Other
 * event kinds under either prefix (a real edit or delete inside the
 * moved folder) flow through untouched.
 */
export interface NodeWorkspaceWatcher extends WorkspaceWatcher {
  emitRename(fromRel: string, toRel: string): void
}

/** Echo absorption stops this long after the last suppressed event. */
const RENAME_ECHO_IDLE_MS = 1_000
/** Absolute ceiling so a prefix can never be muted indefinitely. */
const RENAME_ECHO_MAX_MS = 30_000

/** Raw chokidar event names — suppression matches on these, not on the
 * collapsed `WorkspaceChangeEvent.op` (add and change both map to
 * `write`, but only add is rename echo). */
type ChokidarEventKind = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

interface EchoSuppression {
  prefix: string
  /** Event kinds this prefix absorbs — the rename's predicted echo. */
  kinds: ReadonlySet<ChokidarEventKind>
  idleDeadline: number
  hardDeadline: number
}

const RENAME_ECHO_FROM_KINDS: ReadonlySet<ChokidarEventKind> = new Set(['unlink', 'unlinkDir'])
const RENAME_ECHO_TO_KINDS: ReadonlySet<ChokidarEventKind> = new Set(['add', 'addDir'])

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
 * subscribers. Chokidar starts lazily on the first subscribe/whenReady
 * (after the size guard passes) so unit tests and watch-free hosts pay
 * nothing.
 */
export function createNodeWatcher(root: string): NodeWorkspaceWatcher {
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
    fsw.on('add', (p, s) => emit('add', { op: 'write', path: rel(p), mtimeMs: s?.mtimeMs }))
    fsw.on('change', (p, s) => emit('change', { op: 'write', path: rel(p), mtimeMs: s?.mtimeMs }))
    fsw.on('addDir', (p) => emit('addDir', { op: 'mkdir', path: rel(p) }))
    fsw.on('unlink', (p) => emit('unlink', { op: 'unlink', path: rel(p) }))
    fsw.on('unlinkDir', (p) => emit('unlinkDir', { op: 'unlink', path: rel(p) }))
    let loggedError = false
    fsw.on('error', (err) => {
      // Watch errors are best-effort, but a silent EMFILE storm (macOS
      // fd limit without fsevents) looked like the app hanging. Log the
      // first one so there's a trail.
      if (loggedError) return
      loggedError = true
      logWatcherError('file watcher error — live file events may be incomplete', {
        root,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  // Size guard runs once, before the first chokidar instance: counting
  // entries is a cheap readdir walk with an early exit, while letting
  // chokidar loose on an over-sized tree can OOM the process.
  const ensureFsw = (): Promise<WorkspaceWatcherReadiness> => {
    if (readiness) return readiness
    readiness = (async (): Promise<WorkspaceWatcherReadiness> => {
      const cap = maxWatchedEntries()
      const count = await countWatchableEntries(root, cap)
      if (closed) return { ok: false, reason: 'closed' }
      if (count > cap) {
        const message =
          `workspace at ${root} has more than ${cap} entries — file watching disabled. `
          + `Start boring-ui in a smaller subfolder for live file updates, `
          + `or raise BORING_MAX_WATCHED_ENTRIES.`
        logWatcherError(message, { root, cap })
        return { ok: false, reason: 'workspace_too_large', message }
      }
      startFsw()
      if (fsw) {
        await new Promise<void>((resolve) => {
          fsw!.once('ready', resolve)
          fsw!.once('error', () => resolve())
        })
      }
      if (closed) return { ok: false, reason: 'closed' }
      return { ok: true }
    })()
    return readiness
  }

  const rel = (abs: string): string => toPosixRel(root, abs)

  const fanout = (event: WorkspaceChangeEvent) => {
    if (closed) return
    if (event.path === '' || event.path.startsWith('..')) return
    for (const l of [...listeners]) {
      try { l(event) } catch { /* one bad listener doesn't kill the chain */ }
    }
  }

  const isSuppressedEcho = (kind: ChokidarEventKind, path: string): boolean => {
    const now = Date.now()
    for (let i = suppressions.length - 1; i >= 0; i--) {
      const s = suppressions[i]!
      if (now > s.idleDeadline || now > s.hardDeadline) {
        suppressions.splice(i, 1)
        continue
      }
      if (s.kinds.has(kind) && (path === s.prefix || path.startsWith(`${s.prefix}/`))) {
        s.idleDeadline = Math.min(now + RENAME_ECHO_IDLE_MS, s.hardDeadline)
        return true
      }
    }
    return false
  }

  // Chokidar events go through the suppression filter; synthetic
  // events from `emitRename` bypass it via `fanout` directly.
  const emit = (kind: ChokidarEventKind, event: WorkspaceChangeEvent) => {
    if (isSuppressedEcho(kind, event.path)) return
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
      // Suppressions absorb chokidar's echo — without a running chokidar
      // instance there is no echo. Registering anyway would leak entries
      // (only pruned on chokidar events) and wrongly mute genuine adds if
      // chokidar starts inside the window (ignoreInitial means the
      // post-start scan never replays this rename).
      if (fsw) {
        const now = Date.now()
        const window = {
          idleDeadline: now + RENAME_ECHO_IDLE_MS,
          hardDeadline: now + RENAME_ECHO_MAX_MS,
        }
        suppressions.push(
          { prefix: fromRel, kinds: RENAME_ECHO_FROM_KINDS, ...window },
          { prefix: toRel, kinds: RENAME_ECHO_TO_KINDS, ...window },
        )
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

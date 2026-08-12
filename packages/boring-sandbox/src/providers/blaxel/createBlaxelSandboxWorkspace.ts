import type {
  Entry,
  Stat,
  Workspace,
  WorkspaceWatchControlEvent,
} from '@hachej/boring-agent/shared'

import type { BlaxelRemoteSandbox, BlaxelWatchEvent } from './client'
import { BLAXEL_WORKSPACE_ROOT } from './config'
import { isBlaxelNotFound, normalizeBlaxelError, normalizeBlaxelFilesystemError } from './errors'
import { shellQuote, toBlaxelPath } from './runtimeHelpers'

type WorkspaceWatcher = ReturnType<NonNullable<Workspace['watch']>>
type WorkspaceChangeEvent = Parameters<WorkspaceWatcher['subscribe']>[0] extends (
  event: infer Event,
) => void ? Event : never

const CACHE_TTL_MS = 15_000
const CACHE_MAX_ENTRIES = 512
const HELPER_TIMEOUT_SECONDS = 10
const HELPER_MAX_OUTPUT_BYTES = 16 * 1024
const MAX_WATCH_RECONNECT_ATTEMPTS = 6
const EPERM = 'EPERM'

interface CacheEntry<T> { value: T; expiresAt: number }

function createTimedLruCache<T>() {
  const entries = new Map<string, CacheEntry<T>>()
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key)
      if (!entry || entry.expiresAt <= Date.now()) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key: string, value: T) {
      entries.delete(key)
      entries.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
      while (entries.size > CACHE_MAX_ENTRIES) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    clear() { entries.clear() },
  }
}

function cloneStat(value: Stat): Stat { return { ...value } }
function cloneEntries(value: Entry[]): Entry[] { return value.map((entry) => ({ ...entry })) }

function assertHelperOutputBound(stdout: string, stderr: string): void {
  const encoder = new TextEncoder()
  if (encoder.encode(stdout).byteLength + encoder.encode(stderr).byteLength > HELPER_MAX_OUTPUT_BYTES) {
    throw normalizeBlaxelError(new Error('guest helper output exceeded the local byte limit'), 'BLAXEL_RUNTIME_UNQUALIFIED')
  }
}

function relativeWatchPath(event: BlaxelWatchEvent): string | null {
  const parent = event.path.replace(/\/+$/, '')
  const candidate = event.name
    && event.name !== '.'
    && !parent.endsWith(`/${event.name}`)
    ? `${parent}/${event.name}`
    : parent || event.name
  const normalized = candidate.startsWith(`${BLAXEL_WORKSPACE_ROOT}/`)
    ? candidate.slice(BLAXEL_WORKSPACE_ROOT.length + 1)
    : candidate === BLAXEL_WORKSPACE_ROOT ? '.' : candidate.replace(/^\/+/, '')
  if (!normalized || normalized === '.') return '.'
  try {
    toBlaxelPath(normalized)
    return normalized
  } catch {
    return null
  }
}

export interface BlaxelSandboxWorkspace extends Workspace {
  invalidateMetadataCache(): void
  notifyExternalChange(event: WorkspaceWatchControlEvent): void
  dispose(): void
}

export function createBlaxelSandboxWorkspace(
  remote: BlaxelRemoteSandbox,
  options: { onMutation?: () => void } = {},
): BlaxelSandboxWorkspace {
  const statCache = createTimedLruCache<Stat>()
  const readdirCache = createTimedLruCache<Entry[]>()
  const listeners = new Set<(event: WorkspaceChangeEvent) => void>()
  const controlListeners = new Set<(event: WorkspaceWatchControlEvent) => void>()
  let metadataVersion = 0
  let closed = false
  let nativeWatch: { close(): void } | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempt = 0
  const recentLocalEvents = new Map<string, number>()
  const recentLocalRenames = new Map<string, number>()

  function eventKey(event: Pick<WorkspaceChangeEvent, 'op' | 'path'>): string {
    return `${event.op}:${event.path}`
  }

  function invalidateMetadataCache() {
    metadataVersion += 1
    statCache.clear()
    readdirCache.clear()
  }
  function emit(event: WorkspaceChangeEvent, local = true) {
    if (closed) return
    const now = Date.now()
    for (const [key, expiresAt] of recentLocalEvents) {
      if (expiresAt <= now) recentLocalEvents.delete(key)
    }
    for (const [key, expiresAt] of recentLocalRenames) {
      if (expiresAt <= now) recentLocalRenames.delete(key)
    }
    if (local) {
      recentLocalEvents.set(eventKey(event), now + 1_500)
      if (event.op === 'rename') recentLocalRenames.set(event.path, now + 1_500)
    }
    for (const listener of [...listeners]) {
      try { listener(event) } catch { /* listener isolation */ }
    }
  }
  function emitControl(event: WorkspaceWatchControlEvent) {
    if (closed) return
    for (const listener of [...controlListeners]) {
      try { listener(event) } catch { /* listener isolation */ }
    }
  }
  function ensureNativeWatch() {
    if (nativeWatch || closed) return
    try {
      nativeWatch = remote.fs.watch(
        `${BLAXEL_WORKSPACE_ROOT}/**`,
        async (event) => {
          invalidateMetadataCache()
          const path = relativeWatchPath(event)
          if (path === null) return emitControl({ type: 'resync-required', reason: 'blaxel_invalid_watch_path' })
          switch (event.op) {
            case 'WRITE': {
              if ((recentLocalEvents.get(eventKey({ op: 'write', path })) ?? 0) > Date.now()) return
              emit({ op: 'write', path }, false); break
            }
            case 'REMOVE': {
              if ((recentLocalEvents.get(eventKey({ op: 'unlink', path })) ?? 0) > Date.now()) return
              emit({ op: 'unlink', path }, false); break
            }
            case 'CREATE': {
              try {
                const info = await statPath(toBlaxelPath(path))
                const mapped = { op: info.kind === 'dir' ? 'mkdir' as const : 'write' as const, path }
                if ((recentLocalEvents.get(eventKey(mapped)) ?? 0) <= Date.now()) emit({ ...mapped, mtimeMs: info.mtimeMs }, false)
              } catch {
                emitControl({ type: 'resync-required', reason: 'blaxel_create_classification_race' })
              }
              break
            }
            case 'RENAME': {
              if ((recentLocalRenames.get(path) ?? 0) > Date.now()) return
              emitControl({ type: 'resync-required', reason: 'blaxel_rename_missing_old_path' }); break
            }
            case 'CHMOD': emitControl({ type: 'resync-required', reason: 'blaxel_unmapped_chmod' }); break
          }
        },
        { withContent: false, onError: () => {
          emitControl({ type: 'resync-required', reason: 'blaxel_watch_error' })
          nativeWatch?.close()
          nativeWatch = undefined
          if (!closed && reconnectAttempt < MAX_WATCH_RECONNECT_ATTEMPTS) {
            const delay = Math.min(10_000, 250 * 2 ** reconnectAttempt++)
            reconnectTimer = setTimeout(ensureNativeWatch, delay)
          }
        } },
      )
    } catch {
      emitControl({ type: 'resync-required', reason: 'blaxel_watch_start_failed' })
      if (!closed && reconnectAttempt < MAX_WATCH_RECONNECT_ATTEMPTS) {
        const delay = Math.min(10_000, 250 * 2 ** reconnectAttempt++)
        reconnectTimer = setTimeout(ensureNativeWatch, delay)
      }
    }
  }

  async function helper(command: string): Promise<string> {
    try {
      const result = await remote.process.exec({
        command: `sh -c ${shellQuote(`export LC_ALL=C; ${command}`)}`,
        workingDir: BLAXEL_WORKSPACE_ROOT,
        keepAlive: true,
        timeout: HELPER_TIMEOUT_SECONDS,
        waitForCompletion: true,
      })
      assertHelperOutputBound(result.stdout, result.stderr)
      if (result.exitCode !== 0) {
        const stderr = result.stderr.slice(0, 16 * 1024)
        const code = /no such file|not found/i.test(stderr) ? 'ENOENT'
          : /not a directory/i.test(stderr) ? 'ENOTDIR'
            : /permission denied|operation not permitted/i.test(stderr) ? 'EPERM'
              : /file exists/i.test(stderr) ? 'EEXIST'
                : undefined
        const error = Object.assign(new Error(stderr || `helper exited ${result.exitCode}`), { code })
        throw error
      }
      return result.stdout
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      if (typeof code === 'string' || isBlaxelNotFound(error)) {
        throw normalizeBlaxelFilesystemError(error)
      }
      throw normalizeBlaxelError(error)
    }
  }

  async function statPath(path: string): Promise<Stat> {
    const output = await helper(`stat -Lc '%s|%Y|%F' -- ${shellQuote(path)}`)
    const lines = output.trimEnd().split('|')
    if (lines.length !== 3) throw normalizeBlaxelError(new Error('invalid stat helper response'), 'BLAXEL_RUNTIME_UNQUALIFIED')
    const size = Number(lines[0])
    const seconds = Number(lines[1])
    if (!Number.isSafeInteger(size) || !Number.isFinite(seconds)) {
      throw normalizeBlaxelError(new Error('invalid stat helper numbers'), 'BLAXEL_RUNTIME_UNQUALIFIED')
    }
    return { size, mtimeMs: seconds * 1_000, kind: lines[2]!.includes('directory') ? 'dir' : 'file' }
  }

  async function assertResolvedWithinRoot(path: string): Promise<void> {
    const resolved = (await helper(`realpath -e -- ${shellQuote(path)}`)).trim()
    if (resolved !== BLAXEL_WORKSPACE_ROOT && !resolved.startsWith(`${BLAXEL_WORKSPACE_ROOT}/`)) {
      throw Object.assign(new Error('resolved path escapes workspace root'), { code: EPERM })
    }
  }

  async function assertMutationTargetWithinRoot(path: string): Promise<void> {
    let result
    try {
      result = await remote.process.exec({
        command: `sh -c ${shellQuote(`export LC_ALL=C; if test -L ${shellQuote(path)}; then exit 77; elif test -e ${shellQuote(path)}; then realpath -e -- ${shellQuote(path)}; else realpath -m -- ${shellQuote(path)}; fi`)}`,
        workingDir: BLAXEL_WORKSPACE_ROOT,
        keepAlive: true,
        timeout: HELPER_TIMEOUT_SECONDS,
        waitForCompletion: true,
      })
    } catch (error) { throw normalizeBlaxelError(error) }
    assertHelperOutputBound(result.stdout, result.stderr)
    if (result.exitCode === 77) throw Object.assign(new Error('symbolic-link mutation targets are not allowed'), { code: EPERM })
    if (result.exitCode !== 0) throw normalizeBlaxelFilesystemError(Object.assign(new Error(result.stderr.slice(0, 16 * 1024)), { code: 'ENOENT' }))
    const resolved = result.stdout.trim()
    if (resolved !== BLAXEL_WORKSPACE_ROOT && !resolved.startsWith(`${BLAXEL_WORKSPACE_ROOT}/`)) {
      throw Object.assign(new Error('resolved mutation target escapes workspace root'), { code: EPERM })
    }
  }

  async function isSymlink(path: string): Promise<boolean> {
    try {
      const result = await remote.process.exec({
        command: `sh -c ${shellQuote(`test -L ${shellQuote(path)}`)}`,
        workingDir: BLAXEL_WORKSPACE_ROOT,
        keepAlive: true,
        timeout: HELPER_TIMEOUT_SECONDS,
        waitForCompletion: true,
      })
      assertHelperOutputBound(result.stdout, result.stderr)
      return result.exitCode === 0
    } catch (error) { throw normalizeBlaxelError(error) }
  }

  async function descendantPaths(relPath: string, absolute: string): Promise<string[]> {
    await assertResolvedWithinRoot(absolute)
    const info = await statPath(absolute)
    if (info.kind !== 'dir') return []
    let entries
    try { entries = await remote.fs.ls(absolute) }
    catch (error) { throw normalizeBlaxelFilesystemError(error) }
    const descendants: string[] = []
    for (const entry of [...entries.files, ...entries.subdirectories]) {
      const child = relPath === '.' ? entry.name : `${relPath}/${entry.name}`
      descendants.push(child)
      if ('size' in entry === false) descendants.push(...await descendantPaths(child, `${absolute}/${entry.name}`))
    }
    return descendants
  }

  const watcher: WorkspaceWatcher = {
    subscribe(listener, subscribeOptions) {
      if (closed) return () => {}
      listeners.add(listener)
      if (subscribeOptions?.onControlEvent) controlListeners.add(subscribeOptions.onControlEvent)
      ensureNativeWatch()
      return () => {
        listeners.delete(listener)
        if (subscribeOptions?.onControlEvent) controlListeners.delete(subscribeOptions.onControlEvent)
      }
    },
    close() {
      if (closed) return
      closed = true
      nativeWatch?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      nativeWatch = undefined
      listeners.clear()
      controlListeners.clear()
      recentLocalEvents.clear()
      recentLocalRenames.clear()
    },
  }

  const workspace: BlaxelSandboxWorkspace = {
    root: BLAXEL_WORKSPACE_ROOT,
    runtimeContext: { runtimeCwd: BLAXEL_WORKSPACE_ROOT },
    fsCapability: 'best-effort',
    watch: () => watcher,
    invalidateMetadataCache,
    notifyExternalChange: emitControl,
    dispose: () => watcher.close(),
    async readFile(relPath) {
      const path = toBlaxelPath(relPath); await assertResolvedWithinRoot(path)
      try { return await remote.fs.read(path) } catch (error) { throw normalizeBlaxelFilesystemError(error) }
    },
    async readBinaryFile(relPath) {
      const path = toBlaxelPath(relPath); await assertResolvedWithinRoot(path)
      try { return new Uint8Array(await (await remote.fs.readBinary(path)).arrayBuffer()) }
      catch (error) { throw normalizeBlaxelFilesystemError(error) }
    },
    async writeFile(relPath, data) {
      const path = toBlaxelPath(relPath); await assertMutationTargetWithinRoot(path)
      try { await remote.fs.write(path, data) }
      catch (error) { throw normalizeBlaxelFilesystemError(error) }
      invalidateMetadataCache(); options.onMutation?.(); emit({ op: 'write', path: relPath })
    },
    async writeBinaryFile(relPath, data) {
      const path = toBlaxelPath(relPath); await assertMutationTargetWithinRoot(path)
      try { await remote.fs.writeBinary(path, data) }
      catch (error) { throw normalizeBlaxelFilesystemError(error) }
      invalidateMetadataCache(); options.onMutation?.(); emit({ op: 'write', path: relPath })
    },
    async readFileWithStat(relPath) {
      const path = toBlaxelPath(relPath)
      await assertResolvedWithinRoot(path)
      const [content, stat] = await Promise.all([
        remote.fs.read(path).catch((error) => { throw normalizeBlaxelFilesystemError(error) }),
        workspace.stat(relPath),
      ])
      return { content, stat }
    },
    async writeFileWithStat(relPath, data) {
      await workspace.writeFile(relPath, data)
      return await workspace.stat(relPath)
    },
    async writeBinaryFileWithStat(relPath, data) {
      await workspace.writeBinaryFile!(relPath, data)
      return await workspace.stat(relPath)
    },
    async unlink(relPath) {
      const path = toBlaxelPath(relPath)
      if (path === BLAXEL_WORKSPACE_ROOT) throw Object.assign(new Error('cannot remove workspace root'), { code: EPERM })
      await assertResolvedWithinRoot(path)
      const descendants = await isSymlink(path) ? [] : await descendantPaths(relPath, path)
      try { await remote.fs.rm(path, true) }
      catch (error) { throw normalizeBlaxelFilesystemError(error) }
      invalidateMetadataCache(); options.onMutation?.(); emit({ op: 'unlink', path: relPath })
      for (const descendant of descendants) emit({ op: 'unlink', path: descendant })
    },
    async readdir(relPath) {
      const path = toBlaxelPath(relPath)
      await assertResolvedWithinRoot(path)
      const cached = readdirCache.get(path)
      if (cached) return cloneEntries(cached)
      const version = metadataVersion
      let directory
      try { directory = await remote.fs.ls(path) }
      catch (error) { throw normalizeBlaxelFilesystemError(error) }
      const entries: Entry[] = [
        ...directory.files.map((entry) => ({ name: entry.name, kind: 'file' as const })),
        ...directory.subdirectories.map((entry) => ({ name: entry.name, kind: 'dir' as const })),
      ]
      if (version === metadataVersion) readdirCache.set(path, entries)
      return cloneEntries(entries)
    },
    async stat(relPath) {
      const path = toBlaxelPath(relPath)
      await assertResolvedWithinRoot(path)
      const cached = statCache.get(path)
      if (cached) return cloneStat(cached)
      const version = metadataVersion
      const stat = await statPath(path)
      if (version === metadataVersion) statCache.set(path, stat)
      return cloneStat(stat)
    },
    async mkdir(relPath, mkdirOptions) {
      const path = toBlaxelPath(relPath)
      if (path !== BLAXEL_WORKSPACE_ROOT) await assertMutationTargetWithinRoot(path)
      if (mkdirOptions?.recursive) await helper(`mkdir -p -- ${shellQuote(path)}`)
      else {
        try { await remote.fs.mkdir(path) }
        catch (error) { throw normalizeBlaxelFilesystemError(error) }
      }
      invalidateMetadataCache(); options.onMutation?.(); emit({ op: 'mkdir', path: relPath })
    },
    async rename(fromRelPath, toRelPath) {
      const from = toBlaxelPath(fromRelPath)
      const to = toBlaxelPath(toRelPath)
      if (from === BLAXEL_WORKSPACE_ROOT || to === BLAXEL_WORKSPACE_ROOT) {
        throw Object.assign(new Error('cannot rename workspace root'), { code: EPERM })
      }
      await assertResolvedWithinRoot(from)
      await assertMutationTargetWithinRoot(to)
      await helper(`mv -T -- ${shellQuote(from)} ${shellQuote(to)}`)
      invalidateMetadataCache(); options.onMutation?.(); emit({ op: 'rename', oldPath: fromRelPath, path: toRelPath })
    },
  }
  return workspace
}

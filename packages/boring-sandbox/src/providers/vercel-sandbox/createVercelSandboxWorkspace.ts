import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type {
  Entry,
  Stat,
  Workspace,
  WorkspaceWatchControlEvent,
} from '@hachej/boring-agent/shared'
import { validatePath } from '../node-workspace/paths'

type WorkspaceWatcher = ReturnType<NonNullable<Workspace['watch']>>
type WorkspaceChangeEvent = Parameters<WorkspaceWatcher['subscribe']>[0] extends (
  event: infer Event,
) => void ? Event : never

export const VERCEL_SANDBOX_WORKSPACE_ROOT = '/workspace'
export const VERCEL_SANDBOX_REMOTE_ROOT = VERCEL_SANDBOX_WORKSPACE_ROOT
export const VERCEL_SANDBOX_RUNTIME_CONTEXT = { runtimeCwd: VERCEL_SANDBOX_WORKSPACE_ROOT } as const

type VercelSandboxCompat = VercelSandbox & {
  fs?: {
    readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array | Buffer>
    readdir(path: string, opts: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>
    stat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory(): boolean }>
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<unknown>
    rename(from: string, to: string): Promise<unknown>
    rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<unknown>
  }
  readFileToBuffer?(file: { path: string; cwd?: string }, opts?: { signal?: AbortSignal }): Promise<Buffer | null>
  mkDir?(path: string, opts?: { signal?: AbortSignal }): Promise<void>
  runCommand(params: {
    cmd: string
    args?: string[]
    cwd?: string
  }): Promise<{
    exitCode?: number
    stdout?: () => Promise<string>
    stderr?: () => Promise<string>
  }>
}
const EPERM_CODE = 'EPERM'
const CACHE_TTL_MS = 15_000
const CACHE_MAX_ENTRIES = 512
const MAX_INLINE_WRITE_BYTES = 128 * 1024
const metadataInvalidators = new WeakMap<VercelSandbox, Set<() => void>>()
const workspaceDisposers = new WeakMap<Workspace, () => void>()

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function runJson<T>(sandbox: VercelSandboxCompat, script: string): Promise<T> {
  const result = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script] })
  const [out, err] = await Promise.all([
    result.stdout?.() ?? Promise.resolve(''),
    result.stderr?.() ?? Promise.resolve(''),
  ])
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(err || `sandbox command failed with exit code ${result.exitCode}`)
  }
  return JSON.parse(out) as T
}

async function runShell(sandbox: VercelSandboxCompat, script: string): Promise<void> {
  const result = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script] })
  if ((result.exitCode ?? 1) !== 0) {
    const err = await (result.stderr?.() ?? Promise.resolve(''))
    throw new Error(err || `sandbox command failed with exit code ${result.exitCode}`)
  }
}

function registerMetadataInvalidator(
  sandbox: VercelSandbox,
  invalidate: () => void,
): () => void {
  const existing = metadataInvalidators.get(sandbox)
  if (existing) {
    existing.add(invalidate)
  } else {
    metadataInvalidators.set(sandbox, new Set([invalidate]))
  }
  return () => {
    const invalidators = metadataInvalidators.get(sandbox)
    if (!invalidators) return
    invalidators.delete(invalidate)
    if (invalidators.size === 0) metadataInvalidators.delete(sandbox)
  }
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

export function disposeVercelSandboxWorkspace(workspace: Workspace): void {
  const dispose = workspaceDisposers.get(workspace)
  if (!dispose) return
  workspaceDisposers.delete(workspace)
  dispose()
}

export interface VercelSandboxWorkspace extends Workspace {
  invalidateMetadataCache(): void
  notifyExternalChange(event: WorkspaceWatchControlEvent): void
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
  emitControl: (e: WorkspaceWatchControlEvent) => void
  watcher: WorkspaceWatcher
} {
  const listeners = new Set<(e: WorkspaceChangeEvent) => void>()
  const controlListeners = new Set<(e: WorkspaceWatchControlEvent) => void>()
  let closed = false

  const emit = (event: WorkspaceChangeEvent) => {
    if (closed) return
    for (const l of [...listeners]) {
      try {
        l(event)
      } catch {
        /* swallow */
      }
    }
  }

  const emitControl = (event: WorkspaceWatchControlEvent) => {
    if (closed) return
    for (const l of [...controlListeners]) {
      try {
        l(event)
      } catch {
        /* swallow */
      }
    }
  }

  const watcher: WorkspaceWatcher = {
    subscribe(listener, options) {
      if (closed) return () => {}
      listeners.add(listener)
      if (options?.onControlEvent) {
        controlListeners.add(options.onControlEvent)
      }
      return () => {
        listeners.delete(listener)
        if (options?.onControlEvent) {
          controlListeners.delete(options.onControlEvent)
        }
      }
    },
    close() {
      closed = true
      listeners.clear()
      controlListeners.clear()
    },
  }

  return { emit, emitControl, watcher }
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

  const unregisterMetadataInvalidator = registerMetadataInvalidator(
    sandbox,
    invalidateMetadataCache,
  )

  const { emit: emitChange, emitControl, watcher } = createSandboxBroadcaster()
  const remote = sandbox as VercelSandboxCompat

  async function assertRealPathWithinSandboxRoot(sandboxPath: string): Promise<void> {
    const isWithinRoot = await runJson<boolean>(
      remote,
      `node -e ${shellQuote(`const fs=require('fs'); const path=require('path'); const root=fs.realpathSync(process.argv[1]); const target=fs.realpathSync(process.argv[2]); const rel=path.relative(root,target); process.stdout.write(JSON.stringify(rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel))))`)} ${shellQuote(VERCEL_SANDBOX_REMOTE_ROOT)} ${shellQuote(sandboxPath)}`,
    )
    if (!isWithinRoot) {
      throw Object.assign(new Error('resolved path escapes workspace root'), { code: EPERM_CODE })
    }
  }

  async function isSandboxSymlink(sandboxPath: string): Promise<boolean> {
    return await runJson<boolean>(
      remote,
      `node -e ${shellQuote(`const fs=require('fs'); process.stdout.write(JSON.stringify(fs.lstatSync(process.argv[1]).isSymbolicLink()))`)} ${shellQuote(sandboxPath)}`,
    )
  }

  async function listDescendantPaths(relPath: string, sandboxPath: string): Promise<string[]> {
    if (remote.fs?.stat && remote.fs.readdir) {
      const fileStat = await remote.fs.stat(sandboxPath)
      if (!fileStat.isDirectory()) return []
      const entries = await remote.fs.readdir(sandboxPath, { withFileTypes: true })
      const descendants: string[] = []
      for (const entry of entries) {
        const childRelPath = relPath === '.' ? entry.name : `${relPath}/${entry.name}`
        descendants.push(childRelPath)
        if (entry.isDirectory()) {
          descendants.push(...await listDescendantPaths(childRelPath, `${sandboxPath}/${entry.name}`))
        }
      }
      return descendants
    }
    return await runJson<string[]>(
      remote,
      `node -e ${shellQuote(`const fs=require('fs'); const path=require('path'); const root=process.argv[1]; const relRoot=process.argv[2]; function walk(abs,rel){ const s=fs.statSync(abs); if(!s.isDirectory()) return []; const out=[]; for (const entry of fs.readdirSync(abs,{withFileTypes:true})) { const childRel=rel==='.'?entry.name:rel+'/'+entry.name; out.push(childRel); if(entry.isDirectory()) out.push(...walk(path.join(abs,entry.name),childRel)); } return out; } process.stdout.write(JSON.stringify(walk(root,relRoot)))`)} ${shellQuote(sandboxPath)} ${shellQuote(relPath)}`,
    )
  }

  async function statSandboxPath(sandboxPath: string): Promise<Stat> {
    if (remote.fs?.stat) {
      const fileStat = await remote.fs.stat(sandboxPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    }
    return await runJson<Stat>(
      remote,
      `node -e ${shellQuote(`const fs=require('fs'); const p=process.argv[1]; const s=fs.statSync(p); process.stdout.write(JSON.stringify({size:s.size,mtimeMs:s.mtimeMs,kind:s.isDirectory()?'dir':'file'}))`)} ${shellQuote(sandboxPath)}`,
    )
  }

  const workspace: VercelSandboxWorkspace = {
    root: VERCEL_SANDBOX_RUNTIME_CONTEXT.runtimeCwd,
    runtimeContext: VERCEL_SANDBOX_RUNTIME_CONTEXT,
    fsCapability: 'best-effort',
    watch() {
      return watcher
    },
    invalidateMetadataCache,
    notifyExternalChange: emitControl,
    async readFile(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      if (remote.fs?.readFile) {
        const content = await remote.fs.readFile(sandboxPath, 'utf8')
        if (typeof content === 'string') return content
        return Buffer.from(content).toString('utf-8')
      }
      const content = await remote.readFileToBuffer?.({ path: sandboxPath })
      if (!content) {
        const err = new Error(`ENOENT: file not found, open '${validatePath(VERCEL_SANDBOX_WORKSPACE_ROOT, relPath)}'`) as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return Buffer.from(content).toString('utf-8')
    },
    async readBinaryFile(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      if (remote.fs?.readFile) {
        const content = await remote.fs.readFile(sandboxPath)
        return new Uint8Array(Buffer.from(content))
      }
      const content = await remote.readFileToBuffer?.({ path: sandboxPath })
      if (!content) {
        const err = new Error(`ENOENT: file not found, open '${validatePath(VERCEL_SANDBOX_WORKSPACE_ROOT, relPath)}'`) as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
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
      if (remote.fs?.readFile) {
        if (cachedStat) {
          const content = await remote.fs.readFile(sandboxPath, 'utf8')
          return {
            content: typeof content === 'string' ? content : Buffer.from(content).toString('utf-8'),
            stat: cloneStat(cachedStat),
          }
        }

        const [content, fileStat] = await Promise.all([
          remote.fs.readFile(sandboxPath, 'utf8'),
          remote.fs.stat(sandboxPath),
        ])
        const stat: Stat = {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          kind: fileStat.isDirectory() ? 'dir' : 'file',
        }
        statCache.set(sandboxPath, stat)
        return {
          content: typeof content === 'string' ? content : Buffer.from(content).toString('utf-8'),
          stat: cloneStat(stat),
        }
      }

      const version = metadataVersion
      const result = await runJson<{ content: string; stat: Stat }>(
        remote,
        `node -e ${shellQuote(`const fs=require('fs'); const p=process.argv[1]; const s=fs.statSync(p); const content=fs.readFileSync(p,'utf8'); process.stdout.write(JSON.stringify({content,stat:{size:s.size,mtimeMs:s.mtimeMs,kind:s.isDirectory()?'dir':'file'}}))`)} ${shellQuote(sandboxPath)}`,
      )
      if (metadataVersion === version) {
        statCache.set(sandboxPath, result.stat)
      }
      return { content: result.content, stat: cloneStat(result.stat) }
    },
    async writeFileWithStat(relPath, data) {
      const sandboxPath = toSandboxPath(relPath)
      const payload = Buffer.from(data, 'utf-8')

      if (remote.fs || payload.byteLength > MAX_INLINE_WRITE_BYTES) {
        await sandbox.writeFiles([
          {
            path: sandboxPath,
            content: payload,
          },
        ])
        invalidateMetadataCache()
        workspaceOpts.onMutation?.()
        const writtenStat = await statSandboxPath(sandboxPath)
        statCache.set(sandboxPath, writtenStat)
        emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
        return cloneStat(writtenStat)
      }

      const encoded = payload.toString('base64')
      const writtenStat = await runJson<Stat>(
        remote,
        `node -e ${shellQuote(`const fs=require('fs'); const p=process.argv[1]; const data=Buffer.from(process.argv[2],'base64'); fs.writeFileSync(p,data); const s=fs.statSync(p); process.stdout.write(JSON.stringify({size:s.size,mtimeMs:s.mtimeMs,kind:s.isDirectory()?'dir':'file'}))`)} ${shellQuote(sandboxPath)} ${shellQuote(encoded)}`,
      )
      invalidateMetadataCache()
      statCache.set(sandboxPath, writtenStat)
      workspaceOpts.onMutation?.()
      emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
      return cloneStat(writtenStat)
    },
    async writeBinaryFileWithStat(relPath, data) {
      const sandboxPath = toSandboxPath(relPath)
      const payload = Buffer.from(data)

      if (remote.fs || payload.byteLength > MAX_INLINE_WRITE_BYTES) {
        await sandbox.writeFiles([
          {
            path: sandboxPath,
            content: payload,
          },
        ])
        invalidateMetadataCache()
        workspaceOpts.onMutation?.()
        const writtenStat = await statSandboxPath(sandboxPath)
        statCache.set(sandboxPath, writtenStat)
        emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
        return cloneStat(writtenStat)
      }

      const encoded = payload.toString('base64')
      const writtenStat = await runJson<Stat>(
        remote,
        `node -e ${shellQuote(`const fs=require('fs'); const p=process.argv[1]; const data=Buffer.from(process.argv[2],'base64'); fs.writeFileSync(p,data); const s=fs.statSync(p); process.stdout.write(JSON.stringify({size:s.size,mtimeMs:s.mtimeMs,kind:s.isDirectory()?'dir':'file'}))`)} ${shellQuote(sandboxPath)} ${shellQuote(encoded)}`,
      )
      invalidateMetadataCache()
      statCache.set(sandboxPath, writtenStat)
      workspaceOpts.onMutation?.()
      emitChange({ op: 'write', path: relPath, mtimeMs: writtenStat.mtimeMs })
      return cloneStat(writtenStat)
    },
    async unlink(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      if (sandboxPath === VERCEL_SANDBOX_REMOTE_ROOT) {
        throw Object.assign(new Error('cannot remove workspace root'), { code: EPERM_CODE })
      }
      await assertRealPathWithinSandboxRoot(sandboxPath)
      const descendantPaths = await isSandboxSymlink(sandboxPath)
        ? []
        : await listDescendantPaths(relPath, sandboxPath)
      if (remote.fs?.rm) await remote.fs.rm(sandboxPath, { recursive: true, force: false })
      else await runShell(remote, `rm -r -- ${shellQuote(sandboxPath)}`)
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'unlink', path: relPath })
      for (const path of descendantPaths) {
        emitChange({ op: 'unlink', path })
      }
    },
    async readdir(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const cached = readdirCache.get(sandboxPath)
      if (cached) return cloneEntries(cached)

      const version = metadataVersion
      const mappedEntries: Entry[] = remote.fs?.readdir
        ? (await remote.fs.readdir(sandboxPath, { withFileTypes: true })).map((entry): Entry => ({
            name: entry.name,
            kind: entry.isDirectory() ? 'dir' : 'file',
          }))
        : await runJson<Entry[]>(
            remote,
            `node -e ${shellQuote(`const fs=require('fs'); const p=process.argv[1]; const entries=fs.readdirSync(p,{withFileTypes:true}).map((e)=>({name:e.name,kind:e.isDirectory()?'dir':'file'})); process.stdout.write(JSON.stringify(entries))`)} ${shellQuote(sandboxPath)}`,
          )

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
      let mappedStat: Stat
      if (remote.fs?.stat) {
        const fileStat = await remote.fs.stat(sandboxPath)
        mappedStat = {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          kind: fileStat.isDirectory() ? 'dir' : 'file',
        }
      } else {
        mappedStat = await runJson<Stat>(
          remote,
          `node -e ${shellQuote(`const fs=require('fs'); const p=process.argv[1]; const s=fs.statSync(p); process.stdout.write(JSON.stringify({size:s.size,mtimeMs:s.mtimeMs,kind:s.isDirectory()?'dir':'file'}))`)} ${shellQuote(sandboxPath)}`,
        )
      }
      if (metadataVersion === version) {
        statCache.set(sandboxPath, mappedStat)
      }
      return cloneStat(mappedStat)
    },
    async mkdir(relPath, opts) {
      const sandboxPath = toSandboxPath(relPath)
      if (remote.fs?.mkdir) await remote.fs.mkdir(sandboxPath, { recursive: opts?.recursive ?? false })
      else if (opts?.recursive) await runShell(remote, `mkdir -p -- ${shellQuote(sandboxPath)}`)
      else if (remote.mkDir) await remote.mkDir(sandboxPath)
      else await runShell(remote, `mkdir -- ${shellQuote(sandboxPath)}`)
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'mkdir', path: relPath })
    },
    async rename(fromRelPath, toRelPath) {
      const fromSandboxPath = toSandboxPath(fromRelPath)
      const toSandboxAbsolutePath = toSandboxPath(toRelPath)
      if (remote.fs?.rename) await remote.fs.rename(fromSandboxPath, toSandboxAbsolutePath)
      else await runShell(remote, `mv -- ${shellQuote(fromSandboxPath)} ${shellQuote(toSandboxAbsolutePath)}`)
      invalidateMetadataCache()
      workspaceOpts.onMutation?.()
      emitChange({ op: 'rename', path: toRelPath, oldPath: fromRelPath })
    },
  }
  workspaceDisposers.set(workspace, () => {
    unregisterMetadataInvalidator()
    watcher.close()
  })
  return workspace
}

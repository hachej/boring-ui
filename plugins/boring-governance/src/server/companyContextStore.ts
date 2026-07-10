import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'

export const COMPANY_CONTEXT_CONFLICT_CODE = 'conflict'

export class CompanyContextConflictError extends Error {
  readonly statusCode = 409
  readonly code = COMPANY_CONTEXT_CONFLICT_CODE

  constructor(readonly details: { currentMtimeMs?: number; expectedMtimeMs: number }) {
    super(details.currentMtimeMs === undefined ? 'file no longer exists' : 'file has been modified since last read')
    this.name = 'CompanyContextConflictError'
  }
}

interface ResolvedTarget {
  root: string
  target: string
}

export const COMPANY_CONTEXT_STATE_DIR = '.boring-governance'

const mutationQueues = new Map<string, Promise<void>>()

function normalizeCompanyPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (normalized.includes('\0')) throw Object.assign(new Error('invalid company path'), { code: 'EPERM' })
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`
  const parts = withRoot.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..' || part === COMPANY_CONTEXT_STATE_DIR)) {
    throw Object.assign(new Error('company path traversal is not allowed'), { code: 'EPERM' })
  }
  return `/${parts.join('/')}`
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('path escapes company context root'), { code: 'EPERM' })
  }
}

async function inspectExistingPath(root: string, target: string, allowMissingLeaf: boolean): Promise<void> {
  assertContained(root, target)
  const relative = path.relative(root, target)
  let current = root
  const parts = relative.split(path.sep).filter(Boolean)
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]!)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink()) throw Object.assign(new Error('company context symlinks are not allowed'), { code: 'EPERM' })
      if (index < parts.length - 1 && !entry.isDirectory()) {
        throw Object.assign(new Error('company context parent is not a directory'), { code: 'ENOTDIR' })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissingLeaf && index === parts.length - 1) return
      throw error
    }
  }
}

async function acquireFilesystemLock(root: string): Promise<() => Promise<void>> {
  const stateRoot = path.join(root, COMPANY_CONTEXT_STATE_DIR)
  const lockPath = path.join(stateRoot, 'mutation.lock')
  await mkdir(stateRoot, { recursive: true, mode: 0o700 })
  const stateStat = await lstat(stateRoot)
  if (stateStat.isSymbolicLink() || !stateStat.isDirectory()) {
    throw Object.assign(new Error('unsafe company context state directory'), { code: 'EPERM' })
  }

  return await lockfile.lock(root, {
    lockfilePath: lockPath,
    realpath: false,
    stale: 30_000,
    update: 5_000,
    retries: { retries: 100, minTimeout: 25, maxTimeout: 100 },
  })
}

async function withMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve()
  let releaseProcessLock!: () => void
  const current = new Promise<void>((resolve) => { releaseProcessLock = resolve })
  const queued = previous.then(() => current)
  mutationQueues.set(key, queued)
  await previous
  let releaseFilesystemLock: (() => Promise<void>) | null = null
  try {
    releaseFilesystemLock = await acquireFilesystemLock(key)
    return await operation()
  } finally {
    await releaseFilesystemLock?.().catch(() => {})
    releaseProcessLock()
    if (mutationQueues.get(key) === queued) mutationQueues.delete(key)
  }
}

export class CompanyContextStore {
  private constructor(private readonly root: string) {}

  static async open(root: string): Promise<CompanyContextStore> {
    const canonicalRoot = await realpath(path.resolve(root))
    const rootStat = await stat(canonicalRoot)
    if (!rootStat.isDirectory()) throw new Error('company context root is not a directory')
    return new CompanyContextStore(canonicalRoot)
  }

  private resolve(companyPath: string): ResolvedTarget {
    const normalized = normalizeCompanyPath(companyPath)
    const target = path.resolve(this.root, `.${normalized}`)
    assertContained(this.root, target)
    return { root: this.root, target }
  }

  async read(companyPath: string): Promise<{ content: string; mtimeMs: number }> {
    const { target } = this.resolve(companyPath)
    await inspectExistingPath(this.root, target, false)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await stat(target)
      if (!before.isFile()) throw Object.assign(new Error('company context path is not a file'), { code: 'EISDIR' })
      const content = await readFile(target, 'utf8')
      const after = await stat(target)
      if (before.mtimeMs === after.mtimeMs && before.size === after.size) return { content, mtimeMs: after.mtimeMs }
    }
    throw Object.assign(new Error('company context changed while reading'), { statusCode: 409, code: COMPANY_CONTEXT_CONFLICT_CODE })
  }

  async list(companyPath: string): Promise<{ entries: string[] }> {
    const { target } = this.resolve(companyPath)
    await inspectExistingPath(this.root, target, false)
    const entries = await readdir(target, { withFileTypes: true })
    return {
      entries: entries
        .filter((entry) => !entry.isSymbolicLink() && entry.name !== COMPANY_CONTEXT_STATE_DIR)
        .map((entry) => entry.name),
    }
  }

  private async walk(companyPath: string): Promise<string[]> {
    const normalized = normalizeCompanyPath(companyPath)
    const pending = [normalized]
    const files: string[] = []
    while (pending.length > 0) {
      const current = pending.shift()!
      const listed = await this.list(current)
      for (const name of listed.entries) {
        const child = current === '/' ? `/${name}` : `${current}/${name}`
        const childStat = await this.stat(child)
        if (childStat.isDirectory) pending.push(child)
        else files.push(child)
      }
    }
    return files
  }

  async find(companyPath: string, pattern: string, options: { limit?: number; offset?: number } = {}): Promise<{ paths: string[] }> {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')
    const matcher = new RegExp(`^${escaped}$`)
    const paths = (await this.walk(companyPath)).filter((entry) => matcher.test(path.posix.basename(entry)) || matcher.test(entry))
    const offset = Math.max(0, options.offset ?? 0)
    return { paths: paths.slice(offset, options.limit === undefined ? undefined : offset + Math.max(0, options.limit)) }
  }

  async grep(companyPath: string, pattern: string, options: { limit?: number; offset?: number } = {}): Promise<{ matches: Array<{ path: string; line: number; text: string }> }> {
    const matcher = new RegExp(pattern)
    const matches: Array<{ path: string; line: number; text: string }> = []
    for (const file of await this.walk(companyPath)) {
      const { content } = await this.read(file)
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        matcher.lastIndex = 0
        if (matcher.test(line)) matches.push({ path: file, line: index + 1, text: line })
      }
    }
    const offset = Math.max(0, options.offset ?? 0)
    return { matches: matches.slice(offset, options.limit === undefined ? undefined : offset + Math.max(0, options.limit)) }
  }

  async stat(companyPath: string): Promise<{ isDirectory: boolean; mtimeMs: number }> {
    const { target } = this.resolve(companyPath)
    await inspectExistingPath(this.root, target, false)
    const entry = await stat(target)
    return { isDirectory: entry.isDirectory(), mtimeMs: entry.mtimeMs }
  }

  async write(companyPath: string, content: string, expectedMtimeMs?: number): Promise<{ mtimeMs: number }> {
    const { target } = this.resolve(companyPath)
    return withMutationLock(this.root, async () => {
      await inspectExistingPath(this.root, path.dirname(target), false)
      let currentMtimeMs: number | undefined
      try {
        await inspectExistingPath(this.root, target, false)
        currentMtimeMs = (await stat(target)).mtimeMs
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (expectedMtimeMs !== undefined && currentMtimeMs !== expectedMtimeMs) {
        throw new CompanyContextConflictError({ currentMtimeMs, expectedMtimeMs })
      }

      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
      let promoted = false
      try {
        const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try {
          await handle.writeFile(content, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, target)
        promoted = true
        return { mtimeMs: (await stat(target)).mtimeMs }
      } finally {
        if (!promoted) await rm(temporary, { force: true }).catch(() => {})
      }
    })
  }

  async delete(companyPath: string): Promise<void> {
    const { target } = this.resolve(companyPath)
    await withMutationLock(this.root, async () => {
      await inspectExistingPath(this.root, target, false)
      const entry = await lstat(target)
      if (!entry.isFile()) throw Object.assign(new Error('company context path is not a file'), { code: 'EPERM' })
      await rm(target)
    })
  }

  async mkdir(companyPath: string, recursive = false): Promise<void> {
    const { target } = this.resolve(companyPath)
    await withMutationLock(this.root, async () => {
      if (!recursive) {
        await inspectExistingPath(this.root, path.dirname(target), false)
        await mkdir(target)
        return
      }
      const relative = path.relative(this.root, target)
      let current = this.root
      for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment)
        try {
          const entry = await lstat(current)
          if (entry.isSymbolicLink() || !entry.isDirectory()) {
            throw Object.assign(new Error('unsafe company context directory'), { code: 'EPERM' })
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await mkdir(current)
        }
      }
    })
  }

  async move(fromPath: string, toPath: string): Promise<void> {
    const from = this.resolve(fromPath).target
    const to = this.resolve(toPath).target
    await withMutationLock(this.root, async () => {
      await inspectExistingPath(this.root, from, false)
      await inspectExistingPath(this.root, path.dirname(to), false)
      try {
        await inspectExistingPath(this.root, to, false)
        throw Object.assign(new Error('destination already exists'), { code: 'EEXIST' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rename(from, to)
    })
  }
}

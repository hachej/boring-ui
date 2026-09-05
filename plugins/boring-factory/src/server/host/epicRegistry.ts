import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const EPIC_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface FactoryEpicModels {
  readonly orchestrator?: string
  readonly worker?: string
  readonly reviewer?: string
}

export interface FactoryEpicEntry {
  readonly epicKey: string
  readonly featureName: string
  readonly worktree: string
  readonly branch: string
  readonly repositoryRoot: string
  readonly requestFile?: string
  readonly models?: FactoryEpicModels
  readonly orchestratorSessionId?: string
  readonly createdAt: string
  readonly status: 'active' | 'closed'
}

interface EpicRegistryFile {
  readonly epics: Record<string, FactoryEpicEntry>
}

interface LegacyProcessEntry {
  readonly epicKey?: string
  readonly featureName?: string
  readonly workspaceRoot?: string
  readonly branch?: string
  readonly worktreeGitRoot?: string
  readonly startedAt?: string
}

export interface FactoryEpicRegistry {
  load(): Promise<readonly FactoryEpicEntry[]>
  list(): Promise<readonly FactoryEpicEntry[]>
  get(epicKey: string): Promise<FactoryEpicEntry | undefined>
  register(entry: FactoryEpicEntry): Promise<FactoryEpicEntry>
  setOrchestratorSession(epicKey: string, sessionId: string): Promise<FactoryEpicEntry>
  markClosed(epicKey: string): Promise<FactoryEpicEntry>
}

export class FactoryEpicRegistryError extends Error {
  constructor(
    readonly code: 'INVALID_EPIC' | 'EPIC_EXISTS' | 'EPIC_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'FactoryEpicRegistryError'
  }
}

function cloneEntry(entry: FactoryEpicEntry): FactoryEpicEntry {
  return {
    ...entry,
    ...(entry.models ? { models: { ...entry.models } } : {}),
  }
}

function normalizePersistedEntry(raw: unknown): { entry: FactoryEpicEntry; migrated: boolean } {
  const candidate = raw as Partial<FactoryEpicEntry> & LegacyProcessEntry
  if (typeof candidate.worktree === 'string' && typeof candidate.repositoryRoot === 'string') {
    return { entry: candidate as FactoryEpicEntry, migrated: false }
  }
  if (typeof candidate.workspaceRoot === 'string' && typeof candidate.worktreeGitRoot === 'string') {
    return {
      entry: {
        epicKey: candidate.epicKey as string,
        featureName: candidate.featureName as string,
        worktree: candidate.workspaceRoot,
        branch: candidate.branch as string,
        repositoryRoot: candidate.worktreeGitRoot,
        createdAt: candidate.startedAt ?? new Date(0).toISOString(),
        status: 'active',
      },
      migrated: true,
    }
  }
  return { entry: candidate as FactoryEpicEntry, migrated: false }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FactoryEpicRegistryError('INVALID_EPIC', `${field} must be a non-empty string`)
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim()
}

function listedWorktrees(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
}

export async function validateFactoryEpicEntry(entry: FactoryEpicEntry): Promise<FactoryEpicEntry> {
  if (!EPIC_KEY_PATTERN.test(entry.epicKey)) {
    throw new FactoryEpicRegistryError('INVALID_EPIC', 'epicKey must be a lowercase slug (letters, numbers, and single hyphens)')
  }
  assertNonEmpty(entry.featureName, 'featureName')
  assertNonEmpty(entry.worktree, 'worktree')
  assertNonEmpty(entry.branch, 'branch')
  assertNonEmpty(entry.repositoryRoot, 'repositoryRoot')
  assertNonEmpty(entry.createdAt, 'createdAt')
  if (entry.status !== 'active' && entry.status !== 'closed') {
    throw new FactoryEpicRegistryError('INVALID_EPIC', 'status must be "active" or "closed"')
  }
  if (entry.requestFile !== undefined) assertNonEmpty(entry.requestFile, 'requestFile')
  if (entry.orchestratorSessionId !== undefined) assertNonEmpty(entry.orchestratorSessionId, 'orchestratorSessionId')
  if (entry.models !== undefined) {
    if (!entry.models || typeof entry.models !== 'object' || Array.isArray(entry.models)) {
      throw new FactoryEpicRegistryError('INVALID_EPIC', 'models must be an object when provided')
    }
    for (const [seat, model] of Object.entries(entry.models)) {
      if (!['orchestrator', 'worker', 'reviewer'].includes(seat) || typeof model !== 'string' || !model.trim()) {
        throw new FactoryEpicRegistryError('INVALID_EPIC', `models.${seat} must be a non-empty string`)
      }
    }
  }

  const repositoryRoot = resolve(entry.repositoryRoot)
  const worktree = resolve(entry.worktree)
  if (!(await directoryExists(repositoryRoot))) {
    throw new FactoryEpicRegistryError('INVALID_EPIC', `repositoryRoot does not exist: ${repositoryRoot}`)
  }
  if (!(await directoryExists(worktree))) {
    throw new FactoryEpicRegistryError('INVALID_EPIC', `worktree does not exist: ${worktree}`)
  }

  try {
    const [canonicalRepositoryRoot, canonicalWorktree, topLevel, branch, worktreeList] = await Promise.all([
      realpath(repositoryRoot),
      realpath(worktree),
      gitOutput(worktree, ['rev-parse', '--show-toplevel']).then(async (path) => await realpath(path)),
      gitOutput(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']),
      gitOutput(repositoryRoot, ['worktree', 'list', '--porcelain']),
    ])
    if (topLevel !== canonicalWorktree) {
      throw new Error(`git top-level is ${topLevel}`)
    }
    const registered = await Promise.all(listedWorktrees(worktreeList).map(async (path) => {
      try { return await realpath(path) } catch { return resolve(path) }
    }))
    if (!registered.includes(canonicalWorktree)) {
      throw new Error(`not listed by git -C ${canonicalRepositoryRoot} worktree list`)
    }
    if (branch !== entry.branch) {
      throw new Error(`branch is ${branch}, expected ${entry.branch}`)
    }
    const [repositoryCommonDir, worktreeCommonDir] = await Promise.all([
      gitOutput(canonicalRepositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).then(async (path) => await realpath(path)),
      gitOutput(canonicalWorktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']).then(async (path) => await realpath(path)),
    ])
    if (repositoryCommonDir !== worktreeCommonDir) {
      throw new Error('repository and worktree have different git common directories')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'git validation failed'
    throw new FactoryEpicRegistryError('INVALID_EPIC', `worktree is not branch ${entry.branch} of repositoryRoot: ${message}`)
  }

  return {
    ...cloneEntry(entry),
    worktree,
    repositoryRoot,
  }
}

async function writeAtomic(path: string, file: EpicRegistryFile): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(file, null, 2), 'utf8')
  await rename(temporaryPath, path)
}

export function createFactoryEpicRegistry(stateRoot: string): FactoryEpicRegistry {
  const root = resolve(stateRoot)
  const path = resolve(root, 'epics.json')
  let entries = new Map<string, FactoryEpicEntry>()
  let loaded = false
  let mutations = Promise.resolve()

  async function load(): Promise<readonly FactoryEpicEntry[]> {
    if (loaded) return [...entries.values()].map(cloneEntry)
    await mkdir(root, { recursive: true })
    let parsed: Partial<EpicRegistryFile> = {}
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<EpicRegistryFile>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new FactoryEpicRegistryError('INVALID_EPIC', `failed to load ${path}: ${(error as Error).message}`)
      }
    }
    if (parsed.epics !== undefined && (!parsed.epics || typeof parsed.epics !== 'object' || Array.isArray(parsed.epics))) {
      throw new FactoryEpicRegistryError('INVALID_EPIC', `${path} must contain an epics object`)
    }
    let migrated = false
    const validated = await Promise.all(Object.entries(parsed.epics ?? {}).map(async ([key, raw]) => {
      const normalized = normalizePersistedEntry(raw)
      migrated ||= normalized.migrated
      const entry = normalized.entry
      if (key !== entry.epicKey) throw new FactoryEpicRegistryError('INVALID_EPIC', `registry key ${key} does not match entry epicKey`)
      return await validateFactoryEpicEntry(entry)
    }))
    entries = new Map(validated.map((entry) => [entry.epicKey, entry]))
    loaded = true
    if (migrated) await persist()
    return [...entries.values()].map(cloneEntry)
  }

  async function persist(): Promise<void> {
    await mkdir(root, { recursive: true })
    await writeAtomic(path, { epics: Object.fromEntries(entries) })
  }

  async function mutate<T>(operation: () => Promise<T>): Promise<T> {
    let resolveResult!: (value: T | PromiseLike<T>) => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<T>((resolvePromise, rejectPromise) => {
      resolveResult = resolvePromise
      rejectResult = rejectPromise
    })
    mutations = mutations.then(async () => {
      try { resolveResult(await operation()) } catch (error) { rejectResult(error) }
    })
    await mutations
    return await result
  }

  return {
    load,
    async list() {
      await load()
      return [...entries.values()].map(cloneEntry).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    },
    async get(epicKey) {
      await load()
      const entry = entries.get(epicKey)
      return entry ? cloneEntry(entry) : undefined
    },
    async register(rawEntry) {
      const entry = await validateFactoryEpicEntry(rawEntry)
      return await mutate(async () => {
        await load()
        const existing = entries.get(entry.epicKey)
        if (existing) {
          throw new FactoryEpicRegistryError('EPIC_EXISTS', `epic ${entry.epicKey} is already registered (${existing.status})`)
        }
        const next = new Map(entries).set(entry.epicKey, entry)
        await writeAtomic(path, { epics: Object.fromEntries(next) })
        entries = next
        return cloneEntry(entry)
      })
    },
    async setOrchestratorSession(epicKey, sessionId) {
      assertNonEmpty(sessionId, 'orchestratorSessionId')
      return await mutate(async () => {
        await load()
        const entry = entries.get(epicKey)
        if (!entry) throw new FactoryEpicRegistryError('EPIC_NOT_FOUND', `epic ${epicKey} is not registered`)
        const next = { ...entry, orchestratorSessionId: sessionId }
        const nextEntries = new Map(entries).set(epicKey, next)
        await writeAtomic(path, { epics: Object.fromEntries(nextEntries) })
        entries = nextEntries
        return cloneEntry(next)
      })
    },
    async markClosed(epicKey) {
      return await mutate(async () => {
        await load()
        const entry = entries.get(epicKey)
        if (!entry) throw new FactoryEpicRegistryError('EPIC_NOT_FOUND', `epic ${epicKey} is not registered`)
        const next = { ...entry, status: 'closed' as const }
        const nextEntries = new Map(entries).set(epicKey, next)
        await writeAtomic(path, { epics: Object.fromEntries(nextEntries) })
        entries = nextEntries
        return cloneEntry(next)
      })
    },
  }
}

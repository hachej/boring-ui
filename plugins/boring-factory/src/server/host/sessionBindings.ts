import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ToolExecContext } from '@hachej/boring-agent/shared'
import type { FactoryEpicEntry, FactoryEpicRegistry } from './epicRegistry'

interface SessionBindingsFile {
  readonly bindings: Record<string, string>
}

export interface FactorySessionBindingReconciliation {
  readonly droppedSessionIds: readonly string[]
  readonly restoredOrchestratorSessionIds: readonly string[]
}

export interface FactorySessionBindings {
  load(): Promise<Readonly<Record<string, string>>>
  get(sessionId: string): Promise<string | undefined>
  bind(sessionId: string, epicKey: string): Promise<void>
  unbind(sessionId: string): Promise<void>
  inherit(parentSessionId: string, childSessionId: string): Promise<string>
  reconcile(entries: readonly FactoryEpicEntry[], dropSessionIds?: readonly string[]): Promise<FactorySessionBindingReconciliation>
}

export class FactoryEpicResolutionError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'EPIC_BINDING_REQUIRED' | 'EPIC_NOT_FOUND' | 'EPIC_CLOSED',
    message: string,
  ) {
    super(message)
    this.name = 'FactoryEpicResolutionError'
  }
}

export class FactorySessionBindingError extends Error {
  readonly code = 'SESSION_ALREADY_BOUND'

  constructor(readonly sessionId: string, readonly epicKey: string) {
    super(`session ${sessionId} is already bound to epic ${epicKey}`)
    this.name = 'FactorySessionBindingError'
  }
}

async function writeAtomic(path: string, state: SessionBindingsFile): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
  await rename(temporaryPath, path)
}

export function createFactorySessionBindings(stateRoot: string): FactorySessionBindings {
  const root = resolve(stateRoot)
  const path = resolve(root, 'session-bindings.json')
  let bindings: Record<string, string> = {}
  let loaded = false
  let mutations = Promise.resolve()

  async function load(): Promise<Readonly<Record<string, string>>> {
    if (loaded) return { ...bindings }
    await mkdir(root, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SessionBindingsFile>
      if (!parsed.bindings || typeof parsed.bindings !== 'object' || Array.isArray(parsed.bindings)) {
        throw new Error('expected a bindings object')
      }
      for (const [sessionId, epicKey] of Object.entries(parsed.bindings)) {
        if (!sessionId.trim() || typeof epicKey !== 'string' || !epicKey.trim()) throw new Error('bindings must map non-empty strings')
      }
      bindings = { ...parsed.bindings }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`failed to load ${path}: ${(error as Error).message}`)
      }
    }
    loaded = true
    return { ...bindings }
  }

  async function mutate(operation: () => Promise<void>): Promise<void> {
    const next = mutations.then(operation)
    mutations = next.catch(() => undefined)
    await next
  }

  return {
    load,
    async get(sessionId) {
      await load()
      return bindings[sessionId]
    },
    async bind(sessionId, epicKey) {
      if (!sessionId.trim() || !epicKey.trim()) throw new TypeError('sessionId and epicKey are required')
      await mutate(async () => {
        await load()
        const existing = bindings[sessionId]
        if (existing && existing !== epicKey) throw new FactorySessionBindingError(sessionId, existing)
        const next = { ...bindings, [sessionId]: epicKey }
        await writeAtomic(path, { bindings: next })
        bindings = next
      })
    },
    async unbind(sessionId) {
      await mutate(async () => {
        await load()
        if (!(sessionId in bindings)) return
        const next = { ...bindings }
        delete next[sessionId]
        await writeAtomic(path, { bindings: next })
        bindings = next
      })
    },
    async inherit(parentSessionId, childSessionId) {
      const epicKey = await this.get(parentSessionId)
      if (!epicKey) {
        throw new FactoryEpicResolutionError(
          'EPIC_BINDING_REQUIRED',
          `session ${parentSessionId} is not bound to an epic; pass the optional epicKey parameter explicitly`,
        )
      }
      await this.bind(childSessionId, epicKey)
      return epicKey
    },
    async reconcile(entries, dropSessionIds = []) {
      let report: FactorySessionBindingReconciliation = { droppedSessionIds: [], restoredOrchestratorSessionIds: [] }
      await mutate(async () => {
        await load()
        const active = new Map(entries.filter((entry) => entry.status === 'active').map((entry) => [entry.epicKey, entry]))
        const explicitlyDropped = new Set(dropSessionIds)
        const next: Record<string, string> = {}
        const droppedSessionIds: string[] = []
        for (const [sessionId, epicKey] of Object.entries(bindings)) {
          if (explicitlyDropped.has(sessionId) || !active.has(epicKey)) droppedSessionIds.push(sessionId)
          else next[sessionId] = epicKey
        }
        const restoredOrchestratorSessionIds: string[] = []
        for (const entry of active.values()) {
          const sessionId = entry.orchestratorSessionId
          if (!sessionId) continue
          if (next[sessionId] !== entry.epicKey) restoredOrchestratorSessionIds.push(sessionId)
          next[sessionId] = entry.epicKey
        }
        if (JSON.stringify(next) !== JSON.stringify(bindings)) await writeAtomic(path, { bindings: next })
        bindings = next
        report = { droppedSessionIds, restoredOrchestratorSessionIds }
      })
      return report
    },
  }
}

export async function resolveFactoryEpic(
  params: Record<string, unknown>,
  ctx: ToolExecContext,
  registry: FactoryEpicRegistry,
  bindings: FactorySessionBindings,
): Promise<FactoryEpicEntry> {
  const override = params.epicKey
  if (override !== undefined && (typeof override !== 'string' || !override.trim())) {
    throw new FactoryEpicResolutionError('INVALID_INPUT', 'epicKey must be a non-empty string when provided')
  }
  const epicKey = typeof override === 'string'
    ? override
    : ctx.sessionId ? await bindings.get(ctx.sessionId) : undefined
  if (!epicKey) {
    throw new FactoryEpicResolutionError(
      'EPIC_BINDING_REQUIRED',
      'this session is not bound to a Factory epic; pass the optional epicKey parameter explicitly',
    )
  }
  const entry = await registry.get(epicKey)
  if (!entry) throw new FactoryEpicResolutionError('EPIC_NOT_FOUND', `epic ${epicKey} is not registered`)
  if (entry.status !== 'active') throw new FactoryEpicResolutionError('EPIC_CLOSED', `epic ${epicKey} is closed`)
  return entry
}

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type FactoryDispatchOutcome =
  | 'created'
  | 'running'
  | 'completed'
  | 'timeout'
  | 'prompt-failed'
  | 'bind-failed'
  | 'aborted'
  | 'failed'

export type FactoryReviewOutcome = FactoryDispatchOutcome

export interface FactoryDispatchRecord {
  readonly id: string
  readonly epicKey: string
  readonly beadId: string
  readonly childSessionId: string
  readonly timestamp: string
  readonly updatedAt: string
  readonly outcome: FactoryDispatchOutcome
}

export interface FactoryReviewRecord {
  readonly id: string
  readonly epicKey: string
  readonly targetKey: string
  readonly beadId?: string
  readonly sha?: string
  readonly parentSessionId?: string
  readonly childSessionId: string
  readonly round: number
  readonly timestamp: string
  readonly updatedAt: string
  readonly outcome: FactoryReviewOutcome
}

export interface FactoryDispatchState {
  readonly version: 1
  readonly dispatches: readonly FactoryDispatchRecord[]
  readonly reviews: readonly FactoryReviewRecord[]
}

export interface FactoryDispatchLedger {
  read(): Promise<FactoryDispatchState>
  appendDispatch(record: Omit<FactoryDispatchRecord, 'id' | 'updatedAt'>): Promise<FactoryDispatchRecord>
  updateDispatch(id: string, outcome: FactoryDispatchOutcome): Promise<FactoryDispatchRecord>
  appendReview(record: Omit<FactoryReviewRecord, 'id' | 'updatedAt' | 'round'>): Promise<FactoryReviewRecord>
  updateReview(id: string, outcome: FactoryReviewOutcome): Promise<FactoryReviewRecord>
  reviewTargetFor(epicKey: string, parentSessionId: string | undefined, requestedTarget: string): Promise<string>
}

const EMPTY_STATE: FactoryDispatchState = { version: 1, dispatches: [], reviews: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseState(raw: string, path: string): FactoryDispatchState {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.dispatches) || !Array.isArray(parsed.reviews)) {
    throw new Error(`${path} must contain a version 1 Factory dispatch ledger`)
  }
  return {
    version: 1,
    dispatches: parsed.dispatches as FactoryDispatchRecord[],
    reviews: parsed.reviews as FactoryReviewRecord[],
  }
}

async function writeAtomic(path: string, state: FactoryDispatchState): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
  await rename(temporaryPath, path)
}

export function createFactoryDispatchLedger(stateRoot: string): FactoryDispatchLedger {
  const root = resolve(stateRoot)
  const path = resolve(root, 'dispatches.json')
  let mutations = Promise.resolve()

  async function readFileState(): Promise<FactoryDispatchState> {
    try {
      return parseState(await readFile(path, 'utf8'), path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_STATE
      throw error
    }
  }

  async function mutate<T>(operation: (state: FactoryDispatchState) => { state: FactoryDispatchState; result: T }): Promise<T> {
    let result!: T
    const next = mutations.then(async () => {
      await mkdir(root, { recursive: true })
      const changed = operation(await readFileState())
      await writeAtomic(path, changed.state)
      result = changed.result
    })
    mutations = next.catch(() => undefined)
    await next
    return result
  }

  return {
    async read() {
      await mutations
      return await readFileState()
    },
    async appendDispatch(record) {
      return await mutate((state) => {
        const stored: FactoryDispatchRecord = { ...record, id: randomUUID(), updatedAt: record.timestamp }
        return { state: { ...state, dispatches: [...state.dispatches, stored] }, result: stored }
      })
    },
    async updateDispatch(id, outcome) {
      return await mutate((state) => {
        let updated: FactoryDispatchRecord | undefined
        const dispatches = state.dispatches.map((record) => {
          if (record.id !== id) return record
          updated = { ...record, outcome, updatedAt: new Date().toISOString() }
          return updated
        })
        if (!updated) throw new Error(`dispatch record ${id} was not found`)
        return { state: { ...state, dispatches }, result: updated }
      })
    },
    async appendReview(record) {
      return await mutate((state) => {
        const round = state.reviews.filter((candidate) => (
          candidate.epicKey === record.epicKey && candidate.targetKey === record.targetKey
        )).length + 1
        const stored: FactoryReviewRecord = { ...record, id: randomUUID(), round, updatedAt: record.timestamp }
        return { state: { ...state, reviews: [...state.reviews, stored] }, result: stored }
      })
    },
    async updateReview(id, outcome) {
      return await mutate((state) => {
        let updated: FactoryReviewRecord | undefined
        const reviews = state.reviews.map((record) => {
          if (record.id !== id) return record
          updated = { ...record, outcome, updatedAt: new Date().toISOString() }
          return updated
        })
        if (!updated) throw new Error(`review record ${id} was not found`)
        return { state: { ...state, reviews }, result: updated }
      })
    },
    async reviewTargetFor(epicKey, parentSessionId, requestedTarget) {
      await mutations
      const state = await readFileState()
      const prior = state.reviews.find((record) => (
        record.epicKey === epicKey
        && record.parentSessionId === parentSessionId
        && record.beadId === undefined
      ))
      return prior?.targetKey ?? requestedTarget
    },
  }
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

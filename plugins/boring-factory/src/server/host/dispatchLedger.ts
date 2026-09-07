import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type FactoryDispatchOutcome =
  | 'reserved'
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
  readonly childSessionId?: string
  readonly timestamp: string
  readonly updatedAt: string
  readonly outcome: FactoryDispatchOutcome
}

export type FactoryDispatchCap = 'worker-concurrency' | 'bead-dispatch'

export interface FactoryCapRefusalMarker {
  readonly id: string
  readonly epicKey: string
  readonly beadId: string
  readonly cap: FactoryDispatchCap
  readonly timestamp: string
}

export interface FactoryReviewRecord {
  readonly id: string
  readonly epicKey: string
  readonly targetKey: string
  readonly beadId?: string
  readonly sha?: string
  readonly parentSessionId?: string
  /** Absent while admission is durably reserved before child-session creation. */
  readonly childSessionId?: string
  readonly round: number
  readonly timestamp: string
  readonly updatedAt: string
  readonly outcome: FactoryReviewOutcome
}

export type FactoryReviewReservation =
  | { readonly accepted: true; readonly record: FactoryReviewRecord }
  | { readonly accepted: false; readonly targetKey: string; readonly current: number; readonly maximum: number }

export interface FactoryDispatchState {
  readonly version: 1
  readonly dispatches: readonly FactoryDispatchRecord[]
  readonly reviews: readonly FactoryReviewRecord[]
  readonly refusals: readonly FactoryCapRefusalMarker[]
}

export interface FactoryDispatchLedger {
  read(): Promise<FactoryDispatchState>
  reserveDispatch(record: Pick<FactoryDispatchRecord, 'epicKey' | 'beadId' | 'timestamp'>): Promise<FactoryDispatchRecord>
  attachDispatch(id: string, childSessionId: string, outcome: FactoryDispatchOutcome): Promise<FactoryDispatchRecord>
  updateDispatch(id: string, outcome: FactoryDispatchOutcome): Promise<FactoryDispatchRecord>
  reserveReview(
    record: Omit<FactoryReviewRecord, 'id' | 'updatedAt' | 'round' | 'childSessionId' | 'outcome'>,
    maximum: number,
  ): Promise<FactoryReviewReservation>
  attachReview(id: string, childSessionId: string, outcome: FactoryReviewOutcome): Promise<FactoryReviewRecord>
  updateReview(id: string, outcome: FactoryReviewOutcome): Promise<FactoryReviewRecord>
  markRefusal(input: Omit<FactoryCapRefusalMarker, 'id'>): Promise<{ readonly marker: FactoryCapRefusalMarker; readonly created: boolean }>
}

const EMPTY_STATE: FactoryDispatchState = { version: 1, dispatches: [], reviews: [], refusals: [] }

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
    refusals: Array.isArray(parsed.refusals) ? parsed.refusals as FactoryCapRefusalMarker[] : [],
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
    async reserveDispatch(record) {
      return await mutate((state) => {
        const stored: FactoryDispatchRecord = {
          ...record,
          id: randomUUID(),
          updatedAt: record.timestamp,
          outcome: 'reserved',
        }
        return { state: { ...state, dispatches: [...state.dispatches, stored] }, result: stored }
      })
    },
    async attachDispatch(id, childSessionId, outcome) {
      return await mutate((state) => {
        let updated: FactoryDispatchRecord | undefined
        const dispatches = state.dispatches.map((record) => {
          if (record.id !== id) return record
          updated = { ...record, childSessionId, outcome, updatedAt: new Date().toISOString() }
          return updated
        })
        if (!updated) throw new Error(`dispatch record ${id} was not found`)
        return { state: { ...state, dispatches }, result: updated }
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
    async reserveReview(record, maximum) {
      return await mutate<FactoryReviewReservation>((state) => {
        const priorTarget = record.beadId === undefined
          ? state.reviews.find((candidate) => (
              candidate.epicKey === record.epicKey
              && candidate.parentSessionId === record.parentSessionId
              && candidate.beadId === undefined
            ))?.targetKey
          : undefined
        const targetKey = priorTarget ?? record.targetKey
        const current = state.reviews.filter((candidate) => (
          candidate.epicKey === record.epicKey && candidate.targetKey === targetKey
        )).length
        if (current >= maximum) {
          return { state, result: { accepted: false, targetKey, current, maximum } }
        }
        const stored: FactoryReviewRecord = {
          ...record,
          targetKey,
          id: randomUUID(),
          round: current + 1,
          updatedAt: record.timestamp,
          outcome: 'reserved',
        }
        return { state: { ...state, reviews: [...state.reviews, stored] }, result: { accepted: true, record: stored } }
      })
    },
    async attachReview(id, childSessionId, outcome) {
      return await mutate((state) => {
        let updated: FactoryReviewRecord | undefined
        const reviews = state.reviews.map((record) => {
          if (record.id !== id) return record
          updated = { ...record, childSessionId, outcome, updatedAt: new Date().toISOString() }
          return updated
        })
        if (!updated) throw new Error(`review record ${id} was not found`)
        return { state: { ...state, reviews }, result: updated }
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
    async markRefusal(input) {
      return await mutate<{ readonly marker: FactoryCapRefusalMarker; readonly created: boolean }>((state) => {
        const existing = state.refusals.find((marker) => (
          marker.epicKey === input.epicKey
          && marker.beadId === input.beadId
          && marker.cap === input.cap
        ))
        if (existing) return { state, result: { marker: existing, created: false } }
        const marker: FactoryCapRefusalMarker = { ...input, id: randomUUID() }
        return {
          state: { ...state, refusals: [...state.refusals, marker] },
          result: { marker, created: true },
        }
      })
    },
  }
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

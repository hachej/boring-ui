export interface SessionCreationRow {
  id: string
  agentTypeId?: string
}

export interface CoordinateSessionCreateOptions<TRow extends SessionCreationRow> {
  dedupeKey: string
  create: () => unknown
  onResolved?: (session: unknown) => void
  onError?: (error: unknown) => void
  onSettled?: () => void
}

export interface SessionCreationTask<TRow extends SessionCreationRow> extends CoordinateSessionCreateOptions<TRow> {
  knownKeys: Set<string>
  awaitingRow: boolean
  rowWaitTimeout?: ReturnType<typeof globalThis.setTimeout>
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export type SessionCreationOutcome = { value?: unknown; error?: unknown }

export class SessionCreationCoordinator<TRow extends SessionCreationRow> {
  sourceKey: string
  active: SessionCreationTask<TRow> | null = null
  queue: SessionCreationTask<TRow>[] = []

  constructor(sourceKey: string) {
    this.sourceKey = sourceKey
  }

  reset(sourceKey: string): void {
    this.cancel(() => true)
    this.sourceKey = sourceKey
  }

  coordinate(options: CoordinateSessionCreateOptions<TRow>): Promise<unknown> {
    const duplicate = this.active?.dedupeKey === options.dedupeKey
      ? this.active
      : this.queue.find((task) => task.dedupeKey === options.dedupeKey)
    if (duplicate) return duplicate.promise

    let resolve!: (value: unknown) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<unknown>((nextResolve, nextReject) => {
      resolve = nextResolve
      reject = nextReject
    })
    this.queue.push({
      ...options,
      knownKeys: new Set(),
      awaitingRow: false,
      promise,
      resolve,
      reject,
    })
    return promise
  }

  takeNext(knownKeys: Set<string>): SessionCreationTask<TRow> | null {
    if (this.active) return null
    const task = this.queue.shift() ?? null
    if (!task) return null
    task.knownKeys = knownKeys
    this.active = task
    return task
  }

  finish(task: SessionCreationTask<TRow>, outcome: SessionCreationOutcome): boolean {
    if (this.active !== task) return false
    if (task.rowWaitTimeout !== undefined) globalThis.clearTimeout(task.rowWaitTimeout)
    this.active = null
    task.onSettled?.()
    if ("error" in outcome) task.reject(outcome.error)
    else task.resolve(outcome.value)
    return true
  }

  cancel(matches: (task: SessionCreationTask<TRow>) => boolean): void {
    if (this.active && matches(this.active)) {
      const task = this.active
      if (task.rowWaitTimeout !== undefined) globalThis.clearTimeout(task.rowWaitTimeout)
      this.active = null
      task.onSettled?.()
      task.resolve(undefined)
    }
    this.queue = this.queue.filter((task) => {
      if (!matches(task)) return true
      task.onSettled?.()
      task.resolve(undefined)
      return false
    })
  }
}

/**
 * A void create can only be attributed when the provider exposes one canonical
 * new row. Prefer its newly active addressed row; otherwise accept exactly one
 * unseen row and wait/fail on ambiguous batches rather than choosing by order.
 */
export function selectCreatedSessionCandidate<TRow extends SessionCreationRow>({
  rows,
  knownKeys,
  activeKey,
  keyFor,
}: {
  rows: readonly TRow[]
  knownKeys: ReadonlySet<string>
  activeKey: string | null
  keyFor: (row: TRow) => string
}): TRow | undefined {
  const unseen = rows.filter((row) => !knownKeys.has(keyFor(row)))
  if (activeKey) {
    const active = unseen.find((row) => keyFor(row) === activeKey)
    if (active) return active
  }
  return unseen.length === 1 ? unseen[0] : undefined
}

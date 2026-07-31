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
  sourceKey: string
  knownKeys: Set<string>
  candidateKeys: Set<string>
  ambiguousCandidateHistory: boolean
  awaitingRow: boolean
  invocationPending: boolean
  finished: boolean
  rowWaitTimeout?: ReturnType<typeof globalThis.setTimeout>
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export type SessionCreationOutcome = { value?: unknown; error?: unknown }

/**
 * Deterministic state for one source's serialized creates. Invocation and React
 * lifecycle work live in useSessionCreationCoordinator; this model only owns
 * queue identity, orphan barriers, and row attribution history.
 */
export class SessionCreationCoordinator<TRow extends SessionCreationRow> {
  sourceKey: string
  active: SessionCreationTask<TRow> | null = null
  queue: SessionCreationTask<TRow>[] = []
  private readonly orphanInvocations = new Set<SessionCreationTask<TRow>>()
  private readonly overlapKeys = new Set<string>()
  private readonly quarantinedKeys = new Set<string>()

  constructor(sourceKey: string) {
    this.sourceKey = sourceKey
  }

  get hasOrphanBarrier(): boolean {
    return this.orphanInvocations.size > 0
  }

  reset(sourceKey: string, observedKeys: Iterable<string> = []): void {
    this.cancel(() => true, observedKeys)
    this.sourceKey = sourceKey
    this.orphanInvocations.clear()
    this.overlapKeys.clear()
    this.quarantinedKeys.clear()
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
      sourceKey: this.sourceKey,
      knownKeys: new Set(),
      candidateKeys: new Set(),
      ambiguousCandidateHistory: false,
      awaitingRow: false,
      invocationPending: false,
      finished: false,
      promise,
      resolve,
      reject,
    })
    return promise
  }

  takeNext(knownKeys: Iterable<string>): SessionCreationTask<TRow> | null {
    if (this.active) return null
    const task = this.queue.shift() ?? null
    if (!task) return null
    task.knownKeys = new Set([...knownKeys, ...this.quarantinedKeys])
    this.active = task
    return task
  }

  beginInvocation(task: SessionCreationTask<TRow>): boolean {
    if (this.active !== task || task.finished || task.sourceKey !== this.sourceKey) return false
    task.invocationPending = true
    return true
  }

  settleInvocation(task: SessionCreationTask<TRow>, observedKeys: Iterable<string>): void {
    this.observeRows(observedKeys)
    task.invocationPending = false
    if (!this.orphanInvocations.delete(task) || this.orphanInvocations.size > 0) return
    for (const key of this.overlapKeys) this.quarantinedKeys.add(key)
    this.overlapKeys.clear()
  }

  markAwaitingRow(task: SessionCreationTask<TRow>): boolean {
    if (this.active !== task || task.finished || task.sourceKey !== this.sourceKey) return false
    task.awaitingRow = true
    return true
  }

  observeRows(keys: Iterable<string>): void {
    if (!this.hasOrphanBarrier) return
    for (const key of keys) this.overlapKeys.add(key)
  }

  selectCandidate({
    task,
    rows,
    activeKey,
    keyFor,
  }: {
    task: SessionCreationTask<TRow>
    rows: readonly TRow[]
    activeKey: string | null
    keyFor: (row: TRow) => string
  }): TRow | undefined {
    const rowKeys = rows.map(keyFor)
    this.observeRows(rowKeys)
    if (
      this.active !== task
      || !task.awaitingRow
      || task.sourceKey !== this.sourceKey
      || this.hasOrphanBarrier
    ) return undefined

    const candidates = rows.filter((row) => {
      const key = keyFor(row)
      return !task.knownKeys.has(key) && !this.quarantinedKeys.has(key)
    })
    const active = activeKey
      ? candidates.find((row) => keyFor(row) === activeKey)
      : undefined
    if (candidates.length > 1 && !active) task.ambiguousCandidateHistory = true
    for (const row of candidates) task.candidateKeys.add(keyFor(row))

    if (active && !task.ambiguousCandidateHistory) return active
    if (task.candidateKeys.size !== 1) return undefined
    const onlyKey = task.candidateKeys.values().next().value as string | undefined
    return candidates.find((row) => keyFor(row) === onlyKey)
  }

  finish(task: SessionCreationTask<TRow>, outcome: SessionCreationOutcome): boolean {
    if (this.active !== task || task.finished) return false
    this.active = null
    this.settleTask(task, outcome)
    return true
  }

  cancel(
    matches: (task: SessionCreationTask<TRow>) => boolean,
    observedKeys: Iterable<string> = [],
  ): void {
    const keys = Array.from(observedKeys)
    if (this.active && matches(this.active)) {
      const task = this.active
      this.active = null
      if (task.invocationPending) {
        this.orphanInvocations.add(task)
        for (const key of keys) this.overlapKeys.add(key)
      }
      this.settleTask(task, { value: undefined })
    }
    this.queue = this.queue.filter((task) => {
      if (!matches(task)) return true
      this.settleTask(task, { value: undefined })
      return false
    })
  }

  private settleTask(task: SessionCreationTask<TRow>, outcome: SessionCreationOutcome): void {
    if (task.finished) return
    task.finished = true
    if (task.rowWaitTimeout !== undefined) globalThis.clearTimeout(task.rowWaitTimeout)
    task.onSettled?.()
    if ("error" in outcome) task.reject(outcome.error)
    else task.resolve(outcome.value)
  }
}

/**
 * Stateless compatibility helper for callers that already own candidate
 * history. The coordinator model uses the same active-row preference while
 * retaining history across observations.
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

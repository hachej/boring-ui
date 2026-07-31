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

export type SessionCreationTaskPhase = "queued" | "ready" | "transport" | "invoked" | "awaiting-row" | "finished"

export interface SessionCreationTask<TRow extends SessionCreationRow> extends CoordinateSessionCreateOptions<TRow> {
  sourceKey: string
  knownKeys: Set<string>
  candidateKeys: Set<string>
  ambiguousCandidateHistory: boolean
  phase: SessionCreationTaskPhase
  rowWaitTimeout?: ReturnType<typeof globalThis.setTimeout>
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export type SessionCreationOutcome = { value?: unknown; error?: unknown }

export interface OrphanBarrierOptions {
  timeoutMs: number
  onRelease?: () => void
}

interface OrphanInvocation<TRow extends SessionCreationRow> {
  task: SessionCreationTask<TRow>
  transportPending: boolean
  barrierTimeout: ReturnType<typeof globalThis.setTimeout> | undefined
  options: OrphanBarrierOptions
}

/**
 * Deterministic state for one source's serialized creates. Invocation and React
 * lifecycle work live in useSessionCreationCoordinator; this model only owns
 * queue identity, orphan barriers, and row attribution history.
 */
export class SessionCreationCoordinator<TRow extends SessionCreationRow> {
  sourceKey: string
  active: SessionCreationTask<TRow> | null = null
  queue: SessionCreationTask<TRow>[] = []
  private readonly orphanInvocations = new Map<SessionCreationTask<TRow>, OrphanInvocation<TRow>>()
  private readonly overlapKeys = new Set<string>()
  private readonly quarantinedKeys = new Set<string>()

  constructor(sourceKey: string) {
    this.sourceKey = sourceKey
  }

  get hasOrphanAttributionBarrier(): boolean {
    return this.orphanInvocations.size > 0
  }

  get canEvict(): boolean {
    return this.active === null && this.queue.length === 0 && this.orphanInvocations.size === 0
  }

  reset(sourceKey: string): void {
    this.cancel(() => true)
    this.clearOrphanBarriers()
    this.sourceKey = sourceKey
    this.quarantinedKeys.clear()
  }

  dispose(): void {
    this.cancel(() => true)
    this.clearOrphanBarriers()
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
      phase: "queued",
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
    this.quarantinedKeys.clear()
    task.phase = "ready"
    this.active = task
    return task
  }

  beginInvocation(task: SessionCreationTask<TRow>, observedKeys: Iterable<string>): boolean {
    if (this.active !== task || task.phase !== "ready" || task.sourceKey !== this.sourceKey) return false
    for (const key of observedKeys) task.knownKeys.add(key)
    task.phase = "transport"
    return true
  }

  settleInvocation(task: SessionCreationTask<TRow>, observedKeys: Iterable<string>): void {
    if (task.sourceKey !== this.sourceKey) return
    this.observeRows(observedKeys)
    const orphan = this.orphanInvocations.get(task)
    if (orphan?.transportPending) {
      orphan.transportPending = false
      this.armPublicationHorizon(orphan)
    }
    if (this.active === task && task.phase === "transport") task.phase = "invoked"
  }

  markAwaitingRow(task: SessionCreationTask<TRow>): boolean {
    if (this.active !== task || task.phase !== "invoked" || task.sourceKey !== this.sourceKey) return false
    task.phase = "awaiting-row"
    return true
  }

  observeRows(keys: Iterable<string>): void {
    if (!this.hasOrphanAttributionBarrier) return
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
      || task.sourceKey !== this.sourceKey
      || (task.phase !== "transport" && task.phase !== "invoked" && task.phase !== "awaiting-row")
      || this.hasOrphanAttributionBarrier
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

    // Observation starts at provider invocation, but attribution cannot happen
    // until a settled void result explicitly enters its row-publication wait.
    if (task.phase !== "awaiting-row") return undefined
    if (active && !task.ambiguousCandidateHistory) return active
    if (task.candidateKeys.size !== 1) return undefined
    const onlyKey = task.candidateKeys.values().next().value as string | undefined
    return candidates.find((row) => keyFor(row) === onlyKey)
  }

  finish(task: SessionCreationTask<TRow>, outcome: SessionCreationOutcome): boolean {
    if (this.active !== task || task.phase === "finished") return false
    this.active = null
    this.settleTask(task, outcome)
    return true
  }

  abandon(task: SessionCreationTask<TRow>, observedKeys: Iterable<string>, barrier: OrphanBarrierOptions): void {
    if (
      task.sourceKey !== this.sourceKey
      || (task.phase !== "transport" && task.phase !== "invoked" && task.phase !== "awaiting-row")
      || this.orphanInvocations.has(task)
    ) return
    for (const key of observedKeys) this.overlapKeys.add(key)
    const orphan: OrphanInvocation<TRow> = {
      task,
      transportPending: task.phase === "transport",
      barrierTimeout: undefined,
      options: barrier,
    }
    this.orphanInvocations.set(task, orphan)
    // An unresolved transport has no safe time bound: its row may publish after
    // any local deadline. Start the bounded publication horizon only once the
    // transport settles.
    if (!orphan.transportPending) this.armPublicationHorizon(orphan)
  }

  cancel(
    matches: (task: SessionCreationTask<TRow>) => boolean,
    observedKeys: Iterable<string> = [],
    barrier?: OrphanBarrierOptions,
  ): void {
    const keys = Array.from(observedKeys)
    if (this.active && matches(this.active)) {
      const task = this.active
      this.active = null
      if (barrier) this.abandon(task, keys, barrier)
      this.settleTask(task, { value: undefined })
    }
    this.queue = this.queue.filter((task) => {
      if (!matches(task)) return true
      this.settleTask(task, { value: undefined })
      return false
    })
  }

  private armPublicationHorizon(orphan: OrphanInvocation<TRow>): void {
    this.clearOrphanTimeout(orphan)
    orphan.barrierTimeout = globalThis.setTimeout(() => {
      orphan.barrierTimeout = undefined
      this.orphanInvocations.delete(orphan.task)
      for (const key of this.overlapKeys) this.quarantinedKeys.add(key)
      this.overlapKeys.clear()
      orphan.options.onRelease?.()
    }, Math.max(0, orphan.options.timeoutMs))
  }

  private clearOrphanTimeout(orphan: OrphanInvocation<TRow>): void {
    if (orphan.barrierTimeout !== undefined) globalThis.clearTimeout(orphan.barrierTimeout)
    orphan.barrierTimeout = undefined
  }

  private clearOrphanBarriers(): void {
    for (const orphan of this.orphanInvocations.values()) this.clearOrphanTimeout(orphan)
    this.orphanInvocations.clear()
    this.overlapKeys.clear()
  }

  private settleTask(task: SessionCreationTask<TRow>, outcome: SessionCreationOutcome): void {
    if (task.phase === "finished") return
    task.phase = "finished"
    if (task.rowWaitTimeout !== undefined) globalThis.clearTimeout(task.rowWaitTimeout)
    task.rowWaitTimeout = undefined
    try {
      task.onSettled?.()
    } catch (error) {
      task.reject(error)
      return
    }
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

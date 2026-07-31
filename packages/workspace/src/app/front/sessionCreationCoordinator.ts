export interface SessionCreationResult {
  id: string
  agentTypeId?: string
}

export interface CoordinateSessionCreateOptions<TSession extends SessionCreationResult> {
  dedupeKey: string
  create: () => TSession | Promise<TSession>
  onResolved?: (session: TSession) => void
  onError?: (error: unknown) => void
  onSettled?: () => void
}

export interface SessionCreationTask<TSession extends SessionCreationResult>
  extends CoordinateSessionCreateOptions<TSession> {
  sourceKey: string
  phase: "queued" | "active" | "finished"
  promise: Promise<TSession | undefined>
  resolve: (value: TSession | undefined) => void
  reject: (error: unknown) => void
}

export type SessionCreationOutcome<TSession extends SessionCreationResult> =
  | { value: TSession | undefined }
  | { error: unknown }

/** Source-owned queue for session creates. React lifecycle and invocation live in the hook. */
export class SessionCreationCoordinator<TSession extends SessionCreationResult> {
  sourceKey: string
  active: SessionCreationTask<TSession> | null = null
  queue: SessionCreationTask<TSession>[] = []
  private resetting = false

  constructor(sourceKey: string) {
    this.sourceKey = sourceKey
  }

  reset(sourceKey: string): void {
    if (this.resetting) return
    this.resetting = true
    try {
      this.cancel(() => true)
      this.sourceKey = sourceKey
    } finally {
      this.resetting = false
    }
  }

  coordinate(options: CoordinateSessionCreateOptions<TSession>): Promise<TSession | undefined> {
    if (this.resetting) {
      return Promise.reject(Object.assign(
        new Error("Session creation coordinator is resetting"),
        { code: "SESSION_CREATE_COORDINATOR_UNAVAILABLE" as const },
      ))
    }
    const duplicate = this.active?.dedupeKey === options.dedupeKey
      ? this.active
      : this.queue.find((task) => task.dedupeKey === options.dedupeKey)
    if (duplicate) return duplicate.promise

    let resolve!: (value: TSession | undefined) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<TSession | undefined>((nextResolve, nextReject) => {
      resolve = nextResolve
      reject = nextReject
    })
    this.queue.push({
      ...options,
      sourceKey: this.sourceKey,
      phase: "queued",
      promise,
      resolve,
      reject,
    })
    return promise
  }

  takeNext(): SessionCreationTask<TSession> | null {
    if (this.active) return null
    const task = this.queue.shift() ?? null
    if (!task) return null
    task.phase = "active"
    this.active = task
    return task
  }

  finish(task: SessionCreationTask<TSession>, outcome: SessionCreationOutcome<TSession>): boolean {
    if (this.active !== task || task.phase === "finished") return false
    this.active = null
    this.settleTask(task, outcome)
    return true
  }

  cancel(matches: (task: SessionCreationTask<TSession>) => boolean): void {
    const active = this.active
    const cancelActive = active !== null && matches(active)
    const canceled = this.queue.filter(matches)
    // Detach tasks before callbacks can re-enter coordinate().
    this.queue = this.queue.filter((task) => !matches(task))
    if (active && cancelActive) {
      this.active = null
      this.settleTask(active, { value: undefined })
    }
    for (const task of canceled) this.settleTask(task, { value: undefined })
  }

  private settleTask(task: SessionCreationTask<TSession>, outcome: SessionCreationOutcome<TSession>): void {
    if (task.phase === "finished") return
    task.phase = "finished"
    try {
      try {
        if ("error" in outcome) task.onError?.(outcome.error)
        else if (outcome.value !== undefined) task.onResolved?.(outcome.value)
      } finally {
        task.onSettled?.()
      }
    } catch (error) {
      task.reject(error)
      return
    }
    if ("error" in outcome) task.reject(outcome.error)
    else task.resolve(outcome.value)
  }
}

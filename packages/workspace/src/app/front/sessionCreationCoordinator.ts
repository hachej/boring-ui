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

export interface SessionCreationCoordinatorRuntime<TSession extends SessionCreationResult> {
  sourceKey: string
  validateResult: (value: unknown) => TSession
  ownerIsCurrent: () => boolean
  ownershipReady: boolean
  mounted: boolean
}

export type SessionCreationOutcome<TSession extends SessionCreationResult> =
  | { value: TSession | undefined }
  | { error: unknown }

/** Serializes creates for one authoritative session source and fences stale settlements. */
export class SessionCreationCoordinator<TSession extends SessionCreationResult> {
  private active: SessionCreationTask<TSession> | null = null
  private queue: SessionCreationTask<TSession>[] = []
  private resetting = false

  constructor(private runtime: SessionCreationCoordinatorRuntime<TSession>) {}

  update(runtime: SessionCreationCoordinatorRuntime<TSession>): void {
    const sourceChanged = runtime.sourceKey !== this.runtime.sourceKey
    this.runtime = runtime
    if (sourceChanged) {
      this.resetting = true
      try { this.cancel(() => true) } finally { this.resetting = false }
    }
    if (!this.available()) this.cancel(() => true)
    this.drain()
  }

  coordinate(options: CoordinateSessionCreateOptions<TSession>): Promise<TSession | undefined> {
    if (this.resetting) {
      return Promise.reject(Object.assign(
        new Error("Session creation coordinator is resetting"),
        { code: "SESSION_CREATE_COORDINATOR_UNAVAILABLE" as const },
      ))
    }
    if (!this.available()) return Promise.resolve(undefined)
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
      sourceKey: this.runtime.sourceKey,
      phase: "queued",
      promise,
      resolve,
      reject,
    })
    this.drain()
    return promise
  }

  cancel(matches: (task: SessionCreationTask<TSession>) => boolean): void {
    const active = this.active
    const canceled = this.queue.filter(matches)
    this.queue = this.queue.filter((task) => !canceled.includes(task))
    if (active && matches(active)) {
      this.active = null
      this.settleTask(active, { value: undefined })
    }
    for (const task of canceled) this.settleTask(task, { value: undefined })
    this.drainSoon()
  }

  private available(task?: SessionCreationTask<TSession>): boolean {
    return this.runtime.mounted
      && this.runtime.ownershipReady
      && this.runtime.ownerIsCurrent()
      && (task === undefined || task.sourceKey === this.runtime.sourceKey)
  }

  private drain(): void {
    if (this.active || !this.available()) return
    const task = this.queue.shift()
    if (!task) return
    task.phase = "active"
    this.active = task
    void Promise.resolve().then(async () => {
      if (this.active !== task || !this.available(task)) {
        this.cancel((candidate) => candidate === task)
        return
      }
      try {
        const value = await task.create()
        if (this.active !== task) return
        if (!this.available(task)) {
          this.cancel((candidate) => candidate === task)
          return
        }
        let session: TSession
        try {
          session = this.runtime.validateResult(value)
        } catch (error) {
          this.finish(task, { error })
          return
        }
        this.finish(task, { value: session })
      } catch (error) {
        if (this.active !== task) return
        if (!this.available(task)) this.cancel((candidate) => candidate === task)
        else this.finish(task, { error })
      }
    }).finally(() => this.drainSoon())
  }

  private drainSoon(): void {
    queueMicrotask(() => this.drain())
  }

  private finish(task: SessionCreationTask<TSession>, outcome: SessionCreationOutcome<TSession>): void {
    if (this.active !== task || task.phase === "finished") return
    this.active = null
    this.settleTask(task, outcome)
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

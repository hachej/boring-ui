export type CircuitBreakerState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  windowMs?: number
  openDurationMs?: number
  minRequestCount?: number
  failureRateThreshold?: number
  consecutiveFailuresToOpen?: number
  backoffDelaysMs?: readonly number[]
}

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_OPEN_DURATION_MS = 30_000
const DEFAULT_MIN_REQUEST_COUNT = 20
const DEFAULT_FAILURE_RATE_THRESHOLD = 0.5
const DEFAULT_CONSECUTIVE_FAILURES_TO_OPEN = 5
const DEFAULT_BACKOFF_DELAYS_MS = [100, 400, 1_600] as const

interface OutcomeSample {
  atMs: number
  success: boolean
}

export class CircuitOpenError extends Error {
  readonly errorCode = 'CIRCUIT_OPEN' as const
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super('circuit breaker is open')
    this.name = 'CircuitOpenError'
    this.retryAfterMs = retryAfterMs
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed'
  private openUntilMs = 0
  private consecutiveFailures = 0
  private readonly outcomes: OutcomeSample[] = []
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly windowMs: number
  private readonly openDurationMs: number
  private readonly minRequestCount: number
  private readonly failureRateThreshold: number
  private readonly consecutiveFailuresToOpen: number
  private readonly backoffDelaysMs: readonly number[]

  constructor(opts: CircuitBreakerOptions = {}) {
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS
    this.openDurationMs = opts.openDurationMs ?? DEFAULT_OPEN_DURATION_MS
    this.minRequestCount = opts.minRequestCount ?? DEFAULT_MIN_REQUEST_COUNT
    this.failureRateThreshold = opts.failureRateThreshold ?? DEFAULT_FAILURE_RATE_THRESHOLD
    this.consecutiveFailuresToOpen =
      opts.consecutiveFailuresToOpen ?? DEFAULT_CONSECUTIVE_FAILURES_TO_OPEN
    this.backoffDelaysMs = opts.backoffDelaysMs ?? DEFAULT_BACKOFF_DELAYS_MS
  }

  getState(): CircuitBreakerState {
    this.maybeTransitionFromOpen()
    return this.state
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.maybeTransitionFromOpen()
    if (this.state === 'open') {
      throw new CircuitOpenError(Math.max(this.openUntilMs - this.now(), 0))
    }

    const allowRetries = this.state === 'closed'

    try {
      const result = await this.executeWithRetries(operation, allowRetries)
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure()
      throw error
    }
  }

  private async executeWithRetries<T>(
    operation: () => Promise<T>,
    allowRetries: boolean,
  ): Promise<T> {
    const maxAttempts = allowRetries ? this.backoffDelaysMs.length + 1 : 1
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        if (attempt === maxAttempts - 1) {
          break
        }
        await this.sleep(this.backoffDelaysMs[attempt] ?? 0)
      }
    }

    throw lastError
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0
    this.pushOutcome(true)
    if (this.state === 'half-open') {
      this.state = 'closed'
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1
    this.pushOutcome(false)
    if (this.shouldOpenCircuit()) {
      this.state = 'open'
      this.openUntilMs = this.now() + this.openDurationMs
    }
  }

  private shouldOpenCircuit(): boolean {
    if (this.state === 'half-open') {
      return true
    }

    if (this.consecutiveFailures >= this.consecutiveFailuresToOpen) {
      return true
    }

    if (this.outcomes.length < this.minRequestCount) {
      return false
    }

    const failures = this.outcomes.reduce((count, sample) => {
      return sample.success ? count : count + 1
    }, 0)

    return failures / this.outcomes.length >= this.failureRateThreshold
  }

  private pushOutcome(success: boolean): void {
    const cutoffMs = this.now() - this.windowMs
    this.outcomes.push({ atMs: this.now(), success })
    while (this.outcomes.length > 0 && this.outcomes[0].atMs < cutoffMs) {
      this.outcomes.shift()
    }
  }

  private maybeTransitionFromOpen(): void {
    if (this.state === 'open' && this.now() >= this.openUntilMs) {
      this.state = 'half-open'
    }
  }
}
